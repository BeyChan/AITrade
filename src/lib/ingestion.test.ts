import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ingestion-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getDb } = await import("./db.ts");
const {
  getDataSourcesDashboard,
  importCandidatesCsv,
  importKeepaByAsins,
  importQuotesCsv,
  importSuppliersCsv,
} = await import("./ingestion.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
});

const candidateCsv = [
  "source,source_record_id,observed_at,asin,marketplace,category,title,competitor_price,currency,monthly_sales_min,monthly_sales_max,review_count,rating,landed_cost,fba_fee,referral_rate,ad_rate,return_rate,return_processing,return_recovery_rate,coupon,storage_cost,other_cost",
  "csv_sample,INGEST-C-1,2026-11-04T08:00:00Z,B0INGEST001,US,宠物用品,Ingestion test product,39.99,USD,800,1200,340,4.3,10.00,5.72,15%,12%,6%,3.00,30%,1.00,0.45,0.50",
].join("\n");

const supplierCsv = [
  "supplier_platform,external_supplier_id,supplier_name,supplier_url,country,contact,category,rating,verified,moq,lead_time_days,certifications,observed_at",
  "1688,SUP-INGEST-1,Ingestion Supplier,https://example.com/supplier/ingest?utm_source=test,CN,first@example.com,Pet,4.6,true,500,25,ISO9001,2026-11-04T08:00:00Z",
].join("\n");

const updatedSupplierCsv = supplierCsv.replace("first@example.com", "second@example.com");

const quoteCsv = [
  "asin,marketplace,supplier_platform,external_supplier_id,supplier_name,unit_price,freight_per_unit,duty_rate,quality_score,moq,lead_time_days,payment_terms,incoterm,sample_fee,tooling_fee,certifications,quote_valid_until,currency,observed_at",
  "B0INGEST001,US,1688,SUP-INGEST-1,Ingestion Supplier,5.20,1.10,8%,82,500,25,30 days,FOB,120,0,CE / RoHS,2026-12-31,USD,2026-11-04T08:00:00Z",
].join("\n");

test("ingestion is traceable, guarded and idempotent", async () => {
  const db = await getDb();

  const firstCandidate = await importCandidatesCsv(candidateCsv, { fileName: "candidates.csv" });
  assert.equal(firstCandidate.imported, 1);
  assert.equal(firstCandidate.snapshots, 1);
  assert.equal(firstCandidate.status, "completed");

  const duplicateCandidate = await importCandidatesCsv(candidateCsv, { fileName: "candidates.csv" });
  assert.equal(duplicateCandidate.skipped, 1);
  assert.equal(duplicateCandidate.snapshots, 0);

  const sameProductOnTikTok = await importCandidatesCsv(candidateCsv, {
    fileName: "candidates-tiktok.csv",
    marketOverride: "US",
    platformCode: "tiktok_shop",
  });
  assert.equal(sameProductOnTikTok.updated, 1);
  assert.equal(sameProductOnTikTok.imported, 0);

  const candidateId = (await db.query<{ id: string }>(
    "SELECT id FROM product_cases WHERE asin = 'B0INGEST001' AND marketplace = 'US'",
  )).rows[0]?.id;
  assert.ok(candidateId);
  const siteLinks = await db.query<{ market_code: string; platform_code: string }>(
    "SELECT market_code, platform_code FROM product_case_sites WHERE case_id = $1 ORDER BY platform_code",
    [candidateId],
  );
  assert.deepEqual(
    siteLinks.rows.map((row) => `${row.market_code}:${row.platform_code}`),
    ["US:amazon", "US:tiktok_shop"],
  );
  const tiktokGbScope = await db.query<{ case_id: string }>(
    "SELECT case_id FROM product_case_sites WHERE market_code = 'GB' AND platform_code = 'tiktok_shop' AND case_id = $1",
    [candidateId],
  );
  assert.equal(tiktokGbScope.rows.length, 0);

  const firstSupplier = await importSuppliersCsv(supplierCsv, { fileName: "suppliers.csv" });
  assert.equal(firstSupplier.imported, 1);
  assert.equal(firstSupplier.snapshots, 1);

  const updatedSupplier = await importSuppliersCsv(updatedSupplierCsv, { fileName: "suppliers.csv" });
  assert.equal(updatedSupplier.updated, 1);
  assert.equal(updatedSupplier.snapshots, 1);

  const product = await db.query<{ id: string; status: string }>(
    "SELECT id, status FROM product_cases WHERE asin = 'B0INGEST001' AND marketplace = 'US'",
  );
  assert.ok(product.rows[0]?.id);
  assert.equal(product.rows[0]?.status, "approved");

  const firstQuote = await importQuotesCsv(quoteCsv, { fileName: "quotes.csv" });
  assert.equal(firstQuote.imported, 1);
  assert.equal(firstQuote.snapshots, 1);

  const duplicateQuote = await importQuotesCsv(quoteCsv, { fileName: "quotes.csv" });
  assert.equal(duplicateQuote.skipped, 1);
  assert.equal(duplicateQuote.snapshots, 0);

  const previousKeepaKey = process.env.KEEPA_API_KEY;
  delete process.env.KEEPA_API_KEY;
  try {
    await assert.rejects(
      importKeepaByAsins({ asins: ["B0INGEST001"], marketplace: "US" }),
      /Keepa 尚未配置凭证/,
    );
  } finally {
    if (previousKeepaKey === undefined) delete process.env.KEEPA_API_KEY;
    else process.env.KEEPA_API_KEY = previousKeepaKey;
  }
  const failedKeepaRun = await db.query<{ error_count: number; status: string; error_message: string }>(
    "SELECT error_count, status, error_message FROM ingestion_runs WHERE source_code = 'keepa' ORDER BY started_at DESC LIMIT 1",
  );
  assert.equal(failedKeepaRun.rows[0]?.status, "failed");
  assert.equal(failedKeepaRun.rows[0]?.error_count, 1);
  assert.match(failedKeepaRun.rows[0]?.error_message ?? "", /尚未配置凭证/);

  const dashboard = await getDataSourcesDashboard();
  assert.equal(dashboard.stats.realCandidateCount, 1);
  assert.equal(dashboard.stats.supplierCount, 1);
  assert.equal(dashboard.stats.quoteCount, 1);
  assert.equal(dashboard.stats.snapshotCount, 4);
  assert.ok(dashboard.runs.length >= 6);
  assert.ok(dashboard.sources.find((source) => source.code === "csv_candidates")?.last_synced_at);

  const persistedSupplier = await db.query<{ contact: string }>(
    "SELECT contact FROM suppliers WHERE name = 'Ingestion Supplier'",
  );
  assert.equal(persistedSupplier.rows[0]?.contact, "second@example.com");

  const quoteAudit = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM audit_logs WHERE action = 'quote.imported'",
  );
  assert.equal(quoteAudit.rows[0]?.count, "1");
});
