import { getAppMode } from "@/lib/app-mode";
import { getDb } from "@/lib/db";
import { getStorageProviderInfo } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    await db.query("SELECT 1 AS ok");
    const dbLatencyMs = Date.now() - startedAt;
    const mode = await getAppMode();
    const storage = getStorageProviderInfo();

    return Response.json({
      status: "ok",
      service: "aitrade",
      mode,
      db: {
        engine: process.env.DATABASE_URL ? "postgresql" : "pglite",
        status: "connected",
        latencyMs: dbLatencyMs,
      },
      storage,
      nodeVersion: process.version,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json(
      {
        status: "degraded",
        service: "aitrade",
        error: error instanceof Error ? error.message : "database_unavailable",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
