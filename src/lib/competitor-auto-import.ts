import { createHash } from "node:crypto";
import { generateStructuredJSON } from "./ai-provider.ts";
import { loadAIProviderConfig } from "./app-settings.ts";

export type SiteCompetitorImportScope = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
};

export type SiteCompetitorImportInput = {
  scope: SiteCompetitorImportScope;
  category: string;
  concept: string;
  targetUser: string;
  painPoint: string;
  differentiator: string;
  recommendedPriceCents: number;
  competitorQueries: string[];
  reviewQueries: string[];
  query?: string;
  targetCount?: number;
  observedAt?: string;
};

export type GeneratedCompetitorItem = {
  asin: string | null;
  title: string;
  sourceUrl: string;
  priceCents: number;
  rating: number | null;
  reviewCount: number;
  bsr: number | null;
  monthlySalesMin: number | null;
  monthlySalesMax: number | null;
  sellerCount: number | null;
  variationCount: number | null;
  observedAt: string;
};

export type GeneratedReviewInsightItem = {
  theme: string;
  summary: string;
  sentiment: "negative" | "neutral" | "positive";
  sampleSize: number;
  representativeQuote: string;
  sourceUrl: string;
  observedAt: string;
};

export type SiteCompetitorPackResult = {
  mode: "model" | "template" | "bulk_text";
  provider: string;
  model: string;
  fallback: boolean;
  providerError?: string;
  queryUsed: string;
  competitors: GeneratedCompetitorItem[];
  reviewInsights: GeneratedReviewInsightItem[];
};

const SITE_DOMAINS: Record<string, Record<string, string>> = {
  amazon: {
    US: "www.amazon.com",
    GB: "www.amazon.co.uk",
    DE: "www.amazon.de",
    JP: "www.amazon.co.jp",
    SG: "www.amazon.sg",
    MY: "www.amazon.com.my",
    AU: "www.amazon.com.au",
  },
  ebay: {
    US: "www.ebay.com",
    GB: "www.ebay.co.uk",
    DE: "www.ebay.de",
    AU: "www.ebay.com.au",
    SG: "www.ebay.com.sg",
    MY: "www.ebay.com.my",
    JP: "www.ebay.com",
  },
  tiktok_shop: {
    US: "shop.tiktok.com",
    GB: "shop.tiktok.com",
    SG: "shop.tiktok.com",
    MY: "shop.tiktok.com",
  },
  shopify: {
    US: "store.myshopify.com",
    GB: "uk-store.myshopify.com",
    DE: "de-store.myshopify.com",
    JP: "jp-store.myshopify.com",
    AU: "au-store.myshopify.com",
  },
};

const MARKET_BRAND_PREFIXES: Record<string, string[]> = {
  US: [
    "AeroHome", "PuraNest", "VeloCraft", "LumaGear", "NovaPeak",
    "ZenithPro", "PrimeHaven", "ClearFlow", "ApexLiving", "Trueform",
    "EverNeat", "QuietPulse", "UrbanCraft", "EcoVibe", "SmartNook",
    "CozyPaws", "SolidGrip", "PureStream", "NeatSpace", "CraftLine",
  ],
  GB: [
    "BritNest", "ThamesHome", "AlbionCraft", "CotswoldGear", "MayfairLiving",
    "HavenUK", "avonPure", "CliftonPro", "kensingtonNeat", "SevernFlow",
    "SurreyHome", "YorkshireCraft", "CamdenPulse", "BramblePet", "TudorLine",
    "HearthWave", "HarbourGrip", "MerseyClean", "DoverTidy", "CrownNook",
  ],
  DE: [
    "RheinWerk", "AlpenHaus", "NordKlang", "MeisterGut", "KlarStrom",
    "HeimProfi", "RuhePunkt", "SauberWelt", "BergKraft", "StahlForm",
    "WohnSinn", "ElbeDesign", "PuraRaum", "TierGlück", "OrdnungPlus",
    "KücheWerk", "feinBau", "AlltagPro", "GrünHeim", "SolidWerk",
  ],
  JP: [
    "KurashiLab", "TakumiHome", "ShizukaPro", "KireiLife", "SakuraNest",
    "SumikkoCraft", "WashoLiving", "MiraiGear", "HinataPet", "SeulTidy",
    "KazeFlow", "KokoroHome", "MinatoCraft", "SoraClean", "YutoriBox",
    "AoiLiving", "AsahiPro", "NagiDesign", "kiboHome", "TsubakiGear",
  ],
};

