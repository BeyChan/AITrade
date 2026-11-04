import { calculateEconomics } from "./economics.ts";

export type AISourcingContext = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
  fxRateToUsd: number | null;
  fxSourceUrl: string | null;
};

export type HypothesisDraft = {
  concept: string;
  targetUser: string;
  painPoint: string;
  differentiator: string;
  recommendedPriceCents: number;
  expectedMarginRate: number;
  firstOrderBudgetCents: number;
  mainRisks: string[];
  supplierKeywords: string[];
  competitorQueries: string[];
  reviewQueries: string[];
};

export type HypothesisGenerationInput = {
  brief: string;
  category: string;
  context: AISourcingContext;
};

export type HypothesisGenerationResult = {
  provider: string;
  model: string;
  hypotheses: HypothesisDraft[];
  responseSummary: Record<string, unknown>;
};

export type DecisionGate = {
  key: string;
  label: string;
  required: string;
  actual: string;
  passed: boolean;
  kind: "evidence" | "economic" | "risk" | "priority";
};

export type QuoteForDecision = {
  id: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  landedCostCents: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  sampleScore: number | null;
  sampleFeeCents: number;
  observedAt: string;
};

export type DecisionEvidenceInput = {
  opportunityScore: number;
  recommendedPriceCents: number;
  context: AISourcingContext;
  competitorCount: number;
  reviewSampleCount: number;
  supplierCount: number;
  quotes: QuoteForDecision[];
  latestPatentRisk: "clear" | "review" | "found" | "missing";
  latestLogisticsRisk: "clear" | "review" | "found" | "missing";
};

export type DecisionEvaluation = {
  decision: "GO" | "HOLD" | "NO-GO";
  decisionScore: number;
  opportunityScore: number;
  evidenceCompleteness: number;
  gates: DecisionGate[];
  blockers: string[];
  warnings: string[];
  bestQuoteId: string | null;
  landedCostCents: number | null;
  landedCostUsdCents: number | null;
  marginRate: number | null;
  stressMarginRate: number | null;
  netProfitCents: number | null;
  firstOrderCashCents: number | null;
  firstOrderCashUsdCents: number | null;
  metrics: Record<string, unknown>;
};

export const DEFAULT_SOURCING_THRESHOLDS = {
  minOpportunityScore: 65,
  minCompetitors: 20,
  minReviewSamples: 50,
  minSuppliers: 3,
  minQuotes: 3,
  maxLandedCostUsdCents: 450,
  minMarginRate: 0.18,
  minEvidenceCompleteness: 80,
  maxMoq: 500,
  maxLeadTimeDays: 30,
  minSampleScore: 80,
  maxFirstOrderCashUsdCents: 300_000,
} as const;

const MAX_TEXT = 500;

