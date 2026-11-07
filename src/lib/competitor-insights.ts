import { calculateEconomics, type EconomicsResults } from "./economics.ts";
import { platformEconomicDefaults } from "./ai-sourcing.ts";
import {
  findRiskyClaims,
  normalizeListingContent,
  type ListingDraftContent,
  type PreflightFinding,
} from "./listing.ts";
import { clampConfidence, type ProposalGeneration } from "./ai-proposals/contract.ts";

export type CompetitorBenchmarkScope = {
  runId: string;
  hypothesisId: string;
  caseId?: string | null;
  marketCode: string;
  platformCode: string;
  currency: string;
};

/**
 * 由 AI 或本地模板批量生成的竞品记录来源标记。
 * 这些记录只能当作待核实的假设素材：不得计入 GO 门禁的竞品数、
 * 不得进入真实价格分位、不得被冠以「真实竞品」。
 */
export const SYNTHETIC_COMPETITOR_SOURCES = [
  "ai_model_site_import",
  "ai_site_auto_import",
  "ai_generated",
  "template",
  "demo",
  "synthetic",
] as const;

export function isSyntheticCompetitorSource(sourceType: string | null | undefined): boolean {
  if (!sourceType) return false; // 历史数据无标记：按人工/采集证据处理，避免误伤
  return (SYNTHETIC_COMPETITOR_SOURCES as readonly string[]).includes(sourceType.trim().toLowerCase());
}

export type CompetitorSnapshotInput = {
  id: string;
  hypothesisId: string;
  evidenceId?: string | null;
  /** 来自 opportunity_evidence.source_type，用于区分人工/采集证据与 AI 合成素材 */
  sourceType?: string | null;
  asin: string | null;
  title: string;
  sourceUrl: string;
  priceCents: number;
  rating: number | null;
  reviewCount: number;
  bsr: number | null;
  monthlySalesMin?: number | null;
  monthlySalesMax?: number | null;
  sellerCount?: number | null;
  variationCount?: number | null;
  observedAt: string;
  marketCode?: string;
  platformCode?: string;
  currency?: string;
};

export type ReviewInsightInput = {
  id: string;
  hypothesisId: string;
  evidenceId: string;
  /** 来自 opportunity_evidence.source_type；AI 合成的差评主题不进入对标证据 */
  sourceType?: string | null;
  competitorSnapshotId: string | null;
  theme: string;
  sentiment: "negative" | "neutral" | "positive";
  sampleSize: number;
  representativeQuote: string;
  sourceUrl?: string | null;
  observedAt?: string | null;
};

export type CompetitorCoverage = {
  competitorCount: number;
  dedupedCount: number;
  priceBandCount: number;
  themeCount: number;
  reviewSampleCount: number;
  withSourceUrlRate: number;
  freshnessDaysP50: number | null;
  sufficient: boolean;
};

export type HypothesisPricePosition =
  | "below_p25"
  | "p25_to_p50"
  | "p50_to_p75"
  | "p75_to_p90"
  | "above_p90";

export type CompetitorPriceSummary = {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  min: number;
  max: number;
  hypothesisPricePosition?: HypothesisPricePosition;
  topSourceUrl: string | null;
};

export type CompetitorDistribution = {
  ratingP50: number | null;
  reviewCountP50: number | null;
  bsrP50: number | null;
};

export type CompetitorThemeSummary = {
  theme: string;
  weightedCount: number;
  sampleSize: number;
  quote: string;
  sourceUrl: string | null;
  evidenceRefs: string[];
};

export type ContradictionVerdict = "supported" | "unverified" | "contradicted";

export type HypothesisContradiction = {
  assertion: string;
  field: "differentiator" | "price" | "margin";
  verdict: ContradictionVerdict;
  evidenceRefs: string[];
  note: string;
};

export type HypothesisAnchorInput = {
  concept: string;
  targetUser: string;
  painPoint: string;
  differentiator: string;
  recommendedPriceCents: number;
  confirmedPriceCents: number | null;
  expectedMarginRate: number;
  bestQuoteLandedCostCents?: number | null;
  bestQuoteId?: string | null;
};

export type CompetitorProfile = {
  scope: CompetitorBenchmarkScope;
  coverage: CompetitorCoverage;
  price: CompetitorPriceSummary | null;
  distribution: CompetitorDistribution;
  themes: CompetitorThemeSummary[];
  competitorBrands: string[];
  competitorAsins: string[];
};

export type CompetitorBenchmark = CompetitorProfile & {
  contradictions: HypothesisContradiction[];
  p50Economics: EconomicsResults | null;
  hypothesisSummary: HypothesisAnchorInput;
  /** 因 AI/模板合成而被排除、未参与画像与价格分位计算的快照数 */
  excludedSyntheticCount?: number;
};

