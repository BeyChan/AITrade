import { ConnectorNotConfiguredError } from "./types.ts";

export type ConnectorDiagnosticCode = "amazon_sp_api" | "shopify" | "ebay" | "tiktok_shop" | "alibaba_1688";

export type ConnectorEnv = Readonly<Record<string, string | undefined>>;

export type ConnectorDiagnosticResult = {
  sourceCode: ConnectorDiagnosticCode;
  status: "verified" | "credentials_valid" | "failed" | "unsupported";
  verificationLevel: "seller_read" | "application_credentials" | "unsupported";
  message: string;
  durationMs: number;
  checkedAt: string;
  details: Record<string, unknown>;
  externalActions: "read_only" | "none";
};

type DiagnosticDefinition = {
  code: ConnectorDiagnosticCode;
  name: string;
  requiredEnv: string[];
  supported: boolean;
};

const definitions: Record<ConnectorDiagnosticCode, DiagnosticDefinition> = {
  amazon_sp_api: {
    code: "amazon_sp_api",
    name: "Amazon SP-API",
    requiredEnv: [
      "AMAZON_SP_API_CLIENT_ID",
      "AMAZON_SP_API_CLIENT_SECRET",
      "AMAZON_SP_API_REFRESH_TOKEN",
    ],
    supported: true,
  },
  shopify: {
    code: "shopify",
    name: "Shopify Admin API",
    requiredEnv: ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ACCESS_TOKEN"],
    supported: true,
  },
  ebay: {
    code: "ebay",
    name: "eBay",
    requiredEnv: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    supported: true,
  },
  tiktok_shop: {
    code: "tiktok_shop",
    name: "TikTok Shop Partner API",
    requiredEnv: ["TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET"],
    supported: false,
  },
  alibaba_1688: {
    code: "alibaba_1688",
    name: "1688 / Alibaba",
    requiredEnv: ["ALIBABA_1688_APP_KEY", "ALIBABA_1688_APP_SECRET"],
    supported: false,
  },
};

const AMAZON_SP_API_ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

type DiagnosticPayload = Pick<
  ConnectorDiagnosticResult,
  "status" | "verificationLevel" | "message" | "details"
>;

export function getConnectorDiagnosticDefinition(code: string) {
  return definitions[code as ConnectorDiagnosticCode] ?? null;
}

export async function runConnectorDiagnostic(
  code: ConnectorDiagnosticCode,
  env: ConnectorEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectorDiagnosticResult> {
  const definition = definitions[code];
  if (!definition) throw new Error(`不支持的连接器：${code}`);
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  if (!definition.supported) {
    return {
      sourceCode: code,
      status: "unsupported",
      verificationLevel: "unsupported",
      message: `${definition.name} 尚未实现官方连接诊断，不会发起外部请求。`,
      durationMs: Date.now() - startedAt,
      checkedAt,
      details: { requiredEnv: definition.requiredEnv, externalRequestAttempted: false },
      externalActions: "none",
    };
  }

  const missing = definition.requiredEnv.filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new ConnectorNotConfiguredError(definition.name);

  try {
    const payload =
      code === "amazon_sp_api"
        ? await checkAmazon(env, fetchImpl)
        : code === "shopify"
          ? await checkShopify(env, fetchImpl)
          : await checkEbay(env, fetchImpl);
    return {
      sourceCode: code,
      ...payload,
      durationMs: Date.now() - startedAt,
      checkedAt,
      externalActions: "read_only",
    };
  } catch (error) {
    return {
      sourceCode: code,
      status: "failed",
      verificationLevel: code === "ebay" ? "application_credentials" : "seller_read",
      message: diagnosticErrorMessage(error),
      durationMs: Date.now() - startedAt,
      checkedAt,
      details: { externalRequestAttempted: true },
      externalActions: "read_only",
    };
  }
}

async function checkAmazon(env: ConnectorEnv, fetchImpl: typeof fetch): Promise<DiagnosticPayload> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: requiredEnv(env, "AMAZON_SP_API_REFRESH_TOKEN"),
    client_id: requiredEnv(env, "AMAZON_SP_API_CLIENT_ID"),
    client_secret: requiredEnv(env, "AMAZON_SP_API_CLIENT_SECRET"),
  });
  const tokenResponse = await fetchImpl("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) throw new Error(`Amazon LWA 凭证交换失败：HTTP ${tokenResponse.status}`);
  const tokenPayload = await parseJsonObject(tokenResponse);
  const accessToken = String(tokenPayload.access_token ?? "");
  if (!accessToken) throw new Error("Amazon LWA 响应缺少 access_token");

  const region = (env.AMAZON_SP_API_REGION || "na").trim().toLowerCase();
  const endpoint = AMAZON_SP_API_ENDPOINTS[region];
  if (!endpoint) throw new Error("AMAZON_SP_API_REGION 只支持 na、eu 或 fe");
  const sellerResponse = await fetchImpl(`${endpoint}/sellers/v1/marketplaceParticipations`, {
    headers: { Accept: "application/json", "x-amz-access-token": accessToken },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!sellerResponse.ok) throw new Error(`Amazon Seller API 权限检查失败：HTTP ${sellerResponse.status}`);
  const sellerPayload = await parseJsonObject(sellerResponse);
  const participations = Array.isArray(sellerPayload.payload) ? sellerPayload.payload : [];
  const marketplaceIds = participations
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const marketplace = (item as Record<string, unknown>).marketplace;
      if (!marketplace || typeof marketplace !== "object") return "";
      return String((marketplace as Record<string, unknown>).id ?? "");
    })
    .filter(Boolean);
  return {
    status: "verified",
    verificationLevel: "seller_read",
    message: `Amazon 自有店铺授权已验证，共发现 ${participations.length} 个可访问市场。`,
    details: { region, marketplaceCount: participations.length, marketplaceIds },
  };
}