export function buildTemplateHypotheses(input: HypothesisGenerationInput): HypothesisDraft[] {
  const focus = normalizeFocus(input.brief);
  const marketLabel = `${input.context.marketName} / ${input.context.platformName}`;
  const supplierKeywords = supplierKeywordsFor(focus, input.category);
  const competitorQueries = competitorQueriesFor(focus);
  const reviewQueries = reviewQueriesFor(focus);
  const basePrice = templateBasePriceCents(input.context);
  const directions = [
    {
      suffix: "核心自清洁款",
      user: "被日常清洁步骤困扰、希望减少维护时间的家庭用户",
      pain: "现有产品清理毛屑费时、卡毛或操作步骤复杂",
      differentiator: "围绕一键退毛、可拆洗和长毛适配做可验证的结构改进",
      margin: 0.24,
      budgetFactor: 48,
      risks: ["头部评论壁垒较高", "结构专利需要人工检索", "低价竞品可能压缩利润"],
    },
    {
      suffix: "双梳头组合装",
      user: "同时护理长毛犬猫、希望一件工具覆盖多种毛型的用户",
      pain: "单一梳齿无法兼顾打结、浮毛和日常顺毛",
      differentiator: "以可替换梳头覆盖两种高频场景，并明确包装内件",
      margin: 0.27,
      budgetFactor: 60,
      risks: ["组合装会增加包装和SKU复杂度", "需要验证消费者是否愿意为第二梳头付费"],
    },
    {
      suffix: "可拆洗升级款",
      user: "对卫生和清洁死角敏感、愿意为易维护支付溢价的用户",
      pain: "梳齿根部难清理，长期使用后残留毛发和皮屑",
      differentiator: "把可拆洗结构作为主卖点，并用清洁前后对比验证",
      margin: 0.22,
      budgetFactor: 56,
      risks: ["卡扣耐用性需要样品测试", "可拆结构可能抬高模具成本"],
    },
    {
      suffix: "轻量旅行款",
      user: "经常携宠出行或需要随手收纳的用户",
      pain: "家用梳子体积大、外出携带不便且容易弄脏包内物品",
      differentiator: "轻量折叠或独立收纳设计，聚焦旅行场景而非正面拼价格",
      margin: 0.2,
      budgetFactor: 40,
      risks: ["旅行场景需求规模待验证", "轻量结构可能牺牲耐用度"],
    },
    {
      suffix: "替换头耗材装",
      user: "已有梳柄、重视长期使用成本的重度养宠用户",
      pain: "整把更换成本高，不同毛型和季节需要不同梳齿",
      differentiator: "用通用手柄加多规格替换头降低复购门槛",
      margin: 0.3,
      budgetFactor: 36,
      risks: ["通用接口的兼容性难验证", "必须确认目标竞品是否存在可替换结构"],
    },
  ];

  return directions.map((direction, index) => ({
    concept: `${focus} · ${direction.suffix}`,
    targetUser: `${marketLabel}：${direction.user}`,
    painPoint: direction.pain,
    differentiator: direction.differentiator,
    recommendedPriceCents: basePrice + index * 300,
    expectedMarginRate: direction.margin,
    firstOrderBudgetCents: Math.round(basePrice * direction.budgetFactor),
    mainRisks: direction.risks,
    supplierKeywords,
    competitorQueries: competitorQueries.map((query) => `${query} ${input.context.marketCode.toLowerCase()}`),
    reviewQueries,
  }));
}

export function parseHypothesesJson(raw: string, input: HypothesisGenerationInput): HypothesisDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error("AI 返回内容不是有效 JSON，已拒绝写入");
  }

  const root = asRecord(parsed);
  const candidates = Array.isArray(root.hypotheses)
    ? root.hypotheses
    : Array.isArray(parsed)
      ? parsed
      : null;
  if (!candidates || candidates.length < 5) {
    throw new Error("AI 必须返回至少 5 个结构化机会假设");
  }

  const hypotheses = candidates.slice(0, 5).map((candidate, index) => normalizeHypothesis(candidate, input, index));
  if (new Set(hypotheses.map((item) => item.concept)).size !== 5) {
    throw new Error("AI 返回的商品概念重复，已拒绝写入");
  }
  return hypotheses;
}

export function researchPriorityScore(
  hypothesis: Pick<HypothesisDraft, "expectedMarginRate" | "recommendedPriceCents" | "firstOrderBudgetCents" | "mainRisks">,
  category: string,
  context?: Pick<AISourcingContext, "currency" | "fxRateToUsd">,
) {
  const priceUsdCents = valueInUsdCents(
    hypothesis.recommendedPriceCents,
    context?.currency,
    context?.fxRateToUsd,
  );
  const budgetUsdCents = valueInUsdCents(
    hypothesis.firstOrderBudgetCents,
    context?.currency,
    context?.fxRateToUsd,
  );
  const marginScore = clamp(hypothesis.expectedMarginRate / 0.3, 0, 1) * 28;
  const priceScore = clamp(priceUsdCents / 4000, 0, 1) * 16;
  const budgetScore = clamp(1 - budgetUsdCents / 250_000, 0, 1) * 18;
  const simplicityScore = /宠物|家居|办公|厨房|服饰|美妆/.test(category) ? 18 : 12;
  const riskPenalty = clamp(hypothesis.mainRisks.length * 2.5, 0, 12);
  return Math.round(clamp(48 + marginScore + priceScore + budgetScore + simplicityScore - riskPenalty, 0, 100));
}

