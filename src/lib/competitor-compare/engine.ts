import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import type { AppMode } from "../app-mode.ts";
import { extractTitleFromUrl, inferBrandFromTitle, parseCompetitorInputs } from "./parser.ts";
import { calculateProductIndex } from "./competitiveness.ts";
import {
  COMPETITOR_NUMERIC_FIELDS,
  isVerifiedCompetitorField,
  type ActionablePainPoint,
  type AttributeMatrixDimension,
  type ComparisonPriceStats,
  type CompetitorComparisonReport,
  type CompetitorInputItem,
  type CompetitorNumericField,
  type CompetitorProfile,
  type CompetitorProvenance,
  type MarketSignalsSummary,
} from "./types.ts";

type PriceSample = Pick<CompetitorProfile, "priceCents" | "effectivePriceCents" | "fieldProvenance">;

type CapturedValues = NonNullable<CompetitorInputItem["captured"]>;

/**
 * 解析 Amazon Coupon 文案计算券后实付价：
 * - 百分比折扣（如 "Save 20% with coupon"）：按比例扣减（上限 60% 防异常文案）
 * - 明确立减金额（如 "Save $5.00" / "$5 off"）：从原价扣减（且折扣不超过原价 60%）
 * - 券后直接标价（如 "$18.99 with coupon" 或裸金额 "$18.99" 且接近原价）：直接视为券后实付价，绝不把 19.99 - 18.99 误算成 1.00！
 */
export function computeEffectivePriceCents(
  priceCents: number,
  couponText?: string,
  explicitEffectiveCents?: number,
): number {
  if (typeof explicitEffectiveCents === "number" && Number.isFinite(explicitEffectiveCents) && explicitEffectiveCents > 0) {
    // 防止历史错误缓存的离谱低价（如 19.99 算成 1.00）在重新分析时被沿用
    if (!couponText || explicitEffectiveCents >= priceCents * 0.4) {
      return Math.round(explicitEffectiveCents);
    }
  }
  if (!priceCents || priceCents <= 0 || !couponText) return priceCents;

  const pctMatch = couponText.match(/(\d{1,2})\s*%/);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    if (Number.isFinite(pct) && pct > 0 && pct <= 60) {
      return Math.max(1, Math.round(priceCents * (1 - pct / 100)));
    }
    return priceCents;
  }

  const amountMatch = couponText.match(/(?:A\$|CA\$|S\$|\$|£|€|¥)\s*(\d+(?:\.\d{1,2})?)/i);
  if (amountMatch) {
    const amountCents = Math.round(Number(amountMatch[1]) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents >= priceCents) {
      return priceCents;
    }
    const isExplicitDiscount = /(?:save|off|discount|rabatt|省|立减|减)/i.test(couponText);
    const isFinalCouponPrice = /(?:with\s+coupon|after\s+coupon|final\s+price)/i.test(couponText) && !isExplicitDiscount;
    if (isExplicitDiscount && amountCents <= priceCents * 0.6) {
      return priceCents - amountCents;
    }
    // 裸金额（如 "$18.99"）或 "$18.99 with coupon"：若在原价 40%~99% 区间内，代表券后到手价而非减免额
    if ((isFinalCouponPrice || !isExplicitDiscount) && amountCents >= priceCents * 0.4) {
      return amountCents;
    }
  }
  return priceCents;
}

/** 把浏览器采集到的真实数值标成 captured，其余字段标记推断来源 */
function fieldProvenanceFor(
  inferred: CompetitorProvenance,
  captured: CapturedValues | undefined,
): NonNullable<CompetitorProfile["fieldProvenance"]> {
  const result: NonNullable<CompetitorProfile["fieldProvenance"]> = {};
  for (const field of COMPETITOR_NUMERIC_FIELDS) {
    const hasDirect = captured ? typeof captured[field] === "number" && Number.isFinite(captured[field]) && (captured[field] as number) > 0 : false;
    const hasBought = field === "monthlySalesEst" && typeof captured?.boughtPastMonth === "number" && captured.boughtPastMonth > 0;
    result[field] = (hasDirect || hasBought) ? "captured" : inferred;
  }
  return result;
}

/** 采集值优先，AI / 模板不得覆盖真实观察值 */
function numericValue(
  field: CompetitorNumericField,
  inferred: unknown,
  fallback: number,
  captured: CapturedValues | undefined,
): number {
  const normalize = (value: number) => field === "rating"
    ? Math.round(value * 10) / 10
    : Math.round(value);
  if (field === "monthlySalesEst" && typeof captured?.boughtPastMonth === "number" && captured.boughtPastMonth > 0) {
    return normalize(captured.boughtPastMonth);
  }
  const observed = captured?.[field];
  if (typeof observed === "number" && Number.isFinite(observed) && observed > 0) return normalize(observed);
  const parsed = Number(inferred);
  return Number.isFinite(parsed) && parsed > 0 ? normalize(parsed) : fallback;
}

