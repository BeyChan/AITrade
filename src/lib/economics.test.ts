import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateEconomics,
  calculateMaxPurchasePriceCents,
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
} from "./economics.ts";

const baseline = {
  salePriceCents: 3999,
  landedCostCents: 1200,
  fbaFeeCents: 550,
  referralRate: 0.15,
  adRate: 0.12,
  returnRate: 0.05,
  returnProcessingCents: 300,
  returnRecoveryRate: 0.3,
  couponCents: 200,
  storageCents: 40,
  otherCostCents: 50,
};

test("calculates expected unit economics with returns", () => {
  const result = calculateEconomics(baseline);
  assert.equal(result.netRevenueCents, 3609);
  assert.equal(result.referralFeeCents, 541);
  assert.equal(result.adCostCents, 456);
  assert.equal(result.returnLossCents, 57);
  assert.equal(result.totalCostCents, 2894);
  assert.equal(result.netProfitCents, 715);
  assert.ok(Math.abs(result.marginRate - 0.1788) < 0.0001);
  assert.ok(result.breakEvenAdRate > baseline.adRate);
});

test("higher returns reduce profit", () => {
  const lowerReturns = calculateEconomics({ ...baseline, returnRate: 0.02 });
  const higherReturns = calculateEconomics({ ...baseline, returnRate: 0.2 });
  assert.ok(higherReturns.netProfitCents < lowerReturns.netProfitCents);
});

test("stress case is less optimistic than baseline", () => {
  const result = calculateEconomics(baseline);
  assert.ok(result.stressProfitCents < result.netProfitCents);
});

test("target landed cost is the highest integer-cent cost that still meets the target margin", () => {
  const input = {
    ...baseline,
    targetMarginRate: 0.18,
  };
  const target = calculateTargetLandedCost(input);

  assert.equal(target.achievable, true);
  assert.ok(target.maxLandedCostCents > 0);
  assert.ok(calculateEconomics({ ...input, landedCostCents: target.maxLandedCostCents }).marginRate >= 0.18);
  assert.ok(calculateEconomics({ ...input, landedCostCents: target.maxLandedCostCents + 1 }).marginRate < 0.18);
});

test("target landed cost reports an unachievable plan instead of returning a fake budget", () => {
  const target = calculateTargetLandedCost({
    ...baseline,
    salePriceCents: 700,
    targetMarginRate: 0.6,
  });

  assert.equal(target.achievable, false);
  assert.equal(target.maxLandedCostCents, 0);
});

test("maximum purchase price accounts for quoted freight and duty", () => {
  const purchase = calculateMaxPurchasePriceCents(350, 50, 0.1);
  const taxable = purchase + 50;

  assert.equal(taxable + Math.round(taxable * 0.1), 350);
  assert.equal(calculateMaxPurchasePriceCents(40, 50, 0.1), 0);
});

test("opportunity score and recommendation are deterministic", () => {
  const result = calculateEconomics(baseline);
  const score = opportunityScore(result, 1500, 800, 72);
  assert.equal(score, 49);
  assert.equal(recommendationFor({ ...result, stressProfitCents: -100 }, score), "NO-GO");
  assert.equal(recommendationFor({ ...result, marginRate: 0.2, stressProfitCents: 100 }, 70), "GO");
});