export type BenchmarkBulletDraftItem = {
  index: number;
  theme: string;
  bullet: string;
  sourceQuote: string;
  evidenceRefs: string[];
  confidence: number;
  requiresReview: true;
};

export type BenchmarkBulletProposal = {
  summary: string;
  evidenceRefs: string[];
  affectedEntities: string[];
  recommendedActions: string[];
  confidence: number;
  requiresReview: true;
  generation: ProposalGeneration;
  bullets: BenchmarkBulletDraftItem[];
};

const BILINGUAL_SYNONYM_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["静音", "噪音", "异响", "响声", "分贝", "quiet", "silent", "noise", "noisy", "loud", "db", "decibel", "hum"],
  ["拆洗", "清洗", "清洁", "发霉", "死角", "clean", "wash", "washable", "detachable", "removable", "mold", "slimy", "hygiene"],
  ["漏水", "渗水", "密封", "防水", "leak", "leaking", "waterproof", "seal", "spill", "drip"],
  ["续航", "电池", "充电", "断电", "battery", "charge", "charging", "cordless", "power", "outage"],
  ["耐用", "易碎", "断裂", "生锈", "材质", "不锈钢", "durable", "break", "broken", "crack", "rust", "stainless", "flimsy", "cheap"],
  ["感应", "灵敏", "失灵", "水泵", "停转", "sensor", "motion", "pump", "stop", "working", "fail", "malfunction"],
  ["容量", "太小", "不够", "体积", "capacity", "small", "tiny", "size", "large", "refill"],
  ["安装", "复杂", "说明书", "install", "assembly", "setup", "instruction", "manual"],
  ["气味", "异味", "无味", "滤芯", "过滤", "smell", "odor", "filter", "filtration", "taste"],
  ["打滑", "防滑", "稳固", "倾倒", "slip", "non-slip", "stable", "tip", "spill-proof", "suction"],
];

/**
 * 纯函数：聚合同一 run（同市场 × 平台 × 币种）下的竞品快照与差评洞察。
 * 跨市场或跨币种样本直接过滤剔除，禁止隐式合并。
 */
