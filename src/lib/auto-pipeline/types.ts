import type { SourcingFunnelThresholds } from "../sourcing-funnel.ts";
import type { ProductComplianceAttribute } from "../prelaunch-compliance.ts";
import type { SourcingGrade } from "../sourcing-grade.ts";

export type AutoGrade = SourcingGrade;

/**
 * 类型层面严格禁止自动签发正式 GO：
 * 只有人工补录真实报价并完成定标后，才由既有决策门禁产出 verified GO。
 */
export type AutoCandidateVerdict = "HOLD" | "NO-GO" | "PENDING";

export type AutoSourceType = "csv" | "extension" | "inbox" | "api";

export type DeliveryMethodCode =
  | "flatfile_tsv"
  | "shopify_csv"
  | "extension_autofill"
  | "api_draft";

export type PlatformEconomicsDefaults = {
  referralRate: number;
  fbaFeeRate: number;
  fbaFeeMinCents: number;
  adRate: number;
  returnRate: number;
  /** 无真实报价时用于快筛估算的到岸成本占售价比例（仅作 provisional 估算，不作定标依据） */
  estimatedLandedCostRatio: number;
  targetMarginRate: number;
};

export type AutoGradingThresholds = SourcingFunnelThresholds & {
  sGradeMinMargin: number;
  sGradeMinScore: number;
  aGradeMinMargin: number;
  aGradeMinScore: number;
  minPriceCents: number;
  maxPriceCents: number;
};

export type PlatformPipelineConfig = {
  id: string;
  platformCode: string;
  marketCode: string;
  currency: string;
  enabled: boolean;
  label: string;
  economicsDefaults: PlatformEconomicsDefaults;
  thresholds: AutoGradingThresholds;
  deliveryMethods: DeliveryMethodCode[];
  inboxDir: string | null;
  updatedAt?: string;
};

/**
 * 平台无关的标准候选品输入种子：
 * 无论是 CSV、Chrome 扩展、本地收件箱还是未来的 Keepa/官方 API，
 * 全部归一化为此结构后进入同一条选品流水线。
 */
export type NormalizedCandidateSeed = {
  platformCode: string;
  marketCode: string;
  externalId: string;
  title: string;
  brand?: string;
  category?: string;
  url?: string;
  currency: string;
  priceCents: number;
  monthlySalesEstimate?: number;
  reviewCount?: number;
  rating?: number | null;
  isSponsored?: boolean;
  complianceAttrs?: ProductComplianceAttribute[];
  evidenceSource?: "real" | "ai_generated";
  observedAt?: string;
  rawMeta?: Record<string, unknown>;
};

export type AutoCandidateReason = {
  code: string;
  severity: "pass" | "warn" | "fail";
  message: string;
};

export type AutoCandidateResult = {
  id: string;
  runId: string;
  platformCode: string;
  marketCode: string;
  externalId: string;
  title: string;
  brand: string;
  category: string;
  url: string;
  currency: string;
  priceCents: number;
  monthlySalesEstimate: number;
  reviewCount: number;
  rating: number | null;
  grade: AutoGrade;
  verdict: AutoCandidateVerdict;
  score: number;
  estimatedMarginRate: number;
  maxLandedCostCents: number;
  maxLandedCostCny: number;
  pricingSource: "estimated";
  evidenceSource: "real" | "ai_generated";
  reasons: AutoCandidateReason[];
  metrics: {
    netProfitCents: number;
    stressProfitCents: number;
    breakEvenAcos: number;
    competitorCount: number;
    hhi: number | null;
    brandCr3Percent: number | null;
    medianReviews: number | null;
    complianceCostUsd: number;
    complianceStatus: string;
    marketStatus: string;
  };
  promotedCaseId: string | null;
  observedAt: string;
  updatedAt?: string;
};

export type AutoPipelineRunSummary = {
  id: string;
  platformCode: string;
  marketCode: string;
  sourceType: AutoSourceType;
  sourceLabel: string;
  status: "running" | "completed" | "failed";
  totalSeeds: number;
  sCount: number;
  aCount: number;
  bCount: number;
  holdCount: number;
  eliminatedCount: number;
  errorMessage?: string | null;
  createdBy: string;
  createdAt: string;
  completedAt?: string | null;
};
