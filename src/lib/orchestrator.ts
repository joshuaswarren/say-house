import { backendStatus, executeCommand } from "@/lib/backends";
import { assertTargetAllowed, denyUtterance } from "@/lib/deny";
import { AllowlistError, HouseError } from "@/lib/errors";
import { parseFallback } from "@/lib/fallback";
import { parseWithLlm } from "@/lib/llm";
import { findGap, gapOutranksTarget } from "@/lib/match";
import { loadConfig } from "@/lib/config";
import { clearPending, confirmationAnswer, getPending, setPending } from "@/lib/pending";
import {
  allowedActions,
  asideSentence,
  coerceIntentAction,
  entityIdsFor,
  serviceName,
  successSentence,
  unknownReply,
} from "@/lib/policy";
import type { Action, AppConfig, ChatResult, ProposedIntent, ResolvedCommand, Target } from "@/lib/types";

const PENDING_MS = 2 * 60 * 1000;

export async function handleUtterance(input: {
  message: string;
  sessionId?: string;
  dryRun?: boolean;
  config?: AppConfig;
}): Promise<ChatResult> {
  const config = input.config ?? loadConfig();
  const sessionId = sanitizeSession(input.sessionId);
  const dryRun = input.dryRun === true || config.dryRunLocked;
  const text = input.message.trim();

  if (!text) {
    return say("Tell me a room or a scene.", "ask", "fallback", false);
  }
  if (text.length > 400) {
    return say("That was a bit long. Try one room or scene.", "ask", "fallback", false);
  }

  const danger = denyUtterance(text);
  if (danger) {
    clearPending(sessionId);
    return say(danger, "refuse", "fallback", false, true);
  }

  const answer = confirmationAnswer(text);
  const pending = getPending(sessionId);
  if (answer && pending) {
    clearPending(sessionId);
    if (answer === "no") return say("Okay. I left everything as it is.", "ok", "confirmation", false);
    return executeResolved(config, sessionId, pending.targetAlias, pending.action, pending.brightnessPct, pending.utterance, dryRun, "confirmation");
  }
  if (answer === "yes") {
    return say("Nothing is waiting for a yes. Tell me what you want the house to do.", "ask", "confirmation", false);
  }
  if (answer === "no") {
    return say("Nothing is waiting to cancel.", "ask", "confirmation", false);
  }
  if (pending) clearPending(sessionId);

  if (config.llm.baseUrl) {
    try {
      const proposal = await parseWithLlm(text, config);
      return applyProposal(config, sessionId, text, proposal, dryRun, "llm", true);
    } catch (error) {
      console.info(`[sayhouse] model unavailable, using keyword backup (${error instanceof Error ? error.message : "unknown"})`);
    }
  }

  const fallback = parseFallback(text, config);
  if (fallback.type === "reply") {
    return say(fallback.reply, fallback.tone, "fallback", false, fallback.refused);
  }
  return applyProposal(config, sessionId, text, fallback.intent, dryRun, "fallback", false);
}

async function applyProposal(
  config: AppConfig,
  sessionId: string,
  utterance: string,
  proposal: ProposedIntent,
  dryRun: boolean,
  parser: ChatResult["parser"],
  modelUsed: boolean,
): Promise<ChatResult> {
  const gap = gapOutranksTarget(utterance, config.gaps, config.targets);
  if (gap) return say(gap.reply, "refuse", parser, modelUsed, true);
  if (proposal.action === "refuse" || !proposal.targetAlias) {
    const named = findGap(utterance, config.gaps);
    return say(named?.gap.reply ?? unknownReply(config), "refuse", parser, modelUsed, true);
  }
  const target = config.targets.find((item) => item.alias === proposal.targetAlias);
  if (!target) return say(unknownReply(config), "refuse", parser, modelUsed, true);
  const coerced = coerceIntentAction(proposal.action, proposal.brightnessPct, target, config.targets);
  if (!coerced.ok) return say(coerced.reply, "ask", parser, modelUsed, false);
  return maybeConfirm(config, sessionId, target, coerced.action, coerced.brightnessPct, utterance, dryRun, parser, modelUsed);
}

async function maybeConfirm(
  config: AppConfig,
  sessionId: string,
  target: Target,
  action: Action,
  brightnessPct: number | null,
  utterance: string,
  dryRun: boolean,
  parser: ChatResult["parser"],
  modelUsed: boolean,
): Promise<ChatResult> {
  if (target.broad && config.confirmBroadActions) {
    setPending(sessionId, {
      targetAlias: target.alias,
      action,
      brightnessPct,
      utterance,
      expires: Date.now() + PENDING_MS,
    });
    const extra = target.confirm ? ` ${target.confirm}` : "";
    const verb = action === "turn_off" ? "Turn off" : "Change";
    return say(
      `${verb} ${lowerFirst(target.label)}?${extra} Say yes to confirm, or no to cancel.`,
      "confirm",
      parser,
      modelUsed,
      false,
    );
  }
  return executeResolved(config, sessionId, target.alias, action, brightnessPct, utterance, dryRun, parser, modelUsed);
}

async function executeResolved(
  config: AppConfig,
  _sessionId: string,
  alias: string,
  action: Action,
  brightnessPct: number | null,
  utterance: string,
  dryRun: boolean,
  parser: ChatResult["parser"],
  modelUsed = false,
): Promise<ChatResult> {
  const target = config.targets.find((item) => item.alias === alias);
  if (!target) return say(unknownReply(config), "refuse", parser, modelUsed, true);
  try {
    assertTargetAllowed(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That target is blocked.";
    return say(message, "refuse", parser, modelUsed, true);
  }
  if (!allowedActions(target).includes(action)) {
    return say(`I can't do that to ${lowerFirst(target.label)}.`, "refuse", parser, modelUsed, true);
  }
  const command: ResolvedCommand = { action, target, brightnessPct, dryRun };
  const ids = entityIdsFor(target);
  console.info(`[sayhouse] ${dryRun ? "dry-run" : config.backend} ${serviceName(action)} ${ids.join(", ") || target.alias}`);
  try {
    const status = backendStatus(config);
    if (!dryRun && !status.ok) throw new HouseError(status.message);
    await executeCommand(config, command);
  } catch (error) {
    if (error instanceof AllowlistError) return say(error.message, "refuse", parser, modelUsed, true);
    const message = error instanceof Error ? error.message : "The house didn't answer.";
    return say(`I understood that, but the house didn't do it. ${message}`, "error", parser, modelUsed, false);
  }
  const sentence = `${successSentence(target, action, brightnessPct)}${asideSentence(utterance, target)}`;
  const reply = dryRun ? `Dry run — I didn't send this. ${sentence}` : sentence;
  return say(reply, "ok", parser, modelUsed, false, !dryRun, dryRun);
}

function say(
  reply: string,
  tone: ChatResult["tone"],
  parser: ChatResult["parser"],
  modelUsed: boolean,
  refused = false,
  executed = false,
  dryRun = false,
): ChatResult {
  return {
    reply,
    parser,
    modelUsed,
    executed,
    dryRun,
    refused,
    tone,
    pendingConfirmation: tone === "confirm" ? { summary: reply } : null,
  };
}

function sanitizeSession(value: string | undefined): string {
  if (value && /^[a-zA-Z0-9_-]{1,64}$/.test(value)) return value;
  return "default";
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