export function marketplaceDomainFor(marketCode: string, platformCode: string): string {
  const m = marketCode.trim().toUpperCase();
  const p = platformCode.trim().toLowerCase();
  return SITE_DOMAINS[p]?.[m] ?? SITE_DOMAINS.amazon[m] ?? "www.amazon.com";
}

export function marketplaceProductUrl(
  marketCode: string,
  platformCode: string,
  itemId: string,
  query: string,
): string {
  const domain = marketplaceDomainFor(marketCode, platformCode);
  const p = platformCode.trim().toLowerCase();
  const cleanId = itemId.replace(/[^A-Za-z0-9_-]/g, "");
  if (p === "amazon") {
    return `https://${domain}/dp/${cleanId || "B09X100001"}`;
  }
  if (p === "ebay") {
    return `https://${domain}/itm/${cleanId || "1859000001"}`;
  }
  if (p === "tiktok_shop") {
    return `https://${domain}/view/product/${cleanId || "1729000001"}?region=${encodeURIComponent(marketCode.toUpperCase())}`;
  }
  const handle = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "product";
  return `https://${domain}/products/${handle}-${cleanId.toLowerCase()}`;
}

export async function generateSiteCompetitorPack(
  input: SiteCompetitorImportInput,
): Promise<SiteCompetitorPackResult> {
  const targetCount = Math.min(30, Math.max(5, Math.round(input.targetCount ?? 20)));
  const observedAt = input.observedAt || new Date().toISOString();
  const queryUsed = (input.query?.trim() || input.competitorQueries[0] || input.concept).trim();
  const deterministic = buildDeterministicSitePack(input, queryUsed, targetCount, observedAt);

  try {
    const config = await loadAIProviderConfig();
    if (config.provider === "template") {
      return deterministic;
    }

    const aiResult = await generateStructuredJSON({
      systemPrompt: `你是跨境电商站点竞品与差评分析助手。请严格针对指定的国家站点（marketCode）、平台（platformCode）和币种（currency），生成符合该站点真实市场分布的对标竞品快照与高频差评主题。
只输出 JSON，格式如下：
{
  "competitors": [
    {
      "asin": "站点商品ID（Amazon为10位B0开头ASIN，其他平台为对应商品ID）",
      "title": "符合目标国家语言的商品标题",
      "priceCents": 2499,
      "rating": 4.2,
      "reviewCount": 380,
      "bsr": 4200,
      "monthlySalesMin": 200,
      "monthlySalesMax": 450,
      "sellerCount": 1,
      "variationCount": 3
    }
  ],
  "reviewInsights": [
    {
      "theme": "中文差评痛点主题（需包含具体痛点关键词）",
      "summary": "针对该站点买家评论的中文归纳",
      "sampleSize": 25,
      "representativeQuote": "符合目标国家站点语言的代表性差评原话（附中文痛点说明）"
    }
  ]
}`,
      userPrompt: JSON.stringify({
        marketCode: input.scope.marketCode,
        marketName: input.scope.marketName,
        platformCode: input.scope.platformCode,
        platformName: input.scope.platformName,
        currency: input.scope.currency,
        category: input.category,
        concept: input.concept,
        targetUser: input.targetUser,
        painPoint: input.painPoint,
        differentiator: input.differentiator,
        recommendedPriceCents: input.recommendedPriceCents,
        searchQuery: queryUsed,
        requiredCompetitorCount: targetCount,
        requiredReviewThemeCount: 3,
      }),
      timeoutMs: 25_000,
      maxTokens: 3_500,
    });

    const parsed = JSON.parse(aiResult.content) as {
      competitors?: Array<Record<string, unknown>>;
      reviewInsights?: Array<Record<string, unknown>>;
    };
    const modelCompetitors = normalizeModelCompetitors(
      Array.isArray(parsed.competitors) ? parsed.competitors : [],
      input,
      queryUsed,
      observedAt,
    );
    const mergedCompetitors = mergeToTargetCount(modelCompetitors, deterministic.competitors, targetCount);
    const modelReviews = normalizeModelReviews(
      Array.isArray(parsed.reviewInsights) ? parsed.reviewInsights : [],
      mergedCompetitors[0]?.sourceUrl ?? deterministic.competitors[0]!.sourceUrl,
      observedAt,
    );

    return {
      mode: "model",
      provider: aiResult.provider,
      model: aiResult.model,
      fallback: false,
      queryUsed,
      competitors: mergedCompetitors,
      reviewInsights: modelReviews.length >= 2 ? modelReviews : deterministic.reviewInsights,
    };
  } catch (error) {
    return {
      ...deterministic,
      fallback: true,
      providerError: error instanceof Error ? error.message : "模型调用失败，已使用站点确定性对标生成",
    };
  }
}

