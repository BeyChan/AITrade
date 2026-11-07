export type CompetitorPlatform = "amazon" | "ebay" | "tiktok_shop" | "shopify" | "general";

/** 本地研报保留上限，storage 与界面共用同一口径 */
export const MAX_COMPARISON_REPORTS = 30;

/**
 * 证据来源分级。只有 captured（浏览器前台采集）与 manual（人工录入）
 * 属于可参与价格分位与门禁计算的真实观察值；其余一律视为待核实。
 */
export type CompetitorProvenance =
  | "captured"
  | "manual"
  | "ai_generated"
  | "template"
  | "demo"
  | "unknown";

export type CompetitorReviewStatus = "pending" | "confirmed";

export type CompetitorNumericField =
  | "priceCents"
  | "rating"
  | "reviewCount"
  | "bsr"
  | "monthlySalesEst";

export type CompetitorInputItem = {
  raw: string; // URL, ASIN or title
  asin?: string;
  url?: string;
  title?: string;
  /** 浏览器扩展采集到的真实数值，服务端不得用 AI 结果覆盖 */
  captured?: Partial<Record<CompetitorNumericField, number>> & {
    currency?: string;
    bullets?: string[];
    criticalReviews?: string[];
  };
};

export type CompetitorProfile = {
  id: string;
  asin: string;
  title: string;
  brand: string;
  sourceUrl: string;
  priceCents: number;
  currency: string;
  rating: number;
  reviewCount: number;
  bsr: number;
  monthlySalesEst: number;
  pricePosition?: "budget" | "mid_market" | "premium";
  features: string[]; // 核心特点与亮点
  drawbacks: string[]; // 致命缺点与差评痛点
  specifications: Record<string, string>; // 核心参数 (例如 电池容量, 材质, 尺寸)
  targetAudience: string; // 目标人群与场景
  verdict: string; // AI 对该单品的简评
  /** 每个数值字段的来源；缺失即 unknown，UI 必须标「待核实」 */
  fieldProvenance?: Partial<Record<CompetitorNumericField, CompetitorProvenance>>;
};

export const COMPETITOR_NUMERIC_FIELDS: CompetitorNumericField[] = [
  "priceCents",
  "rating",
  "reviewCount",
  "bsr",
  "monthlySalesEst",
];

/** 单个数值是否来自真实观察（可进分位 / 门禁） */
export function isVerifiedCompetitorField(
  profile: Pick<CompetitorProfile, "fieldProvenance">,
  field: CompetitorNumericField,
): boolean {
  const source = profile.fieldProvenance?.[field] ?? "unknown";
  return source === "captured" || source === "manual";
}

/** 报告内所有数值字段是否均为待核实 */
export function isReportEstimated(report: Pick<CompetitorComparisonReport, "priceStats">): boolean {
  return report.priceStats.verifiedSampleCount === 0;
}

export type ComparisonPriceStats = {
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  currency: string;
  /** 参与分位计算的真实观察样本数；0 表示分位仅为示意，不可用于定价 */
  verifiedSampleCount: number;
};

export type CompetitorComparisonReport = {
  id: string;
  title: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  createdAt: string;
  rawInputs: string[];
  competitors: CompetitorProfile[];
  priceStats: ComparisonPriceStats;
  summary: {
    marketMaturity: "emerging" | "growth" | "mature" | "saturated"; // 市场饱和度
    commonStrengths: string[]; // 竞品共有护城河
    commonWeaknesses: string[]; // 行业通病与差评机会缺口
    marketVacuum: string; // 市场空白点
    attackVector: string; // 针对性破局切入策略建议
  };
  sourcingAction: {
    recommendedKeywords1688: string[];
    suggestedCostCents: number;
    targetMarginPercent: number;
  };
  hypothesisBridge?: {
    category: string;
    concept: string;
    painPoint: string;
    differentiator: string;
    recommendedPriceCents: number;
  };
  productIndex?: import("./competitiveness").ProductIndexScore;
  /** 整体来源；新增报告必须显式写入 */
  provenance: CompetitorProvenance;
  /** 采集 / AI 生成的报告默认待确认，确认后才允许写入商品草稿 */
  reviewStatus: CompetitorReviewStatus;
};
