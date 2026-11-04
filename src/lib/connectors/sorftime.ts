import type { CandidateImportRow } from "../csv.ts";
import type { EconomicsAssumptions } from "../economics.ts";
import {
  asJsonObject,
  ConnectorNotConfiguredError,
  type ConnectorApiCall,
  type ConnectorRecord,
  type ConnectorResult,
} from "./types.ts";

export { ConnectorNotConfiguredError } from "./types.ts";

const SORFTIME_ENDPOINT = "https://mcp.sorftime.com";
const MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const MAX_ASINS = 20;
const DEFAULT_MAX_PRODUCTS = 50;
const MAX_CATEGORY_QUERY_LENGTH = 120;

const MARKET_CONFIG: Record<string, { currency: string; amazonDomain: string }> = {
  US: { currency: "USD", amazonDomain: "com" },
  CA: { currency: "CAD", amazonDomain: "ca" },
  MX: { currency: "MXN", amazonDomain: "com.mx" },
  BR: { currency: "BRL", amazonDomain: "com.br" },
  GB: { currency: "GBP", amazonDomain: "co.uk" },
  DE: { currency: "EUR", amazonDomain: "de" },
  FR: { currency: "EUR", amazonDomain: "fr" },
  IT: { currency: "EUR", amazonDomain: "it" },
  ES: { currency: "EUR", amazonDomain: "es" },
  NL: { currency: "EUR", amazonDomain: "nl" },
  SE: { currency: "SEK", amazonDomain: "se" },
  PL: { currency: "PLN", amazonDomain: "pl" },
  JP: { currency: "JPY", amazonDomain: "co.jp" },
  AU: { currency: "AUD", amazonDomain: "com.au" },
};

export const SORFTIME_MARKET_CODES = Object.keys(MARKET_CONFIG);

type ToolName = "category_name_search" | "category_report" | "product_detail";

export type SorftimeResearchRequest = {
  mode: "category" | "asin";
  marketplace: string;
  categoryQuery?: unknown;
  nodeId?: unknown;
  asins?: unknown;
};

export type NormalizedSorftimeRequest = {
  mode: "category" | "asin";
  marketplace: string;
  categoryQuery?: string;
  nodeId?: string;
  asins?: string[];
};

export type SorftimeFetchOptions = {
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onAttempt?: (call: ConnectorApiCall) => void | Promise<void>;
};

export type SorftimeFetchInput = NormalizedSorftimeRequest & {
  maxProducts?: number;
  env?: NodeJS.ProcessEnv;
  fetchOptions?: SorftimeFetchOptions;
};

export function isSorftimeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.SORFTIME_API_KEY?.trim());
}

