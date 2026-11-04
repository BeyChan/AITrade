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
  createAndRunSorftimeSync,
  enqueueKeepaSync,
  getConnectorSyncDashboard,
  retryConnectorSyncJob,
  runConnectorSyncJob,
} = await import("./connector-sync.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
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

test("Sorftime job fails clearly without a key and makes no external request", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SORFTIME_API_KEY;
  delete process.env.SORFTIME_API_KEY;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await createAndRunSorftimeSync({
      mode: "asin",
      marketplace: "US",
      asins: ["B0SYNCASIN"],
    });
    assert.equal(result.job.status, "failed");
    assert.equal(result.errorCode, "not_configured");
    assert.match(result.error ?? "", /尚未配置凭证/);
    assert.equal(requestCount, 0);

    const db = await getDb();
    const apiCalls = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM connector_api_calls WHERE job_id = $1",
      [result.job.id],
    );
    assert.equal(apiCalls.rows[0]?.count, "0");

    const products = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM product_cases WHERE source_code = 'sorftime'",
    );
    assert.equal(products.rows[0]?.count, "0");

    const cursor = await db.query<{ consecutive_failures: number; last_success_at: string | null }>(
      "SELECT consecutive_failures, last_success_at FROM connector_sync_cursors WHERE source_code = 'sorftime' AND marketplace = 'US'",
    );
    assert.equal(cursor.rows[0]?.consecutive_failures, 1);
    assert.equal(cursor.rows[0]?.last_success_at, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SORFTIME_API_KEY;
    else process.env.SORFTIME_API_KEY = originalKey;
  }
});

test("Sorftime category research persists candidates, ratios and source-specific audit without secrets", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SORFTIME_API_KEY;
  const secret = "sorftime-secret-key-123";
  process.env.SORFTIME_API_KEY = secret;
  let requestCount = 0;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestCount += 1;
    const tool = mcpToolName(init);
    const payload = tool === "category_name_search"
      ? { items: [{ nodeId: "7072561011", name: "Cell Phones" }] }
      : {
          "Top100产品": [{
            ASIN: "B0SYNCSFT1",
            标题: "Sorftime sync phone",
            月销量: "10533",
            品牌: "Motorola",
            所处类目排名: "类目：Cell Phones，排名:3",
            价格: 114,
            评论数: 4827,
            星级: 4.3,
          }],
          类目统计报告: {
            类目名称: "Cell Phones",
            top3_brands_sales_volume_share: "销量前三的品牌月销量占比:84.11%",
            amazonOwned_sales_volume_share: "亚马逊自营月销量占比:22.38%",
          },
        };
    return new Response(mcpEnvelope(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await createAndRunSorftimeSync(
      { mode: "category", marketplace: "US", categoryQuery: "Cell Phones" },
      { sorftimeFetchOptions: { retryBaseDelayMs: 1, sleep: async () => {} } },
    );
    assert.equal(result.job.status, "completed");
    assert.equal(result.ingestion?.imported, 1);
    assert.equal(result.ingestion?.snapshots, 2);
    assert.equal(result.job.summary.apiCallCount, 2);
    assert.equal(result.job.request_payload.mode, "category");
    assert.equal(requestCount, 2);

    const db = await getDb();
    const product = await db.query<{
      status: string;
      source_code: string;
      monthly_sales_estimate: number;
      notes: string;
    }>(
      "SELECT status, source_code, monthly_sales_estimate, notes FROM product_cases WHERE asin = 'B0SYNCSFT1' AND marketplace = 'US'",
    );
    assert.equal(product.rows[0]?.status, "review_pending");
    assert.equal(product.rows[0]?.source_code, "sorftime");
    assert.equal(product.rows[0]?.monthly_sales_estimate, 10533);
    assert.match(product.rows[0]?.notes ?? "", /研究占位值/);

    const calls = await db.query<{ request_summary: string; error_message: string | null }>(
      `SELECT request_summary::text AS request_summary, error_message
       FROM connector_api_calls WHERE job_id = $1 ORDER BY created_at`,
      [result.job.id],
    );
    assert.equal(calls.rows.length, 2);
    assert.doesNotMatch(calls.rows.map((call) => `${call.request_summary} ${call.error_message ?? ""}`).join(" "), new RegExp(secret));

    const cursor = await db.query<{ cursor: Record<string, unknown>; consecutive_failures: number }>(
      "SELECT cursor, consecutive_failures FROM connector_sync_cursors WHERE source_code = 'sorftime' AND marketplace = 'US'",
    );
    assert.equal(cursor.rows[0]?.cursor.lastMode, "category");
    assert.equal(cursor.rows[0]?.cursor.lastImportedCount, 1);
    assert.equal(cursor.rows[0]?.consecutive_failures, 0);

    const snapshot = await db.query<{
      evidence_type: string;
      normalized_payload: Record<string, unknown>;
    }>(
      `SELECT evidence_type, normalized_payload FROM evidence_snapshots
       WHERE source_code = 'sorftime' AND evidence_type = 'sorftime_category_report' LIMIT 1`,
    );
    assert.equal(snapshot.rows[0]?.evidence_type, "sorftime_category_report");
    const stats = snapshot.rows[0]?.normalized_payload.stats as Record<string, unknown> | undefined;
    assert.equal(stats?.top3_brands_sales_volume_share, "销量前三的品牌月销量占比:84.11%");

    const leakChecks = await Promise.all([
      db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM connector_sync_jobs WHERE (request_payload::text || summary::text || COALESCE(error_message, '')) LIKE $1",
        [`%${secret}%`],
      ),
      db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM connector_api_calls WHERE (request_summary::text || response_summary::text || COALESCE(error_message, '')) LIKE $1",
        [`%${secret}%`],
      ),
      db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM audit_logs WHERE details::text LIKE $1",
        [`%${secret}%`],
      ),
      db.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM ingestion_runs WHERE (query::text || COALESCE(error_message, '')) LIKE $1",
        [`%${secret}%`],
      ),
    ]);
    assert.deepEqual(leakChecks.map((query) => query.rows[0]?.count), ["0", "0", "0", "0"]);

    const duplicate = await createAndRunSorftimeSync(
      { mode: "category", marketplace: "US", categoryQuery: "Cell Phones" },
      { sorftimeFetchOptions: { retryBaseDelayMs: 1, sleep: async () => {} } },
    );
    assert.equal(duplicate.job.status, "completed");
    assert.equal(duplicate.ingestion?.imported, 0);
    assert.equal(duplicate.ingestion?.skipped, 1);
    const productCount = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM product_cases WHERE asin = 'B0SYNCSFT1' AND marketplace = 'US'",
    );
    assert.equal(productCount.rows[0]?.count, "1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SORFTIME_API_KEY;
    else process.env.SORFTIME_API_KEY = originalKey;
  }
});