function calculatePriceStats(profiles: PriceSample[], currency: string): ComparisonPriceStats {
  const verifiedPrices = profiles
    .filter((p) => isVerifiedCompetitorField(p, "priceCents"))
    .map((p) => (p.effectivePriceCents && p.effectivePriceCents > 0 ? p.effectivePriceCents : p.priceCents))
    .filter((n) => Number.isFinite(n) && n > 0);
  // 严格只用真实已采集/人工核实的价格样本算分位；没有任何真实价格时返回全 0，绝不编造假 P50 误导定价。
  if (verifiedPrices.length === 0) {
    return { min: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, currency, verifiedSampleCount: 0 };
  }
  const sorted = [...verifiedPrices].sort((a, b) => a - b);
  const getPercentile = (p: number) => {
    if (sorted.length === 1) return sorted[0]!;
    const idx = (sorted.length - 1) * p;
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    const weight = idx - lower;
    return Math.round(sorted[lower]! * (1 - weight) + sorted[upper]! * weight);
  };

  return {
    min: sorted[0]!,
    p25: getPercentile(0.25),
    p50: getPercentile(0.5),
    p75: getPercentile(0.75),
    p90: getPercentile(0.9),
    max: sorted[sorted.length - 1]!,
    currency,
    verifiedSampleCount: verifiedPrices.length,
  };
}

