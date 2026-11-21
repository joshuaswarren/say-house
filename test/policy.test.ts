import test from "node:test";
import assert from "node:assert/strict";

import {
  allowedActions,
  asideSentence,
  chooseAction,
  coerceIntentAction,
  entityIdsFor,
  familyHint,
  serviceName,
  successSentence,
  unknownReply,
} from "@/lib/policy";
import type { Action, AppConfig, Target } from "@/lib/types";

function light(over: Partial<Target> = {}): Target {
  return {
    alias: "kitchen",
    label: "Kitchen lights",
    phrases: ["kitchen"],
    kind: "light",
    brightness: true,
    homeassistant: { entityIds: ["light.kitchen"] },
    ...over,
  };
}

function scene(over: Partial<Target> = {}): Target {
  return {
    alias: "movie night",
    label: "Movie night",
    phrases: ["movie night"],
    kind: "scene",
    homeassistant: { entityIds: ["scene.movie_night"] },
    ...over,
  };
}

const targets = [light(), scene(), light({ alias: "hallway", label: "Hallway light", family: "up" })];

test("allowedActions honors an explicit action list, then kind and brightness", () => {
  const cases: [Target, Action[]][] = [
    [light({ actions: ["turn_off"] }), ["turn_off"]],
    [scene(), ["activate_scene"]],
    [light({ brightness: undefined }), ["turn_on", "turn_off"]],
    [light(), ["turn_on", "turn_off", "set_brightness"]],
  ];
  for (const [target, want] of cases) {
    assert.deepEqual(allowedActions(target), want, target.alias);
  }
});

test("familyHint names same-family siblings, empty without family or siblings", () => {
  const up = [
    light({ alias: "hallway", label: "Hallway light", family: "up" }),
    light({ alias: "landing", label: "Landing light", family: "up" }),
  ];
  assert.equal(familyHint(up[0], up), " You can say landing.");
  assert.equal(familyHint(light(), targets), "");
});

test("chooseAction pins the word rules", () => {
  const cases: [string, Target, Target[], unknown][] = [
    ["kitchen lights off", light(), targets, { ok: true, action: "turn_off", brightnessPct: null }],
    ["kitchen lights on", light(), targets, { ok: true, action: "turn_on", brightnessPct: null }],
    ["turn the kitchen lights up", light(), targets, { ok: false, reply: "Do you want kitchen lights on or off?" }],
    ["kitchen lights on and off", light(), targets, { ok: false, reply: "Do you want kitchen lights on or off?" }],
    ["kitchen to 50%", light(), targets, { ok: true, action: "set_brightness", brightnessPct: 50 }],
    ["kitchen half brightness", light(), targets, { ok: true, action: "set_brightness", brightnessPct: 50 }],
    ["dim the kitchen", light(), targets, { ok: true, action: "set_brightness", brightnessPct: 30 }],
    ["kitchen lights to 0%", light(), targets, { ok: true, action: "turn_off", brightnessPct: null }],
    ["movie night", scene(), targets, { ok: true, action: "activate_scene", brightnessPct: null }],
    ["movie night off", scene(), targets, { ok: false, reply: "Movie night is a scene, so it doesn't switch off. Say “kitchen off” to turn the lights off." }], // targets with no family count as same-family
  ];
  for (const [utterance, target, all, want] of cases) {
    assert.deepEqual(chooseAction(utterance, target, all), want, utterance);
  }
});

test("chooseAction: scene-off names a same-family light when there is one", () => {
  const family = [scene({ family: "den" }), light({ alias: "den", label: "Den lights", family: "den" })];
  assert.deepEqual(chooseAction("movie night off", family[0], family), {
    ok: false,
    reply: "Movie night is a scene, so it doesn't switch off. Say “den off” to turn the lights off.",
  });
});

test("chooseAction: refusal shapes for restricted action lists", () => {
  const offOnly = light({ actions: ["turn_off"], brightness: undefined });
  assert.deepEqual(chooseAction("kitchen on", offOnly, targets), {
    ok: false,
    reply: "I won't turn on kitchen lights from here. I can only turn off kitchen lights.",
  });
  const noBrightness = light({ brightness: undefined });
  assert.deepEqual(chooseAction("kitchen to 50%", noBrightness, targets), {
    ok: false,
    reply: "Kitchen lights doesn't take a brightness from here.",
  });
  const single = light({ actions: ["turn_off"], brightness: undefined });
  assert.deepEqual(chooseAction("kitchen", single, targets), {
    ok: true,
    action: "turn_off",
    brightnessPct: null,
  });
});

