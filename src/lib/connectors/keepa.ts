import { calculateEconomics, type EconomicsAssumptions } from "../economics.ts";
import type { CandidateImportRow } from "../csv.ts";
import {
  asJsonObject,
  ConnectorNotConfiguredError,
  type ConnectorApiCall,
  type ConnectorResult,
} from "./types.ts";

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

export type KeepaFetchOptions = {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttempt?: (call: ConnectorApiCall) => void | Promise<void>;
};

export async function fetchKeepaCandidates(input: {
  asins: string[];
  marketplace: string;
  env?: NodeJS.ProcessEnv;
  fetchOptions?: KeepaFetchOptions;
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

  const fetchImpl = input.fetchOptions?.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, Math.min(5, input.fetchOptions?.maxAttempts ?? 3));
  const retryBaseDelayMs = Math.max(0, input.fetchOptions?.retryBaseDelayMs ?? 600);
  const retryMaxDelayMs = Math.max(retryBaseDelayMs, input.fetchOptions?.retryMaxDelayMs ?? 8_000);
  const sleep = input.fetchOptions?.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const apiCalls: ConnectorApiCall[] = [];
  let payload: KeepaResponse | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    let response: Response | null = null;
    let responseBody = "";
    let callError: Error | null = null;

    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(25_000),
        cache: "no-store",
      });
      responseBody = await response.text();
    } catch (error) {
      callError = new Error(safeErrorMessage(error, apiKey));
    }

    const parsedPayload = parseKeepaResponse(responseBody);
    const keepsRetrying = Boolean(
      callError ||
      (response && (response.status === 429 || response.status === 408 || response.status >= 500)),
    );
    const apiCall: ConnectorApiCall = {
      endpoint: "/product",
      method: "GET",
      statusCode: response?.status ?? null,
      durationMs: Math.max(0, Date.now() - startedAt),
      retryCount: attempt - 1,
      requestSummary: {
        domain,
        asinCount: asins.length,
        statsWindow: 30,
      },
      responseSummary: response
        ? {
            httpStatus: response.status,
            productCount: parsedPayload?.products?.length ?? 0,
            keepaError: parsedPayload?.error?.message ? safeErrorMessage(parsedPayload.error.message, apiKey) : null,
          }
        : {},
      errorMessage: callError?.message ?? (!response?.ok && parsedPayload?.error?.message
        ? safeErrorMessage(parsedPayload.error.message, apiKey)
        : null),
    };
    apiCalls.push(apiCall);
    await input.fetchOptions?.onAttempt?.(apiCall);

    if (!keepsRetrying && response?.ok && parsedPayload) {
      payload = parsedPayload;
      break;
    }

    if (!keepsRetrying) {
      const detail = callError?.message || parsedPayload?.error?.message || (response ? `HTTP ${response.status}` : "网络请求失败");
      throw new Error(`Keepa 请求失败：${safeErrorMessage(detail, apiKey)}`);
    }
    if (attempt === maxAttempts) {
      const detail = callError?.message || (response ? `HTTP ${response.status}` : "网络请求失败");
      throw new Error(`Keepa 请求在 ${maxAttempts} 次尝试后失败：${safeErrorMessage(detail, apiKey)}`);
    }

    const retryAfterMs = retryAfterMilliseconds(response?.headers.get("retry-after"));
    const backoffMs = Math.min(retryMaxDelayMs, Math.max(retryAfterMs, retryBaseDelayMs * 2 ** (attempt - 1)));
    if (backoffMs > 0) await sleep(backoffMs);
  }

  if (!payload) throw new Error("Keepa 请求失败：没有可用响应");
  if (payload.error?.message) throw new Error(`Keepa 返回错误：${safeErrorMessage(payload.error.message, apiKey)}`);

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

  return { sourceCode: "keepa", records, warnings, apiCalls };
}

function parseKeepaResponse(body: string): KeepaResponse | null {
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as KeepaResponse;
  } catch {
    return null;
  }
}

function retryAfterMilliseconds(value: string | null | undefined) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : 0;
}

function safeErrorMessage(error: unknown, apiKey: string) {
  const message = error instanceof Error ? error.message : String(error || "未知错误");
  return message.replaceAll(apiKey, "[REDACTED]").slice(0, 500);
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