test("a failed Sorftime job retries as ASIN research and records the source cursor", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SORFTIME_API_KEY;
  process.env.SORFTIME_API_KEY = "sorftime-retry-key";
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(mcpEnvelope([{
      "产品ASIN码": "B0SYNCASIN",
      标题: "Sorftime ASIN retry product",
      价格: 39.99,
      月销量: 250,
      评论数: 80,
      星级: 4.5,
    }]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const db = await getDb();
    const failedJob = (await db.query<{ id: string }>(
      "SELECT id FROM connector_sync_jobs WHERE source_code = 'sorftime' AND status = 'failed' ORDER BY created_at DESC LIMIT 1",
    )).rows[0];
    assert.ok(failedJob?.id);

    const result = await retryConnectorSyncJob(failedJob.id, {
      sorftimeFetchOptions: { retryBaseDelayMs: 1, sleep: async () => {} },
    });
    assert.equal(result.job.status, "completed");
    assert.equal(result.job.source_code, "sorftime");
    assert.equal(result.job.attempt, 2);
    assert.equal(result.ingestion?.imported, 1);
    assert.equal(result.job.summary.apiCallCount, 1);
    assert.equal(requestCount, 1);

    const product = await db.query<{ status: string; source_code: string; competitor_price_cents: number }>(
      "SELECT status, source_code, competitor_price_cents FROM product_cases WHERE asin = 'B0SYNCASIN' AND marketplace = 'US'",
    );
    assert.equal(product.rows[0]?.status, "review_pending");
    assert.equal(product.rows[0]?.source_code, "sorftime");
    assert.equal(product.rows[0]?.competitor_price_cents, 3999);

    const cursor = await db.query<{ cursor: Record<string, unknown>; consecutive_failures: number }>(
      "SELECT cursor, consecutive_failures FROM connector_sync_cursors WHERE source_code = 'sorftime' AND marketplace = 'US'",
    );
    assert.equal(cursor.rows[0]?.cursor.lastMode, "asin");
    assert.equal(cursor.rows[0]?.cursor.lastImportedCount, 1);
    assert.equal(cursor.rows[0]?.consecutive_failures, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SORFTIME_API_KEY;
    else process.env.SORFTIME_API_KEY = originalKey;
  }
});

function mcpEnvelope(payload: unknown) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
  });
}

function mcpToolName(init?: RequestInit) {
  return (JSON.parse(String(init?.body)) as { params?: { name?: string } }).params?.name ?? "";
}