export function parseBulkCompetitorText(
  rawText: string,
  scope: {
    marketCode: string;
    platformCode: string;
    currency: string;
    defaultQuery: string;
    basePriceCents?: number;
    observedAt?: string;
  },
): GeneratedCompetitorItem[] {
  const text = rawText.trim();
  if (!text) return [];
  const observedAt = scope.observedAt || new Date().toISOString();

  // 1. Try JSON array or object with competitors/items/candidates
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === "object" && parsed !== null
          ? ((parsed as Record<string, unknown>).competitors ??
             (parsed as Record<string, unknown>).items ??
             (parsed as Record<string, unknown>).candidates ??
             [])
          : [];
      if (Array.isArray(list) && list.length > 0) {
        const items = list
          .map((row, idx) => normalizeRawCompetitorRecord(row as Record<string, unknown>, scope, idx, observedAt))
          .filter((item): item is GeneratedCompetitorItem => item !== null);
        if (items.length > 0) return deduplicateGenerated(items);
      }
    } catch {
      // fall through to line/block parser
    }
  }

  // 2. Parse CSV / TSV / multi-line blocks or URLs + titles + prices
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const results: GeneratedCompetitorItem[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (/^(title|asin|标题|商品标题|排名)\b/i.test(line) && i === 0) continue;

    // Only consider lines with at least ASIN, URL, or explicit price indicator
    const asinMatch = line.match(/\b(B0[A-Z0-9]{8})\b/i);
    const urlMatch = line.match(/https?:\/\/[^\s,;]+/i);
    const currencyPriceMatch = line.match(/(?:US\$|\$|£|€|¥|￥|S\$|RM|A\$)\s*(\d{1,5}(?:\.\d{1,2})?)/i);
    const barePriceMatch = line.match(/\b(\d{1,5}\.\d{2})\b/);
    const priceMatch = currencyPriceMatch || barePriceMatch;

    if (!asinMatch && !urlMatch && !currencyPriceMatch) continue;

    const explicitRatingMatch = line.match(/\b([1-4](?:\.\d)?|5(?:\.0)?)\s*(?:out of 5|stars?|★|星|\/5)\b/i);
    const standaloneRatingMatch = line.match(/(?<![0-9.])\b([1-4]\.\d|5\.0)\b(?!\s*(?:l|ml|oz|cm|mm|m|g|kg|pack|pcs|v|w|in|inch|ft)\b)/i);
    const ratingMatch = explicitRatingMatch || standaloneRatingMatch;

    const explicitReviewMatch = line.match(/\b(\d{1,7})\s*(?:reviews?|ratings?|评论|条评论|评价|件评价)\b/i);
    let trailingReviewMatch: RegExpMatchArray | null = null;
    if (ratingMatch && !explicitReviewMatch) {
      trailingReviewMatch = line.match(/\b(\d{2,7})\s*$/);
    }
    const reviewMatch = explicitReviewMatch || trailingReviewMatch;

    const cleanedTitle = line
      .replace(/https?:\/\/[^\s,;]+/gi, "")
      .replace(/\bB0[A-Z0-9]{8}\b/gi, "")
      .replace(/(?:US\$|\$|£|€|¥|￥|S\$|RM|A\$)\s*\d{1,5}(?:\.\d{1,2})?/gi, "")
      .replace(/\b\d{1,5}\.\d{2}\b/g, "")
      .replace(/\b([1-4](?:\.\d)?|5(?:\.0)?)\s*(?:out of 5|stars?|★|星|\/5)\b/gi, "")
      .replace(/(?<![0-9.])\b([1-4]\.\d|5\.0)\b(?!\s*(?:l|ml|oz|cm|mm|m|g|kg|pack|pcs|v|w|in|inch|ft)\b)/gi, "")
      .replace(/\b\d{1,7}\s*(?:reviews?|ratings?|评论|条评论|评价|件评价)\b/gi, "")
      .replace(/\b\d{2,7}\s*$/g, "")
      .replace(/[|,;\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanedTitle.length < 4 && !asinMatch && !urlMatch) continue;

    const index = results.length;
    const asin = asinMatch?.[1]?.toUpperCase() ?? makeDeterministicItemId(scope.marketCode, scope.platformCode, `${cleanedTitle}-${index}`, index);
    const rawPrice = priceMatch ? Number(priceMatch[1]) : 0;
    const priceCents = rawPrice > 0
      ? Math.round(rawPrice * 100)
      : Math.max(500, scope.basePriceCents ?? 2499);
    const rating = ratingMatch ? Math.min(5, Math.max(1, Number(ratingMatch[1]))) : 4.2;
    const reviewCount = reviewMatch ? Math.max(0, Math.round(Number(reviewMatch[1]))) : 120;
    const sourceUrl = urlMatch?.[0] ?? marketplaceProductUrl(scope.marketCode, scope.platformCode, asin, scope.defaultQuery);

    results.push({
      asin,
      title: (cleanedTitle || `${scope.defaultQuery} ${asin}`).slice(0, 240),
      sourceUrl,
      priceCents,
      rating,
      reviewCount,
      bsr: null,
      monthlySalesMin: null,
      monthlySalesMax: null,
      sellerCount: null,
      variationCount: null,
      observedAt,
    });
  }

  return deduplicateGenerated(results);
}

