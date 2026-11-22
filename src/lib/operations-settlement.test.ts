import assert from "node:assert/strict";
import test from "node:test";
import {
  ReportContractError,
  aggregateSettlement,
  compareWithForecast,
  validateInventorySnapshot,
  validateReportBatch,
  validateSettlementLine,
  type NormalizedInventorySnapshot,
  type NormalizedSettlementLine,
  type ReportBatch,
} from "./operations-settlement.ts";

const batch = (overrides: Partial<ReportBatch> = {}): ReportBatch => ({
  ingestionRunId: "run-1",
  rawHash: "hash-1",
  marketplaceCode: "US",
  reportTimezone: "America/Los_Angeles",
  periodStart: "2026-10-16",
  periodEnd: "2026-10-31",
  observedAt: "2026-11-01",
  currency: "USD",
  ...overrides,
});

const cnyBatch = (overrides: Partial<ReportBatch> = {}): ReportBatch =>
  batch({ fxRate: 7.2, fxRateDate: "2026-10-31", ...overrides });

const line = (overrides: Partial<NormalizedSettlementLine> = {}): NormalizedSettlementLine => ({
  batch: batch(),
  settlementId: "SET-2026-10B",
  skuKey: "SKU-A",
  orderDate: "2026-10-29",
  settlementDate: "2026-11-12",
  kind: "revenue",
  amountCents: 100_000,
  ...overrides,
});

const snapshot = (
  overrides: Partial<NormalizedInventorySnapshot> = {},
): NormalizedInventorySnapshot => ({
  batch: batch(),
  skuKey: "SKU-A",
  snapshotDate: "2026-10-31",
  availableUnits: 280,
  ...overrides,
});

test("a batch must carry traceability, a real timezone and a valid period", () => {
  assert.throws(
    () => validateReportBatch(batch({ ingestionRunId: "" }), "USD"),
    /ingestionRunId/,
  );
  assert.throws(
    () => validateReportBatch(batch({ reportTimezone: "Mars/Olympus" }), "USD"),
    /reportTimezone/,
  );
  assert.throws(
    () => validateReportBatch(batch({ periodStart: "2026-02-30" }), "USD"),
    /periodStart: invalid site-calendar date/,
  );
  assert.throws(
    () => validateReportBatch(batch({ periodStart: "2026-11-01", periodEnd: "2026-10-31" }), "USD"),
    /periodEnd: must not be earlier/,
  );
  assert.doesNotThrow(() => validateReportBatch(batch(), "USD"));
});

test("cross-currency batches need a rate and its date; same-currency batches must use 1", () => {
  assert.throws(
    () => validateReportBatch(batch(), "CNY"),
    /fxRate: cross-currency/,
  );
  assert.throws(
    () => validateReportBatch(batch({ fxRate: 7.2 }), "CNY"),
    /fxRateDate/,
  );
  assert.doesNotThrow(() =>
    validateReportBatch(batch({ fxRate: 7.2, fxRateDate: "2026-10-31" }), "CNY"),
  );
  assert.throws(
    () => validateReportBatch(batch({ fxRate: 1.1 }), "USD"),
    /fxRate: same-currency/,
  );
});

test("settlement lines reject bad amounts, unknown kinds and misapplied deduction flags", () => {
  assert.throws(
    () => validateSettlementLine(line({ amountCents: Number.NaN }), "USD"),
    /amountCents/,
  );
  assert.throws(
    () => validateSettlementLine(line({ kind: "mystery" as "revenue" }), "USD"),
    ReportContractError,
  );
  assert.throws(
    () => validateSettlementLine(line({ kind: "revenue", deductedInSettlement: true }), "USD"),
    /deductedInSettlement/,
  );
  assert.throws(
    () => validateSettlementLine(line({ orderDate: "2026-11-31" }), "USD"),
    /orderDate: invalid site-calendar date/,
  );
});

