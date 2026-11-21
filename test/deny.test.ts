import test from "node:test";
import assert from "node:assert/strict";

import {
  assertTargetAllowed,
  blockedToken,
  denyUtterance,
  entityBlockReason,
  entityTokens,
  textBlockReason,
} from "@/lib/deny";
import { AllowlistError } from "@/lib/errors";
import type { Target } from "@/lib/types";

test("entityTokens lowercases and splits on non-alphanumerics", () => {
  const cases: [string, string[]][] = [
    ["light.kitchen_main", ["light", "kitchen", "main"]],
    ["Garage Door", ["garage", "door"]],
    ["", []],
    ["light..double", ["light", "double"]],
  ];
  for (const [input, want] of cases) {
    assert.deepEqual(entityTokens(input), want, input);
  }
});

test("blockedToken matches whole tokens only", () => {
  const cases: [string, string | null][] = [
    ["light.garage_door", "garage"],
    ["pool house lights", "pool"],
    ["poolhouse", null], // substring does not count
    ["kitchen", null],
    ["my lockbox", null], // "lockbox" is not the token "lock"
  ];
  for (const [input, want] of cases) {
    assert.equal(blockedToken(input), want, input);
  }
  assert.equal(blockedToken("lock box"), "lock");
});

test("entityBlockReason: allowed light/scene ids pass", () => {
  for (const id of ["light.kitchen", "scene.movie_night", "LIGHT.KITCHEN"]) {
    assert.equal(entityBlockReason(id), null, id);
  }
});

test("entityBlockReason: non-entity strings refused", () => {
  for (const id of ["garage", "light.", "", " light kitchen", "light.kitchen!"]) {
    const reason = entityBlockReason(id);
    assert.ok(reason?.includes("is not a Home Assistant entity id"), `${id} -> ${reason}`);
  }
});

test("entityBlockReason: domains other than light/scene refused", () => {
  for (const id of [
    "switch.porch",
    "lock.front_door",
    "switch.automation_all_lights_off",
    "script.morning",
    "binary_sensor.door",
  ]) {
    const reason = entityBlockReason(id);
    assert.ok(
      reason?.includes("only calls light.turn_on, light.turn_off, and scene.turn_on"),
      `${id} -> ${reason}`,
    );
  }
});

test("entityBlockReason: allowlisted domain plus blocked token refused by name", () => {
  const cases: [string, string][] = [
    ["light.garage_door", "garage"],
    ["light.pool_lamp", "pool"],
    ["scene.lock_down", "lock"],
    ["light.vent_fan", "vent"],
  ];
  for (const [id, token] of cases) {
    assert.equal(entityBlockReason(id), `${id} is blocked because it matches “${token}”.`, id);
  }
});

test("textBlockReason quotes the utterance and the token", () => {
  assert.equal(
    textBlockReason("turn on the garage light"),
    "“turn on the garage light” is blocked because it matches “garage”.",
  );
  assert.equal(textBlockReason("kitchen lights"), null);
});

test("denyUtterance: first matching rule wins, each with its fixed reply", () => {
  const cases: [string, string | null][] = [
    ["unlock the door", "I don't touch locks."],
    ["lock the tesla", "I don't touch locks."], // lock rule precedes the car rule
    ["turn on the garage lights", "I don't control the garage, including lights or buttons with garage in the name."],
    ["open the garage door", "I don't control the garage, including lights or buttons with garage in the name."],
    ["disarm the alarm", "Alarms, sirens, and security panels stay off limits."],
    ["the gate camera light", "Cameras and security devices stay off limits, including the gate camera light."],
    ["set the thermostat to 70", "Thermostats, pool heat, and HVAC vents aren't on the allowlist."],
    ["turn on the sprinkler", "I don't run water, sprinklers, or irrigation."],
    ["turn on the sprinklers", null], // the rule matches the singular token only
    ["start the roomba", "I don't start the vacuum."],
    ["charge the tesla", "I don't control the car."],
    ["close the blinds", "I don't open covers, blinds, or doors."],
    ["run the morning schedule", "I don't run scripts or Hue schedule switches. Turning all lights off has to be the room lights, not an automation switch."],
    ["kitchen lights on", null],
    ["turn everything off", null],
  ];
  for (const [utterance, want] of cases) {
    assert.equal(denyUtterance(utterance), want, utterance);
  }
});

function lightTarget(over: Partial<Target> = {}): Target {
  return {
    alias: "kitchen",
    label: "Kitchen lights",
    phrases: ["kitchen"],
    kind: "light",
    homeassistant: { entityIds: ["light.kitchen"] },
    ...over,
  };
}

test("assertTargetAllowed passes clean light and scene targets", () => {
  assert.doesNotThrow(() => assertTargetAllowed(lightTarget()));
  assert.doesNotThrow(() =>
    assertTargetAllowed(lightTarget({
      alias: "movie night",
      label: "Movie night",
      kind: "scene",
      homeassistant: { entityIds: ["scene.movie_night"] },
    })),
  );
});

test("assertTargetAllowed blocks on the alias or label text first", () => {
  assert.throws(
    () => assertTargetAllowed(lightTarget({ alias: "garage lamp" })),
    (error: unknown) => error instanceof AllowlistError && /matches “garage”/.test(String(error)),
  );
});

test("assertTargetAllowed blocks entity ids even on a clean target", () => {
  assert.throws(
    () => assertTargetAllowed(lightTarget({ homeassistant: { entityIds: ["light.garage_lamp"] } })),
    /light\.garage_lamp is blocked because it matches “garage”/,
  );
  assert.throws(
    () => assertTargetAllowed(lightTarget({ homeassistant: { entityIds: ["switch.porch"] } })),
    /only calls light\.turn_on/,
  );
});

test("assertTargetAllowed enforces kind/entity domain agreement", () => {
  assert.throws(
    () => assertTargetAllowed(lightTarget({
      kind: "scene",
      homeassistant: { entityIds: ["scene.movie_night", "light.kitchen"] },
    })),
    /Scenes are started with scene\.turn_on/,
  );
  assert.throws(
    () => assertTargetAllowed(lightTarget({ homeassistant: { entityIds: ["scene.movie_night"] } })),
    /Rooms and lights use light\.turn_on or light\.turn_off/,
  );
});