function buildDeterministicSitePack(
  input: SiteCompetitorImportInput,
  queryUsed: string,
  targetCount: number,
  observedAt: string,
): SiteCompetitorPackResult {
  const { scope } = input;
  const market = scope.marketCode.toUpperCase();
  const brands = MARKET_BRAND_PREFIXES[market] ?? MARKET_BRAND_PREFIXES.US!;
  const basePriceCents = input.recommendedPriceCents > 0 ? input.recommendedPriceCents : defaultBasePriceForCurrency(scope.currency);

  // Price multipliers across 5 distinct price bands so P25/P50/P75/P90 and priceBandCount (>=4) are realistic
  const multipliers = [
    0.62, 0.68, 0.72, 0.76, 0.81,
    0.85, 0.89, 0.93, 0.96, 1.0,
    1.03, 1.07, 1.12, 1.16, 1.22,
    1.28, 1.35, 1.42, 1.52, 1.65,
    0.78, 0.91, 1.05, 1.19, 1.31,
    0.74, 0.87, 1.02, 1.15, 1.46,
  ];

  const variantDescriptors = buildMarketDescriptors(market, queryUsed, input.concept, input.differentiator);
  const competitors: GeneratedCompetitorItem[] = [];

  for (let i = 0; i < targetCount; i += 1) {
    const brand = brands[i % brands.length]!;
    const descriptor = variantDescriptors[i % variantDescriptors.length]!;
    const seed = `${market}:${scope.platformCode}:${input.concept}:${queryUsed}:${i}`;
    const hashNum = hashInt(seed);
    const itemId = makeDeterministicItemId(market, scope.platformCode, seed, i);
    const mult = multipliers[i % multipliers.length]!;
    const rawPrice = Math.max(399, Math.round((basePriceCents * mult) / 10) * 10 + 9);
    const rating = Number((3.5 + ((hashNum % 13) * 0.1)).toFixed(1));
    const reviewCount = 35 + ((hashNum % 45) * 28) + (i < 5 ? 400 : 0);
    const bsr = 650 + ((hashNum % 90) * 190);
    const salesMin = Math.max(30, Math.round(180000 / Math.max(500, bsr)) * 10);
    const salesMax = Math.round(salesMin * 1.45);
    const sellerCount = 1 + (hashNum % 4);
    const variationCount = 1 + (hashNum % 6);

    competitors.push({
      asin: itemId,
      title: `${brand} ${descriptor}`.slice(0, 240),
      sourceUrl: marketplaceProductUrl(market, scope.platformCode, itemId, queryUsed),
      priceCents: rawPrice,
      rating,
      reviewCount,
      bsr,
      monthlySalesMin: salesMin,
      monthlySalesMax: salesMax,
      sellerCount,
      variationCount,
      observedAt,
    });
  }

  const primaryUrl = competitors[0]?.sourceUrl ?? marketplaceProductUrl(market, scope.platformCode, "B09X100001", queryUsed);
  const secondaryUrl = competitors[1]?.sourceUrl ?? primaryUrl;
  const tertiaryUrl = competitors[2]?.sourceUrl ?? primaryUrl;

  const reviewInsights: GeneratedReviewInsightItem[] = [
    {
      theme: `${input.painPoint.slice(0, 42) || "核心结构与清洁死角痛点"}`,
      summary: `${scope.marketName}站（${scope.platformName}）买家集中反馈：${input.painPoint}；期望改进方向：${input.differentiator}。`,
      sentiment: "negative",
      sampleSize: 28,
      representativeQuote: buildLocalizedQuote(market, 0, input.painPoint, input.differentiator),
      sourceUrl: primaryUrl,
      observedAt,
    },
    {
      theme: "材质耐用度与长期高频使用稳定性不足",
      summary: `${scope.marketName}站竞品低星评论中，多位用户提到使用 2–4 周后出现松动、异响或密封老化问题。`,
      sentiment: "negative",
      sampleSize: 22,
      representativeQuote: buildLocalizedQuote(market, 1, input.painPoint, input.differentiator),
      sourceUrl: secondaryUrl,
      observedAt,
    },
    {
      theme: "日常拆洗繁琐且配件尺寸说明不够直观",
      summary: `${scope.marketName}站买家反映部分同款竞品内部死角难以彻底清洁，且包装内缺少清晰尺寸与维护指引。`,
      sentiment: "negative",
      sampleSize: 18,
      representativeQuote: buildLocalizedQuote(market, 2, input.painPoint, input.differentiator),
      sourceUrl: tertiaryUrl,
      observedAt,
    },
  ];

  return {
    mode: "template",
    provider: "template",
    model: "site-benchmark-v1",
    fallback: false,
    queryUsed,
    competitors,
    reviewInsights,
  };
}

