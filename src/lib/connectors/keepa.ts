import { calculateEconomics, type EconomicsAssumptions } from "../economics.ts";
import type { CandidateImportRow } from "../csv.ts";
import { asJsonObject, ConnectorNotConfiguredError, type ConnectorResult } from "./types.ts";

export { ConnectorNotConfiguredError } from "./types.ts";

const KEEPA_DOMAINS: Record<string, number> = {
  US: 1,
  GB: 2,
  DE: 3,
  FR: 4,
  JP: 5,
  CA: 6,
  IT: 8,
  ES: 9,
  IN: 10,
  MX: 11,
  BR: 12,
  AU: 13,
};

type KeepaProduct = {
  asin?: string;
  title?: string;
  brand?: string;
  manufacturer?: string;
  categoryTree?: Array<{ name?: string }>;
  rootCategory?: number;
  monthlySold?: number;
  reviewCount?: number;
  rating?: number;
  stats?: { current?: Array<number | null> };
  [key: string]: unknown;
};

type KeepaResponse = {
  products?: Array<KeepaProduct | null>;
  error?: { message?: string };
};

export function isKeepaConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.KEEPA_API_KEY?.trim());
}

export async function fetchKeepaCandidates(input: {
  asins: string[];
  marketplace: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ConnectorResult<CandidateImportRow>> {
  const apiKey = (input.env ?? process.env).KEEPA_API_KEY?.trim();
  if (!apiKey) throw new ConnectorNotConfiguredError("Keepa");
  const marketplace = input.marketplace.trim().toUpperCase();
  const domain = KEEPA_DOMAINS[marketplace];
  if (!domain) throw new Error(`Keepa Adapter 暂不支持市场 ${marketplace}`);
  const asins = [...new Set(input.asins.map((asin) => asin.trim().toUpperCase()).filter(Boolean))];
  if (asins.length === 0) throw new Error("至少提供一个 ASIN");
  if (asins.length > 100) throw new Error("单次 Keepa 同步最多 100 个 ASIN");

  const url = new URL("https://api.keepa.com/product");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("domain", String(domain));
  url.searchParams.set("asin", asins.join(","));
  url.searchParams.set("stats", "30");
  url.searchParams.set("history", "0");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Keepa 请求失败：HTTP ${response.status}`);
  const payload = (await response.json()) as KeepaResponse;
  if (payload.error?.message) throw new Error(`Keepa 返回错误：${payload.error.message}`);

  const records: ConnectorResult<CandidateImportRow>["records"] = [];
  const warnings: string[] = [];
  const observedAt = new Date().toISOString();

  for (const product of payload.products ?? []) {
    if (!product?.asin) continue;
    const asin = product.asin.toUpperCase();
    const current = product.stats?.current ?? [];
    const currentPriceCents = normalizeKeepaPrice(current[1] ?? current[0]);
    if (!currentPriceCents) {
      warnings.push(`${asin} 没有可用价格，已跳过`);
      continue;
    }
    const landedCostCents = Math.round(currentPriceCents * 0.3);
    const assumptions: EconomicsAssumptions = {
      salePriceCents: currentPriceCents,
      landedCostCents,
      fbaFeeCents: 0,
      referralRate: 0.15,
      adRate: 0.12,
      returnRate: 0.05,
      returnProcessingCents: 300,
      returnRecoveryRate: 0.3,
      couponCents: 0,
      storageCents: 40,
      otherCostCents: 50,
    };
    const monthlySales = Math.max(0, Math.round(Number(product.monthlySold ?? 0)));
    const raw = asJsonObject(product);
    const category =
      product.categoryTree?.map((item) => item.name).filter(Boolean).at(-1) ||
      (product.rootCategory ? `Keepa category ${product.rootCategory}` : "未分类");
    const row: CandidateImportRow = {
      asin,
      marketplace,
      category,
      title: product.title || `Keepa ${asin}`,
      url: `https://www.amazon.${keepaAmazonDomain(marketplace)}/dp/${asin}`,
      competitorPriceCents: currentPriceCents,
      currency: keepaCurrency(marketplace),
      monthlySalesEstimate: monthlySales,
      monthlySalesMin: monthlySales,
      monthlySalesMax: monthlySales,
      reviewCount: Math.max(0, Math.round(Number(product.reviewCount ?? 0))),
      rating: normalizeKeepaRating(product.rating),
      bsr: optionalInteger(current[3]),
      keyword: "",
      keywordSearchVolume: null,
      sellerCount: null,
      variationCount: null,
      notes: "Keepa API 只读导入。销量、费用和评级仍需人工核验；成本模型暂时使用保守占位值。",
      source: "keepa",
      sourceRecordId: asin,
      observedAt,
      assumptions,
      rawPayload: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, String(value ?? "")])),
    };
    calculateEconomics(assumptions);
    records.push({
      record: row,
      rawPayload: raw,
      normalizedPayload: asJsonObject({ ...row, rawPayload: undefined }),
      sourceRecordId: `${marketplace}:${asin}`,
      observedAt,
      sourceUrl: row.url,
    });
  }

  return { sourceCode: "keepa", records, warnings };
}

function normalizeKeepaPrice(value: number | null | undefined) {
  if (!value || value < 0) return 0;
  return Math.round(value);
}

function optionalInteger(value: number | null | undefined) {
  return value && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function normalizeKeepaRating(value: number | null | undefined) {
  if (!value || !Number.isFinite(value)) return null;
  const rating = value > 5 ? value / 10 : value;
  return Math.min(5, Math.max(0, rating));
}

function keepaCurrency(marketplace: string) {
  return ({
    US: "USD",
    GB: "GBP",
    DE: "EUR",
    FR: "EUR",
    IT: "EUR",
    ES: "EUR",
    JP: "JPY",
    CA: "CAD",
    IN: "INR",
    MX: "MXN",
    BR: "BRL",
    AU: "AUD",
  } as Record<string, string>)[marketplace] ?? "USD";
}

function keepaAmazonDomain(marketplace: string) {
  return ({
    US: "com",
    GB: "co.uk",
    DE: "de",
    FR: "fr",
    IT: "it",
    ES: "es",
    JP: "co.jp",
    CA: "ca",
    IN: "in",
    MX: "com.mx",
    BR: "com.br",
    AU: "com.au",
  } as Record<string, string>)[marketplace] ?? "com";
}