export function normalizeSorftimeRequest(input: SorftimeResearchRequest): NormalizedSorftimeRequest {
  const marketplace = input.marketplace.trim().toUpperCase();
  if (!MARKET_CONFIG[marketplace]) {
    throw new Error(`Sorftime Adapter 暂不支持市场 ${marketplace || "(空)"}`);
  }
  if (input.mode !== "category" && input.mode !== "asin") {
    throw new Error("Sorftime 研究模式只能是 category 或 asin");
  }

  if (input.mode === "asin") {
    const asins = normalizeAsins(input.asins);
    if (asins.length === 0) throw new Error("请至少填写一个 ASIN");
    if (asins.length > MAX_ASINS) throw new Error(`单次 Sorftime ASIN 研究最多 ${MAX_ASINS} 个 ASIN`);
    const malformed = asins.find((asin) => !/^[A-Z0-9]{10}$/.test(asin));
    if (malformed) throw new Error(`ASIN 格式不正确：${malformed}`);
    return { mode: "asin", marketplace, asins };
  }

  const categoryQuery = optionalText(input.categoryQuery);
  const nodeId = optionalText(input.nodeId);
  if (categoryQuery && categoryQuery.length > MAX_CATEGORY_QUERY_LENGTH) {
    throw new Error(`类目关键词不能超过 ${MAX_CATEGORY_QUERY_LENGTH} 个字符`);
  }
  if (nodeId && !/^\d{1,20}$/.test(nodeId)) {
    throw new Error("类目 Node ID 必须为数字");
  }
  if (!categoryQuery && !nodeId) throw new Error("请填写类目关键词或 Node ID");
  return {
    mode: "category",
    marketplace,
    ...(categoryQuery ? { categoryQuery } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

export async function fetchSorftimeCandidates(input: SorftimeFetchInput): Promise<ConnectorResult<CandidateImportRow>> {
  const normalized = normalizeSorftimeRequest(input);
  const env = input.env ?? process.env;
  const apiKey = env.SORFTIME_API_KEY?.trim() ?? "";
  if (!apiKey) throw new ConnectorNotConfiguredError("Sorftime");

  const observedAt = new Date().toISOString();
  const apiCalls: ConnectorApiCall[] = [];
  const fetchImpl = input.fetchOptions?.fetchImpl ?? fetch;
  const maxAttempts = Math.max(1, Math.min(5, input.fetchOptions?.maxAttempts ?? 3));
  const retryBaseDelayMs = Math.max(0, input.fetchOptions?.retryBaseDelayMs ?? 600);
  const retryMaxDelayMs = Math.max(retryBaseDelayMs, input.fetchOptions?.retryMaxDelayMs ?? 8_000);
  const sleep = input.fetchOptions?.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const endpoint = new URL(SORFTIME_ENDPOINT);
  endpoint.searchParams.set("key", apiKey);
  let requestId = 1;

  async function callTool(tool: ToolName, args: Record<string, unknown>): Promise<unknown> {
    const id = requestId;
    requestId += 1;
    const requestBody = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool, arguments: args },
    });

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();
      let response: Response | null = null;
      let responseBody = "";
      let callError: Error | null = null;
      let rpcError: string | null = null;
      let toolResult: unknown = null;

      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
          },
          body: requestBody,
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        });
        responseBody = await response.text();
        if (responseBody.length > MAX_RESPONSE_CHARS) {
          throw new Error(`Sorftime 响应超过 ${MAX_RESPONSE_CHARS} 字符限制`);
        }
        const parsed = parseMcpEnvelope(responseBody, apiKey);
        rpcError = parsed.error;
        toolResult = parsed.result;
      } catch (error) {
        callError = new Error(safeErrorMessage(error, apiKey));
      }

      const retryable = Boolean(
        callError ||
        !response ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500,
      );
      const call: ConnectorApiCall = {
        endpoint: "/mcp",
        method: "POST",
        statusCode: response?.status ?? null,
        durationMs: Math.max(0, Date.now() - startedAt),
        retryCount: attempt - 1,
        requestSummary: {
          tool,
          marketplace: normalized.marketplace,
          ...(tool === "product_detail" ? { asinCount: 1 } : {}),
          ...(tool === "category_report" ? { nodeIdPresent: true } : {}),
          ...(tool === "category_name_search" ? { queryLength: String(args.searchName ?? "").length } : {}),
        },
        responseSummary: {
          httpStatus: response?.status ?? null,
          contentType: response?.headers.get("content-type") ?? null,
          contentLength: responseBody.length,
          rpcResult: Boolean(toolResult),
        },
        errorMessage: callError?.message ?? rpcError ?? (!response?.ok ? `HTTP ${response?.status ?? "network"}` : null),
      };
      apiCalls.push(call);
      await input.fetchOptions?.onAttempt?.(call);

      if (!retryable && response?.ok && !rpcError && toolResult !== null) return toolResult;
      if (!retryable && response?.ok && rpcError) throw new Error(`Sorftime 工具 ${tool} 返回错误：${safeErrorMessage(rpcError, apiKey)}`);
      if (!retryable && response && !response.ok) {
        throw new Error(`Sorftime 请求失败：HTTP ${response.status}`);
      }
      if (attempt === maxAttempts) {
        const detail = callError?.message || rpcError || (response ? `HTTP ${response.status}` : "网络请求失败");
        throw new Error(`Sorftime 请求在 ${maxAttempts} 次尝试后失败：${safeErrorMessage(detail, apiKey)}`);
      }

      const retryAfterMs = retryAfterMilliseconds(response?.headers.get("retry-after"));
      const backoffMs = Math.min(retryMaxDelayMs, Math.max(retryAfterMs, retryBaseDelayMs * 2 ** (attempt - 1)));
      if (backoffMs > 0) await sleep(backoffMs);
    }

    throw new Error(`Sorftime 工具 ${tool} 没有可用响应`);
  }

  const warnings: string[] = [];
  const records: ConnectorRecord<CandidateImportRow>[] = [];
  const additionalEvidence: ConnectorRecord<unknown>[] = [];
  const market = MARKET_CONFIG[normalized.marketplace];
  if (!market) throw new Error(`Sorftime Adapter 暂不支持市场 ${normalized.marketplace}`);

  if (normalized.mode === "asin") {
    for (const asin of normalized.asins ?? []) {
      const result = await callTool("product_detail", {
        amzSite: normalized.marketplace,
        asin,
      });
      const product = findProductRecord(result, asin);
      if (!product) {
        warnings.push(`${asin} 的 product_detail 没有返回商品对象，已跳过`);
        continue;
      }
      const item = toCandidateRecord({
        product: { ...product, ASIN: textValue(product.ASIN) || asin },
        marketplace: normalized.marketplace,
        categoryFallback: "Sorftime 商品详情",
        observedAt,
        market,
        warnings,
      });
      if (item) records.push(item);
    }
    return {
      sourceCode: "sorftime",
      records,
      warnings,
      apiCalls,
      additionalEvidence,
    };
  }

  let nodeId = normalized.nodeId;
  let categoryName = normalized.categoryQuery || "";
  if (!nodeId) {
    const searchResult = await callTool("category_name_search", {
      amzSite: normalized.marketplace,
      searchName: normalized.categoryQuery,
    });
    const selected = findCategoryMatch(searchResult);
    if (!selected) throw new Error(`Sorftime 未找到类目：${normalized.categoryQuery ?? "(空)"}`);
    nodeId = selected.nodeId;
    categoryName = selected.name || categoryName;
  }

  const reportResult = await callTool("category_report", {
    amzSite: normalized.marketplace,
    nodeId,
  });
  const report = asObject(repairMojibakeDeep(reportResult));
  if (!report) throw new Error("Sorftime category_report 返回内容不是 JSON 对象");
  const stats = findCategoryStats(report);
  const products = findCategoryProducts(report);
  if (!products) throw new Error("Sorftime category_report 未返回 Top 产品数组");
  const maxProducts = Math.max(1, Math.min(DEFAULT_MAX_PRODUCTS, input.maxProducts ?? DEFAULT_MAX_PRODUCTS));
  if (products.length > maxProducts) {
    warnings.push(`Sorftime 返回 ${products.length} 个 Top 产品，本次仅导入前 ${maxProducts} 个`);
  }
  const reportCategory = textValue(stats?.["类目名称"]) || categoryName || `Node ${nodeId}`;

  for (const candidate of products.slice(0, maxProducts)) {
    const product = asObject(repairMojibakeDeep(candidate));
    if (!product) continue;
    const item = toCandidateRecord({
      product,
      marketplace: normalized.marketplace,
      categoryFallback: reportCategory,
      observedAt,
      market,
      warnings,
    });
    if (item) records.push(item);
  }
  if (records.length === 0) warnings.push("Sorftime 类目报告没有可导入的带价格商品，未创建候选品");

  additionalEvidence.push({
    record: report,
    rawPayload: asJsonObject(report),
    normalizedPayload: asJsonObject({
      marketplace: normalized.marketplace,
      nodeId,
      categoryName: reportCategory,
      stats,
      returnedProductCount: products.length,
      importedProductCount: records.length,
      source: "sorftime",
      externalActions: "read_only",
    }),
    sourceRecordId: `${normalized.marketplace}:category:${nodeId}`,
    observedAt,
    sourceUrl: `https://www.amazon.${market.amazonDomain}`,
  });

  return {
    sourceCode: "sorftime",
    records,
    warnings,
    apiCalls,
    additionalEvidence,
  };
}

