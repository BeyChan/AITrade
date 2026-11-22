export type EconomicsAssumptions = {
  currency?: string;
  salePriceCents: number;
  landedCostCents: number;
  fbaFeeCents: number;
  referralRate: number;
  adRate: number;
  returnRate: number;
  returnProcessingCents: number;
  returnRecoveryRate: number;
  couponCents: number;
  storageCents: number;
  otherCostCents: number;
  /** 一次性固定投入（如 CPC/FCC/CE 认证、专利检索、开模费），按首批件数分摊到单件成本 */
  oneTimeFixedCostCents?: number;
  /** 首批备货件数（与 oneTimeFixedCostCents 配合计算单件摊销） */
  initialOrderUnits?: number;
};

export type EconomicsResults = {
  currency: string;
  netRevenueCents: number;
  landedCostCents: number;
  fbaFeeCents: number;
  referralFeeCents: number;
  adCostCents: number;
  returnLossCents: number;
  couponCents: number;
  storageCents: number;
  otherCostCents: number;
  amortizedFixedCostCents: number;
  totalCostCents: number;
  netProfitCents: number;
  marginRate: number;
  roiRate: number;
  breakEvenAdRate: number;
  stressProfitCents: number;
  stressMarginRate: number;
  isProfitable: boolean;
};

export type TargetLandedCostInput = Omit<EconomicsAssumptions, "landedCostCents"> & {
  targetMarginRate: number;
};

export type TargetLandedCostResult = {
  maxLandedCostCents: number;
  targetNetProfitCents: number;
  targetMarginRate: number;
  achievable: boolean;
};

const round = (value: number) => Math.round(value);

export function calculateEconomics(input: EconomicsAssumptions): EconomicsResults {
  const salePrice = Math.max(1, input.salePriceCents);
  const coupon = Math.max(0, input.couponCents);
  const grossRevenue = Math.max(0, salePrice - coupon);
  const keptRevenue = round(grossRevenue * (1 - clamp(input.returnRate, 0, 0.95)));
  const referralFee = round(keptRevenue * clamp(input.referralRate, 0, 0.5));
  const adCost = round(grossRevenue * clamp(input.adRate, 0, 0.8));
  const returnLoss = round(
    clamp(input.returnRate, 0, 0.95) *
      (Math.max(0, input.returnProcessingCents) +
        Math.max(0, input.landedCostCents) * (1 - clamp(input.returnRecoveryRate, 0, 1))),
  );

  const amortizedFixedCostCents =
    input.oneTimeFixedCostCents && input.oneTimeFixedCostCents > 0 && input.initialOrderUnits && input.initialOrderUnits > 0
      ? round(input.oneTimeFixedCostCents / input.initialOrderUnits)
      : 0;

  const totalCost =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    adCost +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents) +
    amortizedFixedCostCents;
  const netProfit = keptRevenue - totalCost;
  const fixedCostsBeforeAd =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents) +
    amortizedFixedCostCents;
  const breakEvenAdRate = grossRevenue > 0 ? (keptRevenue - fixedCostsBeforeAd) / grossRevenue : 0;

  const stress = calculateBase({
    ...input,
    salePriceCents: round(salePrice * 0.9),
    landedCostCents: round(input.landedCostCents * 1.2),
    adRate: clamp(input.adRate * 1.2, 0, 0.8),
    returnRate: clamp(input.returnRate + 0.02, 0, 0.95),
  });

  return {
    currency: input.currency ?? "USD",
    netRevenueCents: keptRevenue,
    landedCostCents: Math.max(0, input.landedCostCents),
    fbaFeeCents: Math.max(0, input.fbaFeeCents),
    referralFeeCents: referralFee,
    adCostCents: adCost,
    returnLossCents: returnLoss,
    couponCents: coupon,
    storageCents: Math.max(0, input.storageCents),
    otherCostCents: Math.max(0, input.otherCostCents),
    amortizedFixedCostCents,
    totalCostCents: totalCost,
    netProfitCents: netProfit,
    marginRate: netProfit / salePrice,
    roiRate: input.landedCostCents > 0 ? netProfit / input.landedCostCents : 0,
    breakEvenAdRate,
    stressProfitCents: stress.netProfitCents,
    stressMarginRate: stress.marginRate,
    isProfitable: netProfit > 0,
  };
}

/**
 * Finds the highest landed cost that still meets the requested net margin.
 * The search uses the same integer-cent economics function as the decision gate so
 * the calculator and the formal gate cannot disagree because of rounding.
 */
export function calculateTargetLandedCost(input: TargetLandedCostInput): TargetLandedCostResult {
  const salePriceCents = Math.max(1, round(input.salePriceCents));
  const targetMarginRate = clamp(input.targetMarginRate, 0, 0.9);
  const targetNetProfitCents = round(salePriceCents * targetMarginRate);

  const meetsTarget = (landedCostCents: number) => {
    const result = calculateEconomics({ ...input, salePriceCents, landedCostCents });
    return result.marginRate + 1e-9 >= targetMarginRate;
  };

  if (!meetsTarget(0)) {
    return { maxLandedCostCents: 0, targetNetProfitCents, targetMarginRate, achievable: false };
  }

  let low = 0;
  let high = salePriceCents;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (meetsTarget(middle)) low = middle;
    else high = middle - 1;
  }

  return { maxLandedCostCents: low, targetNetProfitCents, targetMarginRate, achievable: true };
}