/** 从真实采集到的微观字段汇总市场格局信号（零臆造） */
export function computeMarketSignals(competitors: CompetitorProfile[]): MarketSignalsSummary {
  const total = competitors.length || 1;
  const sponsoredCount = competitors.filter((c) => c.isSponsored).length;
  const amazon1pCount = competitors.filter((c) => c.fulfillmentType === "amazon_1p").length;

  let couponCount = 0;
  const discountPcts: number[] = [];
  for (const c of competitors) {
    const hasCoupon = Boolean(c.couponText) || (c.effectivePriceCents && c.priceCents > 0 && c.effectivePriceCents < c.priceCents);
    if (hasCoupon) {
      couponCount += 1;
      if (c.effectivePriceCents && c.priceCents > 0 && c.effectivePriceCents < c.priceCents) {
        discountPcts.push(((c.priceCents - c.effectivePriceCents) / c.priceCents) * 100);
      }
    }
  }
  const avgDiscountPercent = discountPcts.length > 0
    ? Math.round(discountPcts.reduce((a, b) => a + b, 0) / discountPcts.length)
    : 0;

  const verifiedSalesCount = competitors.filter(
    (c) => (typeof c.boughtPastMonth === "number" && c.boughtPastMonth > 0)
      || (isVerifiedCompetitorField(c, "monthlySalesEst") && c.monthlySalesEst > 0),
  ).length;

  // 品牌坑位分布与 CR3
  const brandCounts = new Map<string, { display: string; count: number }>();
  for (const c of competitors) {
    const raw = (c.brand || "").trim();
    if (!raw || /^(待确认品牌|未知品牌|品牌|unknown|n\/a|generic|—|-)$/i.test(raw)) continue;
    const key = raw.toLowerCase();
    const prev = brandCounts.get(key);
    if (prev) prev.count += 1;
    else brandCounts.set(key, { display: raw, count: 1 });
  }
  const topBrands = [...brandCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((b) => ({
      brand: b.display,
      count: b.count,
      sharePercent: Math.round((b.count / total) * 100),
    }));
  const brandCr3Percent = Math.min(100, topBrands.slice(0, 3).reduce((sum, b) => sum + b.sharePercent, 0));

  // 黑马新品识别：真实评论 ≤ 300 且 有真实月销 ≥ 100（或近 12 个月上架）
  const nowMs = Date.now();
  const darkHorseAsins = competitors
    .filter((c) => {
      const hasLowReviews = isVerifiedCompetitorField(c, "reviewCount") && c.reviewCount > 0 && c.reviewCount <= 300;
      const hasRealSales = (typeof c.boughtPastMonth === "number" && c.boughtPastMonth >= 100)
        || (isVerifiedCompetitorField(c, "monthlySalesEst") && c.monthlySalesEst >= 100);
      let isRecentLaunch = false;
      if (c.dateFirstAvailable) {
        const parsedMs = Date.parse(c.dateFirstAvailable);
        if (Number.isFinite(parsedMs) && nowMs - parsedMs <= 365 * 24 * 3600 * 1000) {
          isRecentLaunch = true;
        }
      }
      return (hasLowReviews && hasRealSales) || (isRecentLaunch && (hasRealSales || hasLowReviews));
    })
    .map((c) => c.asin);

  return {
    sponsoredCount,
    sponsoredRatioPercent: Math.round((sponsoredCount / total) * 100),
    amazon1pCount,
    couponCount,
    avgDiscountPercent,
    verifiedSalesCount,
    brandCr3Percent,
    topBrands,
    darkHorseAsins,
  };
}

/** 免模型 / 兜底模式下，用真实抓到的字段构建对齐式属性对比矩阵 */
function buildDeterministicAttributeMatrix(
  competitors: CompetitorProfile[],
  currency: string,
): AttributeMatrixDimension[] {
  if (competitors.length < 2) return [];
  const dims: AttributeMatrixDimension[] = [];

  const formatMoney = (cents: number) => cents > 0 ? `${(cents / 100).toFixed(2)} ${currency}` : "未采集";

  const priceVals: Record<string, string> = {};
  let hasCoupon = false;
  for (const c of competitors) {
    if (!isVerifiedCompetitorField(c, "priceCents") || c.priceCents <= 0) {
      priceVals[c.asin] = "未采集";
      continue;
    }
    const parts: string[] = [formatMoney(c.priceCents)];
    if (c.listPriceCents && c.listPriceCents > c.priceCents) {
      const offPct = Math.round(((c.listPriceCents - c.priceCents) / c.listPriceCents) * 100);
      parts.push(`原价 ${formatMoney(c.listPriceCents)} -${offPct}%`);
    }
    const eff = c.effectivePriceCents && c.effectivePriceCents > 0 && c.effectivePriceCents < c.priceCents
      ? c.effectivePriceCents
      : 0;
    if (eff > 0) {
      hasCoupon = true;
      const savePct = Math.round(((c.priceCents - eff) / c.priceCents) * 100);
      parts.push(`券后 ${formatMoney(eff)} -${savePct}%`);
    }
    priceVals[c.asin] = parts.join(" · ");
  }
  dims.push({
    key: "effective_price",
    label: "前台售价",
    tier: "baseline",
    insight: hasCoupon ? "展示前台实际售价；有划线原价或 Coupon 优惠券时同步附注。" : "各竞品前台真实售价分布。",
    valuesByAsin: priceVals,
  });

  if (competitors.some((c) => (c.boughtPastMonth ?? 0) > 0)) {
    const salesVals: Record<string, string> = {};
    for (const c of competitors) {
      salesVals[c.asin] = c.boughtPastMonth && c.boughtPastMonth > 0 ? `${c.boughtPastMonth.toLocaleString()}+ / 月` : "未显示";
    }
    dims.push({
      key: "bought_past_month",
      label: "官方月销下限",
      tier: "baseline",
      insight: "Amazon 前台显示的近 30 天真实销量下限。",
      valuesByAsin: salesVals,
    });
  }

  if (competitors.some((c) => c.fulfillmentType && c.fulfillmentType !== "unknown")) {
    const fulfLabel = (t?: string) =>
      t === "amazon_1p" ? "Amazon 自营 (1P)" : t === "fba" ? "FBA 配送" : t === "fbm" ? "FBM 自发" : "未抓到";
    const fulfVals: Record<string, string> = {};
    for (const c of competitors) fulfVals[c.asin] = fulfLabel(c.fulfillmentType);
    dims.push({
      key: "fulfillment",
      label: "履约与卖家归属",
      tier: "baseline",
      insight: "识别 Amazon 1P 自营与 FBA/FBM 格局。",
      valuesByAsin: fulfVals,
    });
  }

  if (competitors.some((c) => Boolean(c.dimensionsText))) {
    const dimVals: Record<string, string> = {};
    for (const c of competitors) dimVals[c.asin] = c.dimensionsText || "未抓到";
    dims.push({
      key: "dimensions",
      label: "产品/包装尺寸",
      tier: "premium_differentiator",
      insight: "用于评估 FBA 尺寸分段与头程抛货成本。",
      valuesByAsin: dimVals,
    });
  }

  if (competitors.some((c) => Boolean(c.dateFirstAvailable))) {
    const dateVals: Record<string, string> = {};
    for (const c of competitors) dateVals[c.asin] = c.dateFirstAvailable || "未抓到";
    dims.push({
      key: "launch_date",
      label: "上架时间",
      tier: "vacuum_opportunity",
      insight: "验证近期新品能否冲进首页（新品存活率）。",
      valuesByAsin: dateVals,
    });
  }

  return dims;
}

const FX_TO_CNY: Record<string, number> = {
  USD: 7.25,
  EUR: 7.8,
  GBP: 9.1,
  JPY: 0.048,
  AUD: 4.7,
  CAD: 5.2,
  SGD: 5.4,
  MYR: 1.65,
  CNY: 1,
};

function resolveCapturedEntry(
  item: CompetitorInputItem,
  list: CompetitorInputItem[] | undefined,
  index: number,
): CompetitorInputItem | undefined {
  if (!list || list.length === 0) return undefined;
  const matched = list.find((entry) =>
    (item.asin && entry.asin && entry.asin.toUpperCase() === item.asin.toUpperCase())
    || (item.url && entry.url && entry.url === item.url),
  );
  return matched ?? (list.length === 1 && index === 0 ? list[0] : undefined);
}

/** 按 ASIN / URL 匹配浏览器采集值；只采到一条时默认作用于首个商品 */
function resolveCaptured(
  item: CompetitorInputItem,
  list: CompetitorInputItem[] | undefined,
  index: number,
): CapturedValues | undefined {
  return resolveCapturedEntry(item, list, index)?.captured;
}

function truncateCleanly(text: string, maxLen = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  const safe = lastSpace > maxLen * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${safe.replace(/[,;:.\-\s]+$/, "")}…`;
}

function build1688Keywords(evidenceText: string, primaryTitle: string): string[] {
  const kwMatch = evidenceText.match(/Search Keyword:\s*(.+)/i);
  const searchKw = kwMatch?.[1]?.trim();
  const isCleanKw = searchKw && !/^https?:\/\//i.test(searchKw) && !searchKw.startsWith("多品深度对比");
  if (isCleanKw) {
    return [`${searchKw} 源头工厂`, `${searchKw} 外贸批发`];
  }
  const cleanTitle = /^https?:\/\//i.test(primaryTitle) ? "" : primaryTitle;
  const coreWords = cleanTitle
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 4)
    .join(" ");
  if (coreWords) {
    return [`${coreWords} 工厂`, "跨境现货批发"];
  }
  return ["跨境源头工厂", "外贸现货批发"];
}

function extractCapturedExtras(captured: CapturedValues | undefined, priceCents: number) {
  const couponText = captured?.couponText?.trim() || undefined;
  const effectivePriceCents = priceCents > 0
    ? computeEffectivePriceCents(priceCents, couponText, captured?.effectivePriceCents)
    : undefined;
  return {
    ...(effectivePriceCents && effectivePriceCents > 0 ? { effectivePriceCents } : {}),
    ...(typeof captured?.shippingCents === "number" && captured.shippingCents > 0 ? { shippingCents: Math.round(captured.shippingCents) } : {}),
    ...(captured?.listPriceCents && captured.listPriceCents > 0 ? { listPriceCents: Math.round(captured.listPriceCents) } : {}),
    ...(couponText ? { couponText } : {}),
    ...(typeof captured?.boughtPastMonth === "number" && captured.boughtPastMonth > 0 ? { boughtPastMonth: Math.round(captured.boughtPastMonth) } : {}),
    ...(typeof captured?.isSponsored === "boolean" ? { isSponsored: captured.isSponsored } : {}),
    ...(captured?.imageUrl ? { imageUrl: captured.imageUrl } : {}),
    ...(captured?.fulfillmentType ? { fulfillmentType: captured.fulfillmentType } : {}),
    ...(captured?.dateFirstAvailable ? { dateFirstAvailable: captured.dateFirstAvailable } : {}),
    ...(captured?.dimensionsText ? { dimensionsText: captured.dimensionsText } : {}),
    ...(captured?.ratingDistribution ? { ratingDistribution: captured.ratingDistribution } : {}),
    ...(captured?.bullets && captured.bullets.length > 0 ? { capturedBullets: captured.bullets } : {}),
    ...(captured?.criticalReviews && captured.criticalReviews.length > 0 ? { capturedReviews: captured.criticalReviews } : {}),
  };
}

export async function analyzeCompetitors(input: {
  rawInputs: string;
  marketCode?: string;
  platformCode?: string;
  currency?: string;
  skipModel?: boolean;
  /** 浏览器扩展在前台采集到的真实数值，优先级高于 AI / 模板推断 */
  capturedInputs?: CompetitorInputItem[];
  /** 采集到的搜索词等上下文文本，只作为分析素材，不参与条目拆分 */
  evidenceText?: string;
  mode?: AppMode;
}): Promise<CompetitorComparisonReport> {
  const marketCode = (input.marketCode || "US").toUpperCase();
  const platformCode = (input.platformCode || "amazon").toLowerCase();
  const currency = input.currency || (marketCode === "GB" ? "GBP" : marketCode === "DE" ? "EUR" : marketCode === "JP" ? "JPY" : marketCode === "AU" ? "AUD" : "USD");

  const parsedInputs = parseCompetitorInputs(input.rawInputs);
  const inputStrings = parsedInputs.map((p) => p.url || p.asin || p.title || p.raw);

  const capturedBullets = (input.capturedInputs ?? []).flatMap((item) => item.captured?.bullets ?? []);
  const capturedReviews = (input.capturedInputs ?? []).flatMap((item) => item.captured?.criticalReviews ?? []);
  const evidenceText = (input.evidenceText ?? "").trim();

  // 整理传入的商品基础条目（优先合并 Chrome 扩展抓回的真实标题与品牌）
  const rawProducts = parsedInputs.map((item, idx) => {
    const capturedEntry = resolveCapturedEntry(item, input.capturedInputs, idx);
    let brand = "待确认品牌";
    let title = (capturedEntry?.title && capturedEntry.title.trim()) || item.title || item.raw;
    const asin = item.asin || capturedEntry?.asin || `B0${Date.now().toString(36).slice(2, 10).toUpperCase()}`;
    const cleanUrl = item.url || capturedEntry?.url || `https://www.amazon.com/dp/${asin}`;

    const urlMeta = extractTitleFromUrl(item.raw.startsWith("http") ? item.raw : cleanUrl);
    if ((!title || /^https?:\/\//i.test(title)) && urlMeta.title) {
      title = urlMeta.title;
    }
    if (capturedEntry?.brand && capturedEntry.brand.trim()) {
      brand = capturedEntry.brand.trim();
    } else if (urlMeta.brand) {
      brand = urlMeta.brand;
    } else {
      const fromTitle = inferBrandFromTitle(title);
      if (fromTitle) brand = fromTitle;
    }

    return {
      asin,
      title: /^https?:\/\//i.test(title) ? `Amazon 商品 (${asin})` : title,
      brand,
      url: cleanUrl,
      rawInput: item.raw,
      index: idx,
      captured: resolveCaptured(item, input.capturedInputs, idx),
    };
  });
  const hasCapturedData = rawProducts.some((product) =>
    product.captured && (
      COMPETITOR_NUMERIC_FIELDS.some((field) => typeof product.captured?.[field] === "number" && (product.captured[field] as number) > 0)
      || (typeof product.captured.boughtPastMonth === "number" && product.captured.boughtPastMonth > 0)
    ),
  );

  // 1. 交给 AI 进行端到端智能识别与对比（按 ASIN 严格隔离各自证据，绝不串台）
  const isTest = process.env.NODE_ENV === "test";
  const shouldTryModel = !input.skipModel && !isTest;
  const config = await loadAIProviderConfig({ mode: input.mode });

  if (shouldTryModel && config.provider !== "template") {
    try {
      const systemPrompt = `你是一位严谨的跨境电商高级竞品分析专家。
请阅读用户提供的每款竞品及其**绑定到该 ASIN 的真实页面证据**（五点描述、买家差评、规格尺寸、价格与销量信号）。
【事实红线】
1. 严禁编造售价、评分、评论数、销量、BSR 等可核查数值：输入里没有给出就输出 null，系统会标记为「未采集」，绝不补假数。
2. 每款竞品的 features / drawbacks 必须严格对应它自己的 bullets / criticalReviews，严禁把 A 商品的差评安到 B 商品头上。
3. 严禁编造认证、实验室测试次数、保修年限、倍数性能对比、绝对化宣传。

目标国家站点：${marketCode}，平台：${platformCode}，币种：${currency}。
只输出严格符合以下结构的合法 JSON：
{
  "title": "根据该具体品类生成的专业研报标题",
  "category": "AI 识别出的准确细分类目",
  "competitors": [
    {
      "asin": "商品ASIN",
      "title": "商品全名",
      "brand": "品牌名",
      "sourceUrl": "来源链接",
      "priceCents": null,
      "rating": null,
      "reviewCount": null,
      "bsr": null,
      "monthlySalesEst": null,
      "pricePosition": "budget" | "mid_market" | "premium",
      "features": ["基于该品五点/标题的2-3条核心亮点"],
      "drawbacks": ["基于该品真实差评的2-3条痛点；若未提供差评则注明待采集"],
      "specifications": { "核心规格1": "参数值" },
      "targetAudience": "目标人群与使用场景",
      "verdict": "一句话专业裁决诊断"
    }
  ],
  "attributeMatrix": [
    {
      "key": "dim_1",
      "label": "核心购买决策维度（如：材质工艺 / 电池续航 / 配件清单 / 便携尺寸）",
      "tier": "baseline" | "premium_differentiator" | "vacuum_opportunity",
      "insight": "一句话说明该维度是全员标配、高价溢价点还是市场真空",
      "valuesByAsin": { "ASIN1": "该品表现（无证据写「未提及」）" }
    }
  ],
  "painPointMatrix": [
    {
      "pain": "高频买家差评痛点（精炼一句话）",
      "category": "structural_design" | "packaging_accessories" | "expectation_mgmt" | "physical_limit",
      "frequency": "high" | "medium" | "low",
      "costToFix": "low" | "medium" | "high" | "unfixable",
      "solution": "可落地的改良动作（工程改料 / 加配件说明书 / 主图预期管理 / 合规避坑）",
      "sourceAsins": ["对应出现该差评的ASIN"],
      "sourceQuote": "摘自输入差评的简短原文依据（无则留空）"
    }
  ],
  "summary": {
    "marketMaturity": "emerging" | "growth" | "mature" | "saturated",
    "commonStrengths": ["该品类竞品共性长处"],
    "commonWeaknesses": ["该品类集中吐槽的差评机会缺口"],
    "marketVacuum": "市场空白点或未被满足的区间",
    "attackVector": "最推荐的差异化改良与破局切入策略"
  },
  "sourcingAction": {
    "recommendedKeywords1688": ["1688源头工厂中文搜索词1", "词2", "词3"],
    "suggestedCostCents": 0,
    "targetMarginPercent": 35
  },
  "hypothesisBridge": {
    "category": "细分类目",
    "concept": "改良商品概念",
    "painPoint": "直击的核心痛点",
    "differentiator": "差异化卖点",
    "recommendedPriceCents": 0
  }
}`;

      const aiResponse = await generateStructuredJSON({
        systemPrompt,
        userPrompt: JSON.stringify({
          inputs: rawProducts.map((p) => ({
            asin: p.asin,
            brand: p.brand,
            title: p.title,
            rawUrl: p.url,
            observedPriceCents: p.captured?.effectivePriceCents ?? p.captured?.priceCents ?? null,
            couponText: p.captured?.couponText ?? null,
            observedRating: p.captured?.rating ?? null,
            observedReviewCount: p.captured?.reviewCount ?? null,
            observedBoughtPastMonth: p.captured?.boughtPastMonth ?? null,
            isSponsored: p.captured?.isSponsored ?? null,
            fulfillmentType: p.captured?.fulfillmentType ?? null,
            dimensionsText: p.captured?.dimensionsText ?? null,
            dateFirstAvailable: p.captured?.dateFirstAvailable ?? null,
            bullets: p.captured?.bullets ?? [],
            criticalReviews: p.captured?.criticalReviews ?? [],
          })),
          marketCode,
          platformCode,
          currency,
          searchContext: evidenceText || undefined,
          note: "每款商品的 bullets 与 criticalReviews 已绑定在对应 inputs 条目下；严禁串台，未提供的数值字段必须输出 null。",
        }),
        timeoutMs: 35_000,
        maxTokens: 4_500,
      }, fetch, undefined, { mode: input.mode });

      const parsedJson = JSON.parse(aiResponse.content) as Partial<CompetitorComparisonReport> & {
        category?: string;
      };

      if (parsedJson.competitors && Array.isArray(parsedJson.competitors) && parsedJson.competitors.length > 0) {
        const byAsin = new Map(rawProducts.map((p) => [p.asin.toUpperCase(), p]));
        const competitors: CompetitorProfile[] = parsedJson.competitors.map((c, idx) => {
          const matchedRaw = (c.asin ? byAsin.get(c.asin.toUpperCase()) : undefined) ?? rawProducts[idx];
          const captured = matchedRaw?.captured;
          // 关键修复：AI 返回 null 且无采集值时，回退 0 而非编造 2999/4.3/800/1500/500
          const priceCents = numericValue("priceCents", c.priceCents, 0, captured);
          const extras = extractCapturedExtras(captured, priceCents);
          return {
            id: `c_${idx}_${Date.now()}`,
            asin: c.asin || matchedRaw?.asin || "ASIN",
            title: matchedRaw?.title && !/^Amazon 商品/.test(matchedRaw.title) ? matchedRaw.title : (c.title || matchedRaw?.title || "竞品"),
            brand: matchedRaw?.brand && matchedRaw.brand !== "待确认品牌" ? matchedRaw.brand : (c.brand || "待确认品牌"),
            sourceUrl: matchedRaw?.url || c.sourceUrl || "",
            priceCents,
            ...extras,
            currency,
            rating: numericValue("rating", c.rating, 0, captured),
            reviewCount: numericValue("reviewCount", c.reviewCount, 0, captured),
            bsr: numericValue("bsr", c.bsr, 0, captured),
            monthlySalesEst: numericValue("monthlySalesEst", c.monthlySalesEst, 0, captured),
            pricePosition: c.pricePosition || (idx === 0 ? "budget" : idx === 1 ? "mid_market" : "premium"),
            features: Array.isArray(c.features) && c.features.length > 0 ? c.features : ["待补充产品卖点"],
            drawbacks: Array.isArray(c.drawbacks) && c.drawbacks.length > 0 ? c.drawbacks : ["尚未采集该品买家差评"],
            specifications: c.specifications || {},
            targetAudience: c.targetAudience || "主流消费者",
            verdict: c.verdict || "表现均衡的主流竞品",
            fieldProvenance: fieldProvenanceFor("ai_generated", captured),
          };
        });

        const priceStats = calculatePriceStats(competitors, currency);
        const marketSignals = computeMarketSignals(competitors);
        const suggestedCostCents = priceStats.p50 > 0
          ? Math.round(priceStats.p50 * 0.25 * (FX_TO_CNY[currency] ?? 7.25))
          : (parsedJson.sourcingAction?.suggestedCostCents || 0);

        const attributeMatrix = Array.isArray(parsedJson.attributeMatrix) && parsedJson.attributeMatrix.length > 0
          ? parsedJson.attributeMatrix
          : buildDeterministicAttributeMatrix(competitors, currency);

        const painPointMatrix: ActionablePainPoint[] = Array.isArray(parsedJson.painPointMatrix)
          ? parsedJson.painPointMatrix.filter((p) => Boolean(p && p.pain))
          : [];

        const reportData = {
          id: `comp_cmp_${Date.now()}`,
          title: parsedJson.title || `${parsedJson.category || rawProducts[0]?.brand || "商品"} 竞品横向洞察研报`,
          marketCode,
          platformCode,
          currency,
          createdAt: new Date().toISOString(),
          rawInputs: inputStrings,
          competitors,
          priceStats,
          marketSignals,
          attributeMatrix,
          painPointMatrix,
          summary: parsedJson.summary || {
            marketMaturity: "mature",
            commonStrengths: ["主打实用高性价比"],
            commonWeaknesses: ["塑料配件耐用度一般"],
            marketVacuum: "中端高品质区间尚存空白",
            attackVector: "以中位价格打造升级用料与更优配件的差异化单品",
          },
          sourcingAction: {
            recommendedKeywords1688: parsedJson.sourcingAction?.recommendedKeywords1688?.length
              ? parsedJson.sourcingAction.recommendedKeywords1688
              : build1688Keywords(evidenceText, rawProducts[0]?.title || ""),
            suggestedCostCents,
            targetMarginPercent: parsedJson.sourcingAction?.targetMarginPercent || 35,
          },
          hypothesisBridge: parsedJson.hypothesisBridge
            ? {
                ...parsedJson.hypothesisBridge,
                recommendedPriceCents: priceStats.p50 > 0
                  ? priceStats.p50
                  : (parsedJson.hypothesisBridge.recommendedPriceCents || 0),
              }
            : undefined,
          provenance: (hasCapturedData ? "captured" : "ai_generated") as CompetitorProvenance,
          reviewStatus: "pending" as const,
        };

        return {
          ...reportData,
          productIndex: calculateProductIndex(reportData),
        };
      }
    } catch (err) {
      console.warn("AI 模型调用未完成，启用直通保底展示:", err);
    }
  }

  // 2. 免 Key / 无模型回退模式：只展示真实采集值；未采集到的数值一律置 0（待补录），绝不编造假价格与假销量。
  const primaryTitle = rawProducts[0]?.title || "对标商品";

  const generatedCompetitors: CompetitorProfile[] = rawProducts.map((item, idx) => {
    const realBullets = item.captured?.bullets?.filter(Boolean) ?? [];
    const realReviews = item.captured?.criticalReviews?.filter(Boolean) ?? [];
    const priceCents = numericValue("priceCents", undefined, 0, item.captured);
    const hasRealPrice = priceCents > 0;
    const extras = extractCapturedExtras(item.captured, priceCents);
    const effPrice = extras.effectivePriceCents ?? priceCents;

    return {
      id: `comp_${Date.now()}_${idx}`,
      asin: item.asin,
      title: item.title,
      brand: item.brand,
      sourceUrl: item.url,
      priceCents,
      ...extras,
      currency,
      rating: numericValue("rating", undefined, 0, item.captured),
      reviewCount: numericValue("reviewCount", undefined, 0, item.captured),
      bsr: numericValue("bsr", undefined, 0, item.captured),
      monthlySalesEst: numericValue("monthlySalesEst", undefined, 0, item.captured),
      fieldProvenance: fieldProvenanceFor("template", item.captured),
      pricePosition: hasRealPrice
        ? (effPrice < 2000 ? "budget" : effPrice > 4500 ? "premium" : "mid_market")
        : "mid_market",
      features: realBullets.length > 0
        ? realBullets.slice(0, 4).map((b) => truncateCleanly(b, 160))
        : ["尚未采集该商品五点描述（建议用 Chrome 插件打开详情页一键采集）"],
      drawbacks: realReviews.length > 0
        ? realReviews.slice(0, 4).map((r) => truncateCleanly(r, 180))
        : ["尚未采集该商品买家差评（未拿到真实评论前不编造痛点）"],
      specifications: {
        "ASIN": item.asin,
        "对标品牌": item.brand,
        ...(extras.dimensionsText ? { "尺寸规格": extras.dimensionsText } : {}),
        ...(extras.dateFirstAvailable ? { "上架时间": extras.dateFirstAvailable } : {}),
        "采集状态": hasRealPrice ? "已采集前台售价" : "待采集售价",
      },
      targetAudience: "待结合真实评论与类目特征确认",
      verdict: hasRealPrice
        ? "已采集前台真实价格，可结合下方毛利模型与评论痛点做横向对比。"
        : "当前仅导入链接/ASIN，缺少真实售价与评论数，请用 Chrome 插件采集或手工补录。",
    };
  });

  const priceStats = calculatePriceStats(generatedCompetitors, currency);
  const marketSignals = computeMarketSignals(generatedCompetitors);
  const attributeMatrix = buildDeterministicAttributeMatrix(generatedCompetitors, currency);
  const painPointMatrix: ActionablePainPoint[] = capturedReviews.slice(0, 4).map((quote) => ({
    pain: truncateCleanly(quote, 90),
    category: /pack|box|manual|instruction|missing|accessor/i.test(quote)
      ? "packaging_accessories"
      : /small|size|expect|photo|color|picture/i.test(quote)
        ? "expectation_mgmt"
        : "structural_design",
    frequency: "medium",
    costToFix: /pack|box|manual|instruction|missing|accessor/i.test(quote) ? "low" : "medium",
    solution: "配置 AI 模型后可自动生成工程级改良方案；当前已保留原差评供人工核对。",
    sourceQuote: truncateCleanly(quote, 140),
  }));

  const reportData = {
    id: `comp_cmp_${Date.now()}`,
    title: `${primaryTitle.slice(0, 30)} 竞品横向洞察研报`,
    marketCode,
    platformCode,
    currency,
    createdAt: new Date().toISOString(),
    rawInputs: inputStrings,
    competitors: generatedCompetitors,
    priceStats,
    marketSignals,
    attributeMatrix,
    painPointMatrix,
    summary: {
      marketMaturity: "mature" as const,
      commonStrengths: capturedBullets.length > 0
        ? capturedBullets.slice(0, 3).map((b) => b.slice(0, 120))
        : ["暂未采集到真实五点卖点，请通过 Chrome 插件打开商品详情页采集"],
      commonWeaknesses: capturedReviews.length > 0
        ? capturedReviews.slice(0, 3).map((text) => text.slice(0, 140))
        : ["暂未采集到真实买家差评，请通过 Chrome 插件采集或粘贴差评原文"],
      marketVacuum: priceStats.verifiedSampleCount >= 2
        ? "已收集多款真实价格样本，可结合四象限图识别高客单低评论切入带。"
        : "真实价格样本不足（需至少 2~3 款真实竞品售价），暂不输出定价空白结论。",
      attackVector: capturedReviews.length > 0
        ? `优先围绕已采集的真实差评痛点做结构改良，定价锚定真实中位价带。`
        : `请先用 Chrome 扩展采集 Amazon 搜索页 Top 20 或详情页差评，再生成反制策略。`,
    },
    sourcingAction: {
      recommendedKeywords1688: build1688Keywords(evidenceText, primaryTitle),
      // 按中位售价约 25% 折算为人民币分（前端以 ¥ 展示建议到岸采购上限）
      suggestedCostCents: priceStats.p50 > 0
        ? Math.round(priceStats.p50 * 0.25 * (FX_TO_CNY[currency] ?? 7.25))
        : 0,
      targetMarginPercent: 35,
    },
    hypothesisBridge: {
      category: "待确认类目",
      concept: `改良升级款 ${primaryTitle.slice(0, 20)}`,
      painPoint: capturedReviews[0]?.slice(0, 80) || "待采集真实买家差评确认",
      differentiator: "待结合真实差评明确差异化卖点",
      recommendedPriceCents: priceStats.p50,
    },
    provenance: (hasCapturedData ? "captured" : "template") as CompetitorProvenance,
    reviewStatus: "pending" as const,
  };

  return {
    ...reportData,
    productIndex: calculateProductIndex(reportData),
  };
}