export function buildCompetitorProfile(
  snapshots: readonly CompetitorSnapshotInput[],
  insights: readonly ReviewInsightInput[],
  scope: CompetitorBenchmarkScope,
  options?: { now?: Date | string; targetPriceCents?: number | null },
): CompetitorProfile {
  const nowMs = options?.now ? new Date(options.now).getTime() : Date.now();
  const scopedSnapshots = snapshots.filter((item) => {
    if (item.hypothesisId && item.hypothesisId !== scope.hypothesisId) return false;
    if (item.marketCode && item.marketCode.toUpperCase() !== scope.marketCode.toUpperCase()) return false;
    if (item.platformCode && item.platformCode.toLowerCase() !== scope.platformCode.toLowerCase()) return false;
    if (item.currency && item.currency.toUpperCase() !== scope.currency.toUpperCase()) return false;
    return Number.isFinite(item.priceCents) && item.priceCents > 0;
  });

  const withValidUrlCount = scopedSnapshots.filter((item) => isHttpUrl(item.sourceUrl)).length;
  const withSourceUrlRate = scopedSnapshots.length > 0
    ? Number((withValidUrlCount / scopedSnapshots.length).toFixed(4))
    : 0;

  const dedupedMap = new Map<string, CompetitorSnapshotInput>();
  for (const item of scopedSnapshots) {
    const key = snapshotDedupKey(item);
    if (!dedupedMap.has(key)) {
      dedupedMap.set(key, item);
    }
  }
  const deduped = [...dedupedMap.values()];

  const prices = deduped.map((item) => Math.round(item.priceCents)).sort((a, b) => a - b);
  const ratings = deduped
    .map((item) => item.rating)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const reviews = deduped
    .map((item) => item.reviewCount)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const bsrs = deduped
    .map((item) => item.bsr)
    .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);

  const freshnessDays = deduped
    .map((item) => {
      const time = new Date(item.observedAt).getTime();
      if (!Number.isFinite(time) || !Number.isFinite(nowMs)) return null;
      return Math.max(0, Math.round((nowMs - time) / 86_400_000));
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const priceBandCount = countDistinctPriceBands(prices);

  const scopedInsights = insights.filter((item) => !item.hypothesisId || item.hypothesisId === scope.hypothesisId);
  const themeGroups = new Map<string, {
    displayTheme: string;
    weightedCount: number;
    sampleSize: number;
    quote: string;
    sourceUrl: string | null;
    evidenceRefs: Set<string>;
  }>();

  for (const insight of scopedInsights) {
    const normalizedTheme = normalizeThemeKey(insight.theme);
    if (!normalizedTheme) continue;
    const sampleSize = Math.max(1, Math.round(insight.sampleSize || 1));
    const weightMultiplier = insight.sentiment === "negative" ? 1 : insight.sentiment === "neutral" ? 0.5 : 0.25;
    const weighted = Math.max(1, Math.round(sampleSize * weightMultiplier));
    const existing = themeGroups.get(normalizedTheme);
    const quote = insight.representativeQuote?.trim() || "";
    const ref = insight.evidenceId || insight.id;
    if (existing) {
      existing.weightedCount += weighted;
      existing.sampleSize += sampleSize;
      if (!existing.quote && quote) existing.quote = quote;
      if (!existing.sourceUrl && insight.sourceUrl) existing.sourceUrl = insight.sourceUrl;
      if (ref) existing.evidenceRefs.add(ref);
    } else {
      themeGroups.set(normalizedTheme, {
        displayTheme: insight.theme.trim(),
        weightedCount: weighted,
        sampleSize,
        quote,
        sourceUrl: insight.sourceUrl ?? null,
        evidenceRefs: new Set(ref ? [ref] : []),
      });
    }
  }

  const themes: CompetitorThemeSummary[] = [...themeGroups.values()]
    .sort((a, b) => b.weightedCount - a.weightedCount || b.sampleSize - a.sampleSize || a.displayTheme.localeCompare(b.displayTheme))
    .map((group) => ({
      theme: group.displayTheme,
      weightedCount: group.weightedCount,
      sampleSize: group.sampleSize,
      quote: group.quote,
      sourceUrl: group.sourceUrl,
      evidenceRefs: [...group.evidenceRefs],
    }));

  const reviewSampleCount = themes.reduce((sum, item) => sum + item.sampleSize, 0);
  const p25 = percentileInt(prices, 0.25);
  const p50 = percentileInt(prices, 0.5);
  const p75 = percentileInt(prices, 0.75);
  const p90 = percentileInt(prices, 0.9);

  const priceSummary: CompetitorPriceSummary | null = prices.length > 0 && p25 !== null && p50 !== null && p75 !== null && p90 !== null
    ? {
        p25,
        p50,
        p75,
        p90,
        min: prices[0]!,
        max: prices[prices.length - 1]!,
        hypothesisPricePosition: options?.targetPriceCents && options.targetPriceCents > 0
          ? classifyPricePosition(options.targetPriceCents, { p25, p50, p75, p90 })
          : undefined,
        topSourceUrl: deduped.find((item) => isHttpUrl(item.sourceUrl))?.sourceUrl ?? null,
      }
    : null;

  const sufficient =
    deduped.length >= 5 &&
    priceBandCount >= 2 &&
    themes.length >= 2 &&
    reviewSampleCount >= 15 &&
    withSourceUrlRate >= 0.8;

  const competitorBrands = extractCompetitorBrandTokens(deduped);
  const competitorAsins = deduped
    .map((item) => item.asin?.trim().toUpperCase())
    .filter((asin): asin is string => Boolean(asin && asin.length >= 6));

  return {
    scope,
    coverage: {
      competitorCount: scopedSnapshots.length,
      dedupedCount: deduped.length,
      priceBandCount,
      themeCount: themes.length,
      reviewSampleCount,
      withSourceUrlRate,
      freshnessDaysP50: percentileInt(freshnessDays, 0.5),
      sufficient,
    },
    price: priceSummary,
    distribution: {
      ratingP50: percentileFloat(ratings, 0.5),
      reviewCountP50: percentileInt(reviews, 0.5),
      bsrP50: percentileInt(bsrs, 0.5),
    },
    themes,
    competitorBrands,
    competitorAsins,
  };
}

/**
 * 纯函数：生成「假设 vs 竞品集」三行证伪对照（痛点差异化、定价落点、中位价毛利可行性）。
 * 只做展示与解释，不修改任何 GO/HOLD 门禁结论。
 */
export function contradictHypothesis(
  profile: CompetitorProfile,
  hypothesis: HypothesisAnchorInput,
): {
  contradictions: HypothesisContradiction[];
  p50Economics: EconomicsResults | null;
} {
  const targetPrice = hypothesis.confirmedPriceCents && hypothesis.confirmedPriceCents > 0
    ? hypothesis.confirmedPriceCents
    : hypothesis.recommendedPriceCents;

  // 1. 痛点与差异化对照
  const claimText = `${hypothesis.painPoint} ${hypothesis.differentiator}`.trim();
  const matchedThemes = profile.themes.filter((item) =>
    textsShareDomainConcept(claimText, `${item.theme} ${item.quote}`),
  );
  let diffVerdict: ContradictionVerdict = "unverified";
  let diffNote = "尚未录入差评主题，暂无法验证该痛点与差异化是否在真实市场存在。";
  let diffRefs: string[] = [];

  if (matchedThemes.length > 0) {
    const matchedSamples = matchedThemes.reduce((sum, item) => sum + item.sampleSize, 0);
    diffRefs = matchedThemes.flatMap((item) => item.evidenceRefs);
    if (matchedSamples >= 5) {
      diffVerdict = "supported";
      diffNote = `差评主题「${matchedThemes.map((t) => t.theme).join("、")}」（共 ${matchedSamples} 条样本）直接印证了该痛点。`;
    } else {
      diffVerdict = "unverified";
      diffNote = `已有相关差评主题「${matchedThemes[0]!.theme}」，但样本量仅 ${matchedSamples} 条，建议继续补充样本。`;
    }
  } else if (profile.themes.length >= 2 && profile.coverage.reviewSampleCount >= 15) {
    diffVerdict = "contradicted";
    diffRefs = profile.themes.slice(0, 3).flatMap((item) => item.evidenceRefs);
    diffNote = `已录 ${profile.coverage.reviewSampleCount} 条差评集中在「${profile.themes.slice(0, 2).map((t) => t.theme).join("、")}」，未见目标痛点反馈，差异化可能偏离真实需求。`;
  } else if (profile.themes.length > 0) {
    diffRefs = profile.themes.flatMap((item) => item.evidenceRefs);
    diffNote = `已录差评主题为「${profile.themes.map((t) => t.theme).join("、")}」，尚未出现与假设痛点匹配的证据。`;
  }

  // 2. 定价合理性对照
  let priceVerdict: ContradictionVerdict = "unverified";
  let priceNote = "尚未录入竞品价格，无法核对定价区间。";
  const priceLabel = hypothesis.confirmedPriceCents ? "已确认售价" : "AI 假设售价";

  if (profile.price && targetPrice > 0) {
    const pos = classifyPricePosition(targetPrice, profile.price);
    const fmt = (cents: number) => `${(cents / 100).toFixed(2)} ${profile.scope.currency}`;
    if (pos === "above_p90") {
      priceVerdict = "contradicted";
      priceNote = `${priceLabel} ${fmt(targetPrice)} 高于 P90（${fmt(profile.price.p90)}），显著脱离主流价格带（P25 ${fmt(profile.price.p25)}–P75 ${fmt(profile.price.p75)}），存在无依据溢价风险。`;
    } else if (pos === "p75_to_p90") {
      priceVerdict = "unverified";
      priceNote = `${priceLabel} ${fmt(targetPrice)} 位于 P75–P90 高溢价区间（中位 P50 为 ${fmt(profile.price.p50)}），需强差异化证据支撑。`;
    } else if (pos === "below_p25") {
      priceVerdict = targetPrice < Math.round(profile.price.p25 * 0.7) ? "contradicted" : "unverified";
      priceNote = `${priceLabel} ${fmt(targetPrice)} 低于竞品 P25（${fmt(profile.price.p25)}），需核对是否漏算平台履约费或配件成本。`;
    } else {
      priceVerdict = "supported";
      priceNote = `${priceLabel} ${fmt(targetPrice)} 落在主流竞品价格带（P25 ${fmt(profile.price.p25)}–P75 ${fmt(profile.price.p75)}，中位 ${fmt(profile.price.p50)}）内。`;
    }
  }

  // 3. 市场中位价毛利可行性对照
  let marginVerdict: ContradictionVerdict = "unverified";
  let marginNote = "需同时具备竞品价格中位数（P50）与真实供应商到岸成本后，才能交叉核验毛利可行性。";
  let p50Economics: EconomicsResults | null = null;
  const marginRefs: string[] = hypothesis.bestQuoteId ? [hypothesis.bestQuoteId] : [];

  if (profile.price && hypothesis.bestQuoteLandedCostCents && hypothesis.bestQuoteLandedCostCents > 0) {
    p50Economics = calculateEconomics({
      currency: profile.scope.currency,
      salePriceCents: profile.price.p50,
      landedCostCents: hypothesis.bestQuoteLandedCostCents,
      ...platformEconomicDefaults(profile.scope.platformCode, profile.price.p50),
    });
    const p50MarginPct = `${(p50Economics.marginRate * 100).toFixed(1)}%`;
    const targetMarginPct = `${(hypothesis.expectedMarginRate * 100).toFixed(1)}%`;
    const p50PriceStr = `${(profile.price.p50 / 100).toFixed(2)} ${profile.scope.currency}`;

    if (!p50Economics.isProfitable || p50Economics.marginRate < Math.min(0.1, hypothesis.expectedMarginRate - 0.1)) {
      marginVerdict = "contradicted";
      marginNote = `若按市场中位价 ${p50PriceStr} 销售，结合当前最低到岸成本测算净利率仅 ${p50MarginPct}（目标 ${targetMarginPct}），主流价位下利润不成立。`;
    } else if (p50Economics.marginRate >= hypothesis.expectedMarginRate - 0.03) {
      marginVerdict = "supported";
      marginNote = `按市场中位价 ${p50PriceStr} 销售，当前最低到岸成本下净利率可达 ${p50MarginPct}（目标 ${targetMarginPct}），具备真实市场安全垫。`;
    } else {
      marginVerdict = "unverified";
      marginNote = `按市场中位价 ${p50PriceStr} 销售时净利率为 ${p50MarginPct}，略低于假设目标 ${targetMarginPct}，需靠差异化溢价或继续议价补齐。`;
    }
  }

  const fmtTargetPrice = targetPrice > 0 ? `${(targetPrice / 100).toFixed(2)} ${profile.scope.currency}` : "未设定";

  return {
    p50Economics,
    contradictions: [
      {
        assertion: `痛点：${hypothesis.painPoint}｜差异化：${hypothesis.differentiator}`,
        field: "differentiator",
        verdict: diffVerdict,
        evidenceRefs: diffRefs,
        note: diffNote,
      },
      {
        assertion: `${priceLabel}：${fmtTargetPrice}`,
        field: "price",
        verdict: priceVerdict,
        evidenceRefs: [],
        note: priceNote,
      },
      {
        assertion: `假设目标净利率：${(hypothesis.expectedMarginRate * 100).toFixed(1)}%`,
        field: "margin",
        verdict: marginVerdict,
        evidenceRefs: marginRefs,
        note: marginNote,
      },
    ],
  };
}

export function buildCompetitorBenchmark(input: {
  snapshots: readonly CompetitorSnapshotInput[];
  insights: readonly ReviewInsightInput[];
  scope: CompetitorBenchmarkScope;
  hypothesis: HypothesisAnchorInput;
  now?: Date | string;
}): CompetitorBenchmark {
  const targetPriceCents = input.hypothesis.confirmedPriceCents && input.hypothesis.confirmedPriceCents > 0
    ? input.hypothesis.confirmedPriceCents
    : input.hypothesis.recommendedPriceCents;
  // AI / 模板合成的竞品数值与差评原话都不是证据：不参与覆盖度、去重、价格分位与主题归纳
  const verifiedSnapshots = input.snapshots.filter((s) => !isSyntheticCompetitorSource(s.sourceType));
  const verifiedInsights = input.insights.filter((i) => !isSyntheticCompetitorSource(i.sourceType));
  const excludedSyntheticCount = input.snapshots.length - verifiedSnapshots.length;
  const profile = buildCompetitorProfile(verifiedSnapshots, verifiedInsights, input.scope, {
    now: input.now,
    targetPriceCents,
  });
  const { contradictions, p50Economics } = contradictHypothesis(profile, input.hypothesis);
  return {
    ...profile,
    contradictions,
    p50Economics,
    hypothesisSummary: input.hypothesis,
    excludedSyntheticCount,
  };
}

/**
 * 确认售价偏离提示（只提示，不阻断保存）。
 */
export function evaluateConfirmedPriceAdvisory(
  priceCents: number,
  priceBand: CompetitorPriceSummary | null,
  currency: string,
): string | null {
  if (!priceBand || !Number.isFinite(priceCents) || priceCents <= 0) return null;
  const fmt = (cents: number) => `${(cents / 100).toFixed(2)} ${currency}`;
  if (priceCents < priceBand.p25) {
    return `该定价（${fmt(priceCents)}）低于竞品价格带 P25（${fmt(priceBand.p25)}），请核对依据链接与成本安全垫`;
  }
  if (priceCents > priceBand.p90) {
    return `该定价（${fmt(priceCents)}）高于竞品价格带 P90（${fmt(priceBand.p90)}），偏离主流竞品价格带，请核对依据链接`;
  }
  return null;
}

/**
 * 内容上架页：三项只读竞品对标提示（Benchmark Advisories）。
 * 绝不进入 errorCount / warningCount / score / passed，保证零回归。
 */
export function evaluateBenchmarkAdvisories(
  rawContent: Partial<ListingDraftContent>,
  benchmark: CompetitorBenchmark | null,
  profile?: {
    coreDifferentiator?: string | null;
    claimsToAvoid?: string | null;
  } | null,
): PreflightFinding[] {
  if (!benchmark) return [];
  const content = normalizeListingContent(rawContent);
  const advisories: PreflightFinding[] = [];
  const bulletsAndDesc = [...content.bullets, content.description].join(" \n ").trim();
  const allListingText = [content.brand, content.title, ...content.bullets, content.description, content.searchTerms]
    .join(" \n ")
    .trim();

  if (!allListingText) return [];

  // 1. BENCHMARK_GAP_UNCOVERED: 高频差评缺口未在五点描述中覆盖
  const topThemes = benchmark.themes.slice(0, 3);
  if (topThemes.length > 0 && content.bullets.some(Boolean)) {
    const bulletsText = content.bullets.filter(Boolean).join(" \n ");
    const uncovered = topThemes.filter(
      (item) => !textsShareDomainConcept(`${item.theme} ${item.quote}`, bulletsText),
    );
    if (uncovered.length > 0) {
      advisories.push({
        code: "BENCHMARK_GAP_UNCOVERED",
        severity: "warning",
        field: "bullets",
        message: `五点描述尚未覆盖选品期高频差评缺口：「${uncovered.map((t) => `${t.theme}（${t.sampleSize}条）`).join("、")}」，建议补充对应改进卖点。`,
      });
    }
  }

  // 2. BENCHMARK_COMPARATIVE_CLAIM: 文案或搜索词出现竞品品牌/ASIN 或未验证比较级
  const comparativeHits: string[] = [];
  const lowerAll = allListingText.toLowerCase();
  const ownBrandLower = content.brand.trim().toLowerCase();

  for (const asin of benchmark.competitorAsins) {
    if (asin && lowerAll.includes(asin.toLowerCase())) {
      comparativeHits.push(`竞品 ASIN ${asin}`);
    }
  }
  for (const brand of benchmark.competitorBrands) {
    if (!brand || brand.toLowerCase() === ownBrandLower) continue;
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "i");
    if (regex.test(allListingText)) {
      comparativeHits.push(`竞品词「${brand}」`);
    }
  }
  const comparativePatterns = [
    /\b(?:better than|superior to|outperforms|cheaper than|unlike other)\b/i,
    /(?:比其他|比同行|吊打|秒杀|碾压|优于市面上)/,
  ];
  for (const pattern of comparativePatterns) {
    const match = allListingText.match(pattern);
    if (match?.[0]) comparativeHits.push(`比较级表述「${match[0]}」`);
  }
  for (const risky of findRiskyClaims(bulletsAndDesc)) {
    comparativeHits.push(`高风险声明「${risky.term}」`);
  }

  if (comparativeHits.length > 0) {
    advisories.push({
      code: "BENCHMARK_COMPARATIVE_CLAIM",
      severity: "warning",
      field: "claims",
      message: `检测到竞品品牌或未验证比较级表述（${[...new Set(comparativeHits)].slice(0, 4).join("、")}），请移除竞品标识并确保声明有实测证据。`,
    });
  }

  // 3. BENCHMARK_CLAIM_CONFLICT: 命中 claims_to_avoid 或与 contradicted 断言冲突
  const conflictHits: string[] = [];
  const claimsToAvoidRaw = profile?.claimsToAvoid?.trim() || "";
  if (claimsToAvoidRaw) {
    const forbiddenPhrases = claimsToAvoidRaw
      .split(/[;；,，。\n]+/)
      .map((phrase) => phrase.replace(/^(?:例[:：]|不得写|禁止写|禁用|避免)/, "").trim())
      .filter((phrase) => phrase.length >= 2);
    for (const phrase of forbiddenPhrases) {
      if (lowerAll.includes(phrase.toLowerCase())) {
        conflictHits.push(`命中禁用声明「${phrase}」`);
      }
    }
  }

  const contradictedDiff = benchmark.contradictions.find(
    (item) => item.field === "differentiator" && item.verdict === "contradicted",
  );
  if (contradictedDiff && textsShareDomainConcept(benchmark.hypothesisSummary.differentiator, bulletsAndDesc)) {
    conflictHits.push(`选品期已被证伪的差异点「${benchmark.hypothesisSummary.differentiator}」仍出现在文案中`);
  }

  if (conflictHits.length > 0) {
    advisories.push({
      code: "BENCHMARK_CLAIM_CONFLICT",
      severity: "warning",
      field: "claims",
      message: `内容与已确认边界存在冲突：${conflictHits.join("；")}。`,
    });
  }

  return advisories;
}

