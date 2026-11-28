import { getAppMode } from "@/lib/app-mode";
import { getDb, getDbEngineInfo } from "@/lib/db";
import { getStorageProviderInfo } from "@/lib/storage";


export async function GET() {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    await db.query("SELECT 1 AS ok");
    const dbLatencyMs = Date.now() - startedAt;
    const dbInfo = getDbEngineInfo();
    const mode = await getAppMode();
    const storage = getStorageProviderInfo();

    return Response.json({
      status: "ok",
      service: "aitrade",
      mode,
      db: {
        engine: dbInfo.engine,
        status: "connected",
        latencyMs: dbLatencyMs,
        ...(dbInfo.configuredDatabaseUrlIgnored
          ? {
              warning:
                "DATABASE_URL is set, but external PostgreSQL is not supported yet; using local PGlite.",
            }
          : {}),
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
