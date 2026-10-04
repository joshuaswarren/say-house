import { handleUtterance } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send JSON with a message." }, { status: 400 });
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const message = typeof body.message === "string" ? body.message : "";
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  const dryRun = body.dryRun === true;
  try {
    const result = await handleUtterance({ message, sessionId, dryRun });
    return Response.json(result);
  } catch (error) {
    const text = error instanceof Error ? error.message : "The house config couldn't be read.";
    console.error(`[sayhouse] ${text}`);
    return Response.json(
      {
        reply: text,
        tone: "error",
        refused: true,
        executed: false,
        dryRun,
        parser: "fallback",
        modelUsed: false,
        pendingConfirmation: null,
        error: text,
      },
      { status: 500 },
    );
  }
}