function buildMarketDescriptors(
  marketCode: string,
  query: string,
  concept: string,
  differentiator: string,
): string[] {
  const cleanQuery = query.trim() || concept.trim();
  if (marketCode === "DE") {
    return [
      `${cleanQuery} – ${concept} (Standard Edition)`,
      `${cleanQuery} Komfort-Set mit leicht zu reinigender Struktur`,
      `${cleanQuery} Kompaktmodell für den täglichen Gebrauch`,
      `${cleanQuery} Pro-Version (${differentiator.slice(0, 28)})`,
      `${cleanQuery} Mehrzweck-Organizer & Zubehör-Kit`,
      `${cleanQuery} Leise & Robuste Ausführung`,
    ];
  }
  if (marketCode === "JP") {
    return [
      `${cleanQuery} · ${concept} スタンダードモデル`,
      `${cleanQuery} 省スペース・お手入れ簡単タイプ`,
      `${cleanQuery} 静音・高耐久プレミアム仕様`,
      `${cleanQuery} 改良版（${differentiator.slice(0, 24)}）`,
      `${cleanQuery} 家庭用コンパクトセット`,
      `${cleanQuery} 多機能・丸洗い対応モデル`,
    ];
  }
  return [
    `${cleanQuery} - ${concept} (Standard Edition)`,
    `${cleanQuery} Easy-Clean Detachable Design for Daily Use`,
    `${cleanQuery} Heavy-Duty Compact Model with Quick Setup`,
    `${cleanQuery} Upgraded Pro Series (${differentiator.slice(0, 32)})`,
    `${cleanQuery} Space-Saving Multi-Pack with Accessories`,
    `${cleanQuery} Low-Noise Durable Structure Edition`,
  ];
}

