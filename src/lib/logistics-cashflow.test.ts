import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFbaSizeTier,
  calculateLaunchCashflow,
  calculateVatBreakdown,
  calculateVolumetricFreight,
} from "./logistics-cashflow.ts";

test("FBA 尺寸分段能识别小号/大号标准件与厚度降档省钱机会", () => {
  const small = calculateFbaSizeTier(20, 15, 1.8, 220);
  assert.equal(small.tier, "small_standard");
  assert.equal(small.downgradeOpportunity, null);

  // 厚度 2.3cm (0.91in) 刚超 0.75in 临界值，应给出压缩降档提示
  const nearSmall = calculateFbaSizeTier(20, 15, 2.3, 220);
  assert.equal(nearSmall.tier, "large_standard");
  assert.ok(nearSmall.downgradeOpportunity !== null);
  assert.ok(nearSmall.downgradeOpportunity!.estimatedSavingCents > 0);
});

test("抛货体积重正确按 max(实重, 长宽高/6000) 计费", () => {
  const bulky = calculateVolumetricFreight(40, 30, 25, 800, "sea_fast", "USD");
  assert.equal(bulky.actualWeightKg, 0.8);
  assert.equal(bulky.volumetricWeightKg, 5);
  assert.equal(bulky.billableWeightKg, 5);
  assert.equal(bulky.isVolumetricCharged, true);
  assert.ok(bulky.freightRmb > 0);
  assert.ok(bulky.freightForeignCents > 0);
});

test("欧洲与英国站点自动从含税售价拆出 VAT，美国站 VAT 为 0", () => {
  const de = calculateVatBreakdown(3999, "DE");
  assert.equal(de.vatRate, 0.19);
  assert.equal(de.vatAmountCents + de.netExVatPriceCents, 3999);
  assert.ok(de.vatAmountCents > 600);

  const us = calculateVatBreakdown(3999, "US");
  assert.equal(us.vatRate, 0);
  assert.equal(us.vatAmountCents, 0);
});

test("90天现金流回本模型计算启动资金峰值与回本月数", () => {
  const result = calculateLaunchCashflow({
    currency: "USD",
    moq: 500,
    unitLandedCostCents: 1000,
    sampleAndMoldCents: 30000,
    certificationCents: 80000,
    launchAdExtraCents: 150000,
    monthlySalesEstimate: 600,
    steadyNetProfitCents: 800,
  });
  assert.equal(result.firstOrderInventoryCents, 500000);
  assert.equal(result.monthlyCurve.length, 6);
  assert.ok(result.peakCashOutflowCents >= result.firstOrderInventoryCents);
  assert.ok(result.totalInitialCapitalRmb > 0);
});
