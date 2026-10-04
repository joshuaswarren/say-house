import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { resetMockHouse, getMockLog } from "../src/lib/backends/mock";
import { configFromUnknown, DEFAULT_LLM_MODEL, loadConfig } from "../src/lib/config";
import { entityBlockReason } from "../src/lib/deny";
import { parseFallback } from "../src/lib/fallback";
import { buildSystemPrompt, intentFromModelText } from "../src/lib/llm";
import { resetPending } from "../src/lib/pending";
import { handleUtterance } from "../src/lib/orchestrator";
import { joinHeard, speechBlockedReason, speechErrorCopy, transcriptFromResults } from "../src/lib/speech";
import type { AppConfig } from "../src/lib/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function reset() {
  resetMockHouse();
  resetPending();
}

function entityIds(config: AppConfig): string[] {
  return config.targets.flatMap((target) => target.homeassistant?.entityIds ?? []);
}

async function main() {
  const closers: Array<() => Promise<void>> = [];
  try {
    testDenyRules();
    testSpeechCopy();
    testConfigs();
    await testDemoHome();
    await testGenericMock();
    await testLlm(closers);
    await testHomeAssistant(closers);
    await testHue(closers);
    console.log("smoke ok");
  } finally {
    await Promise.all(closers.map((close) => close().catch(() => undefined)));
  }
}

function testSpeechCopy() {
  assert(speechBlockedReason(true, true) === null, "secure browsers with speech stay available");
  assert(
    speechBlockedReason(true, false)?.includes("localhost") === true,
    "insecure pages explain the https or localhost requirement",
  );
  const missing = speechBlockedReason(false, true) ?? "";
  assert(missing.includes("Safari") && missing.includes("type"), "missing speech API points at Safari and typing");
  assert(speechErrorCopy("not-allowed").includes("microphone"), "permission errors name the microphone");
  assert(!speechErrorCopy("network").toLowerCase().includes("vendor key"), "network errors do not ask for a speech vendor");
  const heard = transcriptFromResults([
    { isFinal: true, length: 1, 0: { transcript: "kitchen " } },
    { isFinal: false, length: 1, 0: { transcript: "bri" } },
  ]);
  assert(joinHeard(heard.finalText, heard.interimText) === "kitchen bri", "interim transcript stays visible before the phrase finishes");
  assert(joinHeard("kitchen", "bright") === "kitchen bright", "a finished phrase is the text that gets sent");
}

function testDenyRules() {
  assert(entityBlockReason("switch.automation_all_lights_off"), "schedule switch should be blocked");
  assert(entityBlockReason("light.gate_camera_light"), "gate camera light should be blocked");
  assert(entityBlockReason("script.goodnight"), "scripts should be blocked");
  assert(entityBlockReason("light.waterfall_accent"), "waterfall lights should be blocked");
  assert(entityBlockReason("lock.front_door"), "locks should be blocked");
  assert(entityBlockReason("cover.tesla_charge_port"), "covers should be blocked");
  assert(entityBlockReason("climate.downstairs"), "climate should be blocked");
  assert(entityBlockReason("vacuum.robot"), "vacuums should be blocked");
  assert(entityBlockReason("light.garage_lights"), "garage lights should be blocked");
  assert(entityBlockReason("alarm_control_panel.unvr"), "alarm panels should be blocked");
  assert(!entityBlockReason("light.kitchen"), "kitchen light should be allowed");
  assert(!entityBlockReason("scene.kitchen_bright"), "kitchen bright scene should be allowed");
  assert(!entityBlockReason("scene.kitchen_dimmed"), "kitchen dimmed scene should be allowed");
  assert(!entityBlockReason("light.example_porch"), "an ordinary porch light should be allowed");
  assert(!entityBlockReason("scene.downstairs_nightlight"), "nightlight scene should be allowed");

  let blocked = false;
  try {
    configFromUnknown(
      {
        backend: "mock",
        targets: [
          {
            alias: "all off",
            label: "All off",
            kind: "light",
            phrases: ["all off"],
            actions: ["turn_off"],
            homeassistant: { entity_ids: ["switch.automation_all_lights_off"] },
          },
        ],
      },
      "bad",
      {},
    );
  } catch {
    blocked = true;
  }
  assert(blocked, "config with the Hue schedule switch must fail to load");
}