export function evaluateSourcingDecision(input: DecisionEvidenceInput): DecisionEvaluation {
  const thresholds = DEFAULT_SOURCING_THRESHOLDS;
  const completenessParts = [
    part(input.competitorCount, thresholds.minCompetitors, 20),
    part(input.reviewSampleCount, thresholds.minReviewSamples, 15),
    part(input.supplierCount, thresholds.minSuppliers, 15),
    part(input.quotes.length, thresholds.minQuotes, 20),
    part(input.latestPatentRisk === "clear" ? 1 : 0, 1, 15),
    part(input.quotes.some((quote) => (quote.sampleScore ?? 0) >= thresholds.minSampleScore) ? 1 : 0, 1, 15),
  ];
  const evidenceCompleteness = Math.round(completenessParts.reduce((sum, value) => sum + value, 0));

  const bestQuote = [...input.quotes]
    .filter((quote) => quote.currency === input.context.currency)
    .sort((a, b) => a.landedCostCents - b.landedCostCents || a.moq - b.moq)[0] ?? null;
  const fxRate = normalizeFxRate(input.context.currency, input.context.fxRateToUsd);
  const landedCostUsdCents = bestQuote && fxRate
    ? Math.round(bestQuote.landedCostCents / fxRate)
    : null;
  const cashCents = bestQuote ? bestQuote.landedCostCents * bestQuote.moq + bestQuote.sampleFeeCents : null;
  const cashUsdCents = cashCents !== null && fxRate ? Math.round(cashCents / fxRate) : null;

  const platformEconomics = platformEconomicDefaults(input.context.platformCode, input.recommendedPriceCents);
  const economics = bestQuote
    ? calculateEconomics({
        currency: input.context.currency,
        salePriceCents: input.recommendedPriceCents,
        landedCostCents: bestQuote.landedCostCents,
        ...platformEconomics,
      })
    : null;

  const patentFound = input.latestPatentRisk === "found";
  const logisticsBlocked = input.latestLogisticsRisk === "found";
  const gates: DecisionGate[] = [
    gate(
      "opportunity_priority",
      "AI 研究优先级",
      `≥ ${thresholds.minOpportunityScore}`,
      String(input.opportunityScore),
      input.opportunityScore >= thresholds.minOpportunityScore,
      "priority",
    ),
    gate(
      "competitors",
      "真实竞品快照",
      `≥ ${thresholds.minCompetitors}`,
      String(input.competitorCount),
      input.competitorCount >= thresholds.minCompetitors,
      "evidence",
    ),
    gate(
      "reviews",
      "差评样本",
      `≥ ${thresholds.minReviewSamples}`,
      String(input.reviewSampleCount),
      input.reviewSampleCount >= thresholds.minReviewSamples,
      "evidence",
    ),
    gate(
      "suppliers",
      "供应商短名单",
      `≥ ${thresholds.minSuppliers}`,
      String(input.supplierCount),
      input.supplierCount >= thresholds.minSuppliers,
      "evidence",
    ),
    gate(
      "quotes",
      "真实预报价",
      `≥ ${thresholds.minQuotes}`,
      String(input.quotes.length),
      input.quotes.length >= thresholds.minQuotes,
      "evidence",
    ),
    gate(
      "landed_cost",
      "最低到岸成本",
      "≤ $4.50",
      landedCostUsdCents === null ? "缺报价或汇率" : usd(landedCostUsdCents),
      landedCostUsdCents !== null && landedCostUsdCents <= thresholds.maxLandedCostUsdCents,
      "economic",
    ),
    gate(
      "margin",
      "首报价净利率",
      "≥ 18.0%",
      economics ? pct(economics.marginRate) : "缺成本模型",
      Boolean(economics && economics.marginRate >= thresholds.minMarginRate),
      "economic",
    ),
    gate(
      "stress",
      "压力情景盈利",
      "> $0",
      economics ? usd(economics.stressProfitCents) : "缺成本模型",
      Boolean(economics && economics.stressProfitCents > 0),
      "economic",
    ),
    gate(
      "completeness",
      "证据完整度",
      "≥ 80%",
      `${evidenceCompleteness}%`,
      evidenceCompleteness >= thresholds.minEvidenceCompleteness,
      "evidence",
    ),
    gate(
      "moq",
      "最低起订量",
      `≤ ${thresholds.maxMoq}`,
      bestQuote ? String(bestQuote.moq) : "缺报价",
      Boolean(bestQuote && bestQuote.moq <= thresholds.maxMoq),
      "economic",
    ),
    gate(
      "lead_time",
      "供应商交期",
      `≤ ${thresholds.maxLeadTimeDays} 天`,
      bestQuote ? `${bestQuote.leadTimeDays} 天` : "缺报价",
      Boolean(bestQuote && bestQuote.leadTimeDays <= thresholds.maxLeadTimeDays),
      "economic",
    ),
    gate(
      "sample",
      "样品评分",
      `≥ ${thresholds.minSampleScore}`,
      bestQuote?.sampleScore == null ? "未打样" : String(bestQuote.sampleScore),
      Boolean(bestQuote?.sampleScore != null && bestQuote.sampleScore >= thresholds.minSampleScore),
      "risk",
    ),
    gate(
      "patent",
      "专利风险检查",
      "需人工确认无明显风险",
      patentRiskLabel(input.latestPatentRisk),
      input.latestPatentRisk === "clear",
      "risk",
    ),
    gate(
      "logistics",
      "物流与包装风险",
      "需人工确认可执行",
      logisticsRiskLabel(input.latestLogisticsRisk),
      input.latestLogisticsRisk === "clear",
      "risk",
    ),
    gate(
      "first_order_cash",
      "首单现金占用",
      "≤ $3,000",
      cashUsdCents === null ? "缺报价或汇率" : usd(cashUsdCents),
      cashUsdCents !== null && cashUsdCents <= thresholds.maxFirstOrderCashUsdCents,
      "economic",
    ),
    gate(
      "currency",
      "换汇依据",
      "非 USD 必须录入可追溯汇率",
      fxRate ? `1 USD = ${fxRate} ${input.context.currency}` : input.context.currency === "USD" ? "USD 无需换算" : "未录入汇率",
      Boolean(fxRate),
      "economic",
    ),
  ];

  const blockers = gates.filter((item) => !item.passed).map((item) => `${item.label}未通过：${item.actual}`);
  const hardFailure = [
    landedCostUsdCents !== null && landedCostUsdCents > thresholds.maxLandedCostUsdCents,
    Boolean(economics && economics.marginRate < thresholds.minMarginRate),
    Boolean(economics && economics.stressProfitCents <= 0),
    Boolean(bestQuote && bestQuote.moq > thresholds.maxMoq),
    Boolean(bestQuote && bestQuote.leadTimeDays > thresholds.maxLeadTimeDays),
    Boolean(cashUsdCents !== null && cashUsdCents > thresholds.maxFirstOrderCashUsdCents),
    patentFound,
    logisticsBlocked,
    input.quotes.length > 0 && input.quotes.every((quote) => quote.currency !== input.context.currency),
  ].some(Boolean);

  const allPass = gates.every((item) => item.passed);
  const evidenceReady = evidenceCompleteness >= thresholds.minEvidenceCompleteness;
  const decision = hardFailure ? "NO-GO" : allPass && evidenceReady ? "GO" : "HOLD";
  const decisionScore = Math.round(
    gates.reduce((score, item) => score + (item.passed ? (item.kind === "priority" ? 5 : item.kind === "evidence" ? 8 : 7) : 0), 0) /
      1.1,
  );

  const warnings: string[] = [];
  if (input.context.currency !== "USD") {
    warnings.push("最终 $ 门槛依赖你录入的汇率来源；系统不会自动假定汇率。");
  }
  if (input.latestPatentRisk === "review") warnings.push("专利检索仍需人工复核，不能转为 GO。");
  if (input.latestLogisticsRisk === "review") warnings.push("物流或包装仍有待验证事项。");
  if (input.quotes.length > 0) warnings.push("最佳报价按最低到岸成本选取；样品评分仍需来自真实打样记录。");

  return {
    decision,
    decisionScore: clamp(decisionScore, 0, 100),
    opportunityScore: input.opportunityScore,
    evidenceCompleteness,
    gates,
    blockers,
    warnings,
    bestQuoteId: bestQuote?.id ?? null,
    landedCostCents: bestQuote?.landedCostCents ?? null,
    landedCostUsdCents,
    marginRate: economics?.marginRate ?? null,
    stressMarginRate: economics?.stressMarginRate ?? null,
    netProfitCents: economics?.netProfitCents ?? null,
    firstOrderCashCents: cashCents,
    firstOrderCashUsdCents: cashUsdCents,
    metrics: {
      competitorCount: input.competitorCount,
      reviewSampleCount: input.reviewSampleCount,
      supplierCount: input.supplierCount,
      quoteCount: input.quotes.length,
      patentRisk: input.latestPatentRisk,
      logisticsRisk: input.latestLogisticsRisk,
      fxRateToUsd: input.context.fxRateToUsd,
      currency: input.context.currency,
      netProfitCents: economics?.netProfitCents ?? null,
      firstOrderCashCents: cashCents,
      firstOrderCashUsdCents: cashUsdCents,
      warnings,
      thresholds: DEFAULT_SOURCING_THRESHOLDS,
    },
  };
}

