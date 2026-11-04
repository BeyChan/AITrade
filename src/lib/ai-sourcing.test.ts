import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTemplateCategoryRecommendations,
  buildTemplateHypotheses,
  evaluateSourcingDecision,
  normalizeObservedAt,
  parseCategoryRecommendationsJson,
  parseHypothesesJson,
  platformEconomicDefaults,
  researchPriorityScore,
  validateEvidenceUrl,
  type AISourcingContext,
  type CategoryRecommendationContext,
  type DecisionEvidenceInput,
  type HypothesisGenerationInput,
  type QuoteForDecision,
} from "./ai-sourcing.ts";

function context(overrides: Partial<AISourcingContext> = {}): AISourcingContext {
  return {
    marketCode: "US",
    marketName: "美国",
    platformCode: "amazon",
    platformName: "Amazon",
    currency: "USD",
    fxRateToUsd: null,
    fxSourceUrl: null,
    ...overrides,
  };
}

function generationInput(overrides: Partial<HypothesisGenerationInput> = {}): HypothesisGenerationInput {
  return {
    brief: "宠物梳毛刷",
    category: "宠物用品",
    context: context(),
    ...overrides,
  };
}

function categoryContext(overrides: Partial<CategoryRecommendationContext> = {}): CategoryRecommendationContext {
  return {
    marketCode: "US",
    marketName: "美国",
    platformCode: "amazon",
    platformName: "Amazon",
    ...overrides,
  };
}

function categoryRecommendation(index: number) {
  return {
    category: `验证类目 ${index}`,
    reason: "使用场景清楚，可以拆成尺寸、材质和使用流程进行人工核验。",
    firstValidation: "记录前 10 个同类商品的价格、评价主题和规格。",
    riskNote: "需要核对同质化、尺寸误差和退货原因。",
    searchKeywords: [`category ${index}`, `category ${index} review`],
  };
}

