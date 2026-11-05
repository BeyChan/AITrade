import assert from "node:assert/strict";
import test from "node:test";
import {
  adEfficiency,
  assignPeriod,
  breakEvenAcos,
  contributionProfit,
  foldForecastToPeriod,
  forecastVariance,
  inventoryDays,
} from "./operations-metrics.ts";

test("folds a single-unit forecast into a period total before comparing", () => {
  const folded = foldForecastToPeriod({
    unitNetProfitCents: 715,
    actualUnits: 100,
    costModelVersion: "cm-7",
    forecastCurrency: "USD",
    reportingCurrency: "USD",
  });

  assert.equal(folded.foldedProfitCents, 71_500);
  assert.equal(folded.fxRate, 1);
  assert.equal(folded.costModelVersion, "cm-7");
  assert.equal(folded.actualUnits, 100);
});

test("cross-currency forecast requires an explicit fx rate", () => {
  assert.throws(
    () =>
      foldForecastToPeriod({
        unitNetProfitCents: 715,
        actualUnits: 10,
        costModelVersion: "cm-7",
        forecastCurrency: "USD",
        reportingCurrency: "CNY",
      }),
    /positive fxRate/,
  );

  const folded = foldForecastToPeriod({
    unitNetProfitCents: 715,
    actualUnits: 10,
    costModelVersion: "cm-7",
    forecastCurrency: "USD",
    reportingCurrency: "CNY",
    fxRate: 7.2,
  });
  assert.equal(folded.foldedProfitCents, 51_480);
  assert.equal(folded.currency, "CNY");
});

test("forecast variance uses the folded forecast and suppresses tiny denominators", () => {
  const variance = forecastVariance({
    actualProfitCents: 60_000,
    foldedForecastProfitCents: 71_500,
    minDenominatorCents: 1_000,
  });
  assert.equal(variance.differenceCents, -11_500);
  assert.equal(variance.ratioSuppressed, false);
  assert.ok(variance.ratio !== null && Math.abs(variance.ratio + 11_500 / 71_500) < 1e-12);

  const nearZero = forecastVariance({
    actualProfitCents: 300,
    foldedForecastProfitCents: 50,
    minDenominatorCents: 1_000,
  });
  assert.equal(nearZero.ratio, null);
  assert.equal(nearZero.ratioSuppressed, true);
  assert.equal(nearZero.differenceCents, 250);
});

test("forecast variance never divides by zero", () => {
  const result = forecastVariance({
    actualProfitCents: -400,
    foldedForecastProfitCents: 0,
    minDenominatorCents: 0,
  });
  assert.equal(result.ratio, null);
  assert.equal(result.ratioSuppressed, true);
  assert.equal(result.differenceCents, -400);
});

test("costs already deducted in the settlement are not charged twice", () => {
  const result = contributionProfit({
    netRevenueCents: 100_000,
    costsCents: {
      purchaseLanded: 30_000,
      platformFee: 15_000,
      fulfillmentFee: 8_000,
      adCost: 12_000,
      vatOrSalesTax: 5_000,
      fxLoss: 1_000,
    },
    alreadyDeductedInSettlement: ["platformFee", "fulfillmentFee"],
  });

  assert.equal(result.chargedCents, 48_000);
  assert.equal(result.contributionProfitCents, 52_000);
  assert.deepEqual(result.skippedKeys, ["platformFee", "fulfillmentFee"]);
});

test("contribution profit includes the cross-border cost items", () => {
  const result = contributionProfit({
    netRevenueCents: 50_000,
    costsCents: {
      purchaseLanded: 10_000,
      longTermStorage: 500,
      removalFee: 300,
      couponDealFee: 1_200,
      vatOrSalesTax: 4_000,
      fxLoss: 600,
      other: 400,
    },
  });
  assert.equal(result.contributionProfitCents, 33_000);
  assert.deepEqual(result.skippedKeys, []);
});

test("break-even ACOS is a margin rate, not an absolute amount", () => {
  assert.equal(breakEvenAcos(0.28), 0.28);
  assert.equal(breakEvenAcos(-0.1), 0);
  assert.equal(breakEvenAcos(1.5), 1);
});

test("ad efficiency requires an explicit attribution window", () => {
  assert.throws(
    () =>
      adEfficiency({
        adSpendCents: 1_000,
        adAttributedSalesCents: 5_000,
        totalSalesCents: 20_000,
        attributionWindowDays: 0,
      }),
    /attributionWindowDays/,
  );

  const result = adEfficiency({
    adSpendCents: 1_000,
    adAttributedSalesCents: 5_000,
    totalSalesCents: 20_000,
    attributionWindowDays: 7,
  });
  assert.equal(result.acos, 0.2);
  assert.equal(result.tacos, 0.05);
  assert.equal(result.attributionWindowDays, 7);
});