export function validateEvidenceUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("证据链接必须是完整 URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("证据链接仅支持 http/https");
  return url.toString();
}

export function normalizeObservedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("证据观察时间无效");
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error("证据观察时间不能晚于当前时间");
  return date.toISOString();
}

function normalizeHypothesis(candidate: unknown, input: HypothesisGenerationInput, index: number): HypothesisDraft {
  const row = asRecord(candidate);
  const concept = text(row.concept, 120);
  if (concept.length < 3) throw new Error(`第 ${index + 1} 个机会缺少商品概念`);
  const price = Math.round(number(row.recommendedPriceCents, 0));
  if (price < 100 || price > 10_000_000) throw new Error(`第 ${index + 1} 个机会的建议售价无效`);
  const margin = normalizeMargin(number(row.expectedMarginRate, 0));
  if (margin < 0 || margin > 0.9) throw new Error(`第 ${index + 1} 个机会的预计净利率无效`);
  const budget = Math.round(number(row.firstOrderBudgetCents, 0));
  if (budget < 0 || budget > 100_000_000) throw new Error(`第 ${index + 1} 个机会的首单预算无效`);

  return {
    concept,
    targetUser: text(row.targetUser, MAX_TEXT) || "待验证的目标用户",
    painPoint: text(row.painPoint, MAX_TEXT) || "待通过评论与搜索验证",
    differentiator: text(row.differentiator, MAX_TEXT) || "待验证的差异化方向",
    recommendedPriceCents: price,
    expectedMarginRate: margin,
    firstOrderBudgetCents: budget,
    mainRisks: textList(row.mainRisks, index === 0 ? ["AI 假设尚未验证"] : []),
    supplierKeywords: textList(row.supplierKeywords, supplierKeywordsFor(normalizeFocus(input.brief), input.category)),
    competitorQueries: textList(row.competitorQueries, competitorQueriesFor(normalizeFocus(input.brief))),
    reviewQueries: textList(row.reviewQueries, reviewQueriesFor(normalizeFocus(input.brief))),
  };
}

