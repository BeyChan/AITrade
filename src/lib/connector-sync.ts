import { createHash, randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import type { KeepaFetchOptions } from "./connectors/keepa.ts";
import { sanitizeConnectorError } from "./connectors/security.ts";
import { ConnectorNotConfiguredError, type ConnectorApiCall } from "./connectors/types.ts";
import { importKeepaByAsins, type IngestionSummary } from "./ingestion.ts";
import type {
  ConnectorFreshness,
  ConnectorSyncDashboard,
  ConnectorSyncJobRow,
} from "./types.ts";

const KEEPA_MARKETS = new Set(["US", "GB", "DE", "FR", "IT", "ES", "JP", "CA", "IN", "MX", "BR", "AU"]);
const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_JOB_ERROR_LENGTH = 1_000;

export type SupportedSyncSource = "keepa";

export type KeepaSyncInput = {
  asins: string[] | string;
  marketplace: string;
  actor?: string;
  triggerType?: "manual" | "scheduled";
};

export type ConnectorSyncRunResult = {
  job: ConnectorSyncJobRow;
  ingestion?: IngestionSummary;
  error?: string;
  errorCode?: string;
};

type InternalRunOptions = {
  fetchOptions?: KeepaFetchOptions;
};

type EnqueueSyncJobInput = {
  sourceCode: SupportedSyncSource;
  marketplace: string;
  requestHash: string;
  requestPayload: Record<string, unknown>;
  actor?: string;
  triggerType?: "manual" | "scheduled";
  auditDetails: Record<string, unknown>;
};

export async function enqueueKeepaSync(input: KeepaSyncInput): Promise<ConnectorSyncJobRow> {
  const normalized = normalizeKeepaInput(input);
  return enqueueSyncJob({
    sourceCode: "keepa",
    marketplace: normalized.marketplace,
    requestHash: hashPayload({
      sourceCode: "keepa",
      marketplace: normalized.marketplace,
      asins: normalized.asins,
    }),
    requestPayload: {
      asins: normalized.asins,
      marketplace: normalized.marketplace,
      requestSummary: { asinCount: normalized.asins.length },
    },
    actor: input.actor,
    triggerType: input.triggerType,
    auditDetails: {
      sourceCode: "keepa",
      marketplace: normalized.marketplace,
      asinCount: normalized.asins.length,
    },
  });
}

export async function createAndRunKeepaSync(
  input: KeepaSyncInput,
  options: InternalRunOptions = {},
): Promise<ConnectorSyncRunResult> {
  const job = await enqueueKeepaSync(input);
  return runConnectorSyncJob(job.id, options);
}

export async function runConnectorSyncJob(
  jobId: string,
  options: InternalRunOptions = {},
): Promise<ConnectorSyncRunResult> {
  const db = await getDb();
  const claimed = await db.query<ConnectorSyncJobRow>(
    `UPDATE connector_sync_jobs
     SET status = 'running', started_at = COALESCE(started_at, NOW()), completed_at = NULL,
         error_message = NULL, next_run_at = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [jobId],
  );
  const job = claimed.rows[0];
  if (!job) {
    const current = await getJob(jobId);
    if (!current) throw new Error("同步任务不存在");
    return { job: current };
  }
  if (job.source_code === "keepa") return runKeepaSync(job, options);

  const failed = await failJob(job, `不支持的同步数据源：${job.source_code}`, "unsupported_source");
  return { job: failed, error: failed.error_message ?? "不支持的同步任务", errorCode: "unsupported_source" };
}

async function runKeepaSync(
  job: ConnectorSyncJobRow,
  options: InternalRunOptions,
): Promise<ConnectorSyncRunResult> {
  const payload = job.request_payload as { asins?: unknown; marketplace?: unknown };
  let asins: string[];
  try {
    asins = normalizeAsins(payload.asins);
    if (asins.length === 0) throw new Error("同步任务缺少 ASIN");
    if (asins.length > 100) throw new Error("单次 Keepa 同步最多 100 个 ASIN");
  } catch (error) {
    return invalidRequestResult(job, error);
  }

  const runId = randomUUID();
  const startedAt = Date.now();
  let apiCallCount = 0;
  const fetchOptions: KeepaFetchOptions = {
    ...options.fetchOptions,
    onAttempt: async (call) => {
      apiCallCount += 1;
      await persistApiCall(job.id, job.source_code, call);
      await options.fetchOptions?.onAttempt?.(call);
    },
  };

  try {
    const ingestion = await importKeepaByAsins({
      asins,
      marketplace: job.marketplace,
      actor: job.requested_by,
      runId,
      fetchOptions,
    });
    const completed = await succeedJob(job, ingestion, apiCallCount, Date.now() - startedAt);
    return { job: completed, ingestion };
  } catch (error) {
    return failedRunResult(job, error, apiCallCount, startedAt, runId);
  }
}

async function invalidRequestResult(
  job: ConnectorSyncJobRow,
  error: unknown,
): Promise<ConnectorSyncRunResult> {
  const message = sanitizeError(error);
  const failed = await failJob(job, message, "invalid_request");
  return { job: failed, error: message, errorCode: "invalid_request" };
}

async function failedRunResult(
  job: ConnectorSyncJobRow,
  error: unknown,
  apiCallCount: number,
  startedAt: number,
  runId: string,
): Promise<ConnectorSyncRunResult> {
  const message = sanitizeError(error);
  const errorCode = error instanceof ConnectorNotConfiguredError ? error.code : "sync_failed";
  const failed = await failJob(job, message, errorCode, {
    apiCallCount,
    durationMs: Date.now() - startedAt,
    runId,
  });
  return { job: failed, error: message, errorCode };
}

export async function retryConnectorSyncJob(
  jobId: string,
  options: InternalRunOptions = {},
): Promise<ConnectorSyncRunResult> {
  const db = await getDb();
  const current = await getJob(jobId);
  if (!current) throw new Error("同步任务不存在");
  if (current.status !== "failed") throw new Error("只有失败任务可以重试");
  if (current.attempt >= current.max_attempts) throw new Error("该任务已达到最大重试次数");

  const requeued = await db.query<ConnectorSyncJobRow>(
    `UPDATE connector_sync_jobs
     SET status = 'queued', attempt = attempt + 1, error_message = NULL,
         next_run_at = NULL, completed_at = NULL, summary = '{}'::jsonb, updated_at = NOW()
     WHERE id = $1 AND status = 'failed' AND attempt < max_attempts
     RETURNING *`,
    [jobId],
  );
  const job = requeued.rows[0];
  if (!job) throw new Error("任务状态已变化，请刷新后重试");
  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'connector_sync.retry_queued', 'connector_sync_job', $3, $4::jsonb)`,
    [
      randomUUID(),
      job.requested_by,
      job.id,
      JSON.stringify({
        sourceCode: job.source_code,
        attempt: job.attempt,
        maxAttempts: job.max_attempts,
        externalActions: "read_only",
      }),
    ],
  );
  return runConnectorSyncJob(job.id, options);
}

export async function getConnectorSyncDashboard(now = new Date()): Promise<ConnectorSyncDashboard> {
  const db = await getDb();
  const [jobsResult, cursorsResult] = await Promise.all([
    db.query<ConnectorSyncJobRow>(
      "SELECT * FROM connector_sync_jobs ORDER BY created_at DESC LIMIT 20",
    ),
    db.query<Omit<ConnectorSyncDashboard["cursors"][number], "freshness">>(
      "SELECT * FROM connector_sync_cursors ORDER BY source_code, marketplace",
    ),
  ]);
  const cursors = cursorsResult.rows.map((cursor) => ({
    ...cursor,
    freshness: getFreshness(cursor.last_success_at, now),
  }));
  return {
    jobs: jobsResult.rows,
    cursors,
    stats: {
      runningCount: jobsResult.rows.filter((job) => job.status === "running" || job.status === "queued").length,
      failedCount: jobsResult.rows.filter((job) => job.status === "failed").length,
      staleSourceCount: cursors.filter((cursor) => cursor.freshness !== "fresh").length,
    },
  };
}

export function getFreshness(lastSuccessAt: string | null, now = new Date()): ConnectorFreshness {
  if (!lastSuccessAt) return "unknown";
  const timestamp = new Date(lastSuccessAt).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  return now.getTime() - timestamp <= FRESHNESS_WINDOW_MS ? "fresh" : "stale";
}

async function enqueueSyncJob(input: EnqueueSyncJobInput): Promise<ConnectorSyncJobRow> {
  const db = await getDb();
  const actor = input.actor?.trim() || "运营人员";
  const triggerType = input.triggerType ?? "manual";
  const active = await db.query<ConnectorSyncJobRow>(
    `SELECT * FROM connector_sync_jobs
     WHERE source_code = $1 AND request_hash = $2 AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
    [input.sourceCode, input.requestHash],
  );
  if (active.rows[0]) return active.rows[0];

  const id = randomUUID();
  try {
    const inserted = await db.query<ConnectorSyncJobRow>(
      `INSERT INTO connector_sync_jobs
        (id, source_code, marketplace, status, trigger_type, requested_by, attempt, max_attempts,
         request_hash, request_payload)
       VALUES ($1, $2, $3, 'queued', $4, $5, 1, 3, $6, $7::jsonb)
       RETURNING *`,
      [
        id,
        input.sourceCode,
        input.marketplace,
        triggerType,
        actor,
        input.requestHash,
        JSON.stringify(input.requestPayload),
      ],
    );
    const job = inserted.rows[0];
    if (!job) throw new Error("创建同步任务失败");
    await db.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'connector_sync.queued', 'connector_sync_job', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        id,
        JSON.stringify({
          ...input.auditDetails,
          triggerType,
          externalActions: "read_only",
        }),
      ],
    );
    return job;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await db.query<ConnectorSyncJobRow>(
      `SELECT * FROM connector_sync_jobs
       WHERE source_code = $1 AND request_hash = $2 AND status IN ('queued', 'running')
       ORDER BY created_at DESC LIMIT 1`,
      [input.sourceCode, input.requestHash],
    );
    if (existing.rows[0]) return existing.rows[0];
    throw error;
  }
}

function normalizeKeepaInput(input: KeepaSyncInput) {
  const marketplace = input.marketplace.trim().toUpperCase();
  if (!KEEPA_MARKETS.has(marketplace)) throw new Error(`Keepa 暂不支持市场 ${marketplace || "(空)"}`);
  const asins = normalizeAsins(input.asins);
  if (asins.length === 0) throw new Error("请至少填写一个 ASIN");
  if (asins.length > 100) throw new Error("单次 Keepa 同步最多 100 个 ASIN");
  return { asins, marketplace };
}

function normalizeAsins(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,，;；]+/)
      : [];
  return [...new Set(source.map((asin) => String(asin).trim().toUpperCase()).filter(Boolean))];
}

async function persistApiCall(jobId: string, sourceCode: string, call: ConnectorApiCall) {
  const db = await getDb();
  await db.query(
    `INSERT INTO connector_api_calls
      (id, job_id, source_code, endpoint, method, status_code, duration_ms, retry_count,
       request_summary, response_summary, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)`,
    [
      randomUUID(),
      jobId,
      sourceCode,
      call.endpoint,
      call.method,
      call.statusCode,
      call.durationMs,
      call.retryCount,
      JSON.stringify(call.requestSummary),
      JSON.stringify(call.responseSummary),
      call.errorMessage ? sanitizeError(call.errorMessage) : null,
    ],
  );
}

async function succeedJob(
  job: ConnectorSyncJobRow,
  ingestion: IngestionSummary,
  apiCallCount: number,
  durationMs: number,
) {
  const db = await getDb();
  const status = ingestion.status;
  const summary = {
    imported: ingestion.imported,
    updated: ingestion.updated,
    skipped: ingestion.skipped,
    errors: ingestion.errors,
    snapshots: ingestion.snapshots,
    warnings: ingestion.warnings.slice(0, 10),
    apiCallCount,
    durationMs,
    externalActions: "read_only" as const,
  };
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE connector_sync_jobs
       SET status = $1, summary = $2::jsonb, run_id = $3, error_message = NULL,
           next_run_at = NULL, completed_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [status, JSON.stringify(summary), ingestion.runId, job.id],
    );
    await tx.query(
      `INSERT INTO connector_sync_cursors
        (id, source_code, marketplace, cursor, last_success_at, last_attempt_at, consecutive_failures, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW(), 0, NOW())
       ON CONFLICT (source_code, marketplace) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         last_success_at = NOW(),
         last_attempt_at = NOW(),
         consecutive_failures = 0,
         updated_at = NOW()`,
      [
        randomUUID(),
        job.source_code,
        job.marketplace,
        JSON.stringify({
          lastRunId: ingestion.runId,
          lastImportedCount: ingestion.imported,
          lastSnapshotCount: ingestion.snapshots,
          lastMode: typeof job.request_payload.mode === "string" ? job.request_payload.mode : null,
        }),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'connector_sync.completed', 'connector_sync_job', $3, $4::jsonb)`,
      [
        randomUUID(),
        job.requested_by,
        job.id,
        JSON.stringify({
          sourceCode: job.source_code,
          runId: ingestion.runId,
          status,
          marketplace: job.marketplace,
          apiCallCount,
          imported: ingestion.imported,
          snapshots: ingestion.snapshots,
          externalActions: "read_only",
        }),
      ],
    );
  });
  const completed = await getJob(job.id);
  if (!completed) throw new Error("同步任务完成状态读取失败");
  return completed;
}

