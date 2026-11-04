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
  totalCostCents: number;
  netProfitCents: number;
  marginRate: number;
  roiRate: number;
  breakEvenAdRate: number;
  stressProfitCents: number;
  stressMarginRate: number;
  isProfitable: boolean;
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

  const totalCost =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    adCost +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents);
  const netProfit = keptRevenue - totalCost;
  const fixedCostsBeforeAd =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents);
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
  const totalCost =
    Math.max(0, input.landedCostCents) +
    Math.max(0, input.fbaFeeCents) +
    referralFee +
    adCost +
    returnLoss +
    Math.max(0, input.storageCents) +
    Math.max(0, input.otherCostCents);
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
