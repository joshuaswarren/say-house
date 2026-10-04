import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { assertTargetAllowed } from "@/lib/deny";
import { AllowlistError } from "@/lib/errors";
import type { Action, AppConfig, BackendKind, Gap, HueResource, HueRtype, Target, TargetKind } from "@/lib/types";

const ACTIONS: readonly Action[] = ["turn_on", "turn_off", "set_brightness", "activate_scene"];
const HUE_RTYPES: readonly HueRtype[] = ["light", "grouped_light", "scene"];

type Env = Record<string, string | undefined>;

export const DEFAULT_LLM_MODEL = "qwen3.8-27b-64k-nothink";

export function loadConfig(options?: { path?: string; env?: Env }): AppConfig {
  const env = options?.env ?? process.env;
  const filePath = resolveConfigPath(options?.path ?? envString(env, "SAYHOUSE_CONFIG"));
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parse(raw);
  return configFromUnknown(parsed, path.basename(filePath), env);
}

export function configFromUnknown(value: unknown, sourceName: string, env: Env = {}): AppConfig {
  const root = asRecord(value, "config");
  const backend = backendKind(envString(env, "BACKEND") ?? stringField(root, "backend") ?? "mock");
  const llm = asRecord(root.llm ?? {}, "llm");
  const targets = asArray(root.targets, "targets").map((entry, index) => parseTarget(entry, index));
  if (targets.length === 0) throw new AllowlistError("Add at least one target to the allowlist.");
  for (const target of targets) assertTargetAllowed(target);
  const aliases = new Set<string>();
  for (const target of targets) {
    if (aliases.has(target.alias)) throw new AllowlistError(`Duplicate alias “${target.alias}”.`);
    aliases.add(target.alias);
  }

  const suggestions = stringList(root.suggestions);
  const hueHost = parseBridgeHost(envString(env, "HUE_BRIDGE_IP"));
  const huePort = numberField(env, "HUE_PORT") ?? hueHost.port ?? 443;

  return {
    sourceName,
    householdName: stringField(root, "household_name") ?? "Home",
    tagline: stringField(root, "tagline") ?? "Plain English for the lights on your allowlist.",
    backend,
    confirmBroadActions: root.confirm_broad_actions !== false,
    dryRunLocked: truthy(envString(env, "DRY_RUN")),
    suggestions: suggestions.length > 0 ? suggestions : defaultSuggestions(targets),
    gaps: asArray(root.gaps ?? [], "gaps").map((entry, index) => parseGap(entry, index)),
    targets,
    llm: {
      baseUrl: stripSlash(envString(env, "LLM_BASE_URL")),
      model: envString(env, "LLM_MODEL") ?? stringField(llm, "model") ?? DEFAULT_LLM_MODEL,
      apiKey:
        envString(env, "LLM_API_KEY") ?? envString(env, "LITELLM_API_KEY") ?? envString(env, "OPENAI_API_KEY") ?? "",
      timeoutMs: numberField(env, "LLM_TIMEOUT_MS") ?? 25000,
    },
    homeassistant: {
      url: cleanOrigin(envString(env, "HA_URL")),
      token: envString(env, "HA_TOKEN") ?? envString(env, "HASS_TOKEN"),
    },
    hue: {
      bridgeHost: hueHost.host,
      appKey: envString(env, "HUE_APP_KEY"),
      port: huePort,
    },
  };
}

function resolveConfigPath(explicit: string | null): string {
  const requested =
    explicit ??
    ["config.local.yaml", "config.yaml", "config.example.yaml"].find((name) => fs.existsSync(path.join(process.cwd(), name))) ??
    "config.example.yaml";
  const resolved = path.resolve(process.cwd(), requested);
  const root = path.resolve(process.cwd());
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new AllowlistError("Config path must stay inside the project directory.");
  }
  if (!fs.existsSync(resolved)) {
    throw new AllowlistError(`Config file not found: ${requested}`);
  }
  return resolved;
}

function parseTarget(value: unknown, index: number): Target {
  const record = asRecord(value, `targets[${index}]`);
  const alias = stringField(record, "alias");
  const label = stringField(record, "label") ?? alias;
  if (!alias) throw new AllowlistError(`targets[${index}] needs an alias.`);
  const phrases = stringList(record.phrases);
  if (phrases.length === 0) phrases.push(alias);
  const kind = targetKind(stringField(record, "kind"), alias);
  const actions = record.actions == null ? undefined : asArray(record.actions, `${alias}.actions`).map((entry) => actionName(entry, alias));
  const ha = parseHa(record.homeassistant, alias);
  const hue = parseHue(record.hue, alias);
  if ((!ha || ha.entityIds.length === 0) && hue.length === 0) {
    throw new AllowlistError(`${alias} needs a Home Assistant entity or a Hue resource.`);
  }
  return {
    alias,
    label: label ?? alias,
    phrases,
    kind,
    family: stringField(record, "family"),
    broad: record.broad === true,
    brightness: record.brightness === true,
    actions,
    confirm: stringField(record, "confirm"),
    onSaid: stringField(record, "on_said"),
    offSaid: stringField(record, "off_said"),
    aside: stringField(record, "aside"),
    asideWhen: record.aside_when == null ? undefined : stringList(record.aside_when),
    homeassistant: ha,
    hue,
  };
}