/**
 * M2：校验或构建五点描述提案。
 * 硬约束：每条 bullet 必须带非空 sourceQuote 与非空 evidenceRefs，且 requiresReview 恒为 true。
 */
export function validateBenchmarkBulletProposal(
  raw: unknown,
  benchmark: CompetitorBenchmark,
  generation: ProposalGeneration = { source: "model" },
): BenchmarkBulletProposal {
  const validRefs = new Set(benchmark.themes.flatMap((t) => t.evidenceRefs));
  const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const rawBullets = Array.isArray(record.bullets) ? record.bullets : [];

  if (rawBullets.length === 0) {
    throw new Error("AI 五点提案缺少 bullets 数组");
  }

  const bullets: BenchmarkBulletDraftItem[] = rawBullets.slice(0, 5).map((item, idx) => {
    const row = typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
    const bullet = String(row.bullet ?? "").trim();
    const sourceQuote = String(row.sourceQuote ?? "").trim();
    const theme = String(row.theme ?? benchmark.themes[idx]?.theme ?? "核心卖点").trim();
    const rawRefs = Array.isArray(row.evidenceRefs)
      ? row.evidenceRefs.map((r) => String(r ?? "").trim()).filter(Boolean)
      : [];
    const matchedTheme = benchmark.themes.find((t) => t.theme === theme) ?? benchmark.themes[idx] ?? benchmark.themes[0];
    const evidenceRefs = rawRefs.length > 0
      ? rawRefs
      : (matchedTheme?.evidenceRefs ?? []);

    if (!bullet || bullet.length < 15) {
      throw new Error(`第 ${idx + 1} 条五点草稿内容过短或为空`);
    }
    if (!sourceQuote) {
      throw new Error(`第 ${idx + 1} 条五点草稿缺少原文引用（sourceQuote），已拒绝采纳`);
    }
    if (evidenceRefs.length === 0) {
      throw new Error(`第 ${idx + 1} 条五点草稿缺少证据引用（evidenceRefs），已拒绝采纳`);
    }
    if (validRefs.size > 0 && !evidenceRefs.some((ref) => validRefs.has(ref))) {
      throw new Error(`第 ${idx + 1} 条五点草稿引用了不存在的证据 ID`);
    }

    return {
      index: idx + 1,
      theme,
      bullet: bullet.slice(0, 480),
      sourceQuote: sourceQuote.slice(0, 300),
      evidenceRefs,
      confidence: clampConfidence(Number(row.confidence ?? 0.78)),
      requiresReview: true,
    };
  });

  const allRefs = [...new Set(bullets.flatMap((b) => b.evidenceRefs))];
  const avgConfidence = clampConfidence(
    bullets.reduce((sum, item) => sum + item.confidence, 0) / bullets.length,
  );

  return {
    summary: String(record.summary ?? `基于 ${benchmark.themes.length} 个差评缺口主题生成的五点描述草稿`).trim(),
    evidenceRefs: allRefs,
    affectedEntities: [benchmark.scope.caseId ?? benchmark.scope.hypothesisId],
    recommendedActions: ["人工逐条核对事实与禁用声明后，填入 Listing 草稿保存"],
    confidence: avgConfidence,
    requiresReview: true,
    generation,
    bullets,
  };
}