function normalizeFocus(brief: string) {
  const cleaned = brief.replace(/^(请|帮我|我想|想要|寻找|分析|研究)/, "").replace(/[。.!！?？]+$/g, "").trim();
  return (cleaned || "当前类目候选品").slice(0, 60);
}

function supplierKeywordsFor(focus: string, category: string) {
  if (/宠物|猫|狗/.test(`${focus}${category}`)) {
    return ["宠物梳毛刷 自清洁", "一键退毛宠物梳", "长毛宠物梳子", "宠物美容梳 OEM", "宠物刷毛器 工厂", "宠物梳子 跨境专供"];
  }
  return [`${focus} 源头工厂`, `${focus} OEM`, `${focus} 跨境专供`, `${focus} 小批量定制`, `${category} 供应商`];
}

function competitorQueriesFor(focus: string) {
  if (/宠物|猫|狗/.test(focus)) {
    return ["self cleaning pet grooming brush", "deshedding brush for long hair", "slicker brush self cleaning", "pet hair remover brush", "dog grooming brush for shedding"];
  }
  return [`${focus} best seller`, `${focus} reviews`, `${focus} comparison`, `${focus} near me`, `${focus} amazon`];
}

function reviewQueriesFor(focus: string) {
  return [`${focus} not working`, `${focus} broke after`, `${focus} difficult to clean`, `${focus} too small`, `${focus} return`];
}