test("aggregates revenue, refunds, discounts and cross-border costs without double charging", () => {
  const lines = [
    line({ kind: "revenue", amountCents: 100_000, units: 100 }),
    line({ kind: "refund", amountCents: 5_000, units: 2 }),
    line({ kind: "discount", amountCents: 3_000 }),
    line({ kind: "purchaseLanded", amountCents: 30_000 }),
    line({ kind: "platformFee", amountCents: 15_000, deductedInSettlement: true }),
    line({ kind: "adCost", amountCents: 12_000 }),
    line({ kind: "vatOrSalesTax", amountCents: 5_000 }),
    line({ kind: "other", amountCents: -1_500 }),
  ];

  const [result] = aggregateSettlement(lines, { policy: "settlement", reportingCurrency: "USD" });
  assert.equal(result.contribution.netRevenueCents, 92_000);
  assert.equal(result.contribution.chargedCents, 45_500);
  assert.equal(result.contribution.contributionProfitCents, 46_500);
  assert.deepEqual(result.contribution.skippedKeys, ["platformFee"]);
  assert.equal(result.units, 98);
  assert.equal(result.lineCount, 8);
  assert.equal(result.periodKey, "2026-11");
  assert.deepEqual(result.rawHashes, ["hash-1"]);
  assert.deepEqual(result.ingestionRunIds, ["run-1"]);

  const [byOrder] = aggregateSettlement(lines, { policy: "order", reportingCurrency: "USD" });
  assert.equal(byOrder.periodKey, "2026-10");
  assert.equal(byOrder.contribution.contributionProfitCents, 46_500);
});

test("keeps settlement batches, sites and currencies in separate groups", () => {
  const results = aggregateSettlement(
    [
      line({ batch: cnyBatch() }),
      line({
        batch: cnyBatch(),
        settlementId: "SET-2026-11A",
        settlementDate: "2026-11-26",
      }),
      line({
        skuKey: "SKU-B",
        batch: cnyBatch({
          marketplaceCode: "DE",
          currency: "EUR",
          reportTimezone: "Europe/Berlin",
          fxRate: 7.8,
        }),
      }),
    ],
    { policy: "settlement", reportingCurrency: "CNY" },
  );
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((item) => [item.skuKey, item.settlementId, item.marketplaceCode, item.currency, item.fxRate]),
    [
      ["SKU-A", "SET-2026-10B", "US", "USD", 7.2],
      ["SKU-A", "SET-2026-11A", "US", "USD", 7.2],
      ["SKU-B", "SET-2026-10B", "DE", "EUR", 7.8],
    ],
  );
});

test("refuses to merge one group with inconsistent timezone or fx rate", () => {
  const crossCurrency = (fxRate: number, rawHash: string) =>
    line({
      batch: batch({ fxRate, fxRateDate: "2026-10-31", rawHash }),
    });
  assert.throws(
    () =>
      aggregateSettlement([crossCurrency(7.2, "hash-1"), crossCurrency(7.3, "hash-2")], {
        policy: "settlement",
        reportingCurrency: "CNY",
      }),
    /inconsistent timezone or fxRate/,
  );
});

test("forecast comparison folds the single-unit forecast to actual units first", () => {
  const [result] = aggregateSettlement(
    [line({ kind: "revenue", amountCents: 100_000, units: 98 })],
    { policy: "settlement", reportingCurrency: "USD" },
  );
  const comparison = compareWithForecast(result, {
    unitNetProfitCents: 500,
    costModelVersion: "cm-7",
    forecastCurrency: "USD",
    minDenominatorCents: 1_000,
  });
  assert.equal(comparison.folded.foldedProfitCents, 49_000);
  assert.equal(comparison.folded.costModelVersion, "cm-7");
  assert.equal(comparison.variance.differenceCents, 51_000);
  assert.equal(comparison.variance.ratioSuppressed, false);
});

test("forecast comparison refuses a different currency until it is explicitly converted", () => {
  const [result] = aggregateSettlement([line()], {
    policy: "settlement",
    reportingCurrency: "USD",
  });
  assert.throws(
    () =>
      compareWithForecast(result, {
        unitNetProfitCents: 500,
        costModelVersion: "cm-7",
        forecastCurrency: "CNY",
        minDenominatorCents: 1_000,
      }),
    /forecastCurrency: must match settlement currency USD/,
  );
});