function testConfigs() {
  const demo = loadConfig({ path: "config.example.demo-home.yaml", env: {} });
  const generic = loadConfig({ path: "config.example.yaml", env: {} });
  assert(demo.backend === "mock", "demo home defaults to mock");
  assert(demo.llm.model === DEFAULT_LLM_MODEL, "demo model alias");
  assert(demo.llm.apiKey === "", "example config does not embed an API key");
  assert(generic.backend === "mock", "generic example defaults to mock");
  const fromLite = loadConfig({
    path: "config.example.yaml",
    env: { LITELLM_API_KEY: "from-litellm", LLM_BASE_URL: "http://127.0.0.1:9/v1" },
  });
  assert(fromLite.llm.apiKey === "from-litellm" && fromLite.llm.baseUrl === "http://127.0.0.1:9/v1", "LiteLLM key");
  const preferred = loadConfig({
    path: "config.example.yaml",
    env: { LLM_API_KEY: "primary", OPENAI_API_KEY: "other", LLM_MODEL: "qwen3.8-27b-64k-fast" },
  });
  assert(preferred.llm.apiKey === "primary" && preferred.llm.model === "qwen3.8-27b-64k-fast", "LLM_API_KEY wins");
  const ids = entityIds(demo);
  assert(!ids.includes("switch.automation_all_lights_off"), "demo allowlist must not call the schedule switch");
  assert(!ids.some((id) => id.includes("camera")), "camera lights stay out of the demo allowlist");
  const outdoor = demo.targets.find((target) => target.alias === "outdoor");
  assert(outdoor, "outdoor alias missing");
  assert(
    JSON.stringify(outdoor.homeassistant?.entityIds) ===
      JSON.stringify([
        "light.yard_light",
        "light.driveway_light",
        "light.front_light_3",
        "light.gazebo_led",
        "light.sidewalk_light",
        "light.garden_light",
      ]),
    "outdoor lights are the six public sample lights",
  );
  const allOff = demo.targets.find((target) => target.alias === "all lights off");
  assert(
    JSON.stringify(allOff?.homeassistant?.entityIds) === JSON.stringify(["light.downstairs", "light.upstairs"]),
    "all lights off is downstairs and upstairs room lights",
  );
  const prompt = buildSystemPrompt({
    ...demo,
    homeassistant: { url: "http://homeassistant.local:8123", token: "super-secret-token" },
    hue: { bridgeHost: "10.0.0.8", appKey: "bridge-secret", port: 443 },
  });
  assert(prompt.includes("kitchen relax"), "prompt lists aliases");
  assert(!prompt.includes("super-secret-token"), "prompt must not include the HA token");
  assert(!prompt.includes("bridge-secret"), "prompt must not include the Hue key");
  assert(!prompt.includes("light.master_bedroom"), "prompt must not include entity ids");
  assert(!ids.includes("scene.kitchen_dimmed_2"), "duplicate kitchen dim scene stays off the list");
  assert(!prompt.includes("switch.automation_all_lights_off"), "prompt must not mention the schedule switch");

  const fenced = intentFromModelText('```json\n{"action":"turn_off","target_alias":"bedroom","brightness_pct":null}\n```');
  assert(fenced.targetAlias === "bedroom" && fenced.action === "turn_off", "json fence parse");
  const thought = intentFromModelText('<think>nope</think>{"action":"refuse","target_alias":null,"brightness_pct":null}');
  assert(thought.action === "refuse", "think tag parse");
}