function templateBasePriceCents(context: AISourcingContext) {
  if (context.currency === "USD") return 2499;
  if (context.fxRateToUsd && context.fxRateToUsd > 0) return Math.round(2499 * context.fxRateToUsd);
  const localPriceBands: Record<string, number> = {
    GBP: 1999,
    EUR: 2299,
    JPY: 380000,
    SGD: 3299,
    MYR: 11900,
    AUD: 3799,
    CAD: 3499,
  };
  return localPriceBands[context.currency] ?? 2499;
}

function valueInUsdCents(value: number, currency?: string, fxRateToUsd?: number | null) {
  if (!currency || currency === "USD") return value;
  const rate = Number(fxRateToUsd);
  return Number.isFinite(rate) && rate > 0 ? value / rate : value;
}

export function platformEconomicDefaults(platformCode: string, priceCents: number) {
  const fulfillment = Math.max(350, Math.round(priceCents * 0.18));
  if (platformCode === "shopify") {
    return {
      fbaFeeCents: fulfillment,
      referralRate: 0.029,
      adRate: 0.14,
      returnRate: 0.04,
      returnProcessingCents: 250,
      returnRecoveryRate: 0.3,
      couponCents: Math.round(priceCents * 0.03),
      storageCents: Math.round(priceCents * 0.02),
      otherCostCents: Math.round(priceCents * 0.03),
    };
  }
  if (platformCode === "tiktok_shop") {
    return {
      fbaFeeCents: fulfillment,
      referralRate: 0.08,
      adRate: 0.16,
      returnRate: 0.06,
      returnProcessingCents: 250,
      returnRecoveryRate: 0.25,
      couponCents: Math.round(priceCents * 0.05),
      storageCents: Math.round(priceCents * 0.02),
      otherCostCents: Math.round(priceCents * 0.03),
    };
  }
  if (platformCode === "ebay") {
    return {
      fbaFeeCents: fulfillment,
      referralRate: 0.13,
      adRate: 0.1,
      returnRate: 0.05,
      returnProcessingCents: 250,
      returnRecoveryRate: 0.3,
      couponCents: 0,
      storageCents: Math.round(priceCents * 0.02),
      otherCostCents: Math.round(priceCents * 0.03),
    };
  }
  return {
    fbaFeeCents: fulfillment,
    referralRate: 0.15,
    adRate: 0.12,
    returnRate: 0.05,
    returnProcessingCents: 300,
    returnRecoveryRate: 0.3,
    couponCents: Math.round(priceCents * 0.04),
    storageCents: Math.round(priceCents * 0.02),
    otherCostCents: Math.round(priceCents * 0.03),
  };
}

function normalizeFxRate(currency: string, fxRateToUsd: number | null) {
  if (currency === "USD") return 1;
  const rate = Number(fxRateToUsd);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function part(actual: number, target: number, weight: number) {
  return clamp(actual / Math.max(1, target), 0, 1) * weight;
}

function gate(
  key: string,
  label: string,
  required: string,
  actual: string,
  passed: boolean,
  kind: DecisionGate["kind"],
): DecisionGate {
  return { key, label, required, actual, passed, kind };
}

function patentRiskLabel(value: DecisionEvidenceInput["latestPatentRisk"]) {
  return { clear: "人工确认暂无明显风险", review: "待复核", found: "发现疑似风险", missing: "未检查" }[value];
}

function logisticsRiskLabel(value: DecisionEvidenceInput["latestLogisticsRisk"]) {
  return { clear: "人工确认可执行", review: "待复核", found: "存在明确风险", missing: "未检查" }[value];
}

function normalizeMargin(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value > 1 && value <= 90 ? value / 100 : value;
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback;
  const list = value.map((item) => text(item, 180)).filter(Boolean).slice(0, 8);
  return list.length ? list : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function extractJson(value: string) {
  const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function usd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