/**
 * 确定性模板降级：当未配置外部模型或模型调用失败时，基于已核验商品定义 + 差评缺口生成可审阅草稿。
 */
export function buildTemplateBenchmarkBullets(
  benchmark: CompetitorBenchmark,
  profile?: {
    productName?: string | null;
    targetCustomer?: string | null;
    coreDifferentiator?: string | null;
    specifications?: string | null;
    packageContents?: string | null;
  } | null,
): BenchmarkBulletProposal | null {
  if (benchmark.themes.length === 0) return null;
  const productName = profile?.productName?.trim() || benchmark.hypothesisSummary.concept;
  const targetCustomer = profile?.targetCustomer?.trim() || benchmark.hypothesisSummary.targetUser;
  const differentiator = profile?.coreDifferentiator?.trim() || benchmark.hypothesisSummary.differentiator;
  const specs = profile?.specifications?.trim() || "标准认证材质与实测规格";
  const pkg = profile?.packageContents?.trim() || "完整主机及替换配件";

  const templates = [
    (t: CompetitorThemeSummary) =>
      `【针对「${t.theme}」痛点改进】${productName} 采用 ${differentiator} 设计，专为 ${targetCustomer} 打造，解决传统产品常见困扰。`,
    (t: CompetitorThemeSummary) =>
      `【实测规格与耐用结构】严格选用 ${specs}，针对用户高频反馈的「${t.theme}」问题进行结构强化，日常高频使用更稳定。`,
    (t: CompetitorThemeSummary) =>
      `【便捷维护与省心体验】优化日常清洁与操作动线，直击「${t.theme}」短板，减少后续维护时间成本。`,
    (t: CompetitorThemeSummary) =>
      `【贴合真实使用场景】兼顾 ${targetCustomer} 的日常习惯与安全细节，规避「${t.theme}」带来的体验下降。`,
    (t: CompetitorThemeSummary) =>
      `【完整到货清单】包装内含 ${pkg}，开箱即可按说明快速上手，无需额外添置基础配件。`,
  ];

  const rawBullets = templates.map((fn, idx) => {
    const themeItem = benchmark.themes[idx % benchmark.themes.length]!;
    return {
      theme: themeItem.theme,
      bullet: fn(themeItem),
      sourceQuote: themeItem.quote || `差评主题：${themeItem.theme}（样本 ${themeItem.sampleSize} 条）`,
      evidenceRefs: themeItem.evidenceRefs.length > 0 ? themeItem.evidenceRefs : [benchmark.scope.hypothesisId],
      confidence: 0.75,
    };
  });

  return validateBenchmarkBulletProposal(
    {
      summary: `基于 ${benchmark.themes.length} 项真实差评缺口与商品定义生成的确定性对标五点草稿`,
      bullets: rawBullets,
    },
    benchmark,
    { source: "template" },
  );
}

