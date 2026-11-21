import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import { extractTitleFromUrl, inferBrandFromTitle, parseCompetitorInputs } from "./parser.ts";
import { calculateProductIndex } from "./competitiveness.ts";
import {
  COMPETITOR_NUMERIC_FIELDS,
  isVerifiedCompetitorField,
  type ComparisonPriceStats,
  type CompetitorComparisonReport,
  type CompetitorInputItem,
  type CompetitorNumericField,
  type CompetitorProfile,
  type CompetitorProvenance,
} from "./types.ts";

type PriceSample = Pick<CompetitorProfile, "priceCents" | "fieldProvenance">;

type CapturedValues = NonNullable<CompetitorInputItem["captured"]>;

/** 把浏览器采集到的真实数值标成 captured，其余字段标记推断来源 */
function fieldProvenanceFor(
  inferred: CompetitorProvenance,
  captured: CapturedValues | undefined,
): NonNullable<CompetitorProfile["fieldProvenance"]> {
  const result: NonNullable<CompetitorProfile["fieldProvenance"]> = {};
  for (const field of COMPETITOR_NUMERIC_FIELDS) {
    const hasCaptured = captured ? typeof captured[field] === "number" && Number.isFinite(captured[field]) : false;
    result[field] = hasCaptured ? "captured" : inferred;
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
  // 评分保留一位小数；其余都是整数型计数 / 金额（分）
  const normalize = (value: number) => field === "rating"
    ? Math.round(value * 10) / 10
    : Math.round(value);
  const observed = captured?.[field];
  if (typeof observed === "number" && Number.isFinite(observed)) return normalize(observed);
  const parsed = Number(inferred);
  return Number.isFinite(parsed) && parsed > 0 ? normalize(parsed) : fallback;
}

function calculatePriceStats(profiles: PriceSample[], currency: string): ComparisonPriceStats {
  const verifiedPrices = profiles
    .filter((p) => isVerifiedCompetitorField(p, "priceCents"))
    .map((p) => p.priceCents)
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

export async function analyzeCompetitors(input: {
  rawInputs: string;
  marketCode?: string;
  platformCode?: string;
  currency?: string;
  skipModel?: boolean;
  /** 浏览器扩展在前台采集到的真实数值，优先级高于 AI / 模板推断 */
  capturedInputs?: CompetitorInputItem[];
  /** 采集到的五点描述 / 买家差评原文等文本证据，只作为分析素材，不参与条目拆分 */
  evidenceText?: string;
}): Promise<CompetitorComparisonReport> {
  const marketCode = (input.marketCode || "US").toUpperCase();
  const platformCode = (input.platformCode || "amazon").toLowerCase();
  const currency = input.currency || (marketCode === "GB" ? "GBP" : marketCode === "DE" ? "EUR" : marketCode === "JP" ? "JPY" : marketCode === "AU" ? "AUD" : "USD");

  const parsedInputs = parseCompetitorInputs(input.rawInputs);
  const inputStrings = parsedInputs.map((p) => p.url || p.asin || p.title || p.raw);

  // 前台采集的文本证据（五点描述、买家差评原文）只作为分析上下文，
  // 绝不能混进 rawInputs —— 解析器按换行拆行，会把一个商品拆成多个「竞品」。
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
    product.captured && COMPETITOR_NUMERIC_FIELDS.some((field) => typeof product.captured?.[field] === "number"),
  );

  // 1. 全部交给 AI 进行端到端智能识别与对比（无任何本地硬编码正则分类）
  const isTest = process.env.NODE_ENV === "test";
  const shouldTryModel = !input.skipModel && !isTest;
  const config = await loadAIProviderConfig();

  if (shouldTryModel && config.provider !== "template") {
    try {
      const systemPrompt = `你是一位严谨的跨境电商高级竞品分析专家。
请直接阅读用户提供的竞品链接或商品标题信息，自动识别该商品的真实品类、真实品牌与产品特征。
全面剖析竞品的核心卖点（为什么卖得好）、真实买家差评痛点（致命缺点与退货原因）、规格参数，并推导竞争格局与攻防进攻策略。
所有分析必须严格聚焦于用户实际提供的具体商品，严禁输出任何不相关的其他品类。
【事实红线】不要编造售价、评分、评论数、销量、BSR 等可核查数值：输入里没有明确给出就输出 null，系统会把它们标为「待核实」。严禁编造认证、实验室测试次数、保修年限、倍数性能对比、绝对化宣传等无法核实的事实；这类内容一律不要写进文案。

目标国家站点：${marketCode}，平台：${platformCode}，币种：${currency}。
只输出严格符合以下结构的合法 JSON：
{
  "title": "根据该具体品类生成的专业研报标题（如：家用平板拖把横向对标与差评洞察研报）",
  "category": "AI 识别出的准确细分类目（如：家居清洁 / 拖把与地面护理）",
  "competitors": [
    {
      "asin": "商品ASIN或ID",
      "title": "地道商品全名",
      "brand": "品牌名",
      "sourceUrl": "来源链接",
      "priceCents": null, // 仅在输入中明确给出真实售价时填写（单位：分），否则 null
      "rating": null,
      "reviewCount": null,
      "bsr": null,
      "monthlySalesEst": null,
      "pricePosition": "budget" | "mid_market" | "premium",
      "features": ["3条切中买家满意度的核心亮点与卖点"],
      "drawbacks": ["2-3条该款商品在买家真实差评中高频出现的致命痛点或设计缺陷"],
      "specifications": { "核心规格1": "参数值", "核心规格2": "参数值" },
      "targetAudience": "真实的买家人群画像与使用场景",
      "verdict": "一句话专业裁决诊断"
    }
  ],
  "summary": {
    "marketMaturity": "growth" | "mature" | "saturated",
    "commonStrengths": ["该具体品类竞品普遍具备的共性长处"],
    "commonWeaknesses": ["该品类全行业被买家集中吐槽的通病，即差评机会缺口"],
    "marketVacuum": "市场目前的空白点或未被满足的黄金区间",
    "attackVector": "如果我们做这个品，最推荐的差异化改良打法与破局切入策略"
  },
  "sourcingAction": {
    "recommendedKeywords1688": ["用于1688寻找源头工厂的具体中文搜索词1", "词2", "词3"],
    "suggestedCostCents": 3200,
    "targetMarginPercent": 38
  },
  "hypothesisBridge": {
    "category": "准确细分类目",
    "concept": "针对该品类差评痛点打造的改良商品概念",
    "painPoint": "直击的核心痛点",
    "differentiator": "与竞品形成代差的杀手级差异化卖点",
    "recommendedPriceCents": 2999
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
          })),
          marketCode,
          platformCode,
          currency,
          capturedEvidence: {
            bullets: capturedBullets,
            criticalReviews: capturedReviews,
            rawText: evidenceText,
            note: "以上为浏览器在前台采集的真实文本；其余数值若未给出不得编造。",
          },
        }),
        timeoutMs: 30_000,
        maxTokens: 3_500,
      });

      const parsedJson = JSON.parse(aiResponse.content) as Partial<CompetitorComparisonReport> & {
        category?: string;
      };

      if (parsedJson.competitors && Array.isArray(parsedJson.competitors) && parsedJson.competitors.length > 0) {
        const competitors: CompetitorProfile[] = parsedJson.competitors.map((c, idx) => {
          const captured = rawProducts[idx]?.captured;
          return {
            id: `c_${idx}_${Date.now()}`,
            asin: c.asin || rawProducts[idx]?.asin || "ASIN",
            title: c.title || rawProducts[idx]?.title || "竞品",
            brand: c.brand || rawProducts[idx]?.brand || "品牌",
            sourceUrl: c.sourceUrl || rawProducts[idx]?.url || "",
            priceCents: numericValue("priceCents", c.priceCents, 2999, captured),
            currency,
            rating: numericValue("rating", c.rating, 4.3, captured),
            reviewCount: numericValue("reviewCount", c.reviewCount, 800, captured),
            bsr: numericValue("bsr", c.bsr, 1500, captured),
            monthlySalesEst: numericValue("monthlySalesEst", c.monthlySalesEst, 500, captured),
            pricePosition: c.pricePosition || (idx === 0 ? "budget" : idx === 1 ? "mid_market" : "premium"),
            features: Array.isArray(c.features) && c.features.length > 0 ? c.features : ["实用便携", "设计合理"],
            drawbacks: Array.isArray(c.drawbacks) && c.drawbacks.length > 0 ? c.drawbacks : ["细节做工有待提升"],
            specifications: c.specifications || {},
            targetAudience: c.targetAudience || "主流消费者",
            verdict: c.verdict || "表现均衡的主流竞品",
            fieldProvenance: fieldProvenanceFor("ai_generated", captured),
          };
        });
        const priceStats = calculatePriceStats(competitors, currency);

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
          summary: parsedJson.summary || {
            marketMaturity: "mature",
            commonStrengths: ["主打实用高性价比"],
            commonWeaknesses: ["塑料配件耐用度一般"],
            marketVacuum: "中端高品质区间尚存空白",
            attackVector: "以中位价格打造升级用料与更优配件的差异化单品",
          },
          sourcingAction: parsedJson.sourcingAction || {
            recommendedKeywords1688: [`${parsedJson.category || "商品"} 源头工厂`, "外贸批发"],
            suggestedCostCents: 4500,
            targetMarginPercent: 35,
          },
          hypothesisBridge: parsedJson.hypothesisBridge,
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

  // 2. 免 Key / 无模型回退模式：只展示真实采集值；未采集到的数值一律置 0（待补录），绝不按序号编造假价格与假销量。
  const primaryTitle = rawProducts[0]?.title || "对标商品";

  const generatedCompetitors: CompetitorProfile[] = rawProducts.map((item, idx) => {
    const realBullets = item.captured?.bullets?.filter(Boolean) ?? [];
    const realReviews = item.captured?.criticalReviews?.filter(Boolean) ?? [];
    const hasRealPrice = typeof item.captured?.priceCents === "number" && item.captured.priceCents > 0;

    return {
      id: `comp_${Date.now()}_${idx}`,
      asin: item.asin,
      title: item.title,
      brand: item.brand,
      sourceUrl: item.url,
      priceCents: numericValue("priceCents", undefined, 0, item.captured),
      currency,
      rating: numericValue("rating", undefined, 0, item.captured),
      reviewCount: numericValue("reviewCount", undefined, 0, item.captured),
      bsr: numericValue("bsr", undefined, 0, item.captured),
      monthlySalesEst: numericValue("monthlySalesEst", undefined, 0, item.captured),
      fieldProvenance: fieldProvenanceFor("template", item.captured),
      pricePosition: hasRealPrice
        ? (item.captured!.priceCents! < 2000 ? "budget" : item.captured!.priceCents! > 4500 ? "premium" : "mid_market")
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
        "采集状态": hasRealPrice ? "已采集前台售价" : "待采集售价",
      },
      targetAudience: "待结合真实评论与类目特征确认",
      verdict: hasRealPrice
        ? "已采集前台真实价格，可结合下方毛利模型与评论痛点做横向对比。"
        : "当前仅导入链接/ASIN，缺少真实售价与评论数，请用 Chrome 插件采集或手工补录。",
    };
  });

  const priceStats = calculatePriceStats(generatedCompetitors, currency);

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