test("coerceIntentAction pins the intent cleanup rules", () => {
  const cases: [Action, number | null, Target, Target[], unknown][] = [
    ["turn_on", null, scene(), targets, { ok: true, action: "activate_scene", brightnessPct: null }],
    ["turn_off", null, scene(), targets, { ok: false, reply: "Movie night is a scene, so it doesn't switch off. Say “kitchen off” to turn the lights off." }],
    ["activate_scene", null, light(), targets, { ok: true, action: "turn_on", brightnessPct: null }],
    ["set_brightness", 130, light(), targets, { ok: true, action: "set_brightness", brightnessPct: 100 }],
    ["set_brightness", 0, light(), targets, { ok: true, action: "turn_off", brightnessPct: null }],
    ["set_brightness", null, light(), targets, { ok: true, action: "set_brightness", brightnessPct: 100 }],
    ["set_brightness", 50, light({ brightness: undefined }), targets, { ok: false, reply: "I can turn kitchen lights on or off." }],
  ];
  for (const [action, level, target, all, want] of cases) {
    assert.deepEqual(coerceIntentAction(action, level, target, all), want, `${action} ${level} on ${target.alias}`);
  }
});

test("serviceName maps every action", () => {
  const cases: [Action, string][] = [
    ["activate_scene", "scene.turn_on"],
    ["turn_off", "light.turn_off"],
    ["turn_on", "light.turn_on"],
    ["set_brightness", "light.turn_on"],
  ];
  for (const [action, want] of cases) {
    assert.equal(serviceName(action), want, action);
  }
});

test("entityIdsFor returns the homeassistant list or empty", () => {
  assert.deepEqual(entityIdsFor(light()), ["light.kitchen"]);
  assert.deepEqual(entityIdsFor(light({ homeassistant: undefined })), []);
});

test("successSentence uses overrides, plural agreement, and the level", () => {
  const cases: [Target, Action, number | null, string][] = [
    [light({ offSaid: "Kitchen is dark." }), "turn_off", null, "Kitchen is dark."],
    [light({ onSaid: "Kitchen is lit." }), "turn_on", null, "Kitchen is lit."],
    [light(), "turn_off", null, "Kitchen lights are off."],
    [light({ label: "Porch" }), "turn_on", null, "Porch is on."],
    [light(), "set_brightness", 40, "Kitchen lights are at 40%."],
    [light({ label: "Porch" }), "set_brightness", null, "Porch is at 100%."],
  ];
  for (const [target, action, level, want] of cases) {
    assert.equal(successSentence(target, action, level), want);
  }
});

test("asideSentence fires only when every trigger word is present", () => {
  const target = light({ aside: "The dog is out back.", asideWhen: ["kitchen off"] });
  assert.equal(asideSentence("turn the kitchen lights off", target), " The dog is out back.");
  assert.equal(asideSentence("kitchen lights on", target), "");
  assert.equal(asideSentence("kitchen", light()), "");
});

test("unknownReply prefers suggestions, then aliases, then the bare refusal", () => {
  const base = {
    sourceName: "t", householdName: "t", tagline: "", backend: "mock" as const,
    confirmBroadActions: false, dryRunLocked: false, gaps: [],
    llm: { baseUrl: null, model: "", apiKey: "", timeoutMs: 0 },
    homeassistant: { url: null, token: null },
    hue: { bridgeHost: null, appKey: null, port: 443 },
  };
  const withSuggestions: AppConfig = { ...base, suggestions: ["kitchen", "movie night"], targets };
  assert.equal(
    unknownReply(withSuggestions),
    "That isn't on the allowlist. You can say kitchen, movie night.",
  );
  const noSuggestions: AppConfig = { ...base, suggestions: [], targets };
  assert.equal(
    unknownReply(noSuggestions),
    "That isn't on the allowlist. You can say kitchen, movie night, hallway.",
  );
  const empty: AppConfig = { ...base, suggestions: [], targets: [] };
  assert.equal(unknownReply(empty), "That isn't on the allowlist.");
});
