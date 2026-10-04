import { AllowlistError } from "@/lib/errors";
import type { Target } from "@/lib/types";

// Hard deny runs even when a target is on the allowlist.
// Home Assistant calls are only light.turn_on, light.turn_off, and scene.turn_on.
// switch.automation_all_lights_off enables a Hue schedule; it is not an off button.

const ALLOWED_DOMAINS = new Set(["light", "scene"]);

const BLOCKED_TOKENS = [
  "garage",
  "unvr",
  "eufy",
  "siren",
  "camera",
  "thermostat",
  "pool",
  "heater",
  "linktap",
  "rachio",
  "sprinkler",
  "irrigation",
  "vacuum",
  "roomba",
  "hvac",
  "vent",
  "vents",
  "damper",
  "tesla",
  "lock",
  "unlock",
  "deadbolt",
  "alarm",
  "script",
  "schedule",
  "automation",
  "cover",
  "blinds",
  "water",
  "waterfall",
  "valve",
  "security",
] as const;

const UTTERANCE_RULES: { pattern: RegExp; reply: string }[] = [
  {
    pattern: /\b(?:unlock|lock|locked|locks|deadbolt)\b/,
    reply: "I don't touch locks.",
  },
  {
    pattern: /\bgarage\b/,
    reply: "I don't control the garage, including lights or buttons with garage in the name.",
  },
  {
    pattern: /\b(?:alarm|alarms|disarm|siren|eufy|unvr)\b/,
    reply: "Alarms, sirens, and security panels stay off limits.",
  },
  {
    pattern: /\b(?:camera|cameras|security|gate camera)\b/,
    reply: "Cameras and security devices stay off limits, including the gate camera light.",
  },
  {
    pattern: /\b(?:thermostat|climate|pool heater|pool heat|hvac|air vent|damper)\b|\bvents?\b/,
    reply: "Thermostats, pool heat, and HVAC vents aren't on the allowlist.",
  },
  {
    pattern: /\b(?:sprinkler|irrigation|rachio|linktap|waterfall|water)\b/,
    reply: "I don't run water, sprinklers, or irrigation.",
  },
  {
    pattern: /\b(?:vacuum|roomba)\b/,
    reply: "I don't start the vacuum.",
  },
  {
    pattern: /\b(?:tesla|car lock|charge port)\b/,
    reply: "I don't control the car.",
  },
  {
    pattern: /\b(?:blinds?|covers?|garage door)\b/,
    reply: "I don't open covers, blinds, or doors.",
  },
  {
    pattern: /\b(?:script|scripts|schedule|automation switch)\b/,
    reply:
      "I don't run scripts or Hue schedule switches. Turning all lights off has to be the room lights, not an automation switch.",
  },
];

export function entityTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function blockedToken(value: string): string | null {
  const tokens = new Set(entityTokens(value));
  for (const token of BLOCKED_TOKENS) {
    if (tokens.has(token)) return token;
  }
  return null;
}

export function entityBlockReason(entityId: string): string | null {
  const id = entityId.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*\.[a-z0-9_]+$/.test(id)) {
    return `${entityId} is not a Home Assistant entity id I will call.`;
  }
  const domain = id.split(".")[0] ?? "";
  if (!ALLOWED_DOMAINS.has(domain)) {
    return `${entityId} is blocked. Say House only calls light.turn_on, light.turn_off, and scene.turn_on. Switches, scripts, locks, and schedules stay untouched.`;
  }
  const token = blockedToken(id);
  if (token) {
    return `${entityId} is blocked because it matches “${token}”.`;
  }
  return null;
}

export function textBlockReason(value: string): string | null {
  const token = blockedToken(value);
  if (!token) return null;
  return `“${value}” is blocked because it matches “${token}”.`;
}

export function denyUtterance(text: string): string | null {
  for (const rule of UTTERANCE_RULES) {
    if (rule.pattern.test(text.toLowerCase())) return rule.reply;
  }
  return null;
}

export function assertTargetAllowed(target: Target): void {
  const labelReason = textBlockReason(target.alias) ?? textBlockReason(target.label);
  if (labelReason) throw new AllowlistError(labelReason);
  for (const entityId of target.homeassistant?.entityIds ?? []) {
    const reason = entityBlockReason(entityId);
    if (reason) throw new AllowlistError(reason);
    const domain = entityId.split(".")[0];
    if (target.kind === "scene" && domain !== "scene") {
      throw new AllowlistError(
        `${entityId} can't be used for “${target.alias}”. Scenes are started with scene.turn_on.`,
      );
    }
    if (target.kind === "light" && domain !== "light") {
      throw new AllowlistError(
        `${entityId} can't be used for “${target.alias}”. Rooms and lights use light.turn_on or light.turn_off on the Hue room or zone, not a switch.`,
      );
    }
  }
}
