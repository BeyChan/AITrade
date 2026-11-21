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

export type CompetitorFulfillmentType = "amazon_1p" | "fba" | "fbm" | "unknown";

export type RatingDistribution = {
  star5?: number;
  star4?: number;
  star3?: number;
  star2?: number;
  star1?: number;
};

export type AttributeMatrixTier =
  | "baseline"
  | "premium_differentiator"
  | "vacuum_opportunity";

export type AttributeMatrixDimension = {
  key: string;
  label: string;
  tier: AttributeMatrixTier;
  insight: string;
  valuesByAsin: Record<string, string>;
};

export type ActionablePainCategory =
  | "structural_design"
  | "packaging_accessories"
  | "expectation_mgmt"
  | "physical_limit";

export type ActionablePainPoint = {
  pain: string;
  category: ActionablePainCategory;
  frequency: "high" | "medium" | "low";
  costToFix: "low" | "medium" | "high" | "unfixable";
  solution: string;
  sourceAsins?: string[];
  sourceQuote?: string;
};

export type MarketSignalsSummary = {
  sponsoredCount: number;
  sponsoredRatioPercent: number;
  amazon1pCount: number;
  couponCount: number;
  avgDiscountPercent: number;
  verifiedSalesCount: number;
  brandCr3Percent: number;
  topBrands: Array<{ brand: string; count: number; sharePercent: number }>;
  darkHorseAsins: string[];
};

export type SnapshotDiff = {
  previousReportId: string;
  previousCapturedAt: string;
  avgPriceDeltaPercent: number | null;
  p50PriceDeltaCents: number | null;
  newAsins: string[];
  droppedAsins: string[];
  reviewSurges: Array<{ asin: string; title: string; deltaReviews: number }>;
  alerts: string[];
};

export type CompetitorInputItem = {
  raw: string; // URL, ASIN or title
  asin?: string;
  url?: string;
  title?: string;
  brand?: string;
  /** 浏览器扩展采集到的真实数值，服务端不得用 AI 结果覆盖 */
  captured?: Partial<Record<CompetitorNumericField, number>> & {
    currency?: string;
    bullets?: string[];
    criticalReviews?: string[];
    boughtPastMonth?: number;
    isSponsored?: boolean;
    couponText?: string;
    effectivePriceCents?: number;
    /** 买家另付的单独运费（不含免运费；单位：分） */
    shippingCents?: number;
    listPriceCents?: number;
    imageUrl?: string;
    fulfillmentType?: CompetitorFulfillmentType;
    dateFirstAvailable?: string;
    dimensionsText?: string;
    ratingDistribution?: RatingDistribution;
  };
};

export type CompetitorSourcingCost = {
  /** 1688 实采参考单价（中位价，RMB） */
  actualCny: number;
  minCny?: number;
  maxCny?: number;
  sampleCount: number;
  bestSupplierName?: string;
  bestOfferUrl?: string;
  updatedAt: string;
};

export type CompetitorProfile = {
  id: string;
  asin: string;
  title: string;
  brand: string;
  sourceUrl: string;
  priceCents: number;
  /** 券后真实到手价（若页面存在 Coupon 则自动扣减；无 Coupon 时等于 priceCents） */
  effectivePriceCents?: number;
  /** 买家另付的单独运费（如 +$9.99 delivery；单位：分，0/空表示免邮） */
  shippingCents?: number;
  listPriceCents?: number;
  couponText?: string;
  currency: string;
  rating: number;
  reviewCount: number;
  bsr: number;
  monthlySalesEst: number;
  /** Amazon 前台「X+ bought in past month」真实月销下限 */
  boughtPastMonth?: number;
  isSponsored?: boolean;
  imageUrl?: string;
  fulfillmentType?: CompetitorFulfillmentType;
  dateFirstAvailable?: string;
  dimensionsText?: string;
  ratingDistribution?: RatingDistribution;
  /** 原始采集五点与差评，供 UI 溯源 */
  capturedBullets?: string[];
  capturedReviews?: string[];
  /** 1688 实采回补进价（RMB） */
  sourcingCost?: CompetitorSourcingCost;
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

export type CompetitorAIConclusion = {
  verdict: "GO" | "HOLD" | "NO-GO";
  headline: string;
  summary: string;
  bestCandidateAsin?: string | null;
  keyRisks: string[];
  recommendedActions: string[];
  generatedAt: string;
  modelUsed: string;
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
  /** 对齐式横向属性对比矩阵（全员标配 / 溢价点 / 真空机会） */
  attributeMatrix?: AttributeMatrixDimension[];
  /** 差评可改良性分级矩阵（结构设计 / 配件包装 / 预期管理 / 物理限制） */
  painPointMatrix?: ActionablePainPoint[];
  /** 市场微观信号（广告密度、1P自营占比、Coupon折扣、品牌集中度、黑马新品） */
  marketSignals?: MarketSignalsSummary;
  /** 与上一次同指纹采集快照的差异预警 */
  snapshotDiff?: SnapshotDiff | null;
  /** 用户在四象限或对比表中选定的主攻标杆 ASIN */
  targetBenchmarkAsin?: string | null;
  /** 用户手动触发生成的 AI 综合结论（默认无，绝不自动生成） */
  aiConclusion?: CompetitorAIConclusion | null;
  productIndex?: import("./competitiveness").ProductIndexScore;
  /** 整体来源；新增报告必须显式写入 */
  provenance: CompetitorProvenance;
  /** 采集 / AI 生成的报告默认待确认，确认后才允许写入商品草稿 */
  reviewStatus: CompetitorReviewStatus;
  /** 已转为商品案卷 (Case) 的关联 ID，用于幂等防重与业务流转闭环 */
  promotedCaseId?: string | null;
  /** 正式立项转入时间 */
  promotedAt?: string | null;
};
