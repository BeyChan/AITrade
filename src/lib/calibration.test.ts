import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateSkuObservations,
  computeCalibrationSuggestion,
  previewCalibrationImpact,
  type CalibrationSnapshotRow,
} from "./calibration.ts";
import type { EconomicsAssumptions } from "./economics.ts";

function makeRow(overrides: Partial<CalibrationSnapshotRow> = {}): CalibrationSnapshotRow {
  return {
    marketplace: "US",
    currency: "USD",
    sku: "SKU-PET-1",
    caseId: "case-1",
    caseAsin: "B0PET00001",
    category: "宠物清洁",
    periodKey: "2026-10",
    periodEnd: "2026-10-31",
    unitsSold: 19,
    grossUnits: 20,
    refundUnits: 1,
    grossRevenueCents: 50_000,
    revenueCents: 47_500,
    refundCents: 2_500,
    platformFeeCents: 7_125,
    fulfillmentFeeCents: 10_000,
    adSpendCents: 7_500,
    adAttribution: "ads_report",
    storageFeeCents: 950,
    ...overrides,
  };
}

test("aggregateSkuObservations merges multiple periods and isolates missing ad attribution", () => {
  const rows: CalibrationSnapshotRow[] = [
    makeRow({
      sku: "SKU-A",
      periodKey: "2026-09",
      periodEnd: "2026-09-30",
      grossUnits: 10,
      unitsSold: 9,
      grossRevenueCents: 25_000,
      revenueCents: 22_500,
      refundCents: 2_500,
      adSpendCents: 0,
      adAttribution: "missing",
    }),
    makeRow({
      sku: "SKU-A",
      periodKey: "2026-10",
      periodEnd: "2026-10-31",
      grossUnits: 10,
      unitsSold: 10,
      grossRevenueCents: 25_000,
      revenueCents: 25_000,
      refundCents: 0,
      adSpendCents: 3_750,
      adAttribution: "ads_report",
    }),
  ];

  const obs = aggregateSkuObservations(rows);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].grossUnits, 20);
  assert.equal(obs[0].refundCents, 2_500);
  assert.equal(obs[0].returnRate, 0.05); // 2500 / 50000
  // 广告率只按已归因的 2026-10 期的 25000 分计算 = 3750 / 25000 = 15%，不会被 2026-09 的缺失期稀释成 7.5%
  assert.equal(obs[0].adRate, 0.15);
  assert.equal(obs[0].latestPeriodEnd, "2026-10-31");
});

test("computeCalibrationSuggestion applies 4-level fallback and filters low-volume noise", () => {
  const categoryRows: CalibrationSnapshotRow[] = [
    makeRow({ sku: "PET-1", caseAsin: "B001", category: "宠物清洁", refundCents: 3_000, grossRevenueCents: 50_000, adSpendCents: 6_000 }), // 6% return, 12% ad
    makeRow({ sku: "PET-2", caseAsin: "B002", category: "宠物清洁", refundCents: 4_000, grossRevenueCents: 50_000, adSpendCents: 8_000 }), // 8% return, 16% ad
    makeRow({ sku: "PET-3", caseAsin: "B003", category: "宠物清洁", refundCents: 5_000, grossRevenueCents: 50_000, adSpendCents: 10_000 }), // 10% return, 20% ad
    // 低销量噪声样本（仅 3 件，退货率 50%）应被过滤
    makeRow({ sku: "PET-NOISE", caseAsin: "B004", category: "宠物清洁", grossUnits: 3, unitsSold: 2, refundCents: 5_000, grossRevenueCents: 10_000 }),
  ];

  // Level 2: 同类目达到 3 个有效 SKU → 中位数 8% 退货率, 16% 广告率
  const catSuggestion = computeCalibrationSuggestion(categoryRows, {
    marketplace: "US",
    currency: "USD",
    category: "宠物清洁",
    salePriceCents: 2_500,
  });
  assert.equal(catSuggestion.scope, "category");
  assert.equal(catSuggestion.status, "calibrated");
  assert.equal(catSuggestion.sampleSkuCount, 3);
  assert.equal(catSuggestion.suggested.returnRate, 0.08);
  assert.equal(catSuggestion.suggested.adRate, 0.16);
  assert.equal(catSuggestion.distributions.returnRate?.p25, 0.07);
  assert.equal(catSuggestion.distributions.returnRate?.p75, 0.09);

  // Level 1: 同款 SKU 精确命中 → 优先用该 SKU 自身历史
  const skuSuggestion = computeCalibrationSuggestion(categoryRows, {
    marketplace: "US",
    currency: "USD",
    category: "宠物清洁",
    asin: "B003",
    salePriceCents: 2_500,
  });
  assert.equal(skuSuggestion.scope, "sku");
  assert.equal(skuSuggestion.suggested.returnRate, 0.1);
  assert.equal(skuSuggestion.suggested.adRate, 0.2);

  // Level 3: 其他类目无足够样本 → 回退到同站点全店统计（只校准比例项，不跨类目套用 FBA 费用）
  const storeSuggestion = computeCalibrationSuggestion(categoryRows, {
    marketplace: "US",
    currency: "USD",
    category: "厨房小工具",
    salePriceCents: 2_500,
  });
  assert.equal(storeSuggestion.scope, "store");
  assert.equal(storeSuggestion.suggested.returnRate, 0.08);
  assert.equal(storeSuggestion.suggested.fbaFeeCents, null);

  // Level 4: 跨站点无样本 → platform_default
  const defaultSuggestion = computeCalibrationSuggestion(categoryRows, {
    marketplace: "UK",
    currency: "GBP",
    category: "宠物清洁",
    salePriceCents: 2_500,
  });
  assert.equal(defaultSuggestion.scope, "platform_default");
  assert.equal(defaultSuggestion.status, "uncalibrated");
});

test("previewCalibrationImpact detects GO -> HOLD transition when real return & ad rates are higher", () => {
  const assumptions: EconomicsAssumptions = {
    currency: "USD",
    salePriceCents: 2_999,
    landedCostCents: 650,
    fbaFeeCents: 500,
    referralRate: 0.15,
    adRate: 0.1,
    returnRate: 0.04,
    returnProcessingCents: 300,
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: 50,
    otherCostCents: 50,
  };

  const rows: CalibrationSnapshotRow[] = [
    makeRow({ sku: "P1", category: "宠物清洁", refundCents: 4_500, grossRevenueCents: 50_000, adSpendCents: 9_000, fulfillmentFeeCents: 11_000 }),
    makeRow({ sku: "P2", category: "宠物清洁", refundCents: 5_000, grossRevenueCents: 50_000, adSpendCents: 10_000, fulfillmentFeeCents: 11_000 }),
    makeRow({ sku: "P3", category: "宠物清洁", refundCents: 5_500, grossRevenueCents: 50_000, adSpendCents: 11_000, fulfillmentFeeCents: 11_000 }),
  ];

  const suggestion = computeCalibrationSuggestion(rows, {
    marketplace: "US",
    currency: "USD",
    category: "宠物清洁",
    salePriceCents: assumptions.salePriceCents,
  });

  const preview = previewCalibrationImpact({
    assumptions,
    suggestion,
    monthlySalesEstimate: 2_000,
    reviewCount: 400,
    evidenceScore: 85,
  });

  assert.equal(preview.canApply, true);
  assert.equal(preview.before.recommendation, "GO");
  assert.notEqual(preview.after.recommendation, "GO");
  assert.equal(preview.decisionChanged, true);
  assert.ok(preview.after.marginRate < preview.before.marginRate);
  assert.ok(preview.after.maxLandedCostCents < preview.before.maxLandedCostCents);
});
