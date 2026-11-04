import {
  createAndRunKeepaSync,
  getConnectorSyncDashboard,
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
    if (sourceCode !== "keepa") {
      return Response.json(
        { error: "当前只支持 Keepa 同步任务", code: "unsupported_source" },
        { status: 400 },
      );
    }

    const result = await createAndRunKeepaSync({
      asins: Array.isArray(body.asins) ? body.asins.map(String) : String(body.asins ?? ""),
      marketplace: String(body.marketplace ?? "US"),
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
