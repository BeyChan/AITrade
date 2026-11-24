import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// 与其它 lib 测试一致：每个文件独占 PGlite 数据目录，避免全量跑时目录被并发占用
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-competitor-engine-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { extractAsinFromUrl, parseCompetitorInputs } = await import("./parser.ts");
const { analyzeCompetitors, computeEffectivePriceCents, reanalyzeExistingReport } = await import("./engine.ts");
const { calculateProductIndex } = await import("./competitiveness.ts");
const {
  confirmComparisonReport,
  getComparisonReportById,
  saveComparisonReport,
} = await import("./storage.ts");
const { getDb } = await import("../db.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("extractAsinFromUrl correctly extracts Amazon ASINs", () => {
  assert.equal(extractAsinFromUrl("B08CZ8K652"), "B08CZ8K652");
  assert.equal(
    extractAsinFromUrl("https://www.amazon.com/dp/B08CZ8K652"),
    "B08CZ8K652",
  );
  assert.equal(
    extractAsinFromUrl("https://www.amazon.com/Fanttik-V8-Apex/dp/B09M87J11L?ref=xyz"),
    "B09M87J11L",
  );
});

test("parseCompetitorInputs parses multiple URLs and titles", () => {
  const input = `https://www.amazon.com/dp/B08CZ8K652
https://www.amazon.com/dp/B09M87J11L
B0875X3V95`;
  const items = parseCompetitorInputs(input);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.asin, "B08CZ8K652");
  assert.equal(items[1]?.asin, "B09M87J11L");
  assert.equal(items[2]?.asin, "B0875X3V95");
});

test("parseCompetitorInputs deduplicates same ASIN with different query params and ignores generic adjective brand", () => {
  const input = `https://www.amazon.com/Automatic-Windproof-Compact-Rain-Umbrella/dp/B01LZ75ROQ/ref=sr_1_3?th=1
https://www.amazon.com/Automatic-Windproof-Compact-Rain-Umbrella/dp/B01LZ75ROQ/ref=sr_1_3`;
  const items = parseCompetitorInputs(input);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.asin, "B01LZ75ROQ");
  assert.equal(items[0]?.url, "https://www.amazon.com/dp/B01LZ75ROQ");
});

test("analyzeCompetitors never fabricates prices when no captured data is provided", async () => {
  const result = await analyzeCompetitors({
    rawInputs: `https://www.amazon.com/dp/B08CZ8K652
https://www.amazon.com/dp/B09M87J11L`,
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
  });

  assert.ok(result.id);
  assert.equal(result.competitors.length, 2);
  assert.equal(result.priceStats.verifiedSampleCount, 0);
  assert.equal(result.priceStats.p50, 0);
  assert.equal(result.competitors[0]?.priceCents, 0);
});

