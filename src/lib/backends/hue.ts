import https from "node:https";
import { AllowlistError, HouseError } from "@/lib/errors";
import type { AppConfig, HueResource, ResolvedCommand } from "@/lib/types";

export function hueReady(config: AppConfig): { ok: boolean; message: string } {
  if (!config.hue.bridgeHost || !config.hue.appKey) {
    return { ok: false, message: "Set HUE_BRIDGE_IP and HUE_APP_KEY for the Hue bridge." };
  }
  return { ok: true, message: `Hue bridge at ${config.hue.bridgeHost}.` };
}

export async function executeHue(config: AppConfig, command: ResolvedCommand): Promise<void> {
  const ready = hueReady(config);
  if (!ready.ok) throw new HouseError(ready.message);
  const resources = configReadyResources(command);
  for (const resource of resources) {
    await putResource(config, resource, bodyFor(command, resource));
  }
}

export async function hueGet(config: AppConfig, resourcePath: string): Promise<unknown> {
  const ready = hueReady(config);
  if (!ready.ok) throw new HouseError(ready.message);
  const result = await hueRequest(config, "GET", resourcePath);
  return result.json;
}

function configReadyResources(command: ResolvedCommand): HueResource[] {
  const resources = command.target.hue ?? [];
  if (resources.length === 0) {
    throw new HouseError(
      `${command.target.label} has no Hue id. Add one under hue, or use the Home Assistant backend.`,
    );
  }
  for (const resource of resources) {
    if (resource.id.includes("REPLACE")) {
      throw new HouseError(
        `${command.target.label} still has a placeholder Hue id. Run npm run discover against your bridge and replace it.`,
      );
    }
    if (command.action === "activate_scene" && resource.rtype !== "scene") {
      throw new AllowlistError(`${command.target.label} must recall a Hue scene, not a ${resource.rtype}.`);
    }
    if (command.action !== "activate_scene" && resource.rtype === "scene") {
      throw new AllowlistError(`${command.target.label} is a Hue scene. Start it instead of turning it off.`);
    }
  }
  return resources;
}

function bodyFor(command: ResolvedCommand, resource: HueResource): Record<string, unknown> {
  if (resource.rtype === "scene" || command.action === "activate_scene") {
    return { recall: { action: "active" } };
  }
  if (command.action === "turn_off") return { on: { on: false } };
  if (command.action === "set_brightness") {
    return { on: { on: true }, dimming: { brightness: command.brightnessPct ?? 100 } };
  }
  return { on: { on: true } };
}

async function putResource(config: AppConfig, resource: HueResource, body: Record<string, unknown>): Promise<void> {
  const result = await hueRequest(config, "PUT", `/clip/v2/resource/${resource.rtype}/${resource.id}`, body);
  if (result.status >= 400) {
    throw new HouseError(`Hue bridge returned ${result.status}.`);
  }
  const errors = hueErrors(result.json);
  if (errors) throw new HouseError(`Hue bridge refused that change. ${errors}`);
}

export function hueRequest(
  config: AppConfig,
  method: string,
  resourcePath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const payload = body == null ? undefined : JSON.stringify(body);
  const host = config.hue.bridgeHost as string;
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        host,
        port: config.hue.port,
        path: resourcePath,
        method,
        rejectUnauthorized: false,
        headers: {
          "hue-application-key": config.hue.appKey ?? "",
          "content-type": "application/json",
          "user-agent": "SayHouse",
          ...(payload ? { "content-length": Buffer.byteLength(payload) } : {}),
        },
        timeout: 8000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json: unknown = null;
          if (text) {
            try {
              json = JSON.parse(text) as unknown;
            } catch {
              json = { raw: text.slice(0, 180) };
            }
          }
          resolve({ status: response.statusCode ?? 0, json });
        });
      },
    );
    request.on("error", () => reject(new HouseError(`Couldn't reach the Hue bridge at ${host}.`)));
    request.on("timeout", () => {
      request.destroy();
      reject(new HouseError("The Hue bridge timed out."));
    });
    if (payload) request.write(payload);
    request.end();
  });
}

function hueErrors(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as { errors?: { description?: string }[] }).errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  return errors.map((error) => error.description ?? "unknown error").join("; ");
}