async function failJob(
  job: ConnectorSyncJobRow,
  message: string,
  errorCode: string,
  extra: { apiCallCount?: number; durationMs?: number; runId?: string } = {},
) {
  const db = await getDb();
  const safeMessage = sanitizeError(message);
  const nextRunAt = job.attempt < job.max_attempts
    ? new Date(Date.now() + Math.min(30, 5 * 2 ** (job.attempt - 1)) * 60_000).toISOString()
    : null;
  const summary = {
    apiCallCount: extra.apiCallCount ?? 0,
    durationMs: extra.durationMs ?? 0,
    errorCode,
    warnings: [],
    externalActions: "read_only" as const,
  };
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE connector_sync_jobs
       SET status = 'failed', summary = $1::jsonb, run_id = COALESCE($2, run_id),
           error_message = $3, next_run_at = $4, completed_at = NOW(), updated_at = NOW()
       WHERE id = $5`,
      [
        JSON.stringify(summary),
        extra.runId ?? null,
        safeMessage.slice(0, MAX_JOB_ERROR_LENGTH),
        nextRunAt,
        job.id,
      ],
    );
    await tx.query(
      `INSERT INTO connector_sync_cursors
        (id, source_code, marketplace, last_attempt_at, consecutive_failures, updated_at)
       VALUES ($1, $2, $3, NOW(), 1, NOW())
       ON CONFLICT (source_code, marketplace) DO UPDATE SET
         last_attempt_at = NOW(),
         consecutive_failures = connector_sync_cursors.consecutive_failures + 1,
         updated_at = NOW()`,
      [randomUUID(), job.source_code, job.marketplace],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'connector_sync.failed', 'connector_sync_job', $3, $4::jsonb)`,
      [
        randomUUID(),
        job.requested_by,
        job.id,
        JSON.stringify({
          sourceCode: job.source_code,
          marketplace: job.marketplace,
          attempt: job.attempt,
          errorCode,
          error: safeMessage,
          externalActions: "read_only",
        }),
      ],
    );
  });
  const failed = await getJob(job.id);
  if (!failed) throw new Error("同步任务失败状态读取失败");
  return failed;
}

async function getJob(id: string) {
  const db = await getDb();
  const result = await db.query<ConnectorSyncJobRow>("SELECT * FROM connector_sync_jobs WHERE id = $1 LIMIT 1", [id]);
  return result.rows[0] ?? null;
}

function sanitizeError(error: unknown) {
  return sanitizeConnectorError(error, process.env, MAX_JOB_ERROR_LENGTH);
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && /unique|duplicate key/i.test(error.message);
}