async function testDemoHome() {
  const config = loadConfig({ path: "config.example.demo-home.yaml", env: {} });
  reset();

  const bright = await handleUtterance({ message: "brighten the kitchen", sessionId: "demo-bright", config });
  assert(bright.executed && bright.parser === "fallback", "kitchen bright should run via fallback");
  assert(getMockLog()[0]?.service === "scene.turn_on", "bright is a scene");
  assert(getMockLog()[0]?.entityIds[0] === "scene.kitchen_bright", "kitchen bright entity");
  assert(bright.reply.includes("bright"), bright.reply);

  reset();
  const dim = await handleUtterance({ message: "dim the kitchen", sessionId: "demo-dim", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.kitchen_dimmed", dim.reply);
  assert(!getMockLog()[0]?.entityIds.includes("scene.kitchen_dimmed_2"), "ignored duplicate dim scene");

  reset();
  const off = await handleUtterance({ message: "turn the kitchen off", sessionId: "demo-off", config });
  assert(getMockLog()[0]?.service === "light.turn_off", off.reply);
  assert(getMockLog()[0]?.entityIds[0] === "light.kitchen", "kitchen off is the room light");

  reset();
  const relax = await handleUtterance({ message: "living room relax", sessionId: "demo-relax", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.living_room_relax", relax.reply);

  reset();
  const movie = await handleUtterance({ message: "movie lights", sessionId: "demo-movie", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.media_room_dimmed", movie.reply);
  assert(movie.reply.includes("media room"), movie.reply);

  reset();
  const night = await handleUtterance({ message: "movie night", sessionId: "demo-night", config });
  assert(night.refused && !night.executed, night.reply);
  assert(getMockLog().length === 0, "movie night must not run a scene");
  assert(night.reply.toLowerCase().includes("movie lights"), night.reply);

  reset();
  const goodnight = await handleUtterance({ message: "goodnight", sessionId: "demo-goodnight", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.downstairs_nightlight", goodnight.reply);
  assert(goodnight.reply.toLowerCase().includes("nightlight"), goodnight.reply);

  reset();
  const bed = await handleUtterance({ message: "bedtime", sessionId: "demo-bed", config });
  assert(bed.refused && getMockLog().length === 0, bed.reply);

  reset();
  const hall = await handleUtterance({ message: "hallway sleep", sessionId: "demo-hall", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.hallway_sleep", hall.reply);

  reset();
  const bedroom = await handleUtterance({ message: "bedroom off", sessionId: "demo-bed-off", config });
  assert(
    getMockLog()[0]?.service === "light.turn_off" && getMockLog()[0]?.entityIds[0] === "light.master_bedroom",
    bedroom.reply,
  );

  reset();
  const outdoor = await handleUtterance({ message: "outdoor on", sessionId: "demo-out", config });
  assert(getMockLog()[0]?.service === "light.turn_on", outdoor.reply);
  assert(getMockLog()[0]?.entityIds.length === 6, "outdoor switches the six sample lights together");
  assert(!getMockLog()[0]?.entityIds.some((id) => id.includes("camera")), "camera lights stay out");

  reset();
  const downstairs = await handleUtterance({ message: "downstairs dim", sessionId: "demo-down", config });
  assert(getMockLog()[0]?.entityIds[0] === "scene.downstairs_dimmed", downstairs.reply);

  reset();
  const mediaOff = await handleUtterance({ message: "turn the media room off", sessionId: "demo-media", config });
  assert(
    getMockLog()[0]?.entityIds[0] === "light.media_room" && getMockLog()[0]?.service === "light.turn_off",
    mediaOff.reply,
  );

  reset();
  const ambiguous = await handleUtterance({ message: "kitchen and living room", sessionId: "demo-both", config });
  assert(!ambiguous.executed && getMockLog().length === 0, ambiguous.reply);

  reset();
  const alone = await handleUtterance({ message: "kitchen", sessionId: "demo-alone", config });
  assert(!alone.executed && alone.reply.toLowerCase().includes("on or off"), alone.reply);

  reset();
  const garage = await handleUtterance({ message: "open the garage", sessionId: "demo-garage", config });
  assert(garage.refused && getMockLog().length === 0, garage.reply);

  reset();
  const camera = await handleUtterance({ message: "turn on the gate camera light", sessionId: "demo-cam", config });
  assert(camera.refused && getMockLog().length === 0, camera.reply);

  reset();
  const formula = await handleUtterance({ message: "energize", sessionId: "demo-formula", config });
  assert(formula.refused && getMockLog().length === 0, formula.reply);

  reset();
  const asked = await handleUtterance({ message: "all lights off", sessionId: "demo-all", config });
  assert(asked.tone === "confirm" && !asked.executed && getMockLog().length === 0, asked.reply);
  assert(asked.reply.toLowerCase().includes("schedule"), asked.reply);
  const other = await handleUtterance({ message: "yes", sessionId: "someone-else", config });
  assert(!other.executed && getMockLog().length === 0, "another session must not confirm");
  const done = await handleUtterance({ message: "yes", sessionId: "demo-all", config });
  assert(done.executed, done.reply);
  assert(getMockLog()[0]?.service === "light.turn_off", "all off uses light.turn_off");
  assert(
    JSON.stringify(getMockLog()[0]?.entityIds) === JSON.stringify(["light.downstairs", "light.upstairs"]),
    "all off targets",
  );

  reset();
  const dry = await handleUtterance({ message: "bedroom off", sessionId: "demo-dry", dryRun: true, config });
  assert(!dry.executed && dry.dryRun && dry.reply.toLowerCase().includes("dry run"), dry.reply);
  assert(getMockLog().length === 0, "dry run sends nothing");

  const fallback = parseFallback("make it cozy where we cook", config);
  assert(fallback.type !== "intent", "cozy cooking is not a keyword hit");
}

async function testGenericMock() {
  const config = loadConfig({ path: "config.example.yaml", env: {} });
  reset();
  const movie = await handleUtterance({ message: "movie night", sessionId: "generic-movie", config });
  assert(movie.executed && getMockLog()[0]?.entityIds[0] === "scene.movie_night", movie.reply);
  reset();
  const bright = await handleUtterance({ message: "kitchen bright", sessionId: "generic-bright", config });
  assert(getMockLog()[0]?.service === "light.turn_on", bright.reply);
  assert(getMockLog()[0]?.brightnessPct === 100, "generic kitchen bright is a brightness, not a scene");
  reset();
  const patio = await handleUtterance({ message: "turn the patio off", sessionId: "generic-patio", config });
  assert(getMockLog()[0]?.entityIds[0] === "light.patio" && getMockLog()[0]?.service === "light.turn_off", patio.reply);
}

async function testLlm(closers: Array<() => Promise<void>>) {
  const hits: { raw: string; auth: string }[] = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      hits.push({ raw, auth: String(request.headers.authorization ?? "") });
      const parsed = JSON.parse(raw) as { model?: string; messages: { role: string; content: string }[] };
      const user = parsed.messages.find((message) => message.role === "user")?.content ?? "";
      let intent: Record<string, unknown> = { action: "refuse", target_alias: null, brightness_pct: null, reason: "no" };
      if (user.includes("proxy-down")) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "unauthorized" } }));
        return;
      }
      if (user.includes("cozy")) {
        intent = { action: "activate_scene", target_alias: "kitchen relax", brightness_pct: null, reason: "cozy" };
      } else if (user.includes("movie night")) {
        intent = { action: "activate_scene", target_alias: "movie lights", brightness_pct: null, reason: "guess" };
      } else if (user.includes("raw entity")) {
        intent = { action: "turn_on", target_alias: "light.kitchen", brightness_pct: null, reason: "id" };
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }] }));
    });
  });
  const port = await listen(server);
  closers.push(() => close(server));

  const base = loadConfig({ path: "config.example.demo-home.yaml", env: {} });
  const config: AppConfig = {
    ...base,
    homeassistant: { url: "http://homeassistant.local:8123", token: "super-secret-token" },
    llm: { ...base.llm, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "test-key", model: DEFAULT_LLM_MODEL },
  };

  reset();
  const garage = await handleUtterance({ message: "open the garage", sessionId: "llm-garage", config });
  assert(garage.refused && hits.length === 0, "dangerous text does not need the model");

  reset();
  const cozy = await handleUtterance({ message: "make it cozy where we cook", sessionId: "llm-cozy", config });
  assert(cozy.parser === "llm" && cozy.modelUsed && cozy.executed, cozy.reply);
  assert(getMockLog()[0]?.entityIds[0] === "scene.kitchen_relax", "model alias maps to the allowlisted scene");
  assert(hits[0]?.raw.includes("kitchen relax"), "model request includes the alias");
  assert(hits[0]?.auth === "Bearer test-key", "model request sends the bearer key");
  assert(hits[0]?.raw.includes(DEFAULT_LLM_MODEL), "model request uses the configured alias");
  assert(!hits[0]?.raw.includes("super-secret-token"), "model request omits the token");
  assert(!hits[0]?.raw.includes("light.master_bedroom"), "model request omits entity ids");

  reset();
  const invented = await handleUtterance({ message: "movie night", sessionId: "llm-movie", config });
  assert(invented.refused && !invented.executed && getMockLog().length === 0, invented.reply);

  reset();
  const raw = await handleUtterance({ message: "use the raw entity", sessionId: "llm-raw", config });
  assert(raw.refused && getMockLog().length === 0, "entity ids are not aliases");

  reset();
  const down = await handleUtterance({ message: "proxy-down turn the kitchen off", sessionId: "llm-down", config });
  assert(down.parser === "fallback" && down.executed, down.reply);
  assert(getMockLog()[0]?.entityIds[0] === "light.kitchen", "401 falls back to the keyword match");
}