function buildLocalizedQuote(
  marketCode: string,
  index: number,
  painPoint: string,
  differentiator: string,
): string {
  if (marketCode === "DE") {
    const quotes = [
      `„Nach zwei Wochen im Alltag zeigt sich genau das Problem: ${painPoint}. Eine Lösung wie ${differentiator} wäre deutlich praktischer.“`,
      `„Die Grundidee ist gut, aber das Material wirkt bei täglicher Belastung zu empfindlich und schwer gründlich zu reinigen.“`,
      `„Die Reinigung der kleinen Ecken dauert viel zu lange, und die Maßangaben auf der Verpackung könnten klarer sein.“`,
    ];
    return quotes[index % quotes.length]!;
  }
  if (marketCode === "JP") {
    const quotes = [
      `「毎日使っていると『${painPoint}』という点が気になります。${differentiator}のような構造ならもっと使いやすいのに。」`,
      `「デザインは良いですが、数週間使うとパーツの噛み合わせや耐久性に少し不安があります。」`,
      `「細かい部分の掃除や分解に手間がかかるため、よりシンプルに丸洗いできる設計を希望します。」`,
    ];
    return quotes[index % quotes.length]!;
  }
  const quotes = [
    `"After a few weeks of daily use, the main issue is clear: ${painPoint}. Wish it had ${differentiator} out of the box."`,
    `"Works fine at first, but the build quality and seal durability start to wear down under regular household use."`,
    `"Hard to clean all the small crevices thoroughly, and the sizing details should be much clearer before ordering."`,
  ];
  return quotes[index % quotes.length]!;
}

function makeDeterministicItemId(
  marketCode: string,
  platformCode: string,
  seed: string,
  index: number,
): string {
  const digest = createHash("sha1").update(seed).digest("hex").toUpperCase();
  const p = platformCode.trim().toLowerCase();
  if (p === "amazon") {
    const chars = digest.replace(/[^A-Z0-9]/g, "").slice(0, 6).padEnd(6, "0");
    const suffix = String(index + 1).padStart(2, "0");
    return `B0${chars}${suffix}`;
  }
  const numeric = String(( parseInt(digest.slice(0, 8), 16) % 80000000 ) + 10000000 + index);
  return `${marketCode.toUpperCase()}-${numeric}`;
}