function snapshotDedupKey(item: CompetitorSnapshotInput): string {
  const asin = item.asin?.trim().toUpperCase();
  if (asin) return `asin:${asin}`;
  const url = normalizeUrlKey(item.sourceUrl);
  if (url) return `url:${url}`;
  return `title:${item.title.trim().toLowerCase()}:${item.priceCents}`;
}

function normalizeUrlKey(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const asinMatch = parsed.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asinMatch?.[1]) return `asin:${asinMatch[1].toUpperCase()}`;
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeThemeKey(theme: string): string {
  return theme.trim().toLowerCase().replace(/\s+/g, " ");
}

function percentileInt(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return Math.round(sorted[0]!);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return Math.round(sorted[lower]! * (1 - weight) + sorted[upper]! * weight);
}

function percentileFloat(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return Number(sorted[0]!.toFixed(2));
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return Number((sorted[lower]! * (1 - weight) + sorted[upper]! * weight).toFixed(2));
}

function countDistinctPriceBands(sortedPrices: readonly number[]): number {
  if (sortedPrices.length === 0) return 0;
  const min = sortedPrices[0]!;
  const max = sortedPrices[sortedPrices.length - 1]!;
  if (max <= min) return 1;
  // Divide into $5 (500 cents) or 20% relative buckets, whichever is wider, to measure genuine dispersion.
  const step = Math.max(500, Math.round((max - min) / 4));
  const bands = new Set(sortedPrices.map((price) => Math.floor((price - min) / step)));
  return bands.size;
}

