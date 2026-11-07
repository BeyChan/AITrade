import { calculateEconomics } from "./economics.ts";
import type { CompetitorCoverage } from "./competitor-insights.ts";

export type AISourcingContext = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
  fxRateToUsd: number | null;
  fxSourceUrl: string | null;
};

export type CategoryRecommendationContext = Pick<
  AISourcingContext,
  "marketCode" | "marketName" | "platformCode" | "platformName"
>;

export type CategoryRecommendation = {
  category: string;
  reason: string;
  firstValidation: string;
  riskNote: string;
  searchKeywords: string[];
};

export type CategoryRecommendationResult = {
  provider: string;
  model: string;
  recommendations: CategoryRecommendation[];
  responseSummary: Record<string, unknown>;
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
  // Only a price the operator confirmed against real evidence may drive the profit gates; the AI's suggested price is never used here.
  confirmedPriceCents: number | null;
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
  coverage?: CompetitorCoverage;
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

const MARKET_CATEGORY_CANDIDATES: Record<string, string[]> = {
  US: ["家居收纳", "宠物清洁", "厨房小工具", "汽车收纳", "户外轻量收纳"],
  GB: ["家居收纳", "宠物清洁", "厨房小工具", "汽车收纳", "花园小工具"],
  DE: ["家居收纳", "厨房烘焙", "宠物清洁", "花园小工具", "桌面整理"],
  JP: ["窄空间收纳", "厨房清洁", "宠物护理", "通勤收纳", "防灾收纳"],
  SG: ["防潮收纳", "厨房小工具", "宠物清洁", "通勤收纳", "旅行收纳"],
  MY: ["防潮收纳", "厨房小工具", "宠物清洁", "通勤收纳", "旅行收纳"],
  AU: ["户外轻量收纳", "家居收纳", "宠物清洁", "汽车收纳", "花园小工具"],
};

const CATEGORY_GUIDES: Record<string, Omit<CategoryRecommendation, "category" | "firstValidation">> = {
  家居收纳: {
    reason: "空间尺寸、材质、安装方式和套装组合都能拆成可核验卖点，适合先验证一个明确的收纳场景。",
    riskNote: "重点核对同质化程度、尺寸误差、承重和退货原因。",
    searchKeywords: ["home storage organizer", "closet organizer", "under sink storage", "storage box"],
  },
  宠物清洁: {
    reason: "可以围绕掉毛、清洁死角、可拆洗和不同毛型做结构验证，首轮容易拆成单一使用场景。",
    riskNote: "重点核对专利、结构耐用性、材质安全和清洁效果演示。",
    searchKeywords: ["pet hair remover", "pet cleaning tool", "self cleaning brush", "pet grooming"],
  },
  厨房小工具: {
    reason: "使用步骤和清洁难点相对具体，适合用结构改进、套装组合和台面尺寸做差异化。",
    riskNote: "重点核对食品接触材料、锋利部件、清洁便利性和包装体积。",
    searchKeywords: ["kitchen gadget", "kitchen organizer", "food prep tool", "small kitchen tool"],
  },
  汽车收纳: {
    reason: "后备箱、座椅缝隙和车载清洁场景边界清楚，便于用尺寸、固定方式和兼容性做验证。",
    riskNote: "重点核对车型兼容、固定牢靠度、耐温性和运输体积。",
    searchKeywords: ["car storage organizer", "trunk organizer", "car seat gap organizer", "car cleaning"],
  },
  户外轻量收纳: {
    reason: "适合围绕重量、折叠体积、防水和携带方式拆分验证，首发可聚焦一个户外场景。",
    riskNote: "重点核对承重、防水等级、异味和跨境运输成本。",
    searchKeywords: ["lightweight outdoor organizer", "camping storage", "travel organizer", "folding storage"],
  },
  花园小工具: {
    reason: "适合从收纳、清洁、修剪和便携结构切入，先验证单一园艺动作而非泛化工具套装。",
    riskNote: "重点核对刀口安全、户外耐用性、包装尺寸和季节性库存风险。",
    searchKeywords: ["garden tool organizer", "garden cleaning tool", "plant care tool", "garden storage"],
  },
  厨房烘焙: {
    reason: "模具、量具和收纳组合容易形成清晰套装，可通过尺寸、材质和清洁方式做验证。",
    riskNote: "重点核对食品接触材料、耐温、尺寸标准和套装冗余。",
    searchKeywords: ["baking tool set", "baking organizer", "kitchen measuring tool", "bakeware storage"],
  },
  桌面整理: {
    reason: "桌面、线材和小物件的使用边界明确，适合从尺寸组合、模块化和安装方式做验证。",
    riskNote: "重点核对兼容尺寸、桌面承重、胶粘牢度和同质化。",
    searchKeywords: ["desk organizer", "cable management", "office desk storage", "drawer organizer"],
  },
  窄空间收纳: {
    reason: "窄缝、门后和角落场景清楚，便于用精确尺寸、抽拉方式和空间适配做差异化。",
    riskNote: "重点核对尺寸误差、安装方式、承重和不同户型的兼容性。",
    searchKeywords: ["narrow storage", "gap organizer", "door storage", "small space organizer"],
  },
  厨房清洁: {
    reason: "油污、缝隙和可拆洗结构容易转化为可演示的功能点，适合先验证一个高频清洁动作。",
    riskNote: "重点核对刷毛耐用、清洁剂兼容、缝隙尺寸和材质安全。",
    searchKeywords: ["kitchen cleaning brush", "sink cleaning tool", "gap cleaning brush", "kitchen scrubber"],
  },
  宠物护理: {
    reason: "可以按梳理、喂食、清洁或出行拆成单一场景，首轮更容易验证目标用户和真实痛点。",
    riskNote: "重点核对宠物安全、材质、清洁方式和尺寸适配。",
    searchKeywords: ["pet care tool", "pet grooming", "pet feeding accessory", "pet travel"],
  },
  通勤收纳: {
    reason: "通勤包、小物和线材场景具体，便于用内部结构、容量和取放方式做验证。",
    riskNote: "重点核对尺寸兼容、拉链耐用、重量和通勤场景真实使用频率。",
    searchKeywords: ["commuter organizer", "bag organizer", "travel cable organizer", "portable storage"],
  },
  防灾收纳: {
    reason: "应急物品分类、便携和快速取用能形成清楚的结构需求，适合先验证单一储备场景。",
    riskNote: "重点核对容量、防水、标签系统和当地合规要求。",
    searchKeywords: ["emergency storage", "emergency kit organizer", "survival storage", "portable safety kit"],
  },
  防潮收纳: {
    reason: "潮湿环境下的密封、通风和分区需求可拆成具体结构，适合先验证一种储藏物品。",
    riskNote: "重点核对密封效果、霉变风险、材质气味和运输体积。",
    searchKeywords: ["moisture proof storage", "sealed storage box", "humidity control storage", "wardrobe dehumidifier"],
  },
  旅行收纳: {
    reason: "行李分区、压缩和随身取用场景明确，适合用组合、重量和尺寸做差异化验证。",
    riskNote: "重点核对拉链强度、面料耐用、压缩效果和尺寸兼容。",
    searchKeywords: ["travel organizer", "packing cube", "compression bag", "travel storage set"],
  },
};

export function buildTemplateCategoryRecommendations(
  context: CategoryRecommendationContext,
): CategoryRecommendation[] {
  const categories = MARKET_CATEGORY_CANDIDATES[context.marketCode] ?? [
    "家居收纳",
    "厨房小工具",
    "宠物清洁",
    "桌面整理",
    "旅行收纳",
  ];
  return categories.map((category) => {
    const guide = CATEGORY_GUIDES[category];
    return {
      category,
      ...guide,
      firstValidation: categoryValidationStep(context, guide.searchKeywords),
    };
  });
}

export function parseCategoryRecommendationsJson(
  raw: string,
  context: CategoryRecommendationContext,
): CategoryRecommendation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch {
    throw new Error("AI 推荐类目返回内容不是有效 JSON，已拒绝使用");
  }

  const root = asRecord(parsed);
  const candidates = Array.isArray(root.recommendations) ? root.recommendations : Array.isArray(parsed) ? parsed : null;
  if (!candidates || candidates.length < 5) throw new Error("AI 必须返回至少 5 个推荐类目");

  const recommendations = candidates.slice(0, 5).map((candidate, index) => {
    const row = asRecord(candidate);
    const category = text(row.category, 40);
    const reason = text(row.reason, MAX_TEXT);
    const firstValidation = text(row.firstValidation, MAX_TEXT);
    const riskNote = text(row.riskNote, MAX_TEXT);
    if (!category || !reason || !firstValidation || !riskNote) {
      throw new Error(`AI 第 ${index + 1} 个推荐类目字段不完整`);
    }
    if (hasUnverifiedMarketClaim(`${category}${reason}${firstValidation}${riskNote}`)) {
      throw new Error("AI 推荐包含未经验证的市场结论，已拒绝使用");
    }
    const fallbackKeywords = CATEGORY_GUIDES[category]?.searchKeywords ?? [category];
    return {
      category,
      reason,
      firstValidation,
      riskNote,
      searchKeywords: textList(row.searchKeywords, fallbackKeywords).slice(0, 6),
    };
  });

  if (new Set(recommendations.map((item) => item.category)).size !== 5) {
    throw new Error("AI 返回的推荐类目重复，已拒绝使用");
  }
  return recommendations.map((item) => ({
    ...item,
    firstValidation: item.firstValidation || categoryValidationStep(context, item.searchKeywords),
  }));
}