function toCandidateRecord(input: {
  product: Record<string, unknown>;
  marketplace: string;
  categoryFallback: string;
  observedAt: string;
  market: { currency: string; amazonDomain: string };
  warnings: string[];
}): ConnectorRecord<CandidateImportRow> | null {
  const asin = normalizeAsin(field(input.product, ["ASIN", "asin", "产品ASIN码", "产品ASIN碼"]));
  if (!asin) {
    input.warnings.push("Sorftime 返回了缺少 ASIN 的商品，已跳过");
    return null;
  }
  const priceCents = moneyToCents(field(input.product, ["价格", "售价", "price", "Price"]));
  if (!priceCents) {
    input.warnings.push(`${asin} 没有可用价格，已跳过`);
    return null;
  }

  const monthlySales = nonNegativeInteger(field(input.product, ["月销量", "月销", "monthlySold", "monthlySales"]));
  const reviewCount = nonNegativeInteger(field(input.product, ["评论数", "评价数量", "reviewCount", "Reviews"]));
  const rating = normalizeRating(field(input.product, ["星级", "评分", "rating", "Rating"]));
  const brand = textValue(field(input.product, ["品牌", "brand", "Brand"]));
  const productCategory = textValue(field(input.product, ["产品分类", "类目名称", "category", "Category"]));
  const category = [input.categoryFallback, brand, productCategory].filter(Boolean).join(" · ") || "未分类";
  const url = `https://www.amazon.${input.market.amazonDomain}/dp/${encodeURIComponent(asin)}`;
  const landedCostCents = Math.round(priceCents * 0.3);
  const assumptions: EconomicsAssumptions = {
    salePriceCents: priceCents,
    landedCostCents,
    fbaFeeCents: Math.max(50, Math.round(priceCents * 0.12)),
    referralRate: 0.15,
    adRate: 0.12,
    returnRate: 0.05,
    returnProcessingCents: 300,
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: 40,
    otherCostCents: 50,
  };
  const rawPayload = Object.fromEntries(
    Object.entries(input.product).map(([key, value]) => [key, typeof value === "string" ? value : JSON.stringify(value)]),
  );
  const row: CandidateImportRow = {
    asin,
    marketplace: input.marketplace,
    category,
    title: textValue(field(input.product, ["标题", "产品标题", "title", "Title"])) || `未提供标题（${asin}）`,
    url,
    competitorPriceCents: priceCents,
    currency: input.market.currency,
    monthlySalesEstimate: monthlySales,
    monthlySalesMin: monthlySales,
    monthlySalesMax: monthlySales,
    reviewCount,
    rating,
    bsr: extractBsr(field(input.product, ["所处类目排名", "BSR", "bsr", "rank"])),
    keyword: textValue(field(input.product, ["关键词", "keyword"])),
    keywordSearchVolume: optionalNonNegativeInteger(field(input.product, ["关键词搜索量", "keywordSearchVolume"])),
    sellerCount: optionalNonNegativeInteger(field(input.product, ["卖家数", "sellerCount"])),
    variationCount: optionalNonNegativeInteger(field(input.product, ["变体数", "variationCount"])),
    notes: "Sorftime MCP 只读研究数据。销量为第三方估算；到岸成本、FBA、仓储和退货费用是研究占位值，必须用真实供应商报价、物流报价和平台费用重新测算后再立项。",
    source: "sorftime",
    sourceRecordId: asin,
    observedAt: input.observedAt,
    assumptions,
    rawPayload,
  };

  return {
    record: row,
    rawPayload: asJsonObject(input.product),
    normalizedPayload: asJsonObject({ ...row, rawPayload: undefined }),
    sourceRecordId: `${input.marketplace}:${asin}`,
    observedAt: input.observedAt,
    sourceUrl: url,
  };
}