function parseHa(value: unknown, alias: string): { entityIds: string[] } | undefined {
  if (value == null) return undefined;
  const record = asRecord(value, `${alias}.homeassistant`);
  const ids = [
    ...stringList(record.entity_ids),
    ...(stringField(record, "entity_id") ? [stringField(record, "entity_id") as string] : []),
  ].map((id) => id.toLowerCase());
  return { entityIds: [...new Set(ids)] };
}

function parseHue(value: unknown, alias: string): HueResource[] {
  if (value == null) return [];
  const record = asRecord(value, `${alias}.hue`);
  const resources: HueResource[] = [];
  const singleId = stringField(record, "id");
  if (singleId) {
    resources.push({ id: hueId(singleId, alias), rtype: hueRtype(stringField(record, "rtype"), alias) });
  }
  if (record.resources != null) {
    for (const entry of asArray(record.resources, `${alias}.hue.resources`)) {
      const item = asRecord(entry, `${alias}.hue.resources`);
      const id = stringField(item, "id");
      if (!id) throw new AllowlistError(`${alias} has a Hue resource without an id.`);
      resources.push({ id: hueId(id, alias), rtype: hueRtype(stringField(item, "rtype"), alias) });
    }
  }
  return resources;
}

function parseGap(value: unknown, index: number): Gap {
  const record = asRecord(value, `gaps[${index}]`);
  const phrases = stringList(record.phrases);
  const reply = stringField(record, "reply");
  if (phrases.length === 0 || !reply) {
    throw new AllowlistError(`gaps[${index}] needs phrases and a reply.`);
  }
  return { phrases, reply };
}

function defaultSuggestions(targets: Target[]): string[] {
  return targets
    .filter((target) => !target.broad)
    .slice(0, 4)
    .map((target) => target.phrases[0] ?? target.alias);
}

function backendKind(value: string): BackendKind {
  if (value === "mock" || value === "homeassistant" || value === "hue") return value;
  throw new AllowlistError(`Unknown backend “${value}”. Use mock, homeassistant, or hue.`);
}

function targetKind(value: string | undefined, alias: string): TargetKind {
  if (value === "light" || value === "scene") return value;
  throw new AllowlistError(`${alias} kind must be light or scene.`);
}

function actionName(value: unknown, alias: string): Action {
  if (typeof value === "string" && ACTIONS.includes(value as Action)) return value as Action;
  throw new AllowlistError(`${alias} has an unknown action.`);
}

function hueRtype(value: string | undefined, alias: string): HueRtype {
  if (value && HUE_RTYPES.includes(value as HueRtype)) return value as HueRtype;
  throw new AllowlistError(`${alias} Hue rtype must be light, grouped_light, or scene.`);
}

function hueId(value: string, alias: string): string {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) {
    throw new AllowlistError(`${alias} has an invalid Hue id.`);
  }
  return value;
}

function cleanOrigin(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AllowlistError("HA_URL must be an http or https origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AllowlistError("HA_URL must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new AllowlistError("Put the Home Assistant token in HA_TOKEN, not in the URL.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new AllowlistError("HA_URL should be the origin only, for example http://homeassistant.local:8123.");
  }
  return url.origin;
}

function parseBridgeHost(value: string | null): { host: string | null; port?: number } {
  if (!value) return { host: null };
  const stripped = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const [host, portText] = stripped.split(":");
  if (!host || !/^[A-Za-z0-9.-]+$/.test(host)) {
    throw new AllowlistError("HUE_BRIDGE_IP must be a host or IP, with no path.");
  }
  const port = portText ? Number(portText) : undefined;
  if (portText && (!Number.isInteger(port) || port! < 1 || port! > 65535)) {
    throw new AllowlistError("Hue bridge port is invalid.");
  }
  return { host, port };
}

function envString(env: Env, key: string): string | null {
  const value = env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberField(env: Env, key: string): number | null {
  const value = envString(env, key);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AllowlistError(`${key} must be a number.`);
  return parsed;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new AllowlistError("Expected a list of strings.");
  return value.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) throw new AllowlistError("Expected a list of strings.");
    return entry.trim();
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AllowlistError(`${label} must be a map.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new AllowlistError(`${label} must be a list.`);
  return value;
}

function stripSlash(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\/+$/, "");
}

function truthy(value: string | null): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