function quote(overrides: Partial<QuoteForDecision> = {}): QuoteForDecision {
  return {
    id: "quote-1",
    unitPriceCents: 150,
    freightPerUnitCents: 50,
    dutyRate: 0,
    landedCostCents: 200,
    currency: "USD",
    moq: 500,
    leadTimeDays: 25,
    sampleScore: 85,
    sampleFeeCents: 0,
    observedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function decisionInput(overrides: Partial<DecisionEvidenceInput> = {}): DecisionEvidenceInput {
  return {
    opportunityScore: 78,
    recommendedPriceCents: 2499,
    context: context(),
    competitorCount: 20,
    reviewSampleCount: 50,
    supplierCount: 3,
    quotes: [quote()],
    latestPatentRisk: "clear",
    latestLogisticsRisk: "clear",
    ...overrides,
  };
}

test("template hypotheses use market-local price bands and five distinct concepts", () => {
  const us = buildTemplateHypotheses(generationInput());
  const gb = buildTemplateHypotheses(generationInput({ context: context({ marketCode: "GB", marketName: "英国", currency: "GBP" }) }));
  const jp = buildTemplateHypotheses(generationInput({ context: context({ marketCode: "JP", marketName: "日本", currency: "JPY" }) }));
  const cny = buildTemplateHypotheses(
    generationInput({
      context: context({
        marketCode: "CN",
        marketName: "中国",
        currency: "CNY",
        fxRateToUsd: 7.2,
        fxSourceUrl: "https://example.com/fx",
      }),
    }),
  );

  assert.equal(us.length, 5);
  assert.equal(us[0].recommendedPriceCents, 2499);
  assert.equal(gb[0].recommendedPriceCents, 1999);
  assert.equal(jp[0].recommendedPriceCents, 380000);
  assert.equal(cny[0].recommendedPriceCents, 17993);
  assert.equal(new Set(us.map((item) => item.concept)).size, 5);
  assert.ok(us.every((item) => item.supplierKeywords.length > 0));
});

test("template category recommendations depend on the selected country and platform", () => {
  const us = buildTemplateCategoryRecommendations(categoryContext());
  const jp = buildTemplateCategoryRecommendations(
    categoryContext({ marketCode: "JP", marketName: "日本", platformCode: "tiktok_shop", platformName: "TikTok Shop" }),
  );

  assert.equal(us.length, 5);
  assert.equal(jp.length, 5);
  assert.equal(new Set(us.map((item) => item.category)).size, 5);
  assert.notDeepEqual(us.map((item) => item.category), jp.map((item) => item.category));
  assert.ok(jp.every((item) => item.firstValidation.includes("日本")));
  assert.ok(jp.every((item) => item.firstValidation.includes("TikTok Shop")));
});

test("structured category recommendations require five unique and fact-safe directions", () => {
  const valid = parseCategoryRecommendationsJson(
    JSON.stringify({ recommendations: Array.from({ length: 5 }, (_, index) => categoryRecommendation(index)) }),
    categoryContext(),
  );
  assert.equal(valid.length, 5);
  assert.equal(valid[0].searchKeywords.length, 2);

  assert.throws(
    () => parseCategoryRecommendationsJson(
      JSON.stringify({ recommendations: Array.from({ length: 4 }, (_, index) => categoryRecommendation(index)) }),
      categoryContext(),
    ),
    /至少 5 个/,
  );
  assert.throws(
    () => parseCategoryRecommendationsJson(
      JSON.stringify({ recommendations: Array.from({ length: 5 }, () => categoryRecommendation(1)) }),
      categoryContext(),
    ),
    /类目重复/,
  );
  assert.throws(
    () => parseCategoryRecommendationsJson(
      JSON.stringify({
        recommendations: Array.from({ length: 5 }, (_, index) => ({
          ...categoryRecommendation(index),
          reason: index === 0 ? "这是低竞争的蓝海类目。" : categoryRecommendation(index).reason,
        })),
      }),
      categoryContext(),
    ),
    /未经验证的市场结论/,
  );
  assert.throws(
    () => parseCategoryRecommendationsJson(
      JSON.stringify({
        recommendations: Array.from({ length: 5 }, (_, index) => ({
          ...categoryRecommendation(index),
          riskNote: index === 0 ? "" : categoryRecommendation(index).riskNote,
        })),
      }),
      categoryContext(),
    ),
    /字段不完整/,
  );
});

test("structured AI output requires five unique, valid hypotheses", () => {
  const hypothesis = (index: number) => ({
    concept: `宠物梳毛刷方案 ${index}`,
    targetUser: "养宠家庭",
    painPoint: "清洁复杂",
    differentiator: "可拆洗结构",
    recommendedPriceCents: 2499 + index * 100,
    expectedMarginRate: 0.25,
    firstOrderBudgetCents: 120000,
    mainRisks: ["待验证"],
    supplierKeywords: ["宠物梳子 OEM"],
    competitorQueries: ["pet brush"],
    reviewQueries: ["pet brush broke"],
  });
  const valid = parseHypothesesJson(
    `\`\`\`json\n${JSON.stringify({ hypotheses: Array.from({ length: 5 }, (_, index) => hypothesis(index)) })}\n\`\`\``,
    generationInput(),
  );
  assert.equal(valid.length, 5);
  assert.equal(valid[0].expectedMarginRate, 0.25);

  assert.throws(
    () => parseHypothesesJson(JSON.stringify({ hypotheses: Array.from({ length: 4 }, (_, index) => hypothesis(index)) }), generationInput()),
    /至少 5 个/,
  );
  assert.throws(
    () => parseHypothesesJson(JSON.stringify({ hypotheses: Array.from({ length: 5 }, () => hypothesis(1)) }), generationInput()),
    /概念重复/,
  );
});

test("research priority score normalizes local currency when a traceable FX rate exists", () => {
  const hypothesis = {
    expectedMarginRate: 0.25,
    recommendedPriceCents: 2499,
    firstOrderBudgetCents: 120000,
    mainRisks: ["专利待查"],
  };
  const usdScore = researchPriorityScore(hypothesis, "宠物用品", context());
  const jpyScore = researchPriorityScore(
    {
      ...hypothesis,
      recommendedPriceCents: 2499 * 150,
      firstOrderBudgetCents: 120000 * 150,
    },
    "宠物用品",
    context({ currency: "JPY", fxRateToUsd: 150 }),
  );

  assert.equal(jpyScore, usdScore);
});

test("decision stays HOLD until all evidence and economic gates pass", () => {
  const hold = evaluateSourcingDecision(decisionInput({ competitorCount: 0, reviewSampleCount: 0, supplierCount: 0, quotes: [] }));
  assert.equal(hold.decision, "HOLD");
  assert.ok(hold.blockers.length > 0);
  assert.equal(hold.evidenceCompleteness, 15);

  const go = evaluateSourcingDecision(decisionInput({ quotes: [quote(), quote({ id: "quote-2", landedCostCents: 230 }), quote({ id: "quote-3", landedCostCents: 260 })] }));
  assert.equal(go.decision, "GO");
  assert.equal(go.bestQuoteId, "quote-1");
  assert.equal(go.evidenceCompleteness, 100);
  assert.ok(go.gates.every((gate) => gate.passed));
  assert.ok((go.marginRate ?? 0) >= 0.18);
  assert.ok((go.stressMarginRate ?? 0) > 0);
  assert.ok((go.firstOrderCashUsdCents ?? Infinity) <= 300000);
});

test("confirmed patent risk is a hard NO-GO", () => {
  const result = evaluateSourcingDecision(decisionInput({ latestPatentRisk: "found" }));
  assert.equal(result.decision, "NO-GO");
  assert.ok(result.blockers.some((blocker) => blocker.includes("专利风险检查")));
});

test("non-USD decisions require a recorded and traceable FX rate", () => {
  const gbpContext = context({ marketCode: "GB", marketName: "英国", currency: "GBP", fxRateToUsd: null });
  const result = evaluateSourcingDecision(
    decisionInput({
      context: gbpContext,
      recommendedPriceCents: 1999,
      quotes: [quote({ currency: "GBP", landedCostCents: 160 })],
    }),
  );

  assert.equal(result.decision, "HOLD");
  assert.equal(result.landedCostUsdCents, null);
  assert.ok(result.gates.find((gate) => gate.key === "currency")?.passed === false);
});

test("evidence URLs and observation times are validated before persistence", () => {
  assert.equal(validateEvidenceUrl("https://example.com/evidence"), "https://example.com/evidence");
  assert.throws(() => validateEvidenceUrl("file:///tmp/evidence"), /http\/https/);
  assert.throws(() => validateEvidenceUrl("not-a-url"), /完整 URL/);
  assert.equal(normalizeObservedAt("2026-10-01T08:30:00+08:00"), "2026-10-01T00:30:00.000Z");
  assert.throws(() => normalizeObservedAt("not-a-date"), /观察时间无效/);
  assert.throws(() => normalizeObservedAt(new Date(Date.now() + 10 * 60 * 1000).toISOString()), /不能晚于当前时间/);
});


test("platform economic defaults stay aligned across decision and promotion paths", () => {
  assert.equal(platformEconomicDefaults("shopify", 2499).referralRate, 0.029);
  assert.equal(platformEconomicDefaults("tiktok_shop", 2499).referralRate, 0.08);
  assert.equal(platformEconomicDefaults("ebay", 2499).referralRate, 0.13);
  assert.equal(platformEconomicDefaults("amazon", 2499).referralRate, 0.15);
});
