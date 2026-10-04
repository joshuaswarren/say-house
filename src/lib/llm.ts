import type { AppConfig, ProposedIntent } from "@/lib/types";
import { allowedActions } from "@/lib/policy";

export function buildSystemPrompt(config: AppConfig): string {
  const lines = config.targets.map((target) => {
    const actions = allowedActions(target).join(", ");
    const examples = target.phrases.slice(0, 6).join("; ");
    return `- alias: "${target.alias}" | ${target.kind} | actions: ${actions} | examples: ${examples}`;
  });
  const gaps = config.gaps.map((gap) => `- if they say “${gap.phrases[0]}”: refuse. ${gap.reply}`);
  return [
    "You are the intent parser for Say House, a household lighting assistant.",
    "You do not control devices. You choose one allowlisted alias, or you refuse.",
    "Return a single JSON object and nothing else:",
    '{"action":"turn_on"|"turn_off"|"set_brightness"|"activate_scene"|"refuse","target_alias":string|null,"brightness_pct":number|null,"reason":string}',
    "Rules:",
    "- target_alias must be copied exactly from the allowlist, or null when you refuse.",
    "- Never invent an alias, entity id, room, or scene.",
    "- Scenes use activate_scene. Do not turn a scene into a brightness number.",
    "- Lights use turn_on or turn_off. Use set_brightness only when that alias allows it.",
    "- Locks, garage, alarms, cameras, climate, water, vacuums, scripts, and schedules are always refuse.",
    "- One alias only.",
    "",
    "Allowlist:",
    ...lines,
    "",
    "Refusals already decided by the household:",
    ...(gaps.length > 0 ? gaps : ["- none"]),
  ].join("\n");
}

export async function parseWithLlm(utterance: string, config: AppConfig): Promise<ProposedIntent> {
  if (!config.llm.baseUrl) throw new Error("No LLM base URL.");
  const messages = [
    { role: "system", content: buildSystemPrompt(config) },
    { role: "user", content: utterance },
  ];
  const first = await postChat(config, { ...chatBody(config, messages), response_format: { type: "json_object" }, max_tokens: 300 });
  const body = first.status === 400 ? await postChat(config, chatBody(config, messages)) : first;
  if (!body.ok) {
    throw new Error(`The local model returned ${body.status}.`);
  }
  return intentFromModelText(body.content);
}

function chatBody(config: AppConfig, messages: { role: string; content: string }[]): Record<string, unknown> {
  return {
    model: config.llm.model,
    temperature: 0.1,
    messages,
  };
}

async function postChat(
  config: AppConfig,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; content: string }> {
  const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.llm.apiKey ? { authorization: `Bearer ${config.llm.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.llm.timeoutMs),
  });
  if (response.status === 400) {
    return { ok: false, status: 400, content: "" };
  }
  const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
  const content = payload?.choices?.[0]?.message?.content;
  return {
    ok: response.ok,
    status: response.status,
    content: typeof content === "string" ? content : "",
  };
}

export function intentFromModelText(text: string): ProposedIntent {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model JSON was not an object.");
  }
  const record = parsed as Record<string, unknown>;
  const action = record.action;
  if (
    action !== "turn_on" &&
    action !== "turn_off" &&
    action !== "set_brightness" &&
    action !== "activate_scene" &&
    action !== "refuse"
  ) {
    throw new Error("Model action was not recognized.");
  }
  const alias = typeof record.target_alias === "string" ? record.target_alias.trim() : null;
  const brightness = typeof record.brightness_pct === "number" ? record.brightness_pct : null;
  return {
    action,
    targetAlias: alias && alias.length > 0 ? alias : null,
    brightnessPct: brightness,
  };
}

function extractJson(text: string): string {
  const withoutThoughts = text.replace(/<think>[\s\S]*?<\/think>/gi, " ").replace(/```(?:json)?/gi, " ");
  const start = withoutThoughts.indexOf("{");
  const end = withoutThoughts.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("Model did not return JSON.");
  return withoutThoughts.slice(start, end + 1);
}
