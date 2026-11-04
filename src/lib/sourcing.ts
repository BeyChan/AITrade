import { calculateEconomics, type EconomicsAssumptions, type EconomicsResults } from "./economics.ts";

export type SupplierQuoteForScoring = {
  id: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  moq: number;
  leadTimeDays: number | null;
  qualityScore: number;
  sampleFeeCents: number;
  certifications: string;
};

export type QuoteScoreBreakdown = {
  cost: number;
  quality: number;
  leadTime: number;
  moq: number;
  commercial: number;
};

export type ScoredSupplierQuote = SupplierQuoteForScoring & {
  dutyCents: number;
  landedCostCents: number;
  landedDeltaCents: number;
  landedDeltaRate: number;
  economics: EconomicsResults;
  score: number;
  scoreBreakdown: QuoteScoreBreakdown;
  risks: string[];
  isEligible: boolean;
  isPreferred: boolean;
};

export function analyzeSupplierQuotes(
  quotes: SupplierQuoteForScoring[],
  assumptions: EconomicsAssumptions,
): ScoredSupplierQuote[] {
  if (quotes.length === 0) return [];

  const normalized = quotes.map((quote) => normalizeQuote(quote, assumptions));
  const cheapestLandedCost = Math.min(...normalized.map((quote) => quote.landedCostCents));
  const scored = normalized.map((quote) => scoreQuote(quote, cheapestLandedCost));
  const preferred = [...scored]
    .filter((quote) => quote.isEligible)
    .sort(compareQuotes)[0];

  return scored
    .map((quote) => ({ ...quote, isPreferred: quote.id === preferred?.id }))
    .sort(compareQuotes);
}

function normalizeQuote(quote: SupplierQuoteForScoring, assumptions: EconomicsAssumptions) {
  const unitPriceCents = Math.max(0, Math.round(quote.unitPriceCents));
  const freightPerUnitCents = Math.max(0, Math.round(quote.freightPerUnitCents));
  const dutyRate = clamp(Number(quote.dutyRate), 0, 1);
  const dutyCents = Math.round((unitPriceCents + freightPerUnitCents) * dutyRate);
  const landedCostCents = unitPriceCents + freightPerUnitCents + dutyCents;
  const economics = calculateEconomics({ ...assumptions, landedCostCents });
  const landedDeltaCents = landedCostCents - assumptions.landedCostCents;
  const landedDeltaRate = assumptions.landedCostCents > 0 ? landedDeltaCents / assumptions.landedCostCents : 0;
  const qualityScore = clamp(Math.round(Number(quote.qualityScore)), 0, 100);

  return {
    ...quote,
    unitPriceCents,
    freightPerUnitCents,
    dutyRate,
    dutyCents,
    landedCostCents,
    landedDeltaCents,
    landedDeltaRate,
    economics,
    qualityScore,
  };
}

function scoreQuote(
  quote: ReturnType<typeof normalizeQuote>,
  cheapestLandedCost: number,
): Omit<ScoredSupplierQuote, "isPreferred"> {
  const costScore = quote.landedCostCents > 0 ? clamp((cheapestLandedCost / quote.landedCostCents) * 100, 0, 100) : 0;
  const qualityScore = clamp(quote.qualityScore, 0, 100);
  const leadTimeScore = clamp(100 - Math.max(0, (quote.leadTimeDays ?? 60) - 15) * 2.5, 0, 100);
  const moqScore = clamp(100 - Math.log10(Math.max(1, quote.moq)) * 15, 0, 100);
  const sampleScore = clamp(100 - Math.max(0, quote.sampleFeeCents) / 500, 0, 100);
  const certificationScore = quote.certifications.trim() ? 100 : 40;
  const commercialScore = sampleScore * 0.6 + certificationScore * 0.4;

  const scoreBreakdown = {
    cost: round(costScore),
    quality: round(qualityScore),
    leadTime: round(leadTimeScore),
    moq: round(moqScore),
    commercial: round(commercialScore),
  };
  const score = Math.round(
    costScore * 0.45 +
      qualityScore * 0.25 +
      leadTimeScore * 0.15 +
      moqScore * 0.1 +
      commercialScore * 0.05,
  );

  const risks: string[] = [];
  if (quote.economics.stressProfitCents <= 0) risks.push("压力情景不盈利");
  if (quote.landedDeltaCents > 0) risks.push(`到岸成本高于当前模型 $${(quote.landedDeltaCents / 100).toFixed(2)}`);
  if (qualityScore < 60) risks.push("质量评分低于 60");
  if ((quote.leadTimeDays ?? 60) > 45) risks.push("交期超过 45 天");
  if (quote.moq > 1000) risks.push("MOQ 超过 1,000");
  if (!quote.certifications.trim()) risks.push("认证信息未填写");

  return {
    ...quote,
    score,
    scoreBreakdown,
    risks,
    isEligible: quote.economics.stressProfitCents > 0 && qualityScore >= 50,
  };
}

function compareQuotes(a: Omit<ScoredSupplierQuote, "isPreferred">, b: Omit<ScoredSupplierQuote, "isPreferred">) {
  return b.score - a.score || a.landedCostCents - b.landedCostCents || (a.leadTimeDays ?? 60) - (b.leadTimeDays ?? 60);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
