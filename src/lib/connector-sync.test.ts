import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-connector-sync-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getDb } = await import("./db.ts");
const {
  createAndRunKeepaSync,
  enqueueKeepaSync,
  getConnectorSyncDashboard,
  retryConnectorSyncJob,
  runConnectorSyncJob,
} = await import("./connector-sync.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("Keepa job fails clearly without a key and makes no external request", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KEEPA_API_KEY;
  delete process.env.KEEPA_API_KEY;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await createAndRunKeepaSync({ asins: "B0SYNCNOKEY", marketplace: "US" });
    assert.equal(result.job.status, "failed");
    assert.equal(result.errorCode, "not_configured");
    assert.match(result.error ?? "", /尚未配置凭证/);
    assert.equal(requestCount, 0);

    const db = await getDb();
    const ingestion = await db.query<{ status: string; error_message: string }>(
      "SELECT status, error_message FROM ingestion_runs WHERE id = $1",
      [result.job.run_id],
    );
    assert.equal(ingestion.rows[0]?.status, "failed");
    assert.match(ingestion.rows[0]?.error_message ?? "", /尚未配置凭证/);

    const apiCalls = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM connector_api_calls WHERE job_id = $1",
      [result.job.id],
    );
    assert.equal(apiCalls.rows[0]?.count, "0");

    const products = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM product_cases WHERE asin = 'B0SYNCNOKEY'",
    );
    assert.equal(products.rows[0]?.count, "0");

    const cursor = await db.query<{ consecutive_failures: number; last_success_at: string | null }>(
      "SELECT consecutive_failures, last_success_at FROM connector_sync_cursors WHERE source_code = 'keepa' AND marketplace = 'US'",
    );
    assert.equal(cursor.rows[0]?.consecutive_failures, 1);
    assert.equal(cursor.rows[0]?.last_success_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KEEPA_API_KEY;
    else process.env.KEEPA_API_KEY = originalKey;
  }
});

test("a failed Keepa job can be retried and writes a traceable successful run", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KEEPA_API_KEY;
  process.env.KEEPA_API_KEY = "sync-success-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({
    products: [{
      asin: "B0SYNCOK001",
      title: "Sync retry product",
      categoryTree: [{ name: "Home" }],
      monthlySold: 420,
      reviewCount: 81,
      rating: 45,
      stats: { current: [null, 2999, 3299, 900] },
    }],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    const db = await getDb();
    const failedJob = (await db.query<{ id: string }>(
      "SELECT id FROM connector_sync_jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 1",
    )).rows[0];
    assert.ok(failedJob?.id);

    const result = await retryConnectorSyncJob(failedJob.id);
    assert.equal(result.job.status, "completed");
    assert.equal(result.job.attempt, 2);
    assert.equal(result.ingestion?.imported, 1);
    assert.equal(result.ingestion?.snapshots, 1);
    assert.equal(result.job.summary.apiCallCount, 1);

    const product = await db.query<{ competitor_price_cents: number; source_code: string; source_observed_at: string }>(
      "SELECT competitor_price_cents, source_code, source_observed_at FROM product_cases WHERE asin = 'B0SYNCOK001'",
    );
    assert.equal(product.rows[0]?.competitor_price_cents, 2999);
    assert.equal(product.rows[0]?.source_code, "keepa");
    assert.ok(product.rows[0]?.source_observed_at);

    const calls = await db.query<{ status_code: number; retry_count: number }>(
      "SELECT status_code, retry_count FROM connector_api_calls WHERE job_id = $1 ORDER BY created_at",
      [result.job.id],
    );
    assert.deepEqual(calls.rows, [{ status_code: 200, retry_count: 0 }]);

    const secretLeak = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM connector_api_calls
       WHERE job_id = $1 AND (request_summary::text LIKE '%sync-success-key%' OR response_summary::text LIKE '%sync-success-key%')`,
      [result.job.id],
    );
    assert.equal(secretLeak.rows[0]?.count, "0");

    const auditLeak = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM audit_logs
       WHERE entity_id = $1 AND details::text LIKE '%sync-success-key%'`,
      [result.job.id],
    );
    assert.equal(auditLeak.rows[0]?.count, "0");

    const dashboard = await getConnectorSyncDashboard();
    const cursor = dashboard.cursors.find((item) => item.marketplace === "US");
    assert.equal(cursor?.freshness, "fresh");
    assert.equal(cursor?.consecutive_failures, 0);
    assert.ok(cursor?.last_success_at);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KEEPA_API_KEY;
    else process.env.KEEPA_API_KEY = originalKey;
  }
});

test("active Keepa jobs are idempotent and transient HTTP failures are audited", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KEEPA_API_KEY;
  process.env.KEEPA_API_KEY = "sync-retry-key";
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      });
    }
    return new Response(JSON.stringify({
      products: [{
        asin: "B0SYNC429",
        title: "Rate limited then synced",
        monthlySold: 100,
        stats: { current: [null, 1999] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const first = await enqueueKeepaSync({ asins: ["B0SYNC429"], marketplace: "US" });
    const duplicate = await enqueueKeepaSync({ asins: "B0SYNC429", marketplace: "US" });
    assert.equal(first.id, duplicate.id);

    const result = await runConnectorSyncJob(first.id, {
      fetchOptions: { retryBaseDelayMs: 1, sleep: async () => {} },
    });
    assert.equal(result.job.status, "completed");
    assert.equal(requestCount, 2);

    const db = await getDb();
    const calls = await db.query<{ status_code: number; retry_count: number; request_summary: string }>(
      "SELECT status_code, retry_count, request_summary::text AS request_summary FROM connector_api_calls WHERE job_id = $1 ORDER BY created_at",
      [first.id],
    );
    assert.equal(calls.rows.length, 2);
    assert.deepEqual(calls.rows.map((call) => [call.status_code, call.retry_count]), [[429, 0], [200, 1]]);
    assert.doesNotMatch(calls.rows.map((call) => call.request_summary).join(" "), /sync-retry-key/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KEEPA_API_KEY;
    else process.env.KEEPA_API_KEY = originalKey;
  }
});

test("Keepa errors persist without leaking the API key", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.KEEPA_API_KEY;
  const secret = "secret-keepa-key-123";
  process.env.KEEPA_API_KEY = secret;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: { message: `invalid key=${secret}` },
  }), { status: 401, headers: { "content-type": "application/json" } })) as typeof fetch;

  try {
    const result = await createAndRunKeepaSync({ asins: ["B0SYNC401"], marketplace: "US" });
    assert.equal(result.job.status, "failed");
    assert.doesNotMatch(result.job.error_message ?? "", /secret-keepa-key-123/);
    assert.match(result.job.error_message ?? "", /REDACTED/);

    const db = await getDb();
    const run = await db.query<{ error_message: string }>(
      "SELECT error_message FROM ingestion_runs WHERE id = $1",
      [result.job.run_id],
    );
    assert.doesNotMatch(run.rows[0]?.error_message ?? "", /secret-keepa-key-123/);
    const audit = await db.query<{ details: string }>(
      "SELECT details::text AS details FROM audit_logs WHERE entity_id = $1",
      [result.job.id],
    );
    assert.doesNotMatch(audit.rows.map((row) => row.details).join(" "), /secret-keepa-key-123/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.KEEPA_API_KEY;
    else process.env.KEEPA_API_KEY = originalKey;
  }
});
