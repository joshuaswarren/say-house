export type BackendKind = "mock" | "homeassistant" | "hue";

export type TargetKind = "light" | "scene";

export type HueRtype = "light" | "grouped_light" | "scene";

export type Action = "turn_on" | "turn_off" | "set_brightness" | "activate_scene";

export type Tone = "ok" | "ask" | "refuse" | "confirm" | "error";

export interface HueResource {
  id: string;
  rtype: HueRtype;
}

export interface Target {
  alias: string;
  label: string;
  phrases: string[];
  kind: TargetKind;
  family?: string;
  broad?: boolean;
  brightness?: boolean;
  actions?: Action[];
  confirm?: string;
  onSaid?: string;
  offSaid?: string;
  aside?: string;
  asideWhen?: string[];
  homeassistant?: { entityIds: string[] };
  hue?: HueResource[];
}

export interface Gap {
  phrases: string[];
  reply: string;
}

export interface AppConfig {
  sourceName: string;
  householdName: string;
  tagline: string;
  backend: BackendKind;
  confirmBroadActions: boolean;
  dryRunLocked: boolean;
  suggestions: string[];
  gaps: Gap[];
  targets: Target[];
  llm: {
    baseUrl: string | null;
    model: string;
    apiKey: string;
    timeoutMs: number;
  };
  homeassistant: {
    url: string | null;
    token: string | null;
  };
  hue: {
    bridgeHost: string | null;
    appKey: string | null;
    port: number;
  };
}

export interface ProposedIntent {
  action: Action | "refuse";
  targetAlias: string | null;
  brightnessPct: number | null;
}

export interface ResolvedCommand {
  action: Action;
  target: Target;
  brightnessPct: number | null;
  dryRun: boolean;
}

export interface ChatResult {
  reply: string;
  parser: "llm" | "fallback" | "confirmation";
  modelUsed: boolean;
  executed: boolean;
  dryRun: boolean;
  refused: boolean;
  tone: Tone;
  pendingConfirmation: { summary: string } | null;
}

export interface HealthInfo {
  ok: boolean;
  householdName: string;
  tagline: string;
  backend: BackendKind;
  backendReady: boolean;
  backendMessage: string;
  llmConfigured: boolean;
  llmModel: string;
  dryRunLocked: boolean;
  suggestions: string[];
  targetCount: number;
  configFile: string;
}
