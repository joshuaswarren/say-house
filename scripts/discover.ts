import { backendStatus } from "../src/lib/backends";
import { hueGet, hueReady } from "../src/lib/backends/hue";
import { loadConfig } from "../src/lib/config";
import { entityBlockReason } from "../src/lib/deny";

async function main() {
  const config = loadConfig();
  console.log(`Allowlist ${config.sourceName} (${config.targets.length} aliases, backend ${config.backend})`);
  for (const target of config.targets) {
    const ids = target.homeassistant?.entityIds.join(", ") ?? "no Home Assistant id";
    console.log(`- ${target.alias} [${target.kind}] ${ids}`);
  }

  if (config.backend === "homeassistant") {
    await discoverHomeAssistant(config.homeassistant.url, config.homeassistant.token);
    return;
  }
  if (config.backend === "hue") {
    await discoverHue(config);
    return;
  }
  const status = backendStatus(config);
  console.log(`\n${status.message}`);
  console.log("Set BACKEND=homeassistant or BACKEND=hue, plus the URL and token, to list a real house.");
  console.log("Room on/off should be a Hue room or zone light, not each bulb. Scenes use scene.turn_on.");
}

async function discoverHomeAssistant(url: string | null, token: string | null) {
  if (!url || !token) {
    console.log("\nSet HA_URL and HA_TOKEN (or HASS_TOKEN) to list entities.");
    return;
  }
  const response = await fetch(new URL("/api/states", url), {
    headers: { authorization: `Bearer ${token}`, "user-agent": "SayHouse" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    console.log(`Home Assistant returned ${response.status}.`);
    return;
  }
  const states = (await response.json()) as { entity_id?: string; attributes?: { friendly_name?: string } }[];
  const allowed: string[] = [];
  let skipped = 0;
  for (const state of states) {
    const id = state.entity_id ?? "";
    if (!id.startsWith("light.") && !id.startsWith("scene.")) {
      skipped += 1;
      continue;
    }
    if (entityBlockReason(id)) {
      skipped += 1;
      continue;
    }
    const name = state.attributes?.friendly_name ?? "";
    allowed.push(`${id}${name ? `  ${name}` : ""}`);
  }
  console.log(`\nLights and scenes you can put on the allowlist (${allowed.length}). Skipped ${skipped} other or blocked entities.`);
  for (const line of allowed.sort()) console.log(line);
  console.log("\nUse scene ids with scene.turn_on. Use Hue room/zone light ids for on and off, not individual bulbs.");
}

async function discoverHue(config: ReturnType<typeof loadConfig>) {
  if (!hueReady(config).ok) {
    console.log("\nSet HUE_BRIDGE_IP and HUE_APP_KEY to list the bridge.");
    return;
  }
  const rooms = (await hueGet(config, "/clip/v2/resource/room")) as { data?: HueRoom[] };
  const scenes = (await hueGet(config, "/clip/v2/resource/scene")) as { data?: HueNamed[] };
  console.log("\nRooms. Copy the grouped_light id for on/off. Do not list every bulb.");
  for (const room of rooms.data ?? []) {
    const grouped = room.services?.find((service) => service.rtype === "grouped_light");
    console.log(`- ${room.metadata?.name ?? "room"}  grouped_light ${grouped?.rid ?? "missing"}`);
  }
  console.log("\nScenes. Recall these with the scene rtype. Skip stock formulas you don't want spoken.");
  for (const scene of scenes.data ?? []) {
    console.log(`- ${scene.metadata?.name ?? "scene"}  ${scene.id}`);
  }
}

interface HueRoom {
  metadata?: { name?: string };
  services?: { rid: string; rtype: string }[];
}

interface HueNamed {
  id: string;
  metadata?: { name?: string };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