test("inventory snapshots must sit inside the report period with non-negative counts", () => {
  assert.doesNotThrow(() => validateInventorySnapshot(snapshot(), "USD"));
  assert.throws(
    () => validateInventorySnapshot(snapshot({ snapshotDate: "2026-11-05" }), "USD"),
    /snapshotDate: must fall inside/,
  );
  assert.throws(
    () => validateInventorySnapshot(snapshot({ availableUnits: -1 }), "USD"),
    /availableUnits/,
  );
  assert.throws(
    () => validateInventorySnapshot(snapshot({ reservedUnits: Number.NaN }), "USD"),
    /reservedUnits/,
  );
});

test("aggregateSettlement preserves itemized costs, refunds and discounts without collapsing them", () => {
  const [res] = aggregateSettlement(
    [
      line({ kind: "revenue", amountCents: 40_000, units: 10 }),
      line({ kind: "refund", amountCents: 4_000, units: 1 }),
      line({ kind: "discount", amountCents: 1_000 }),
      line({ kind: "platformFee", amountCents: 5_250 }),
      line({ kind: "fulfillmentFee", amountCents: 5_000 }),
      line({ kind: "adCost", amountCents: 3_000 }),
      line({ kind: "storage", amountCents: 450 }),
    ],
    { policy: "settlement", reportingCurrency: "USD" },
  );

  assert.equal(res.grossRevenueCents, 40_000);
  assert.equal(res.refundCents, 4_000);
  assert.equal(res.discountCents, 1_000);
  assert.equal(res.grossUnits, 10);
  assert.equal(res.refundUnits, 1);
  assert.equal(res.units, 9);
  assert.equal(res.costsByKey.platformFee, 5_250);
  assert.equal(res.costsByKey.fulfillmentFee, 5_000);
  assert.equal(res.costsByKey.adCost, 3_000);
  assert.equal(res.costsByKey.storage, 450);

  // 同口径对比：传入单位采购成本后，按 true_net_profit 计算真实净利与误差
  const trueNetComp = compareWithForecast(res, {
    unitNetProfitCents: 1_000,
    unitLandedCostCents: 1_200,
    externalAdSpendCents: 1_000,
    adAttribution: "ads_report",
    costModelVersion: "v2",
    forecastCurrency: "USD",
    minDenominatorCents: 1_000,
    planBreakdown: {
      salePriceCents: 4_000,
      landedCostCents: 1_200,
      fbaFeeCents: 500,
      referralRate: 0.15,
      adRate: 0.1,
      returnRate: 0.05,
      storageCents: 50,
    },
  });
  assert.equal(trueNetComp.comparisonBasis, "true_net_profit");
  assert.equal(trueNetComp.landedCostApplied, true);
  assert.equal(trueNetComp.landedCostTotalCents, 10_800);
  // contributionProfit = (40000 - 4000 - 1000) - (5250 + 5000 + 3000 + 450) = 35000 - 13700 = 21300
  // trueNetProfit = 21300 - 10800 - 1000 = 9500; forecast = 9 * 1000 = 9000; diff = +500
  assert.equal(trueNetComp.trueNetProfitCents, 9_500);
  assert.equal(trueNetComp.variance.differenceCents, 500);
  assert.equal(trueNetComp.breakdown.length, 6);

  // 缺采购成本但有预测平台贡献时，按 platform_contribution 同口径比较
  const platformComp = compareWithForecast(res, {
    unitNetProfitCents: 1_000,
    unitPlatformContributionCents: 2_300,
    costModelVersion: "v2",
    forecastCurrency: "USD",
    minDenominatorCents: 1_000,
  });
  assert.equal(platformComp.comparisonBasis, "platform_contribution");
  assert.equal(platformComp.landedCostApplied, false);
  assert.equal(platformComp.trueNetProfitCents, null);
  assert.equal(platformComp.forecastComparableProfitCents, 20_700);
  assert.equal(platformComp.variance.differenceCents, 600);
});