async function checkShopify(env: ConnectorEnv, fetchImpl: typeof fetch): Promise<DiagnosticPayload> {
  const shopDomain = requiredEnv(env, "SHOPIFY_SHOP_DOMAIN")
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    throw new Error("SHOPIFY_SHOP_DOMAIN 必须是 xxx.myshopify.com");
  }
  const apiVersion = (env.SHOPIFY_API_VERSION || "2026-10").trim();
  if (!/^\d{4}-\d{2}$/.test(apiVersion)) throw new Error("SHOPIFY_API_VERSION 必须使用 YYYY-MM 格式");

  const response = await fetchImpl(`https://${shopDomain}/admin/api/${apiVersion}/shop.json`, {
    headers: {
      Accept: "application/json",
      "X-Shopify-Access-Token": requiredEnv(env, "SHOPIFY_ACCESS_TOKEN"),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Shopify Admin API 检查失败：HTTP ${response.status}`);
  const payload = await parseJsonObject(response);
  const shop = payload.shop && typeof payload.shop === "object" ? (payload.shop as Record<string, unknown>) : {};
  return {
    status: "verified",
    verificationLevel: "seller_read",
    message: "Shopify 店铺只读授权已验证。",
    details: {
      shopDomain,
      apiVersion,
      shopName: String(shop.name ?? ""),
      currency: String(shop.currency ?? ""),
      countryCode: String(shop.country_code ?? ""),
    },
  };
}

async function checkEbay(env: ConnectorEnv, fetchImpl: typeof fetch): Promise<DiagnosticPayload> {
  const environment = (env.EBAY_ENVIRONMENT || "production").trim().toLowerCase();
  if (environment !== "production" && environment !== "sandbox") {
    throw new Error("EBAY_ENVIRONMENT 只支持 production 或 sandbox");
  }
  const apiBase = environment === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  const clientId = requiredEnv(env, "EBAY_CLIENT_ID");
  const clientSecret = requiredEnv(env, "EBAY_CLIENT_SECRET");
  const response = await fetchImpl(`${apiBase}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`eBay 应用凭证检查失败：HTTP ${response.status}`);
  const payload = await parseJsonObject(response);
  if (!String(payload.access_token ?? "")) throw new Error("eBay 响应缺少 access_token");
  return {
    status: "credentials_valid",
    verificationLevel: "application_credentials",
    message: "eBay 应用凭证已通过；卖家 OAuth 和 Sell API 权限仍需单独验收。",
    details: { environment, scope: String(payload.scope ?? ""), expiresIn: Number(payload.expires_in ?? 0) },
  };
}

function requiredEnv(env: ConnectorEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new ConnectorNotConfiguredError(name);
  return value;
}

async function parseJsonObject(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new Error("平台返回了无法解析的 JSON");
  }
}

function diagnosticErrorMessage(error: unknown) {
  if (error instanceof ConnectorNotConfiguredError) return error.message;
  if (error instanceof Error) return `连接检查失败：${error.message}`;
  return "连接检查失败：未知错误";
}
