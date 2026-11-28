import {
  calculateEconomics,
  evaluateDecisionStage,
  opportunityScore,
  type EconomicsAssumptions,
} from "../economics.ts";
import { evaluateFastScreen } from "../sourcing-funnel.ts";
import { resolveSourcingGrade } from "../sourcing-grade.ts";
import type {
  AutoCandidateReason,
  AutoCandidateResult,
  AutoCandidateVerdict,
  AutoGrade,
  NormalizedCandidateSeed,
  PlatformPipelineConfig,
} from "./types.ts";

export type BatchMarketContext = {
  competitorCount: number;
  hhi: number | null;
  brandCr3Percent: number | null;
  medianReviews: number | null;
};

/**
 * 从同一批次的真实种子中计算类目集中度（HHI / Top3 品牌占比）与评论中位数，
 * 用于在没有外部研报时也能对整批候选做确定性市场格局快筛。
 */
export function computeBatchMarketContext(seeds: NormalizedCandidateSeed[]): BatchMarketContext {
  const organic = seeds.filter((s) => !s.isSponsored);
  const pool = organic.length >= 4 ? organic : seeds;
  const competitorCount = seeds.length;

  const reviewValues = pool
    .map((s) => s.reviewCount ?? 0)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const medianReviews =
    reviewValues.length > 0 ? reviewValues[Math.floor(reviewValues.length / 2)]! : null;

  const brandCounts = new Map<string, number>();
  let brandedTotal = 0;
  for (const item of pool) {
    const brand = (item.brand || "").trim().toLowerCase();
    if (!brand) continue;
    brandedTotal += 1;
    brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
  }

  if (brandedTotal < 3) {
    return { competitorCount, hhi: null, brandCr3Percent: null, medianReviews };
  }

  const shares = [...brandCounts.values()]
    .map((cnt) => (cnt / brandedTotal) * 100)
    .sort((a, b) => b - a);
  const hhi = Math.round(shares.reduce((sum, s) => sum + s * s, 0));
  const brandCr3Percent = Math.round(shares.slice(0, 3).reduce((sum, s) => sum + s, 0));

  return { competitorCount, hhi, brandCr3Percent, medianReviews };
}

/**
 * 对单条候选种子执行确定性快筛、估算算账、18% 采购上限反推与五级分类。
 * 严格遵循产品硬边界：任何等级都不产出正式 GO（verdict 类型限定 HOLD / NO-GO / PENDING）。
 */