/**
 * 基于已保存研报中的真实采集证据原地重新分析（不丢失已抓到的价格/月销/差评/主图，不破坏立项关联）。
 * 支持通过 excludeAsins 剔除误抓的干扰竞品（如配件或异常高价款）后重算分位与四象限。
 */
export async function reanalyzeExistingReport(
  existing: CompetitorComparisonReport,
  options?: {
    excludeAsins?: string[];
    skipModel?: boolean;
    mode?: AppMode;
  },
): Promise<CompetitorComparisonReport> {
  const excluded = new Set((options?.excludeAsins ?? []).map((a) => a.trim().toUpperCase()).filter(Boolean));
  const kept = existing.competitors.filter((c) => !excluded.has((c.asin || "").trim().toUpperCase()));
  if (kept.length === 0) {
    throw new Error("至少需保留 1 款竞品才能重新分析");
  }

  const capturedInputs: CompetitorInputItem[] = kept.map((c) => {
    const captured: NonNullable<CompetitorInputItem["captured"]> = {
      currency: c.currency || existing.currency,
      ...(c.capturedBullets && c.capturedBullets.length > 0 ? { bullets: c.capturedBullets } : {}),
      ...(c.capturedReviews && c.capturedReviews.length > 0 ? { criticalReviews: c.capturedReviews } : {}),
      ...(typeof c.boughtPastMonth === "number" && c.boughtPastMonth > 0 ? { boughtPastMonth: c.boughtPastMonth } : {}),
      ...(typeof c.isSponsored === "boolean" ? { isSponsored: c.isSponsored } : {}),
      ...(c.couponText ? { couponText: c.couponText } : {}),
      ...(typeof c.effectivePriceCents === "number" && c.effectivePriceCents > 0 ? { effectivePriceCents: c.effectivePriceCents } : {}),
      ...(typeof c.shippingCents === "number" && c.shippingCents > 0 ? { shippingCents: c.shippingCents } : {}),
      ...(typeof c.listPriceCents === "number" && c.listPriceCents > 0 ? { listPriceCents: c.listPriceCents } : {}),
      ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
      ...(c.fulfillmentType ? { fulfillmentType: c.fulfillmentType } : {}),
      ...(c.dateFirstAvailable ? { dateFirstAvailable: c.dateFirstAvailable } : {}),
      ...(c.dimensionsText ? { dimensionsText: c.dimensionsText } : {}),
      ...(c.ratingDistribution ? { ratingDistribution: c.ratingDistribution } : {}),
    };

    for (const field of COMPETITOR_NUMERIC_FIELDS) {
      if (isVerifiedCompetitorField(c, field) && c[field] > 0) {
        captured[field] = c[field];
      }
    }

    const url = c.sourceUrl || `https://www.amazon.com/dp/${c.asin}`;
    return {
      raw: url,
      asin: c.asin,
      url,
      title: c.title,
      brand: c.brand,
      captured,
    };
  });

  const rawInputs = capturedInputs.map((item) => item.url || item.asin || item.raw).join("\n");
  const regenerated = await analyzeCompetitors({
    rawInputs,
    marketCode: existing.marketCode,
    platformCode: existing.platformCode,
    currency: existing.currency,
    capturedInputs,
    skipModel: options?.skipModel,
    mode: options?.mode,
  });

  const targetBenchmarkStillExists = existing.targetBenchmarkAsin
    && kept.some((c) => c.asin.toUpperCase() === existing.targetBenchmarkAsin!.toUpperCase());

  const existingCostByAsin = new Map(
    kept
      .filter((c) => Boolean(c.sourcingCost))
      .map((c) => [c.asin.toUpperCase(), c.sourcingCost!]),
  );

  const mergedCompetitors = regenerated.competitors.map((c) => {
    const prevCost = existingCostByAsin.get((c.asin || "").toUpperCase());
    return prevCost ? { ...c, sourcingCost: prevCost } : c;
  });

  return {
    ...regenerated,
    competitors: mergedCompetitors,
    id: existing.id,
    createdAt: new Date().toISOString(),
    reviewStatus: existing.reviewStatus,
    promotedCaseId: existing.promotedCaseId ?? null,
    promotedAt: existing.promotedAt ?? null,
    snapshotDiff: existing.snapshotDiff ?? null,
    targetBenchmarkAsin: targetBenchmarkStillExists ? existing.targetBenchmarkAsin : null,
  };
}
