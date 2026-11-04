import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSupplierUrl,
  parseCandidateCsv,
  parseQuoteCsv,
  parseSupplierCsv,
  supplierIdentityKey,
} from "./csv.ts";

test("candidate CSV preserves observed time, source and sales range", () => {
  const [row] = parseCandidateCsv([
    "source,source_record_id,observed_at,asin,marketplace,category,title,competitor_price,currency,monthly_sales_min,monthly_sales_max,review_count,rating,bsr,keyword,keyword_search_volume,seller_count,variation_count,landed_cost,fba_fee,referral_rate,ad_rate,return_rate,return_processing,return_recovery_rate,coupon,storage_cost,other_cost",
    "keepa_export,rec-1,2026-11-04T08:00:00Z,B0TEST001,US,宠物用品,Test product,39.99,USD,800,1200,340,4.3,1250,pet fountain,2400,18,4,12.40,5.72,15%,12%,6%,3.00,30%,1.00,0.45,0.50",
  ].join("\n"));

  assert.equal(row.marketplace, "US");
  assert.equal(row.source, "keepa_export");
  assert.equal(row.sourceRecordId, "rec-1");
  assert.equal(row.observedAt, "2026-11-04T08:00:00.000Z");
  assert.equal(row.monthlySalesMin, 800);
  assert.equal(row.monthlySalesMax, 1200);
  assert.equal(row.monthlySalesEstimate, 1000);
  assert.equal(row.currency, "USD");
  assert.equal(row.bsr, 1250);
  assert.equal(row.keywordSearchVolume, 2400);
});

test("supplier CSV normalizes platform and keeps verification metadata", () => {
  const [row] = parseSupplierCsv([
    "supplier_platform,external_supplier_id,supplier_name,supplier_url,country,contact,category,rating,verified,moq,lead_time_days,certifications,observed_at",
    "1688,SUP-1,Example Supplier,https://example.com/s/1?utm_source=test,CN,sales@example.com,Pet,4.7,true,500,25,ISO9001,2026-11-04T08:00:00Z",
  ].join("\n"));

  assert.equal(row.platform, "1688");
  assert.equal(row.externalSupplierId, "SUP-1");
  assert.equal(row.verified, true);
  assert.equal(row.moq, 500);
  assert.equal(row.leadTimeDays, 25);
});

test("quote CSV parses landed-cost inputs and links to a case or ASIN", () => {
  const [row] = parseQuoteCsv([
    "asin,marketplace,supplier_platform,external_supplier_id,supplier_name,unit_price,freight_per_unit,duty_rate,quality_score,moq,lead_time_days,payment_terms,incoterm,sample_fee,tooling_fee,certifications,quote_valid_until,currency,observed_at",
    "B0TEST001,US,1688,SUP-1,Example Supplier,5.20,1.10,8%,82,500,25,30 days,FOB,120,0,CE / RoHS,2026-12-31,USD,2026-11-04T08:00:00Z",
  ].join("\n"));

  assert.equal(row.asin, "B0TEST001");
  assert.equal(row.unitPriceCents, 520);
  assert.equal(row.freightPerUnitCents, 110);
  assert.equal(row.dutyRate, 0.08);
  assert.equal(row.sampleFeeCents, 12000);
  assert.equal(row.toolingFeeCents, 0);
  assert.equal(row.quoteValidUntil, "2026-12-31");
});

test("supplier URL normalization removes tracking and identity prefers external ID", () => {
  const normalized = normalizeSupplierUrl("HTTPS://Example.com/store/1/?utm_source=newsletter&spm=abc");
  assert.equal(normalized, "https://example.com/store/1");

  const byId = supplierIdentityKey({
    platform: "1688",
    externalSupplierId: " SUP-1 ",
    url: "https://example.com/store/1",
    name: "Example Supplier",
  });
  const bySameId = supplierIdentityKey({
    platform: "1688",
    externalSupplierId: "sup-1",
    url: "https://another.example.com",
    name: "Another Name",
  });
  assert.equal(byId, "1688:id:sup-1");
  assert.equal(byId, bySameId);
});