export function evaluateAndGradeCandidate(input: {
  id: string;
  runId: string;
  seed: NormalizedCandidateSeed;
  config: PlatformPipelineConfig;
  batchContext: BatchMarketContext;
  fxToCnyRate: number;
}): AutoCandidateResult {
  const { seed, config, batchContext, fxToCnyRate } = input;
  const th = config.thresholds;
  const econCfg = config.economicsDefaults;
  const reasons: AutoCandidateReason[] = [];

  const priceCents = Math.max(0, Math.round(seed.priceCents));
  const reviewCount = Math.max(0, Math.round(seed.reviewCount ?? 0));
  const monthlySalesEstimate = Math.max(0, Math.round(seed.monthlySalesEstimate ?? 300));
  const evidenceSource = seed.evidenceSource ?? "real";

  // 1. 售价与基础有效性检查
  const priceInvalid = priceCents <= 0;
  const outOfPriceBand =
    priceCents > 0 && (priceCents < th.minPriceCents || priceCents > th.maxPriceCents);
  if (priceInvalid) {
    reasons.push({ code: "PRICE_MISSING", severity: "fail", message: "缺少真实售价，无法测算利润与采购上限" });
  } else if (outOfPriceBand) {
    reasons.push({
      code: "PRICE_OUT_OF_BAND",
      severity: "fail",
      message: `售价 ${(priceCents / 100).toFixed(2)} ${seed.currency} 超出配置价格带（${(th.minPriceCents / 100).toFixed(0)}–${(th.maxPriceCents / 100).toFixed(0)}）`,
    });
  } else {
    reasons.push({
      code: "PRICE_OK",
      severity: "pass",
      message: `售价 ${(priceCents / 100).toFixed(2)} ${seed.currency} 符合目标价格带`,
    });
  }

  // 2. 合规与市场格局快筛（复用现有 evaluateFastScreen）
  const fastScreen = evaluateFastScreen({
    marketCode: config.marketCode,
    verifiedCompetitorCount: evidenceSource === "real" ? batchContext.competitorCount : 0,
    p50PriceCents: priceCents > 0 ? priceCents : null,
    complianceAttrs: seed.complianceAttrs ?? [],
    conceptText: `${seed.title} ${seed.category ?? ""}`,
    thresholds: th,
  });

  // 结合批次级集中度补充市场判定
  const marketBlockers: string[] = [...fastScreen.marketBlockers];
  if (batchContext.hhi !== null && batchContext.hhi > th.maxHhi) {
    marketBlockers.push(`批次品牌 HHI=${batchContext.hhi} > ${th.maxHhi}`);
  } else if (batchContext.brandCr3Percent !== null && batchContext.brandCr3Percent >= th.maxBrandCr3Percent) {
    marketBlockers.push(`批次 Top3 品牌占比 ${batchContext.brandCr3Percent}% ≥ ${th.maxBrandCr3Percent}%`);
  }
  if (reviewCount >= th.maxMedianReviews * 2) {
    marketBlockers.push(`单品评论壁垒过高（${reviewCount.toLocaleString()} 条）`);
  } else if (batchContext.medianReviews !== null && batchContext.medianReviews >= th.maxMedianReviews) {
    marketBlockers.push(`批次评论中位数 ${batchContext.medianReviews.toLocaleString()} ≥ ${th.maxMedianReviews.toLocaleString()}`);
  }

  const effectiveMarketStatus =
    marketBlockers.length > 0
      ? "fail"
      : fastScreen.marketStatus;

  if (effectiveMarketStatus === "fail") {
    reasons.push({ code: "MARKET_FAIL", severity: "fail", message: marketBlockers.join("；") || fastScreen.marketSummary });
  } else if (effectiveMarketStatus === "hold") {
    reasons.push({ code: "MARKET_SAMPLE_LOW", severity: "warn", message: fastScreen.marketSummary });
  } else if (effectiveMarketStatus === "pass") {
    reasons.push({ code: "MARKET_PASS", severity: "pass", message: fastScreen.marketSummary });
  }

  if (fastScreen.complianceStatus === "fail") {
    reasons.push({ code: "COMPLIANCE_FAIL", severity: "fail", message: fastScreen.complianceSummary });
  } else if (fastScreen.complianceStatus === "hold") {
    reasons.push({ code: "COMPLIANCE_WARN", severity: "warn", message: fastScreen.complianceSummary });
  } else {
    reasons.push({ code: "COMPLIANCE_PASS", severity: "pass", message: fastScreen.complianceSummary });
  }

  // 3. 确定性单位经济与 18% 目标净利率反推到岸成本上限
  const safePrice = Math.max(100, priceCents);
  const resolvedCurrency = seed.currency || config.currency || "USD";
  const fbaFeeCents = Math.max(econCfg.fbaFeeMinCents, Math.round(safePrice * econCfg.fbaFeeRate));
  const estimatedLandedCostCents = Math.round(safePrice * econCfg.estimatedLandedCostRatio);

  const assumptions: EconomicsAssumptions = {
    currency: resolvedCurrency,
    salePriceCents: safePrice,
    landedCostCents: estimatedLandedCostCents,
    fbaFeeCents,
    referralRate: econCfg.referralRate,
    adRate: econCfg.adRate,
    returnRate: econCfg.returnRate,
    returnProcessingCents: Math.round(fbaFeeCents * 0.25),
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: Math.round(safePrice * 0.015),
    otherCostCents: 0,
    oneTimeFixedCostCents: 0,
    initialOrderUnits: 300,
  };

  const econ = calculateEconomics(assumptions);
  const evidenceScore = evidenceSource === "real" ? (batchContext.competitorCount >= th.minCompetitorsForPass ? 80 : 60) : 30;
  const score = priceInvalid ? 0 : opportunityScore(econ, monthlySalesEstimate, reviewCount, evidenceScore);

  const gate = evaluateDecisionStage({
    assumptions,
    results: econ,
    score,
    hasVerifiedSupplierQuote: false, // 自动流水线阶段永远没有已核实工厂报价
    hasRealCompetitorEvidence: evidenceSource === "real" && !priceInvalid,
    targetMarginRate: econCfg.targetMarginRate,
  });

  const maxLandedCostCents = priceInvalid ? 0 : Math.max(0, gate.maxLandedCostCents);
  const maxLandedCostCny =
    maxLandedCostCents > 0 ? Math.round((maxLandedCostCents / 100) * fxToCnyRate * 100) / 100 : 0;

  if (!priceInvalid) {
    if (!gate.maxLandedAchievable || maxLandedCostCents <= 0) {
      reasons.push({
        code: "TARGET_MARGIN_UNACHIEVABLE",
        severity: "fail",
        message: `即使采购成本归零，也无法达到 ${(econCfg.targetMarginRate * 100).toFixed(0)}% 净利率目标`,
      });
    } else {
      reasons.push({
        code: "TARGET_LANDED_CAP",
        severity: econ.marginRate >= econCfg.targetMarginRate ? "pass" : "warn",
        message: `估算净利率 ${(econ.marginRate * 100).toFixed(1)}% · 达标(${(econCfg.targetMarginRate * 100).toFixed(0)}%)最高允许到岸成本 ${(maxLandedCostCents / 100).toFixed(2)} ${assumptions.currency}（约 ¥${maxLandedCostCny.toFixed(1)}）`,
      });
    }
  }

  // 4. 统一五级分级（严格禁止自动 GO）
  const hardFail =
    priceInvalid ||
    outOfPriceBand ||
    effectiveMarketStatus === "fail" ||
    fastScreen.complianceStatus === "fail" ||
    gate.rawRecommendation === "NO-GO" ||
    !gate.maxLandedAchievable;

  if (!hardFail && evidenceSource !== "real") {
    reasons.push({
      code: "AI_GENERATED_ONLY",
      severity: "warn",
      message: "仅基于 AI 线索生成，需导入真实售价证据后再评级",
    });
  }

  const grade: AutoGrade = resolveSourcingGrade({
    hardFail,
    hasRealEvidence: evidenceSource === "real",
    marketStatus: effectiveMarketStatus,
    marginRate: econ.marginRate,
    score,
    thresholds: {
      sGradeMinMargin: th.sGradeMinMargin,
      sGradeMinScore: th.sGradeMinScore,
      aGradeMinMargin: th.aGradeMinMargin,
      aGradeMinScore: th.aGradeMinScore,
      minMarginRate: econCfg.targetMarginRate,
    },
  });

  const verdict: AutoCandidateVerdict =
    grade === "ELIMINATED"
      ? "NO-GO"
      : grade === "HOLD"
        ? "PENDING"
        : "HOLD"; // 等人工补真实报价后转 verified GO

  return {
    id: input.id,
    runId: input.runId,
    platformCode: config.platformCode,
    marketCode: config.marketCode,
    externalId: seed.externalId.trim().toUpperCase(),
    title: (seed.title || seed.externalId).trim(),
    brand: (seed.brand || "").trim(),
    category: (seed.category || "").trim(),
    url: (seed.url || "").trim(),
    currency: resolvedCurrency,
    priceCents,
    monthlySalesEstimate,
    reviewCount,
    rating: seed.rating ?? null,
    grade,
    verdict,
    score,
    estimatedMarginRate: Math.round(econ.marginRate * 10000) / 10000,
    maxLandedCostCents,
    maxLandedCostCny,
    pricingSource: "estimated",
    evidenceSource,
    reasons,
    metrics: {
      netProfitCents: econ.netProfitCents,
      stressProfitCents: econ.stressProfitCents,
      breakEvenAcos: Math.round(Math.max(0, (econ.netProfitCents + econ.adCostCents) / safePrice) * 10000) / 10000,
      competitorCount: batchContext.competitorCount,
      hhi: batchContext.hhi,
      brandCr3Percent: batchContext.brandCr3Percent,
      medianReviews: batchContext.medianReviews,
      complianceCostUsd: fastScreen.complianceCostUsd,
      complianceStatus: fastScreen.complianceStatus,
      marketStatus: effectiveMarketStatus,
    },
    promotedCaseId: null,
    observedAt: seed.observedAt || new Date().toISOString(),
  };
}