test("analyzeCompetitors produces valid percentiles from verified captured prices", async () => {
  const result = await analyzeCompetitors({
    rawInputs: `https://www.amazon.com/dp/B08CZ8K652
https://www.amazon.com/dp/B09M87J11L`,
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
    capturedInputs: [
      { raw: "https://www.amazon.com/dp/B08CZ8K652", asin: "B08CZ8K652", captured: { priceCents: 1999, rating: 4.3, reviewCount: 1200, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B09M87J11L", asin: "B09M87J11L", captured: { priceCents: 2999, rating: 4.5, reviewCount: 8500, currency: "USD" } },
    ],
  });

  assert.equal(result.priceStats.verifiedSampleCount, 2);
  assert.equal(result.priceStats.min, 1999);
  assert.equal(result.priceStats.max, 2999);
  assert.equal(result.priceStats.p50, 2499);
  assert.ok(result.summary.commonStrengths.length > 0);
  assert.ok(result.summary.commonWeaknesses.length > 0);
  assert.ok(result.summary.attackVector.length > 0);
  assert.ok(result.sourcingAction.recommendedKeywords1688.length > 0);
});

test("computeEffectivePriceCents parses percentage, explicit discounts, and final coupon prices accurately", () => {
  assert.equal(computeEffectivePriceCents(4000, "Save 20% with coupon"), 3200);
  assert.equal(computeEffectivePriceCents(3999, "Save $5.00"), 3499);
  assert.equal(computeEffectivePriceCents(3999, "$5.00 off"), 3499);
  // 券后直接标价 "$18.99" 或 "$18.99 with coupon" 不得误减为 1.00 AUD！
  assert.equal(computeEffectivePriceCents(1999, "$18.99"), 1899);
  assert.equal(computeEffectivePriceCents(1999, "$18.99 with coupon"), 1899);
  // 即使历史缓存了错误 effectivePriceCents=100，重算时也自动纠偏为 1899
  assert.equal(computeEffectivePriceCents(1999, "$18.99", 100), 1899);
  assert.equal(computeEffectivePriceCents(2999, ""), 2999);
});

test("calculateProductIndex never fakes missing sales and aggregates HHI by brand", async () => {
  const report = await analyzeCompetitors({
    rawInputs: [
      "https://www.amazon.com/dp/B0AAA00001",
      "https://www.amazon.com/dp/B0AAA00002",
      "https://www.amazon.com/dp/B0AAA00003",
      "https://www.amazon.com/dp/B0AAA00004",
      "https://www.amazon.com/dp/B0BBB00005",
    ].join("\n"),
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
    capturedInputs: [
      { raw: "https://www.amazon.com/dp/B0AAA00001", asin: "B0AAA00001", brand: "Anker", captured: { priceCents: 4000, couponText: "20% off", rating: 4.5, reviewCount: 2500, isSponsored: true, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0AAA00002", asin: "B0AAA00002", brand: "Anker", captured: { priceCents: 3500, rating: 4.4, reviewCount: 1800, isSponsored: false, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0AAA00003", asin: "B0AAA00003", brand: "Anker", captured: { priceCents: 3800, rating: 4.6, reviewCount: 3200, fulfillmentType: "amazon_1p", currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0AAA00004", asin: "B0AAA00004", brand: "Anker", captured: { priceCents: 4200, rating: 4.3, reviewCount: 900, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0BBB00005", asin: "B0BBB00005", brand: "SmallBrand", captured: { priceCents: 3600, rating: 4.1, reviewCount: 120, currency: "USD" } },
    ],
  });

  // 未抓到官方月销时，salesCapacity 必须 unavailable（绝不编造 300）
  assert.equal(report.productIndex?.pillars.salesCapacity.isAvailable, false);
  assert.equal(report.productIndex?.evidenceCompleteness, 80);

  // Anker 占 4/5 (80%)、SmallBrand 占 1/5 (20%) => 品牌 HHI = 80^2 + 20^2 = 6800（高度垄断）
  assert.equal(report.productIndex?.mathEvidence.hhi, 6800);
  assert.equal(report.productIndex?.mathEvidence.hhiBasis, "brand_shelf");
  assert.equal(report.productIndex?.pillars.monopolyRivalry.verdict, "poor");

  // 券后价 4000 * 0.8 = 3200 参与价格分位，min 应为 3200
  assert.equal(report.priceStats.min, 3200);
  assert.equal(report.marketSignals?.sponsoredCount, 1);
  assert.equal(report.marketSignals?.amazon1pCount, 1);
  assert.equal(report.marketSignals?.couponCount, 1);
  assert.equal(report.marketSignals?.avgDiscountPercent, 20);

  // 联动确定性财务净利率时，毛利支柱实时更新
  const withLiveMargin = calculateProductIndex(report, { overrideMarginPercent: 28.5 });
  assert.equal(withLiveMargin.mathEvidence.marginPercent, 28.5);
});

test("saveComparisonReport computes snapshotDiff when a newer snapshot shows price drop and review surge", async () => {
  const first = await analyzeCompetitors({
    rawInputs: "https://www.amazon.com/dp/B0DIFF0001\nhttps://www.amazon.com/dp/B0DIFF0002",
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
    capturedInputs: [
      { raw: "https://www.amazon.com/dp/B0DIFF0001", asin: "B0DIFF0001", captured: { priceCents: 4000, rating: 4.3, reviewCount: 100, boughtPastMonth: 400, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0DIFF0002", asin: "B0DIFF0002", captured: { priceCents: 4000, rating: 4.4, reviewCount: 200, boughtPastMonth: 300, currency: "USD" } },
    ],
  });
  first.id = "comp_diff_test_1";
  first.createdAt = "2026-11-01T00:00:00.000Z";
  await saveComparisonReport(first);

  const second = await analyzeCompetitors({
    rawInputs: "https://www.amazon.com/dp/B0DIFF0001\nhttps://www.amazon.com/dp/B0DIFF0002",
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
    capturedInputs: [
      { raw: "https://www.amazon.com/dp/B0DIFF0001", asin: "B0DIFF0001", captured: { priceCents: 3200, rating: 4.3, reviewCount: 260, boughtPastMonth: 500, currency: "USD" } },
      { raw: "https://www.amazon.com/dp/B0DIFF0002", asin: "B0DIFF0002", captured: { priceCents: 3600, rating: 4.4, reviewCount: 210, boughtPastMonth: 300, currency: "USD" } },
    ],
  });
  second.id = "comp_diff_test_2";
  second.createdAt = "2026-11-15T00:00:00.000Z";
  await saveComparisonReport(second);

  const saved = await getComparisonReportById("comp_diff_test_2", { mode: "sandbox" });
  assert.ok(saved?.snapshotDiff);
  assert.equal(saved!.snapshotDiff!.avgPriceDeltaPercent, -15);
  assert.equal(saved!.snapshotDiff!.reviewSurges[0]?.asin, "B0DIFF0001");
  assert.equal(saved!.snapshotDiff!.reviewSurges[0]?.deltaReviews, 160);
  assert.ok(saved!.snapshotDiff!.alerts.some((a) => a.includes("价格战")));
});

test("demo confirmation bypasses missing verified samples while regular confirmation still rejects", async () => {
  const report = await analyzeCompetitors({
    rawInputs: "https://www.amazon.com/dp/B0DEMOCONF01",
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
  });
  report.id = "comp_demo_confirm_test";
  report.provenance = "ai_generated";
  await saveComparisonReport(report);

  await assert.rejects(
    () => confirmComparisonReport(report.id),
    /真实抓取\/人工校验的价格样本/,
  );
  assert.equal((await getComparisonReportById(report.id, { mode: "sandbox" }))?.reviewStatus, "pending");

  const confirmed = await confirmComparisonReport(report.id, { allowUnverified: true });
  assert.equal(confirmed?.reviewStatus, "confirmed");
  assert.equal((await getComparisonReportById(report.id, { mode: "sandbox" }))?.reviewStatus, "confirmed");
});

test("reanalyzeExistingReport preserves captured data and supports removing an outlier ASIN in place", async () => {
  const original = await analyzeCompetitors({
    rawInputs: "https://www.amazon.com/dp/B0KEEP0001\nhttps://www.amazon.com/dp/B0DROP0002",
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    skipModel: true,
    capturedInputs: [
      {
        raw: "https://www.amazon.com/dp/B0KEEP0001",
        asin: "B0KEEP0001",
        brand: "KeepBrand",
        captured: {
          priceCents: 3500,
          rating: 4.4,
          reviewCount: 520,
          boughtPastMonth: 600,
          imageUrl: "https://example.com/a.jpg",
          currency: "USD",
        },
      },
      {
        raw: "https://www.amazon.com/dp/B0DROP0002",
        asin: "B0DROP0002",
        brand: "AccessoryOutlier",
        captured: {
          priceCents: 899,
          rating: 4.1,
          reviewCount: 40,
          currency: "USD",
        },
      },
    ],
  });
  original.promotedCaseId = "case_existing_1";

  const reanalyzed = await reanalyzeExistingReport(original, {
    excludeAsins: ["B0DROP0002"],
    skipModel: true,
  });

  assert.equal(reanalyzed.id, original.id);
  assert.equal(reanalyzed.promotedCaseId, "case_existing_1");
  assert.equal(reanalyzed.competitors.length, 1);
  assert.equal(reanalyzed.competitors[0]?.asin, "B0KEEP0001");
  assert.equal(reanalyzed.competitors[0]?.priceCents, 3500);
  assert.equal(reanalyzed.competitors[0]?.boughtPastMonth, 600);
  assert.equal(reanalyzed.competitors[0]?.imageUrl, "https://example.com/a.jpg");
  assert.equal(reanalyzed.priceStats.p50, 3500);
});
