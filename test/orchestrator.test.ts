import test from "node:test";
import assert from "node:assert/strict";

import { handleUtterance } from "@/lib/orchestrator";
import { resetPending } from "@/lib/pending";
import { resetMockHouse } from "@/lib/backends/mock";
import type { AppConfig } from "@/lib/types";

function config(over: Partial<AppConfig> = {}): AppConfig {
  return {
    sourceName: "test",
    householdName: "Test House",
    tagline: "",
    backend: "mock",
    confirmBroadActions: true,
    dryRunLocked: false,
    suggestions: ["kitchen", "movie night"],
    gaps: [{ phrases: ["walk the dog"], reply: "I can't help with the dog." }],
    targets: [
      {
        alias: "kitchen",
        label: "Kitchen lights",
        phrases: ["kitchen"],
        kind: "light",
        brightness: true,
        homeassistant: { entityIds: ["light.kitchen"] },
      },
      {
        alias: "downstairs",
        label: "Downstairs",
        phrases: ["downstairs"],
        kind: "light",
        broad: true,
        homeassistant: { entityIds: ["light.downstairs"] },
      },
      {
        alias: "movie night",
        label: "Movie night",
        phrases: ["movie night"],
        kind: "scene",
        homeassistant: { entityIds: ["scene.movie_night"] },
      },
      {
        alias: "porch lamp",
        label: "Porch lamp",
        phrases: ["porch lamp"],
        kind: "light",
        homeassistant: { entityIds: ["light.garage_lamp"] },
      },
    ],
    llm: { baseUrl: null, model: "", apiKey: "", timeoutMs: 0 },
    homeassistant: { url: null, token: null },
    hue: { bridgeHost: null, appKey: null, port: 443 },
    ...over,
  };
}

test.beforeEach(() => {
  resetPending();
  resetMockHouse();
});

test("input guards: empty and overlong messages", async () => {
  const empty = await handleUtterance({ message: "  ", config: config() });
  assert.deepEqual(
    { reply: empty.reply, tone: empty.tone, parser: empty.parser, refused: empty.refused },
    { reply: "Tell me a room or a scene.", tone: "ask", parser: "fallback", refused: false },
  );
  const long = await handleUtterance({ message: "x".repeat(401), config: config() });
  assert.equal(long.reply, "That was a bit long. Try one room or scene.");
  assert.equal(long.tone, "ask");
});

test("a deny utterance refuses through the fallback parser", async () => {
  const result = await handleUtterance({ message: "unlock the front door", config: config() });
  assert.equal(result.reply, "I don't touch locks.");
  assert.equal(result.tone, "refuse");
  assert.equal(result.parser, "fallback");
  assert.equal(result.refused, true);
});

test("a deny utterance clears a pending confirmation", async () => {
  await handleUtterance({ message: "downstairs off", sessionId: "s1", dryRun: true, config: config() });
  const deny = await handleUtterance({ message: "unlock the door", sessionId: "s1", config: config() });
  assert.equal(deny.tone, "refuse");
  const yes = await handleUtterance({ message: "yes", sessionId: "s1", config: config() });
  assert.equal(yes.reply, "Nothing is waiting for a yes. Tell me what you want the house to do.");
});

test("yes and no without a pending action ask again", async () => {
  const yes = await handleUtterance({ message: "yes", sessionId: "s1", config: config() });
  assert.equal(yes.reply, "Nothing is waiting for a yes. Tell me what you want the house to do.");
  const no = await handleUtterance({ message: "no", sessionId: "s1", config: config() });
  assert.equal(no.reply, "Nothing is waiting to cancel.");
});

test("a gap phrase refuses before a target can match", async () => {
  const result = await handleUtterance({ message: "please walk the dog", config: config() });
  assert.equal(result.reply, "I can't help with the dog.");
  assert.equal(result.tone, "refuse");
  assert.equal(result.refused, true);
});

test("an unknown request refuses with the allowlist examples", async () => {
  const result = await handleUtterance({ message: "turn on the observatory", config: config() });
  assert.equal(result.reply, "That isn't on the allowlist. You can say kitchen, movie night.");
  assert.equal(result.tone, "refuse");
  assert.equal(result.refused, true);
});

test("a clean light command executes through the fallback parser", async () => {
  const result = await handleUtterance({ message: "kitchen lights off", config: config() });
  assert.equal(result.reply, "Kitchen lights are off.");
  assert.equal(result.tone, "ok");
  assert.equal(result.executed, true);
  assert.equal(result.refused, false);
});

test("dryRun marks the reply and skips execution", async () => {
  const result = await handleUtterance({ message: "kitchen lights off", dryRun: true, config: config() });
  assert.equal(result.reply, "Dry run — I didn't send this. Kitchen lights are off.");
  assert.equal(result.executed, false);
  assert.equal(result.dryRun, true);
});

test("dryRunLocked forces a dry run even when the input asks to run", async () => {
  const result = await handleUtterance({
    message: "kitchen lights off",
    dryRun: false,
    config: config({ dryRunLocked: true }),
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.executed, false);
});

test("a broad target confirms first, then yes executes and no cancels", async () => {
  const confirm = await handleUtterance({
    message: "downstairs off", sessionId: "s1", dryRun: true, config: config(),
  });
  assert.equal(confirm.tone, "confirm");
  assert.equal(confirm.reply, "Turn off downstairs? Say yes to confirm, or no to cancel.");
  assert.ok(confirm.pendingConfirmation);

  const yes = await handleUtterance({ message: "yes", sessionId: "s1", dryRun: true, config: config() });
  assert.equal(yes.parser, "confirmation");
  assert.equal(yes.reply, "Dry run — I didn't send this. Downstairs is off.");

  await handleUtterance({ message: "downstairs off", sessionId: "s1", dryRun: true, config: config() });
  const no = await handleUtterance({ message: "no", sessionId: "s1", config: config() });
  assert.equal(no.reply, "Okay. I left everything as it is.");
});

test("a pending confirmation does not leak across sessions", async () => {
  await handleUtterance({ message: "downstairs off", sessionId: "s1", dryRun: true, config: config() });
  const other = await handleUtterance({ message: "yes", sessionId: "s2", config: config() });
  assert.equal(other.reply, "Nothing is waiting for a yes. Tell me what you want the house to do.");
});

test("a scene command resolves to a scene activation", async () => {
  const result = await handleUtterance({ message: "movie night", config: config() });
  assert.equal(result.reply, "Movie night is on.");
  assert.equal(result.tone, "ok");
  assert.equal(result.executed, true);
});

test("an allowlisted alias with a blocked entity id still refuses", async () => {
  const result = await handleUtterance({ message: "porch lamp on", config: config() });
  assert.equal(result.tone, "refuse");
  assert.equal(result.refused, true);
  assert.match(result.reply, /light\.garage_lamp is blocked because it matches “garage”/);
});
