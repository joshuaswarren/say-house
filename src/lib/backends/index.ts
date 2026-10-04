import { executeHomeAssistant, haReady } from "@/lib/backends/homeassistant";
import { executeHue, hueReady } from "@/lib/backends/hue";
import { executeMock, mockReadyMessage } from "@/lib/backends/mock";
import type { AppConfig, ResolvedCommand } from "@/lib/types";

export function backendStatus(config: AppConfig): { ok: boolean; message: string } {
  if (config.backend === "homeassistant") return haReady(config);
  if (config.backend === "hue") return hueReady(config);
  return { ok: true, message: mockReadyMessage() };
}

export async function executeCommand(config: AppConfig, command: ResolvedCommand): Promise<void> {
  if (command.dryRun) return;
  if (config.backend === "homeassistant") {
    await executeHomeAssistant(config, command);
    return;
  }
  if (config.backend === "hue") {
    await executeHue(config, command);
    return;
  }
  executeMock(command);
}
