import { HouseError } from "@/lib/errors";
import { entityIdsFor, serviceName } from "@/lib/policy";
import type { AppConfig, ResolvedCommand } from "@/lib/types";

export function haReady(config: AppConfig): { ok: boolean; message: string } {
  if (!config.homeassistant.url || !config.homeassistant.token) {
    return { ok: false, message: "Set HA_URL and HA_TOKEN (or HASS_TOKEN) to reach Home Assistant." };
  }
  return { ok: true, message: `Home Assistant at ${config.homeassistant.url}.` };
}

export async function executeHomeAssistant(config: AppConfig, command: ResolvedCommand): Promise<void> {
  const ready = haReady(config);
  if (!ready.ok) throw new HouseError(ready.message);
  const entityIds = entityIdsFor(command.target);
  if (entityIds.length === 0) {
    throw new HouseError(`${command.target.label} has no Home Assistant entity on the allowlist.`);
  }
  const service = serviceName(command.action);
  const [domain, name] = service.split(".") as [string, string];
  const payload: Record<string, unknown> = {
    entity_id: entityIds.length === 1 ? entityIds[0] : entityIds,
  };
  if (command.action === "set_brightness" && command.brightnessPct != null) {
    payload.brightness_pct = command.brightnessPct;
  }
  const url = new URL(`/api/services/${domain}/${name}`, config.homeassistant.url as string);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.homeassistant.token}`,
      "content-type": "application/json",
      "user-agent": "SayHouse",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();
  if (response.status === 401) {
    throw new HouseError("Home Assistant rejected the token.");
  }
  if (!response.ok) {
    throw new HouseError(`Home Assistant returned ${response.status}. ${clip(text)}`);
  }
}

function clip(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 180);
}
