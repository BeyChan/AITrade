import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import { extractTitleFromUrl, parseCompetitorInputs } from "./parser.ts";
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
  // 有真实样本时只用真实样本；一条都没有时保留一组「示意」分位供页面排版，
  // 但 verifiedSampleCount = 0，UI 必须标为待核实且禁止用于定价判断。
  const prices = verifiedPrices.length > 0
    ? verifiedPrices
    : profiles.map((p) => p.priceCents).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length === 0) {
    return { min: 0, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, currency, verifiedSampleCount: 0 };
  }
  const sorted = [...prices].sort((a, b) => a - b);
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

/** 按 ASIN / URL 匹配浏览器采集值；只采到一条时默认作用于首个商品 */
function resolveCaptured(
  item: CompetitorInputItem,
  list: CompetitorInputItem[] | undefined,
  index: number,
): CapturedValues | undefined {
  if (!list || list.length === 0) return undefined;
  const matched = list.find((entry) =>
    (item.asin && entry.asin && entry.asin.toUpperCase() === item.asin.toUpperCase())
    || (item.url && entry.url && entry.url === item.url),
  );
  return (matched ?? (list.length === 1 && index === 0 ? list[0] : undefined))?.captured;
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

  // 整理传入的商品基础条目
  const rawProducts = parsedInputs.map((item, idx) => {
    let brand = "优质竞品";
    let title = item.title || item.raw;
    const asin = item.asin || `B0${Date.now().toString(36).slice(2, 10).toUpperCase()}`;
    const cleanUrl = item.url || `https://www.amazon.com/dp/${asin}`;

    if (item.url) {
      const meta = extractTitleFromUrl(item.url);
      if (meta.brand) brand = meta.brand;
      if (meta.title) title = meta.title;
    } else if (item.title) {
      const words = item.title.split(/\s+/);
      if (words[0] && words[0].length >= 2) brand = words[0];
    }

    return {
      asin,
      title,
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

  // 2. 免 Key 模式下的直通展示（只用用户真实输入的标题和品牌，不写任何品类 if-else 正则）
  const primaryTitle = rawProducts[0]?.title || "对标商品";
  const defaultPrices = [2499, 3299, 3999, 4999];

  const generatedCompetitors: CompetitorProfile[] = rawProducts.map((item, idx) => {
    const priceCents = defaultPrices[idx % defaultPrices.length]!;

    return {
      id: `comp_${Date.now()}_${idx}`,
      asin: item.asin,
      title: item.title,
      brand: item.brand,
      sourceUrl: item.url,
      priceCents: numericValue("priceCents", undefined, priceCents, item.captured),
      currency,
      rating: numericValue("rating", undefined, 4.2 + (idx * 0.1), item.captured),
      reviewCount: numericValue("reviewCount", undefined, 800 + (idx * 600), item.captured),
      bsr: numericValue("bsr", undefined, 1500 - (idx * 300), item.captured),
      monthlySalesEst: numericValue("monthlySalesEst", undefined, 400 + (idx * 250), item.captured),
      fieldProvenance: fieldProvenanceFor("template", item.captured),
      pricePosition: idx === 0 ? "budget" : idx === 1 ? "mid_market" : "premium",
      features: [
        `${item.brand} 主打实用性与日常高频需求设计`,
        `结构经过海外买家长期验证，基础功能完备`,
        `握持/操控符合人体工学体验`,
      ],
      drawbacks: [
        `部分买家在差评中反映关键受力部件在长期高强度使用后耐用度有限`,
        `配件装配公差有提升空间，需双手用力拆装`,
        `包装防护较为简易，长途运输有轻微磨损风险`,
      ],
      specifications: {
        "对标品牌": item.brand,
        "商品全称": item.title,
        "适用场景": "家庭与个人日常使用",
      },
      targetAudience: "注重实用性价比与日常便利的消费者",
      verdict: idx === 0
        ? `主打性价比与入门门槛，在主流市场表现稳定，但细节材质耐用度有改良空间。`
        : `主打进阶性能与更强用料，覆盖更广场景，但便携与细节收纳仍可进一步优化。`,
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
      commonStrengths: ["主打实用性与满足海外主流日常需求", "轻量化设计降低买家使用疲劳"],
      // 有前台采集的真实差评就直接用原文，避免模板凭空编造痛点
      commonWeaknesses: capturedReviews.length > 0
        ? capturedReviews.slice(0, 3).map((text) => text.slice(0, 140))
        : ["（模板示意）长期使用后受力件或消耗件存在买家抱怨", "（模板示意）包装保护普遍偏简易，待采集真实差评替换"],
      marketVacuum: "在中端价位段提供做工用料更扎实、关键受力结构加固的升级款。",
      attackVector: `针对 ${primaryTitle.slice(0, 20)} 的核心买家差评痛点进行结构加强，定价锚定中位线直击热销榜。`,
    },
    sourcingAction: {
      recommendedKeywords1688: [`${rawProducts[0]?.brand || "优质"} 外贸工厂`, "源头批发直供"],
      suggestedCostCents: 2600,
      targetMarginPercent: 40,
    },
    hypothesisBridge: {
      category: "日常家居 / 生活消费品",
      concept: `改良升级款 ${primaryTitle.slice(0, 20)}`,
      painPoint: "受力件耐久度有限与细节做工粗糙",
      differentiator: "加固结构与更优选材",
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
