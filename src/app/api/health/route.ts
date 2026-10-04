import { backendStatus } from "@/lib/backends";
import { loadConfig } from "@/lib/config";
import type { HealthInfo } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = loadConfig();
    const status = backendStatus(config);
    const body: HealthInfo = {
      ok: true,
      householdName: config.householdName,
      tagline: config.tagline,
      backend: config.backend,
      backendReady: status.ok,
      backendMessage: status.message,
      llmConfigured: Boolean(config.llm.baseUrl),
      llmModel: config.llm.model,
      dryRunLocked: config.dryRunLocked,
      suggestions: config.suggestions,
      targetCount: config.targets.length,
      configFile: config.sourceName,
    };
    return Response.json(body);
  } catch (error) {
    const text = error instanceof Error ? error.message : "The house config couldn't be read.";
    return Response.json({ ok: false, error: text, reply: text }, { status: 500 });
  }
}
