import { retryConnectorSyncJob } from "@/lib/connector-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const result = await retryConnectorSyncJob(jobId);
    const status = result.job.status === "failed"
      ? result.errorCode === "not_configured" ? 409 : 502
      : 200;
    return Response.json({
      ...result,
      jobId: result.job.id,
      status: result.job.status,
      runId: result.ingestion?.runId ?? result.job.run_id,
      imported: result.ingestion?.imported,
      snapshots: result.ingestion?.snapshots,
      warnings: result.ingestion?.warnings,
    }, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "重试同步任务失败";
    return Response.json({ error: message, code: "sync_retry_failed" }, { status: 400 });
  }
}
