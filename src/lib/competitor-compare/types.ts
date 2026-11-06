export type CompetitorPlatform = "amazon" | "ebay" | "tiktok_shop" | "shopify" | "general";

export type CompetitorInputItem = {
  raw: string; // URL, ASIN or title
  asin?: string;
  url?: string;
  title?: string;
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
};

export type ComparisonPriceStats = {
  min: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
  currency: string;
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
};