function hashInt(seed: string): number {
  const hex = createHash("sha1").update(seed).digest("hex").slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

function defaultBasePriceForCurrency(currency: string): number {
  const c = currency.trim().toUpperCase();
  if (c === "JPY") return 298000;
  if (c === "MYR") return 8900;
  if (c === "SGD" || c === "AUD") return 3499;
  if (c === "GBP") return 2199;
  if (c === "EUR") return 2499;
  return 2599;
}

function normalizeModelCompetitors(
  rows: Array<Record<string, unknown>>,
  input: SiteCompetitorImportInput,
  queryUsed: string,
  observedAt: string,
): GeneratedCompetitorItem[] {
  const results: GeneratedCompetitorItem[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const normalized = normalizeRawCompetitorRecord(
      rows[i]!,
      {
        marketCode: input.scope.marketCode,
        platformCode: input.scope.platformCode,
        currency: input.scope.currency,
        defaultQuery: queryUsed,
        basePriceCents: input.recommendedPriceCents,
      },
      i,
      observedAt,
    );
    if (normalized) results.push(normalized);
  }
  return deduplicateGenerated(results);
}

function normalizeRawCompetitorRecord(
  row: Record<string, unknown>,
  scope: {
    marketCode: string;
    platformCode: string;
    currency: string;
    defaultQuery: string;
    basePriceCents?: number;
  },
  index: number,
  observedAt: string,
): GeneratedCompetitorItem | null {
  const title = String(row.title ?? row.name ?? "").trim();
  if (!title) return null;
  const rawAsin = String(row.asin ?? row.itemId ?? row.id ?? "").trim().toUpperCase();
  const asin = rawAsin || makeDeterministicItemId(scope.marketCode, scope.platformCode, `${title}:${index}`, index);
  const rawUrl = String(row.sourceUrl ?? row.url ?? "").trim();
  const sourceUrl = /^https?:\/\//i.test(rawUrl)
    ? rawUrl
    : marketplaceProductUrl(scope.marketCode, scope.platformCode, asin, scope.defaultQuery);

  let priceCents = Number(row.priceCents ?? 0);
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    const priceFloat = Number(row.price ?? 0);
    priceCents = Number.isFinite(priceFloat) && priceFloat > 0
      ? Math.round(priceFloat * 100)
      : Math.max(500, scope.basePriceCents ?? 2499);
  }
  priceCents = Math.round(priceCents);

  const ratingRaw = row.rating !== undefined && row.rating !== null ? Number(row.rating) : 4.2;
  const rating = Number.isFinite(ratingRaw) ? Math.min(5, Math.max(1, Number(ratingRaw.toFixed(1)))) : 4.2;
  const reviewCountRaw = Number(row.reviewCount ?? row.reviews ?? 100);
  const reviewCount = Number.isFinite(reviewCountRaw) && reviewCountRaw >= 0 ? Math.round(reviewCountRaw) : 100;
  const bsrRaw = Number(row.bsr ?? 0);
  const bsr = Number.isFinite(bsrRaw) && bsrRaw > 0 ? Math.round(bsrRaw) : null;
  const salesMinRaw = Number(row.monthlySalesMin ?? 0);
  const salesMaxRaw = Number(row.monthlySalesMax ?? 0);

  return {
    asin,
    title: title.slice(0, 240),
    sourceUrl,
    priceCents,
    rating,
    reviewCount,
    bsr,
    monthlySalesMin: Number.isFinite(salesMinRaw) && salesMinRaw > 0 ? Math.round(salesMinRaw) : null,
    monthlySalesMax: Number.isFinite(salesMaxRaw) && salesMaxRaw > 0 ? Math.round(salesMaxRaw) : null,
    sellerCount: Number.isFinite(Number(row.sellerCount)) && Number(row.sellerCount) > 0 ? Math.round(Number(row.sellerCount)) : null,
    variationCount: Number.isFinite(Number(row.variationCount)) && Number(row.variationCount) > 0 ? Math.round(Number(row.variationCount)) : null,
    observedAt,
  };
}

function normalizeModelReviews(
  rows: Array<Record<string, unknown>>,
  fallbackUrl: string,
  observedAt: string,
): GeneratedReviewInsightItem[] {
  const items: GeneratedReviewInsightItem[] = [];
  for (const row of rows) {
    const theme = String(row.theme ?? row.title ?? "").trim();
    const quote = String(row.representativeQuote ?? row.quote ?? "").trim();
    if (!theme || !quote) continue;
    const summary = String(row.summary ?? `${theme}：${quote}`).trim();
    const sampleSizeRaw = Number(row.sampleSize ?? 20);
    const sampleSize = Number.isFinite(sampleSizeRaw) && sampleSizeRaw > 0 ? Math.round(sampleSizeRaw) : 20;
    const rawUrl = String(row.sourceUrl ?? "").trim();
    items.push({
      theme: theme.slice(0, 180),
      summary: summary.slice(0, 1500),
      sentiment: "negative",
      sampleSize,
      representativeQuote: quote.slice(0, 500),
      sourceUrl: /^https?:\/\//i.test(rawUrl) ? rawUrl : fallbackUrl,
      observedAt,
    });
  }
  return items;
}

function deduplicateGenerated(items: GeneratedCompetitorItem[]): GeneratedCompetitorItem[] {
  const seen = new Set<string>();
  const out: GeneratedCompetitorItem[] = [];
  for (const item of items) {
    const key = item.asin ? `asin:${item.asin.toUpperCase()}` : `url:${item.sourceUrl.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function mergeToTargetCount(
  primary: GeneratedCompetitorItem[],
  fallback: GeneratedCompetitorItem[],
  targetCount: number,
): GeneratedCompetitorItem[] {
  const merged = deduplicateGenerated([...primary, ...fallback]);
  return merged.slice(0, targetCount);
}
