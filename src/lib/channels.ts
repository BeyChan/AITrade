import {
  normalizeListingContent,
  preflightListing,
  type ListingDraftContent,
  type ListingPreflightResult,
  type PreflightFinding,
} from "./listing.ts";

export type ChannelAdapterType = "api" | "feed" | "manual";

export type ChannelContext = {
  marketCode: string;
  locale: string;
  currency: string;
};

export type ChannelProfile = {
  platform: string;
  label: string;
  adapterType: ChannelAdapterType;
  mappingSupported: boolean;
  publishingSupported: boolean;
  connectionLabel: string;
  mapToPayload: (content: ListingDraftContent, context: ChannelContext) => Record<string, unknown>;
  preflight: (content: Partial<ListingDraftContent>, context: ChannelContext) => ListingPreflightResult;
};

type GenericRules = {
  titleMax: number;
  titleSoftMin: number;
  descriptionMax: number;
  minimumBullets: number;
  bulletMax: number;
  searchTermsRequired: boolean;
  searchTermsMaxBytes: number;
};

const profiles: Record<string, ChannelProfile> = {
  amazon: {
    platform: "amazon",
    label: "Amazon",
    adapterType: "api",
    mappingSupported: true,
    publishingSupported: false,
    connectionLabel: "SP-API 未接入，仅本地映射预览",
    mapToPayload: (content, context) => ({
      marketplace_id: context.marketCode,
      locale: context.locale,
      currency: context.currency,
      product_type: "PRODUCT",
      attributes: {
        item_name: [{ value: content.title, language_tag: context.locale }],
        brand: content.brand ? [{ value: content.brand, language_tag: context.locale }] : [],
        bullet_point: content.bullets
          .filter(Boolean)
          .map((value) => ({ value, language_tag: context.locale })),
        product_description: [{ value: content.description, language_tag: context.locale }],
        generic_keyword: [{ value: content.searchTerms, language_tag: context.locale }],
      },
    }),
    preflight: (input) => preflightListing(input),
  },
  shopify: {
    platform: "shopify",
    label: "Shopify",
    adapterType: "api",
    mappingSupported: true,
    publishingSupported: false,
    connectionLabel: "Admin API 未接入，仅本地映射预览",
    mapToPayload: (content, context) => ({
      product: {
        title: content.title,
        body_html: toSimpleHtml(content.description, content.bullets),
        handle: slugify(content.title),
        tags: splitTags(content.searchTerms),
        status: "draft",
        variants: [{ inventory_management: "shopify" }],
      },
      _meta: { market: context.marketCode, locale: context.locale, currency: context.currency },
    }),
    preflight: (input, context) =>
      genericPreflight(input, context, {
        titleMax: 255,
        titleSoftMin: 20,
        descriptionMax: 5000,
        minimumBullets: 1,
        bulletMax: 1000,
        searchTermsRequired: false,
        searchTermsMaxBytes: 1000,
      }),
  },
  tiktok_shop: {
    platform: "tiktok_shop",
    label: "TikTok Shop",
    adapterType: "api",
    mappingSupported: true,
    publishingSupported: false,
    connectionLabel: "Partner API 未接入，仅本地映射预览",
    mapToPayload: (content, context) => ({
      title: content.title,
      description: [content.bullets.filter(Boolean).join("\n"), content.description].filter(Boolean).join("\n\n"),
      selling_points: content.bullets.filter(Boolean),
      brand: content.brand,
      market: context.marketCode,
      locale: context.locale,
      currency: context.currency,
      status: "draft",
    }),
    preflight: (input, context) =>
      genericPreflight(input, context, {
        titleMax: 255,
        titleSoftMin: 20,
        descriptionMax: 4000,
        minimumBullets: 3,
        bulletMax: 500,
        searchTermsRequired: false,
        searchTermsMaxBytes: 500,
      }),
  },
  ebay: {
    platform: "ebay",
    label: "eBay",
    adapterType: "api",
    mappingSupported: true,
    publishingSupported: false,
    connectionLabel: "Sell API 未接入，当前仅保留目标与占位映射",
    mapToPayload: (content, context) => ({
      title: content.title,
      description: toSimpleHtml(content.description, content.bullets),
      marketplaceId: context.marketCode,
      currency: context.currency,
      listingPolicies: null,
      status: "draft",
    }),
    preflight: (input, context) => {
      const result = genericPreflight(input, context, {
        titleMax: 80,
        titleSoftMin: 20,
        descriptionMax: 500000,
        minimumBullets: 1,
        bulletMax: 500,
        searchTermsRequired: false,
        searchTermsMaxBytes: 1000,
      });
      return addFinding(result, {
        code: "CONNECTOR_NOT_CONNECTED",
        severity: "warning",
        field: "claims",
        message: "eBay Sell API 尚未接入；当前结果只验证本地字段，不能视为可发布。",
      });
    },
  },
  manual: {
    platform: "manual",
    label: "CSV / 人工",
    adapterType: "manual",
    mappingSupported: true,
    publishingSupported: false,
    connectionLabel: "仅生成人工核对字段，不执行导出或发布",
    mapToPayload: (content, context) => ({
      title: content.title,
      brand: content.brand,
      bullet_1: content.bullets[0] ?? "",
      bullet_2: content.bullets[1] ?? "",
      bullet_3: content.bullets[2] ?? "",
      bullet_4: content.bullets[3] ?? "",
      bullet_5: content.bullets[4] ?? "",
      description: content.description,
      search_terms: content.searchTerms,
      market: context.marketCode,
      locale: context.locale,
      currency: context.currency,
    }),
    preflight: (input, context) =>
      genericPreflight(input, context, {
        titleMax: 500,
        titleSoftMin: 10,
        descriptionMax: 20000,
        minimumBullets: 0,
        bulletMax: 1000,
        searchTermsRequired: false,
        searchTermsMaxBytes: 2000,
      }),
  },
};

