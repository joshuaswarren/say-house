import type { ResolvedCommand } from "@/lib/types";
import { entityIdsFor, serviceName } from "@/lib/policy";

export interface MockCall {
  alias: string;
  action: ResolvedCommand["action"];
  service: string;
  entityIds: string[];
  brightnessPct: number | null;
}

export interface MockDevice {
  on: boolean;
  brightness: number | null;
}

const devices = new Map<string, MockDevice>();
const calls: MockCall[] = [];

export function resetMockHouse(): void {
  devices.clear();
  calls.length = 0;
}

export function getMockLog(): MockCall[] {
  return calls.map((call) => ({ ...call, entityIds: [...call.entityIds] }));
}

export function getMockHouse(): Record<string, MockDevice> {
  return Object.fromEntries([...devices.entries()].map(([id, device]) => [id, { ...device }]));
}

export function executeMock(command: ResolvedCommand): void {
  const entityIds = command.target.hue && entityIdsFor(command.target).length === 0
    ? command.target.hue.map((resource) => `${resource.rtype}:${resource.id}`)
    : entityIdsFor(command.target);
  calls.push({
    alias: command.target.alias,
    action: command.action,
    service: serviceName(command.action),
    entityIds,
    brightnessPct: command.brightnessPct,
  });
  for (const entityId of entityIds) {
    if (command.action === "turn_off") {
      devices.set(entityId, { on: false, brightness: null });
    } else if (command.action === "set_brightness") {
      devices.set(entityId, { on: true, brightness: command.brightnessPct });
    } else {
      devices.set(entityId, { on: true, brightness: null });
    }
  }
}

export function mockReadyMessage(): string {
  return "Simulated house. Commands stay on this machine.";
}