function categoryValidationStep(context: CategoryRecommendationContext, keywords: string[]) {
  const query = keywords.slice(0, 2).join("、");
  if (context.platformCode === "amazon") {
    return `在 ${context.marketName} Amazon 用“${query}”人工检索，记录前 10 个同类商品的价格带、Review 数量、差评主题和配送方式。`;
  }
  if (context.platformCode === "tiktok_shop") {
    return `在 ${context.marketName} TikTok Shop 用“${query}”人工检索，记录短视频演示方式、价格带、评价主题和退货风险。`;
  }
  if (context.platformCode === "shopify") {
    return `用“${query}”检索 ${context.marketName} 独立站与广告素材，记录落地页卖点、价格带、评价和履约承诺。`;
  }
  if (context.platformCode === "ebay") {
    return `在 ${context.marketName} eBay 用“${query}”人工检索，记录成色、规格、成交价区间、运费和退货条款。`;
  }
  return `在 ${context.marketName} ${context.platformName} 用“${query}”人工检索，记录价格带、评价主题、竞品规格和配送限制。`;
}

function hasUnverifiedMarketClaim(value: string) {
  return /(热销|爆款|高需求|需求旺盛|销量高|低竞争|竞争小|蓝海|稳赚|保证盈利)/i.test(value);
}

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

  const confirmedPrice = input.confirmedPriceCents && input.confirmedPriceCents > 0 ? input.confirmedPriceCents : null;
  const economics = bestQuote && confirmedPrice
    ? calculateEconomics({
        currency: input.context.currency,
        salePriceCents: confirmedPrice,
        landedCostCents: bestQuote.landedCostCents,
        ...platformEconomicDefaults(input.context.platformCode, confirmedPrice),
      })
    : null;
  const missingEconomicsReason = !confirmedPrice ? "缺已确认售价" : "缺成本模型";

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
      "已核实竞品证据",
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
      economics ? pct(economics.marginRate) : missingEconomicsReason,
      Boolean(economics && economics.marginRate >= thresholds.minMarginRate),
      "economic",
    ),
    gate(
      "stress",
      "压力情景盈利",
      "> $0",
      economics ? usd(economics.stressProfitCents) : missingEconomicsReason,
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
  if (economics) warnings.push("佣金、履约费、广告和退货率使用平台默认比例，尚未用真实费率表校准。");

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