test("inventory days uses a 28-day window when enough history exists", () => {
  const result = inventoryDays({
    availableUnits: 280,
    dailySales: Array.from({ length: 28 }, () => 10),
    windowDays: 28,
    minDailySales: 1,
  });
  assert.equal(result.usedDays, 28);
  assert.equal(result.averageDailySales, 10);
  assert.equal(result.days, 28);
  assert.equal(result.fallbackApplied, false);
});

test("inventory days records a short-window fallback for new SKUs", () => {
  const result = inventoryDays({
    availableUnits: 70,
    dailySales: [7, 7, 7, 7, 7, 7, 7],
    windowDays: 28,
    minDailySales: 1,
  });
  assert.equal(result.usedDays, 7);
  assert.equal(result.fallbackApplied, true);
  assert.equal(result.days, 10);
});

test("inventory days floors stockout days and caps promo outliers", () => {
  const dailySales = Array.from({ length: 27 }, () => 10);
  dailySales.push(0, 500);
  const result = inventoryDays({
    availableUnits: 300,
    dailySales,
    windowDays: 28,
    minDailySales: 2,
    outlierCap: 30,
  });
  assert.ok(result.clampedDays >= 2);
  assert.ok(result.averageDailySales >= 2);
  assert.ok(result.averageDailySales < 30);
  assert.ok(result.days > 0);
});

test("inventory days returns zero days without any demand signal", () => {
  const result = inventoryDays({
    availableUnits: 100,
    dailySales: [],
    windowDays: 28,
    minDailySales: 0,
  });
  assert.equal(result.days, 0);
  assert.equal(result.fallbackApplied, true);
});

test("settlement period and order period stay separate", () => {
  const base = { orderDate: "2026-10-29", settlementDate: "2026-11-12" };
  assert.deepEqual(assignPeriod({ ...base, policy: "settlement" }), {
    periodKey: "2026-11",
    policy: "settlement",
  });
  assert.deepEqual(assignPeriod({ ...base, policy: "order" }), {
    periodKey: "2026-10",
    policy: "order",
  });
});

test("site-calendar dates must be explicit, never server-local", () => {
  assert.throws(
    () => assignPeriod({ orderDate: "2026-10-29T00:00:00Z", settlementDate: "2026-11-12", policy: "order" }),
    /invalid site-calendar date/,
  );
});

test("site-calendar dates must be real calendar days", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-11-31"]) {
    assert.throws(
      () => assignPeriod({ orderDate: bad, settlementDate: "2026-11-12", policy: "order" }),
      /invalid site-calendar date/,
    );
  }
  // 闰年 2 月 29 日是合法日期，不能被一并拒绝。
  assert.deepEqual(
    assignPeriod({ orderDate: "2028-02-29", settlementDate: "2028-03-14", policy: "order" }),
    { periodKey: "2028-02", policy: "order" },
  );
});

test("non-finite amounts fail loudly instead of silently becoming zero", () => {
  assert.throws(
    () => contributionProfit({ netRevenueCents: Number.NaN, costsCents: {} }),
    /netRevenueCents must be a finite number/,
  );
  assert.throws(
    () =>
      contributionProfit({ netRevenueCents: 10_000, costsCents: { adCost: Number.POSITIVE_INFINITY } }),
    /costsCents\.adCost must be a finite number/,
  );
  assert.throws(
    () =>
      foldForecastToPeriod({
        unitNetProfitCents: Number.NaN,
        actualUnits: 10,
        costModelVersion: "cm-7",
        forecastCurrency: "USD",
        reportingCurrency: "USD",
      }),
    /unitNetProfitCents must be a finite number/,
  );
  assert.throws(
    () =>
      inventoryDays({ availableUnits: 10, dailySales: [1, Number.NaN], windowDays: 28, minDailySales: 1 }),
    /dailySales\[1\] must be a finite number/,
  );
});

test("settlement reimbursements are kept as negative cost credits", () => {
  const result = contributionProfit({
    netRevenueCents: 50_000,
    costsCents: { purchaseLanded: 20_000, fulfillmentFee: 8_000, other: -1_500 },
  });
  assert.equal(result.chargedCents, 26_500);
  assert.equal(result.contributionProfitCents, 23_500);
});

test("skippedKeys only lists deducted items that were actually supplied", () => {
  const result = contributionProfit({
    netRevenueCents: 100_000,
    costsCents: { platformFee: 15_000, adCost: 12_000 },
    alreadyDeductedInSettlement: ["platformFee", "storage", "fulfillmentFee"],
  });
  assert.deepEqual(result.skippedKeys, ["platformFee"]);
  assert.equal(result.chargedCents, 12_000);
});