export function getChannelProfile(platformCode: string): ChannelProfile {
  const profile = profiles[platformCode];
  if (profile) return profile;

  return {
    platform: platformCode,
    label: platformCode,
    adapterType: "manual",
    mappingSupported: false,
    publishingSupported: false,
    connectionLabel: "未知平台，不能生成字段映射",
    mapToPayload: (_content, context) => ({ market: context.marketCode, locale: context.locale, currency: context.currency }),
    preflight: (input, context) =>
      genericPreflight(input, context, {
        titleMax: 200,
        titleSoftMin: 20,
        descriptionMax: 2000,
        minimumBullets: 1,
        bulletMax: 500,
        searchTermsRequired: false,
        searchTermsMaxBytes: 250,
      }),
  };
}

export function mapChannelPayload(
  platformCode: string,
  input: Partial<ListingDraftContent>,
  context: ChannelContext,
) {
  const content = normalizeListingContent(input);
  return getChannelProfile(platformCode).mapToPayload(content, context);
}

export function preflightChannelContent(
  platformCode: string,
  input: Partial<ListingDraftContent>,
  context: ChannelContext,
) {
  return getChannelProfile(platformCode).preflight(input, context);
}

function genericPreflight(
  input: Partial<ListingDraftContent>,
  context: ChannelContext,
  rules: GenericRules,
): ListingPreflightResult {
  const content = normalizeListingContent(input);
  const findings: PreflightFinding[] = [];
  const add = (code: string, severity: "error" | "warning", field: PreflightFinding["field"], message: string) => {
    findings.push({ code, severity, field, message });
  };

  if (!content.title) {
    add("TITLE_EMPTY", "error", "title", "标题不能为空。");
  } else {
    if (content.title.length > rules.titleMax) {
      add("TITLE_TOO_LONG", "error", "title", `标题 ${content.title.length} 字符，超过该平台/市场保守上限 ${rules.titleMax}。`);
    }
    if (content.title.length < rules.titleSoftMin) {
      add("TITLE_SHORT", "warning", "title", `标题少于 ${rules.titleSoftMin} 个字符，可能缺少品类、场景或核心差异点。`);
    }
  }

  const filledBullets = content.bullets.filter(Boolean);
  if (filledBullets.length < rules.minimumBullets) {
    add("BULLETS_INCOMPLETE", "error", "bullets", `至少需要 ${rules.minimumBullets} 条卖点，当前为 ${filledBullets.length} 条。`);
  }
  content.bullets.forEach((bullet, index) => {
    if (bullet.length > rules.bulletMax) {
      add(`BULLET_${index + 1}_TOO_LONG`, "error", "bullets", `第 ${index + 1} 条卖点超过 ${rules.bulletMax} 字符。`);
    }
  });

  if (!content.description) {
    add("DESCRIPTION_EMPTY", "error", "description", "商品描述不能为空。");
  } else if (content.description.length > rules.descriptionMax) {
    add("DESCRIPTION_TOO_LONG", "error", "description", `商品描述超过 ${rules.descriptionMax} 字符。`);
  }

  const searchTermsBytes = new TextEncoder().encode(content.searchTerms).length;
  if (rules.searchTermsRequired && !content.searchTerms) {
    add("SEARCH_TERMS_EMPTY", "error", "searchTerms", "该渠道要求填写后台搜索词。");
  } else if (searchTermsBytes > rules.searchTermsMaxBytes) {
    add("SEARCH_TERMS_TOO_LONG", "error", "searchTerms", `搜索词 ${searchTermsBytes} 字节，超过 ${rules.searchTermsMaxBytes} 字节。`);
  }

  const visibleText = [content.title, ...content.bullets, content.description].join("\n");
  if (containsRiskyClaim(visibleText)) {
    add("CLAIMS_REVIEW", "warning", "claims", "检测到绝对化或高风险声明，需要人工核对证据和当地广告法规。");
  }
  if (!/^[a-z]{2}-[A-Z]{2}$/.test(context.locale)) {
    add("LOCALE_INVALID", "warning", "claims", `市场 locale ${context.locale} 不是标准 BCP 47 形式，请人工确认。`);
  }
  if (!/^[A-Z]{3}$/.test(context.currency)) {
    add("CURRENCY_INVALID", "error", "claims", `币种 ${context.currency} 不是三位 ISO 代码。`);
  }

  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  const warningCount = findings.length - errorCount;
  return {
    passed: errorCount === 0,
    score: Math.max(0, 100 - errorCount * 25 - warningCount * 5),
    errorCount,
    warningCount,
    findings,
    metrics: {
      titleChars: content.title.length,
      bulletCount: content.bullets.length,
      filledBulletCount: filledBullets.length,
      maxBulletChars: Math.max(0, ...content.bullets.map((bullet) => bullet.length)),
      descriptionChars: content.description.length,
      searchTermsBytes,
    },
  };
}

function addFinding(result: ListingPreflightResult, finding: PreflightFinding): ListingPreflightResult {
  const findings = [...result.findings, finding];
  const errorCount = findings.filter((item) => item.severity === "error").length;
  const warningCount = findings.length - errorCount;
  return {
    ...result,
    passed: errorCount === 0,
    errorCount,
    warningCount,
    findings,
    score: Math.max(0, 100 - errorCount * 25 - warningCount * 5),
  };
}

function splitTags(value: string) {
  return value
    .split(/[\s,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function toSimpleHtml(description: string, bullets: string[]) {
  const escapedDescription = escapeHtml(description);
  const list = bullets.filter(Boolean).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("");
  return `${list ? `<ul>${list}</ul>` : ""}<p>${escapedDescription}</p>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function containsRiskyClaim(value: string) {
  return /\b(?:best|guaranteed|#1|cure|fda approved|zero risk)\b|100%|绝对|第一|最佳|治愈|永久|零风险/i.test(value);
}