/** Highest supplier unit price after the quoted freight and duty are paid. */
export function calculateMaxPurchasePriceCents(
  maxLandedCostCents: number,
  freightPerUnitCents: number,
  dutyRate: number,
) {
  const maxLanded = Math.max(0, round(maxLandedCostCents));
  const freight = Math.max(0, round(freightPerUnitCents));
  const duty = clamp(dutyRate, 0, 1);
  const landedAt = (purchaseCents: number) => {
    const taxable = purchaseCents + freight;
    return taxable + round(taxable * duty);
  };

  let low = 0;
  let high = maxLanded;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (landedAt(middle) <= maxLanded) low = middle;
    else high = middle - 1;
  }
  return landedAt(low) <= maxLanded ? low : 0;
}

function calculateBase(input: EconomicsAssumptions) {
  const salePrice = Math.max(1, input.salePriceCents);
  const coupon = Math.max(0, input.couponCents);
  const grossRevenue = Math.max(0, salePrice - coupon);
  const keptRevenue = round(grossRevenue * (1 - clamp(input.returnRate, 0, 0.95)));
  const referralFee = round(keptRevenue * clamp(input.referralRate, 0, 0.5));
  const adCost = round(grossRevenue * clamp(input.adRate, 0, 0.8));
  const returnLoss = round(
    clamp(input.returnRate, 0, 0.95) *
      (Math.max(0, input.returnProcessingCents) +
        Math.max(0, input.landedCostCents) * (1 - clamp(input.returnRecoveryRate, 0, 1))),
  );
  const amortizedFixedCostCents =
    input.oneTimeFixedCostCents && input.oneTimeFixedCostCents > 0 && input.initialOrderUnits && input.initialOrderUnits > 0
      ? round(input.oneTimeFixedCostCents / input.initialOrderUnits)
      : 0;
  const totalCost =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    adCost +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents) +
    amortizedFixedCostCents;
  const netProfit = keptRevenue - totalCost;
  return { netProfitCents: netProfit, marginRate: netProfit / salePrice };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function opportunityScore(
  results: EconomicsResults,
  monthlySalesEstimate: number,
  reviewCount: number,
  evidenceScore: number,
) {
  const marginScore = clamp(results.marginRate / 0.3, 0, 1) * 40;
  const profitScore = clamp(results.netProfitCents / 3000, 0, 1) * 20;
  const demandScore = clamp(monthlySalesEstimate / 2000, 0, 1) * 15;
  const evidence = clamp(evidenceScore / 100, 0, 1) * 15;
  const competitionPenalty = clamp(reviewCount / 5000, 0, 1) * 10;
  return Math.round(clamp(marginScore + profitScore + demandScore + evidence - competitionPenalty, 0, 100));
}

export function recommendationFor(results: EconomicsResults, score: number) {
  if (!results.isProfitable || results.stressProfitCents <= 0) return "NO-GO" as const;
  if (score >= 65 && results.marginRate >= 0.18) return "GO" as const;
  return "HOLD" as const;
}

export type DecisionStage = "provisional" | "verified";

export type DecisionGateEvaluation = {
  stage: DecisionStage;
  stageLabel: string;
  recommendation: "GO" | "HOLD" | "NO-GO";
  rawRecommendation: "GO" | "HOLD" | "NO-GO";
  blockedReasons: string[];
  maxLandedCostCents: number;
  maxLandedAchievable: boolean;
};

/**
 * 两段式门禁判定：
 * - 估算快筛态（Provisional）：允许无真实工厂报价时先算盈亏与 18% 砍价天花板，但严禁签发正式 GO；
 * - 实证终审态（Verified）：具备真实竞品证据与真实供应商定标后，才放行正式 GO 结论。
 */
export function evaluateDecisionStage(input: {
  assumptions: EconomicsAssumptions;
  results: EconomicsResults;
  score: number;
  hasVerifiedSupplierQuote: boolean;
  hasRealCompetitorEvidence: boolean;
  targetMarginRate?: number;
}): DecisionGateEvaluation {
  const rawRecommendation = recommendationFor(input.results, input.score);
  const target = calculateTargetLandedCost({
    currency: input.assumptions.currency,
    salePriceCents: input.assumptions.salePriceCents,
    fbaFeeCents: input.assumptions.fbaFeeCents,
    referralRate: input.assumptions.referralRate,
    adRate: input.assumptions.adRate,
    returnRate: input.assumptions.returnRate,
    returnProcessingCents: input.assumptions.returnProcessingCents,
    returnRecoveryRate: input.assumptions.returnRecoveryRate,
    couponCents: input.assumptions.couponCents,
    storageCents: input.assumptions.storageCents,
    otherCostCents: input.assumptions.otherCostCents,
    oneTimeFixedCostCents: input.assumptions.oneTimeFixedCostCents,
    initialOrderUnits: input.assumptions.initialOrderUnits,
    targetMarginRate: input.targetMarginRate ?? 0.18,
  });

  const blockedReasons: string[] = [];
  if (!input.hasRealCompetitorEvidence) {
    blockedReasons.push("缺少真实竞品价格证据（仅靠估算或 AI 假设，不能签发正式 GO）");
  }
  if (!input.hasVerifiedSupplierQuote) {
    blockedReasons.push("尚未定标真实 1688/工厂报价（当前为估算到岸成本，请先拿样比价并定标）");
  }

  const stage: DecisionStage = blockedReasons.length === 0 ? "verified" : "provisional";
  const recommendation: "GO" | "HOLD" | "NO-GO" =
    rawRecommendation === "NO-GO"
      ? "NO-GO"
      : stage === "provisional" && rawRecommendation === "GO"
        ? "HOLD"
        : rawRecommendation;

  return {
    stage,
    stageLabel: stage === "verified" ? "实证终审态 · 可签发正式立项" : "估算快筛态 · 仅作打样参考（未解锁正式 GO）",
    recommendation,
    rawRecommendation,
    blockedReasons,
    maxLandedCostCents: target.maxLandedCostCents,
    maxLandedAchievable: target.achievable,
  };
}