async function testHomeAssistant(closers: Array<() => Promise<void>>) {
  const hits: { path: string; body: { entity_id: string | string[] }; auth: string }[] = [];
  const server = http.createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    request.on("end", () => {
      hits.push({
        path: request.url ?? "",
        body: JSON.parse(raw) as { entity_id: string | string[] },
        auth: String(request.headers.authorization ?? ""),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
    });
  });
  const port = await listen(server);
  closers.push(() => close(server));
  const base = loadConfig({ path: "config.example.demo-home.yaml", env: {} });
  const config: AppConfig = {
    ...base,
    backend: "homeassistant",
    llm: { ...base.llm, baseUrl: null },
    homeassistant: { url: `http://127.0.0.1:${port}`, token: "test-token" },
  };

  reset();
  const bright = await handleUtterance({ message: "kitchen bright", sessionId: "ha-bright", config });
  assert(bright.executed, bright.reply);
  assert(hitPath(hits, 0) === "/api/services/scene/turn_on", hitPath(hits, 0) || "missing scene call");
  assert(asIds(hits[0]?.body.entity_id)[0] === "scene.kitchen_bright", "scene.turn_on kitchen bright");
  assert(hits[0]?.auth === "Bearer test-token", "bearer token");

  hits.length = 0;
  reset();
  const bedroom = await handleUtterance({ message: "bedroom off", sessionId: "ha-bed", config });
  assert(bedroom.executed, bedroom.reply);
  assert(hitPath(hits, 0) === "/api/services/light/turn_off", "room off is light.turn_off");
  assert(asIds(hits[0]?.body.entity_id)[0] === "light.master_bedroom", "bedroom is the room entity");

  hits.length = 0;
  reset();
  const asked = await handleUtterance({ message: "all lights off", sessionId: "ha-all", config });
  assert(asked.tone === "confirm" && hits.length === 0, "confirmation happens before the call");
  const done = await handleUtterance({ message: "yes", sessionId: "ha-all", config });
  assert(done.executed, done.reply);
  assert(hitPath(hits, 0) === "/api/services/light/turn_off", "all off is light.turn_off");
  assert(
    JSON.stringify(asIds(hits[0]?.body.entity_id)) === JSON.stringify(["light.downstairs", "light.upstairs"]),
    "both rooms",
  );
  assert(!JSON.stringify(hits).includes("automation_all_lights_off"), "schedule switch was not called");

  hits.length = 0;
  reset();
  const outdoor = await handleUtterance({ message: "outdoor off", sessionId: "ha-out", config });
  assert(outdoor.executed, outdoor.reply);
  const outdoorIds = asIds(hits[0]?.body.entity_id);
  assert(outdoorIds.length === 6 && !outdoorIds.some((id) => id.includes("camera")), "six outdoor lights, no camera");
}

