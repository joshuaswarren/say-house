import type { Action, AppConfig, Target } from "@/lib/types";
import { brightnessPct, wordSet } from "@/lib/normalize";

const OFF_WORDS = new Set(["off", "out", "dark"]);

export function allowedActions(target: Target): Action[] {
  if (target.actions && target.actions.length > 0) return target.actions;
  if (target.kind === "scene") return ["activate_scene"];
  const actions: Action[] = ["turn_on", "turn_off"];
  if (target.brightness) actions.push("set_brightness");
  return actions;
}

export function familyHint(target: Target, targets: Target[]): string {
  if (!target.family) return "";
  const names = targets
    .filter((item) => item.family === target.family && item.alias !== target.alias)
    .map((item) => item.alias);
  if (names.length === 0) return "";
  return ` You can say ${names.join(", ")}.`;
}

export function chooseAction(
  utterance: string,
  target: Target,
  targets: Target[],
): { ok: true; action: Action; brightnessPct: number | null } | { ok: false; reply: string } {
  const allowed = allowedActions(target);
  const words = wordSet(utterance);
  const wantsOff = [...OFF_WORDS].some((word) => words.has(word));
  const wantsOn = words.has("on");
  const pct = brightnessPct(utterance);
  const wantsLevel = pct != null || words.has("bright") || words.has("dim");

  if (target.kind === "scene") {
    if (wantsOff) {
      const room = targets.find((item) => item.family === target.family && item.kind === "light");
      const extra = room ? ` Say “${room.alias} off” to turn the lights off.` : "";
      return {
        ok: false,
        reply: `${target.label} is a scene, so it doesn't switch off.${extra}`,
      };
    }
    return { ok: true, action: "activate_scene", brightnessPct: null };
  }

  if (wantsOn && !allowed.includes("turn_on")) {
    return {
      ok: false,
      reply: `I won't turn on ${lowerFirst(target.label)} from here. ${describeAllowed(target)}`,
    };
  }

  if (wantsOff && wantsOn) {
    return { ok: false, reply: `Do you want ${lowerFirst(target.label)} on or off?` };
  }

  if (wantsOff) {
    if (!allowed.includes("turn_off")) {
      return { ok: false, reply: describeAllowed(target) };
    }
    return { ok: true, action: "turn_off", brightnessPct: null };
  }

  if (wantsLevel) {
    if (!allowed.includes("set_brightness")) {
      return {
        ok: false,
        reply: `${target.label} doesn't take a brightness from here.${familyHint(target, targets)}`,
      };
    }
    const level = pct === 0 ? 0 : (pct ?? (words.has("dim") ? 30 : 100));
    if (level === 0 && allowed.includes("turn_off")) {
      return { ok: true, action: "turn_off", brightnessPct: null };
    }
    return { ok: true, action: "set_brightness", brightnessPct: level };
  }

  if (wantsOn) {
    return { ok: true, action: "turn_on", brightnessPct: null };
  }

  if (allowed.length === 1) {
    return { ok: true, action: allowed[0], brightnessPct: null };
  }

  return {
    ok: false,
    reply: `Do you want ${lowerFirst(target.label)} on or off?`,
  };
}

export function coerceIntentAction(
  action: Action,
  brightness: number | null,
  target: Target,
  targets: Target[],
): { ok: true; action: Action; brightnessPct: number | null } | { ok: false; reply: string } {
  const allowed = allowedActions(target);

  if (target.kind === "scene") {
    if (action === "turn_off") {
      const room = targets.find((item) => item.family === target.family && item.kind === "light");
      const extra = room ? ` Say “${room.alias} off” to turn the lights off.` : "";
      return {
        ok: false,
        reply: `${target.label} is a scene, so it doesn't switch off.${extra}`,
      };
    }
    return { ok: true, action: "activate_scene", brightnessPct: null };
  }

  const resolved: Action = action === "activate_scene" ? "turn_on" : action;
  if (!allowed.includes(resolved)) {
    return {
      ok: false,
      reply: `${describeAllowed(target)}${familyHint(target, targets)}`,
    };
  }
  if (resolved === "set_brightness") {
    const level = clamp(brightness ?? 100);
    if (level === 0 && allowed.includes("turn_off")) {
      return { ok: true, action: "turn_off", brightnessPct: null };
    }
    return { ok: true, action: "set_brightness", brightnessPct: level };
  }
  return { ok: true, action: resolved, brightnessPct: null };
}

export function serviceName(action: Action): "scene.turn_on" | "light.turn_on" | "light.turn_off" {
  if (action === "activate_scene") return "scene.turn_on";
  if (action === "turn_off") return "light.turn_off";
  return "light.turn_on";
}

export function entityIdsFor(target: Target): string[] {
  return target.homeassistant?.entityIds ?? [];
}

export function successSentence(target: Target, action: Action, level: number | null): string {
  if (action === "turn_off" && target.offSaid) return target.offSaid;
  if (action !== "turn_off" && target.onSaid) return target.onSaid;
  if (action === "set_brightness") {
    return `${target.label} ${plural(target.label) ? "are" : "is"} at ${level ?? 100}%.`;
  }
  const state = action === "turn_off" ? "off" : "on";
  const verb = plural(target.label) ? "are" : "is";
  return `${target.label} ${verb} ${state}.`;
}

export function asideSentence(utterance: string, target: Target): string {
  if (!target.aside || !target.asideWhen?.length) return "";
  const words = wordSet(utterance);
  const hit = target.asideWhen.some((trigger) => {
    const triggerWords = [...wordSet(trigger)];
    return triggerWords.length > 0 && triggerWords.every((word) => words.has(word));
  });
  return hit ? ` ${target.aside}` : "";
}

export function unknownReply(config: AppConfig): string {
  const examples = (config.suggestions.length > 0 ? config.suggestions : config.targets.map((target) => target.alias)).slice(
    0,
    5,
  );
  if (examples.length === 0) {
    return "That isn't on the allowlist.";
  }
  return `That isn't on the allowlist. You can say ${examples.join(", ")}.`;
}

function describeAllowed(target: Target): string {
  const allowed = allowedActions(target);
  if (allowed.length === 1 && allowed[0] === "turn_off") {
    return `I can only turn off ${lowerFirst(target.label)}.`;
  }
  if (allowed.length === 1 && allowed[0] === "activate_scene") {
    return `${target.label} is a scene I can turn on.`;
  }
  return `I can turn ${lowerFirst(target.label)} on or off.`;
}

function plural(label: string): boolean {
  return /\blights$/i.test(label);
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function clamp(value: number): number {
  if (Number.isNaN(value)) return 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}
