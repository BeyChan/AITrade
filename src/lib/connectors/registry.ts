import type { DataSourceReadiness } from "./types.ts";

type ReadinessDefinition = Omit<DataSourceReadiness, "configured" | "status">;

const definitions: ReadinessDefinition[] = [
  {
    code: "csv_candidates",
    name: "候选品 CSV",
    kind: "csv",
    adapterImplemented: true,
    credentialEnv: [],
    note: "真实选品表、平台后台导出或第三方工具导出均可；保留来源与采集时间。",
    externalActions: "none",
  },
  {
    code: "csv_suppliers",
    name: "供应商 CSV",
    kind: "csv",
    adapterImplemented: true,
    credentialEnv: [],
    note: "按平台 + 外部供应商 ID 或规范化链接去重，重复导入不会重复建档。",
    externalActions: "none",
  },
  {
    code: "csv_quotes",
    name: "报价 CSV",
    kind: "csv",
    adapterImplemented: true,
    credentialEnv: [],
    note: "报价通过 ASIN/市场或 case_id 关联已立项商品；只入库，不发送 RFQ。",
    externalActions: "none",
  },
  {
    code: "manual_quotes",
    name: "人工报价录入",
    kind: "manual",
    adapterImplemented: true,
    credentialEnv: [],
    note: "在供应商询价页人工录入报价；只入库，不发送 RFQ、不自动定标。",
    externalActions: "none",
  },
  {
    code: "keepa",
    name: "Keepa 商品数据",
    kind: "api",
    adapterImplemented: true,
    credentialEnv: ["KEEPA_API_KEY"],
    note: "只读竞品商品数据 Adapter；配置 Key 后可同步指定 ASIN，不执行采购动作。",
    externalActions: "read_only",
  },
  {
    code: "amazon_sp_api",
    name: "Amazon SP-API（自有店铺）",
    kind: "api",
    adapterImplemented: false,
    credentialEnv: ["AMAZON_SP_API_CLIENT_ID", "AMAZON_SP_API_CLIENT_SECRET", "AMAZON_SP_API_REFRESH_TOKEN"],
    note: "支持只读授权诊断；用于自有店铺 Listing、库存和订单，不能作为竞品销量数据源。写连接尚未实现。",
    externalActions: "read_only",
    diagnostic: "seller_read",
    docsUrl: "https://developer-docs.amazon.com/sp-api/",
  },
  {
    code: "shopify",
    name: "Shopify Admin API",
    kind: "api",
    adapterImplemented: false,
    credentialEnv: ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ACCESS_TOKEN"],
    note: "支持只读店铺诊断；用于独立站 Listing、库存和订单。写连接尚未实现。",
    externalActions: "read_only",
    diagnostic: "seller_read",
    docsUrl: "https://shopify.dev/docs/api/admin",
  },
  {
    code: "tiktok_shop",
    name: "TikTok Shop Partner API",
    kind: "api",
    adapterImplemented: false,
    credentialEnv: ["TIKTOK_SHOP_APP_KEY", "TIKTOK_SHOP_APP_SECRET"],
    note: "需要 Partner 应用与店铺授权；连接诊断和写 Adapter 尚未实现。",
    externalActions: "none",
    diagnostic: "not_available",
    docsUrl: "https://partner.tiktokshop.com/docv2/page/overview",
  },
  {
    code: "ebay",
    name: "eBay Sell APIs",
    kind: "api",
    adapterImplemented: false,
    credentialEnv: ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET"],
    note: "支持应用凭证诊断；卖家 OAuth 与写 Adapter 尚未实现。",
    externalActions: "read_only",
    diagnostic: "application_credentials",
    docsUrl: "https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html",
  },
  {
    code: "alibaba_1688",
    name: "1688 / Alibaba 官方授权接口",
    kind: "api",
    adapterImplemented: false,
    credentialEnv: ["ALIBABA_1688_APP_KEY", "ALIBABA_1688_APP_SECRET"],
    note: "需官方开放平台审核；不采用未授权爬虫。连接诊断和 Adapter 尚未实现。",
    externalActions: "none",
    diagnostic: "not_available",
    docsUrl: "https://open.1688.com/",
  },
];

export function getConnectorReadiness(env: NodeJS.ProcessEnv = process.env): DataSourceReadiness[] {
  return definitions.map((definition) => {
    const configured = definition.credentialEnv.every((name) => Boolean(env[name]?.trim()));
    const status: DataSourceReadiness["status"] = !definition.adapterImplemented
      ? "planned"
      : definition.credentialEnv.length === 0
        ? "available"
        : configured
          ? "configured"
          : "not_configured";
    return { ...definition, configured, status };
  });
}

export function getConnectorDefinition(code: string, env: NodeJS.ProcessEnv = process.env) {
  return getConnectorReadiness(env).find((source) => source.code === code) ?? null;
}