async function testHue(closers: Array<() => Promise<void>>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sayhouse-"));
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    path.join(dir, "key.pem"),
    "-out",
    path.join(dir, "cert.pem"),
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
  ]);
  const hits: { path: string; body: unknown; key: string }[] = [];
  const server = https.createServer(
    { key: fs.readFileSync(path.join(dir, "key.pem")), cert: fs.readFileSync(path.join(dir, "cert.pem")) },
    (request, response) => {
      let raw = "";
      request.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      request.on("end", () => {
        hits.push({
          path: request.url ?? "",
          body: raw ? (JSON.parse(raw) as unknown) : null,
          key: String(request.headers["hue-application-key"] ?? ""),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "ok" }] }));
      });
    },
  );
  const port = await listen(server);
  closers.push(() => close(server));

  const config = configFromUnknown(
    {
      backend: "hue",
      targets: [
        {
          alias: "kitchen",
          label: "Kitchen lights",
          kind: "light",
          phrases: ["kitchen", "kitchen off"],
          homeassistant: { entity_id: "light.kitchen" },
          hue: { id: "room123", rtype: "grouped_light" },
        },
        {
          alias: "movie night",
          label: "Movie night",
          kind: "scene",
          phrases: ["movie night"],
          on_said: "Movie night is on.",
          homeassistant: { entity_id: "scene.movie_night" },
          hue: { id: "scene123", rtype: "scene" },
        },
      ],
    },
    "hue-test",
    { BACKEND: "hue", HUE_BRIDGE_IP: "127.0.0.1", HUE_APP_KEY: "test-app-key", HUE_PORT: String(port) },
  );

  reset();
  const off = await handleUtterance({ message: "kitchen off", sessionId: "hue-off", config });
  assert(off.executed, off.reply);
  assert(hitPath(hits, 0) === "/clip/v2/resource/grouped_light/room123", hitPath(hits, 0) || "missing hue path");
  assert(JSON.stringify(hits[0]?.body) === JSON.stringify({ on: { on: false } }), "grouped light off");
  assert(hits[0]?.key === "test-app-key", "hue application key");

  const scene = await handleUtterance({ message: "movie night", sessionId: "hue-scene", config });
  assert(scene.executed, scene.reply);
  assert(hitPath(hits, 1) === "/clip/v2/resource/scene/scene123", "scene recall path");
  assert(JSON.stringify(hits[1]?.body) === JSON.stringify({ recall: { action: "active" } }), "scene recall body");
}

function asIds(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function hitPath(hits: { path: string }[], index: number): string {
  return hits[index]?.path ?? "";
}

function listen(server: http.Server | https.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve(address.port);
    });
  });
}

function close(server: http.Server | https.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
