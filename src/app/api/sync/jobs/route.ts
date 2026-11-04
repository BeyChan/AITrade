import {
  createAndRunKeepaSync,
  createAndRunSorftimeSync,
  getConnectorSyncDashboard,
  type SorftimeSyncInput,
} from "@/lib/connector-sync";
import { sanitizeConnectorError } from "@/lib/connectors/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;

export async function GET() {
  return Response.json(await getConnectorSyncDashboard());
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "请求体不能超过 64 KB", code: "payload_too_large" }, { status: 413 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const sourceCode = String(body.sourceCode ?? "");
    if (sourceCode !== "keepa" && sourceCode !== "sorftime") {
      return Response.json(
        { error: "当前只支持 Keepa 与 Sorftime 同步任务", code: "unsupported_source" },
        { status: 400 },
      );
    }

    const result = sourceCode === "keepa"
      ? await createAndRunKeepaSync({
          asins: Array.isArray(body.asins) ? body.asins.map(String) : String(body.asins ?? ""),
          marketplace: String(body.marketplace ?? "US"),
          actor: String(body.actor ?? "运营人员"),
          triggerType: "manual",
        })
      : await createAndRunSorftimeSync({
          mode: body.mode === "asin" ? "asin" : body.mode === "category" ? "category" : String(body.mode) as SorftimeSyncInput["mode"],
          marketplace: String(body.marketplace ?? "US"),
          categoryQuery: body.categoryQuery === undefined ? undefined : String(body.categoryQuery),
          nodeId: body.nodeId === undefined ? undefined : String(body.nodeId),
          asins: Array.isArray(body.asins) ? body.asins.map(String) : String(body.asins ?? ""),
          actor: String(body.actor ?? "运营人员"),
          triggerType: "manual",
        });

    const status = result.job.status === "failed"
      ? result.errorCode === "not_configured" ? 409 : 502
      : 200;
    return Response.json({
      ...result,
      jobId: result.job.id,
      status: result.job.status,
      runId: result.ingestion?.runId ?? result.job.run_id,
      imported: result.ingestion?.imported,
      updated: result.ingestion?.updated,
      skipped: result.ingestion?.skipped,
      errors: result.ingestion?.errors,
      snapshots: result.ingestion?.snapshots,
      warnings: result.ingestion?.warnings,
    }, { status });
  } catch (error) {
    const message = sanitizeConnectorError(error);
    return Response.json({ error: message, code: "sync_job_failed" }, { status: 400 });
  }
}