function parseMcpEnvelope(body: string, apiKey: string): { result: unknown; error: string | null } {
  const envelope = parseJsonValue(body);
  const root = asObject(envelope);
  if (!root) return { result: null, error: "MCP 响应不是 JSON 对象" };
  const rpcError = root.error;
  if (rpcError) {
    const errorObject = asObject(rpcError);
    return { result: null, error: safeErrorMessage(textValue(errorObject?.message) || textValue(rpcError) || "JSON-RPC error", apiKey) };
  }
  const result = root.result ?? root;
  const resultObject = asObject(result);
  if (resultObject?.isError === true) {
    return { result: null, error: safeErrorMessage(extractToolText(resultObject) || "MCP tool returned isError=true", apiKey) };
  }
  const text = extractToolText(resultObject);
  if (text) {
    const toolValue = parseToolText(text);
    if (toolValue === null) return { result: null, error: "MCP 工具文本中没有可解析的 JSON" };
    return { result: toolValue, error: null };
  }
  return { result, error: null };
}

function extractToolText(result: Record<string, unknown> | null) {
  if (!result) return "";
  if (Array.isArray(result.content)) {
    const text = result.content
      .map((item) => {
        const block = asObject(item);
        return block?.type === "text" ? textValue(block.text) : "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  if (result.structuredContent !== undefined) return JSON.stringify(result.structuredContent);
  return "";
}

function parseToolText(text: string): unknown {
  const clean = text
    .replace(/^\uFEFF/, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const parsed = parseJsonValue(clean);
  if (parsed !== undefined) return repairMojibakeDeep(parsed);
  return null;
}

function parseJsonValue(text: string): unknown {
  const trimmed = text.trim().replace(/^\uFEFF/, "");
  if (!trimmed) return undefined;

  const parsedWhole = tryJsonParse(trimmed);
  if (parsedWhole !== undefined) return parsedWhole;

  const candidates: string[] = [];
  for (const event of trimmed.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (data && data !== "[DONE]") candidates.push(data);
  }
  for (const data of candidates) {
    const parsed = tryJsonParse(data);
    if (parsed !== undefined) return parsed;
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== "{" && char !== "[") continue;
    const document = extractBalancedJson(trimmed, index);
    if (!document) continue;
    const parsed = tryJsonParse(document);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function tryJsonParse(value: string): unknown {
  try {
    return JSON.parse(escapeControlCharsInStrings(value));
  } catch {
    return undefined;
  }
}

function extractBalancedJson(text: string, startIndex: number) {
  const opening = text[startIndex];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, index + 1);
    }
  }
  return null;
}

function escapeControlCharsInStrings(value: string) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (inString) {
      if (escaped) {
        output += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        output += char;
        escaped = true;
        continue;
      }
      if (char === "\"") {
        output += char;
        inString = false;
        continue;
      }
      if (code < 0x20) {
        output += code === 10 ? "\\n" : code === 13 ? "\\r" : code === 9 ? "\\t" : `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }
    } else if (char === "\"") {
      inString = true;
    }
    output += char;
  }
  return output;
}

function findCategoryMatch(value: unknown): { nodeId: string; name: string } | null {
  const fixed = repairMojibakeDeep(value);
  const queue: unknown[] = [fixed];
  while (queue.length > 0) {
    const current = queue.shift();
    const object = asObject(current);
    if (object) {
      const nodeId = textValue(field(object, ["NodeId", "nodeId", "node_id", "节点ID", "节点Id"]));
      if (nodeId && /^\d+$/.test(nodeId)) {
        return {
          nodeId,
          name: textValue(field(object, ["Name", "name", "类目名称", "CategoryName"])) || "",
        };
      }
      queue.push(...Object.values(object));
      continue;
    }
    if (Array.isArray(current)) queue.push(...current);
  }
  return null;
}

function findCategoryProducts(report: Record<string, unknown>) {
  const queue: unknown[] = [report];
  while (queue.length > 0) {
    const current = queue.shift();
    const object = asObject(current);
    if (object) {
      for (const key of ["Top100产品", "Top100產品", "Top产品", "产品列表", "products"]) {
        const value = object[key];
        if (Array.isArray(value)) return value;
      }
      queue.push(...Object.values(object));
    }
  }
  return null;
}

function findCategoryStats(report: Record<string, unknown>) {
  for (const key of ["类目统计报告", "類目統計報告", "categoryStats", "statistics"]) {
    const stats = asObject(report[key]);
    if (stats) return stats;
  }
  return null;
}

function findProductRecord(value: unknown, expectedAsin: string): Record<string, unknown> | null {
  const fixed = repairMojibakeDeep(value);
  const queue: unknown[] = [fixed];
  while (queue.length > 0) {
    const current = queue.shift();
    const object = asObject(current);
    if (object) {
      const asin = normalizeAsin(field(object, ["ASIN", "asin", "产品ASIN码", "产品ASIN碼"]));
      if (asin === expectedAsin) return object;
      queue.push(...Object.values(object));
      continue;
    }
    if (Array.isArray(current)) queue.push(...current);
  }
  return null;
}

function repairMojibakeDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(repairMojibakeDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [repairMojibake(key), repairMojibakeDeep(item)]),
    );
  }
  if (typeof value === "string") return repairMojibake(value);
  return value;
}

function repairMojibake(value: string) {
  if (!/[\u0080-\u00ff]/.test(value) || /[\u3400-\u9fff]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    if (repaired.includes("\uFFFD") || repaired === value) return value;
    return repaired;
  } catch {
    return value;
  }
}

function field(object: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (object[name] !== undefined && object[name] !== null) return object[name];
  }
  const entries = Object.entries(object);
  for (const name of names) {
    const match = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (match && match[1] !== null && match[1] !== undefined) return match[1];
  }
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizeAsins(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,，;；]+/)
      : [];
  return [...new Set(source.map((asin) => String(asin).trim().toUpperCase()).filter(Boolean))];
}

function normalizeAsin(value: unknown) {
  const asin = textValue(value).toUpperCase();
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : "";
}

function nonNegativeInteger(value: unknown) {
  return optionalNonNegativeInteger(value) ?? 0;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  const number = extractNumber(value);
  return number === null ? null : Math.max(0, Math.round(number));
}

function moneyToCents(value: unknown) {
  const number = extractNumber(value);
  return number === null || number <= 0 ? 0 : Math.round(number * 100);
}

function extractNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function extractBsr(value: unknown) {
  const text = textValue(value);
  if (!text) return null;
  const matches = [...text.matchAll(/(?:排名|Rank|BSR)\s*[:：]?\s*(\d+)/gi)];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : null;
}

function normalizeRating(value: unknown) {
  const number = extractNumber(value);
  if (number === null || number < 0) return null;
  const rating = number > 5 ? number / 10 : number;
  return Math.min(5, Math.max(0, rating));
}

function optionalText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
  return message
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .slice(0, 500);
}
