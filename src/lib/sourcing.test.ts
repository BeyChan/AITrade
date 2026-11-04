import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSupplierQuotes, type SupplierQuoteForScoring } from "./sourcing.ts";
import type { EconomicsAssumptions } from "./economics.ts";

const assumptions: EconomicsAssumptions = {
  salePriceCents: 4999,
  landedCostCents: 500,
  fbaFeeCents: 495,
  referralRate: 0.15,
  adRate: 0.12,
  returnRate: 0.04,
  returnProcessingCents: 300,
  returnRecoveryRate: 0.3,
  couponCents: 0,
  storageCents: 45,
  otherCostCents: 50,
};

const baseQuote: SupplierQuoteForScoring = {
  id: "q1",
  unitPriceCents: 1000,
  freightPerUnitCents: 200,
  dutyRate: 0.1,
  moq: 500,
  leadTimeDays: 25,
  qualityScore: 75,
  sampleFeeCents: 0,
  certifications: "CE, RoHS",
};

test("calculates duty and landed cost deterministically", () => {
  const [quote] = analyzeSupplierQuotes([baseQuote], assumptions);
  assert.equal(quote.dutyCents, 120);
  assert.equal(quote.landedCostCents, 1320);
  assert.equal(quote.landedDeltaCents, 820);
  assert.equal(quote.score > 0, true);
});

test("cheaper landed cost receives a stronger cost score", () => {
  const [cheap, expensive] = analyzeSupplierQuotes(
    [
      { ...baseQuote, id: "cheap", unitPriceCents: 800 },
      { ...baseQuote, id: "expensive", unitPriceCents: 1400 },
    ],
    assumptions,
  );
  assert.ok(cheap.scoreBreakdown.cost > expensive.scoreBreakdown.cost);
  assert.ok(cheap.landedCostCents < expensive.landedCostCents);
});

test("prefers the best eligible quote when another quote is not stress-profitable", () => {
  const quotes = analyzeSupplierQuotes(
    [
      { ...baseQuote, id: "unprofitable", unitPriceCents: 2600, qualityScore: 98 },
      { ...baseQuote, id: "eligible", unitPriceCents: 1100, qualityScore: 78 },
    ],
    assumptions,
  );
  assert.equal(quotes.find((quote) => quote.id === "unprofitable")?.isEligible, false);
  assert.equal(quotes.find((quote) => quote.id === "eligible")?.isPreferred, true);
});

test("flags commercial and delivery risks", () => {
  const [quote] = analyzeSupplierQuotes(
    [{ ...baseQuote, qualityScore: 40, leadTimeDays: 60, moq: 2000, certifications: "" }],
    assumptions,
  );
  assert.deepEqual(quote.risks, ["到岸成本高于当前模型 $8.20", "质量评分低于 60", "交期超过 45 天", "MOQ 超过 1,000", "认证信息未填写"]);
});