export function classifyPricePosition(
  priceCents: number,
  band: Pick<CompetitorPriceSummary, "p25" | "p50" | "p75" | "p90">,
): HypothesisPricePosition {
  if (priceCents < band.p25) return "below_p25";
  if (priceCents <= band.p50) return "p25_to_p50";
  if (priceCents <= band.p75) return "p50_to_p75";
  if (priceCents <= band.p90) return "p75_to_p90";
  return "above_p90";
}

function extractCompetitorBrandTokens(snapshots: readonly CompetitorSnapshotInput[]): string[] {
  const stopWords = new Set([
    "for", "with", "and", "the", "set", "pack", "new", "pro", "mini", "max", "plus",
    "portable", "automatic", "electric", "stainless", "steel", "pet", "cat", "dog",
    "water", "fountain", "home", "kitchen", "storage", "organizer", "holder", "box",
  ]);
  const brands = new Set<string>();
  for (const item of snapshots) {
    const firstToken = item.title.trim().split(/[\s\-|,:：/]+/)[0]?.trim() ?? "";
    if (
      firstToken.length >= 4 &&
      /^[A-Za-z][A-Za-z0-9]+$/.test(firstToken) &&
      !stopWords.has(firstToken.toLowerCase())
    ) {
      brands.add(firstToken);
    }
  }
  return [...brands];
}

export function textsShareDomainConcept(textA: string, textB: string): boolean {
  const a = textA.trim().toLowerCase();
  const b = textB.trim().toLowerCase();
  if (!a || !b) return false;

  // 1. Check bilingual synonym groups
  for (const group of BILINGUAL_SYNONYM_GROUPS) {
    const hitA = group.some((term) => a.includes(term));
    const hitB = group.some((term) => b.includes(term));
    if (hitA && hitB) return true;
  }

  // 2. Check Chinese 2-character bigrams or English 4+ char word overlap
  const tokensA = extractMeaningfulTokens(a);
  const tokensB = new Set(extractMeaningfulTokens(b));
  return tokensA.some((token) => tokensB.has(token));
}

function extractMeaningfulTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/[a-z]{4,}/g)) {
    tokens.push(match[0]);
  }
  const cjk = text.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjk.length - 1; i += 1) {
    tokens.push(cjk.slice(i, i + 2));
  }
  return tokens;
}
