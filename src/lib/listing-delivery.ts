import { mapChannelPayload, preflightChannelContent, type ChannelContext } from "./channels.ts";
import { normalizeListingContent, type ListingDraftContent, type ListingPreflightResult } from "./listing.ts";

export type ImageAssetForPreflight = {
  id: string;
  assetType: string;
  status: string;
  fileName: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
};

export type ImagePreflightFinding = {
  code: string;
  severity: "error" | "warning";
  message: string;
};

export type ImagePreflightResult = {
  passed: boolean;
  approvedMainCount: number;
  totalCount: number;
  findings: ImagePreflightFinding[];
};

export type FeedExportInput = {
  platformCode: string;
  sku: string;
  externalProductId: string;
  brand: string;
  title: string;
  price: string;
  currency: string;
  quantity?: number;
  category?: string;
  bullets: string[];
  description: string;
  searchTerms: string;
  imageFilenames?: string[];
};

export type FeedExportOutput = {
  platformCode: string;
  format: "tsv" | "csv";
  mimeType: string;
  fileName: string;
  content: string;
};

const MARKET_LOCALES: Record<string, string> = {
  US: "en-US",
  UK: "en-GB",
  GB: "en-GB",
  DE: "de-DE",
  FR: "fr-FR",
  IT: "it-IT",
  ES: "es-ES",
  JP: "ja-JP",
  CA: "en-CA",
  AU: "en-AU",
};

export function resolveMarketLocale(marketCode: string): string {
  return MARKET_LOCALES[(marketCode || "US").trim().toUpperCase()] ?? "en-US";
}

/**
 * 主图与素材确定性预检（面向 Amazon / Shopify / TikTok 等多平台通用底线）。
 */
export function preflightListingImages(assets: ImageAssetForPreflight[]): ImagePreflightResult {
  const findings: ImagePreflightFinding[] = [];
  const mainImages = assets.filter((a) => a.assetType === "main_image");
  const approvedMain = mainImages.filter((a) => a.status === "approved");

  if (approvedMain.length === 0) {
    findings.push({
      code: "MAIN_IMAGE_NOT_APPROVED",
      severity: "error",
      message: "缺少已人工审核通过的主图（至少需要 1 张已审核主图才能正式上架）。",
    });
  }

  for (const img of approvedMain) {
    if (img.width && img.height && (img.width < 1000 || img.height < 1000)) {
      findings.push({
        code: "MAIN_IMAGE_LOW_RES",
        severity: "warning",
        message: `主图 ${img.fileName} 分辨率为 ${img.width}×${img.height}，建议 ≥ 1000×1000 以支持平台缩放展示。`,
      });
    }
    if (img.sizeBytes && img.sizeBytes > 8 * 1024 * 1024) {
      findings.push({
        code: "MAIN_IMAGE_TOO_LARGE",
        severity: "error",
        message: `主图 ${img.fileName} 超过 8MB，上传前请压缩。`,
      });
    }
  }

  if (assets.length < 3) {
    findings.push({
      code: "GALLERY_THIN",
      severity: "warning",
      message: `当前仅绑定 ${assets.length} 个视觉素材，建议补齐场景图/卖点信息图后再发布。`,
    });
  }

  const hasError = findings.some((f) => f.severity === "error");
  return {
    passed: !hasError,
    approvedMainCount: approvedMain.length,
    totalCount: assets.length,
    findings,
  };
}

function sanitizeTsvCell(value: string): string {
  return String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
}

function escapeCsvCell(value: string): string {
  const s = String(value ?? "").replace(/\r\n/g, "\n");
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugifyHandle(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "product"
  );
}

/**
 * 多平台可配置模板导出器：
 * - amazon: 增强版 Flat File TSV（含 GTIN/外键占位、图片文件名映射）
 * - shopify: 原生 Draft CSV（Status=draft, Published=FALSE，导入即半自动草稿）
 * - 其他平台（tiktok_shop / ebay / 自定义）: 通用标准 TSV
 */
export function buildPlatformFeedExport(input: FeedExportInput): FeedExportOutput {
  const platform = (input.platformCode || "amazon").trim().toLowerCase();
  const safeSku = input.sku.replace(/[^a-zA-Z0-9_-]+/g, "_") || "SKU";
  const bullets = [...input.bullets];
  while (bullets.length < 5) bullets.push("");
  const qty = String(input.quantity ?? 100);
  const images = input.imageFilenames ?? [];

  if (platform === "shopify") {
    const headers = [
      "Handle",
      "Title",
      "Body (HTML)",
      "Vendor",
      "Type",
      "Tags",
      "Published",
      "Option1 Name",
      "Option1 Value",
      "Variant SKU",
      "Variant Inventory Qty",
      "Variant Price",
      "Status",
      "Image Local Ref",
    ];
    const htmlBody = [
      bullets.filter(Boolean).length > 0
        ? `<ul>${bullets.filter(Boolean).map((b) => `<li>${b}</li>`).join("")}</ul>`
        : "",
      `<p>${input.description || input.title}</p>`,
    ]
      .filter(Boolean)
      .join("");
    const tags = input.searchTerms
      .split(/[\s,，;；]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20)
      .join(", ");

    const row = [
      slugifyHandle(input.title || input.sku),
      input.title,
      htmlBody,
      input.brand || "Generic",
      input.category || "General",
      tags,
      "FALSE",
      "Title",
      "Default Title",
      input.sku,
      qty,
      input.price,
      "draft",
      images.join("; "),
    ].map(escapeCsvCell);

    return {
      platformCode: "shopify",
      format: "csv",
      mimeType: "text/csv; charset=utf-8",
      fileName: `shopify_draft_${safeSku}.csv`,
      content: `${headers.map(escapeCsvCell).join(",")}\n${row.join(",")}\n`,
    };
  }

  if (platform === "amazon") {
    const headers = [
      "feed_product_type",
      "item_sku",
      "external_product_id",
      "external_product_id_type",
      "brand_name",
      "item_name",
      "standard_price",
      "currency",
      "quantity",
      "bullet_point1",
      "bullet_point2",
      "bullet_point3",
      "bullet_point4",
      "bullet_point5",
      "product_description",
      "generic_keywords",
      "main_image_local_file",
      "other_images_local_files",
    ];
    const row = [
      "product",
      input.sku,
      input.externalProductId || "",
      "GTIN_EXEMPTION_OR_UPC",
      input.brand || "Generic",
      input.title,
      input.price,
      input.currency,
      qty,
      bullets[0] || "",
      bullets[1] || "",
      bullets[2] || "",
      bullets[3] || "",
      bullets[4] || "",
      input.description || input.title,
      input.searchTerms,
      images[0] || "",
      images.slice(1).join("; "),
    ].map(sanitizeTsvCell);

    return {
      platformCode: "amazon",
      format: "tsv",
      mimeType: "text/tab-separated-values; charset=utf-8",
      fileName: `amazon_flatfile_${safeSku}.tsv`,
      content: `${headers.join("\t")}\n${row.join("\t")}\n`,
    };
  }

  // 通用多平台（TikTok Shop / eBay / 自定义平台）标准 TSV 交付
  const headers = [
    "platform",
    "sku",
    "external_id",
    "brand",
    "title",
    "price",
    "currency",
    "quantity",
    "category",
    "bullet_1",
    "bullet_2",
    "bullet_3",
    "bullet_4",
    "bullet_5",
    "description",
    "keywords",
    "local_images",
  ];
  const row = [
    platform,
    input.sku,
    input.externalProductId || "",
    input.brand || "Generic",
    input.title,
    input.price,
    input.currency,
    qty,
    input.category || "",
    bullets[0] || "",
    bullets[1] || "",
    bullets[2] || "",
    bullets[3] || "",
    bullets[4] || "",
    input.description || input.title,
    input.searchTerms,
    images.join("; "),
  ].map(sanitizeTsvCell);

  return {
    platformCode: platform,
    format: "tsv",
    mimeType: "text/tab-separated-values; charset=utf-8",
    fileName: `${platform}_listing_${safeSku}.tsv`,
    content: `${headers.join("\t")}\n${row.join("\t")}\n`,
  };
}

export type SemiAutoListingPayload = {
  caseId: string;
  platformCode: string;
  marketCode: string;
  locale: string;
  currency: string;
  preflight: ListingPreflightResult;
  imagePreflight: ImagePreflightResult;
  fields: {
    sku: string;
    externalProductId: string;
    brand: string;
    title: string;
    price: string;
    currency: string;
    quantity: number;
    category: string;
    bullets: string[];
    description: string;
    searchTerms: string;
    specifications: string;
    packageContents: string;
    claimsToAvoid: string;
  };
  channelPayload: Record<string, unknown>;
  imageFilenames: string[];
};

export function buildSemiAutoListingPayload(input: {
  caseId: string;
  platformCode: string;
  marketCode: string;
  currency: string;
  sku: string;
  externalProductId: string;
  price: string;
  category: string;
  listing: Partial<ListingDraftContent>;
  specifications?: string;
  packageContents?: string;
  claimsToAvoid?: string;
  images: ImageAssetForPreflight[];
}): SemiAutoListingPayload {
  const normalized = normalizeListingContent(input.listing);
  const locale = resolveMarketLocale(input.marketCode);
  const ctx: ChannelContext = {
    marketCode: input.marketCode.trim().toUpperCase() || "US",
    locale,
    currency: (input.currency || "USD").trim().toUpperCase(),
  };

  const preflight = preflightChannelContent(input.platformCode, normalized, ctx);
  const imagePreflight = preflightListingImages(input.images);
  const channelPayload = mapChannelPayload(input.platformCode, normalized, ctx);

  return {
    caseId: input.caseId,
    platformCode: input.platformCode.trim().toLowerCase() || "amazon",
    marketCode: ctx.marketCode,
    locale: ctx.locale,
    currency: ctx.currency,
    preflight,
    imagePreflight,
    fields: {
      sku: input.sku,
      externalProductId: input.externalProductId,
      brand: normalized.brand || "Generic",
      title: normalized.title,
      price: input.price,
      currency: ctx.currency,
      quantity: 100,
      category: input.category,
      bullets: normalized.bullets,
      description: normalized.description,
      searchTerms: normalized.searchTerms,
      specifications: input.specifications || "",
      packageContents: input.packageContents || "",
      claimsToAvoid: input.claimsToAvoid || "",
    },
    channelPayload,
    imageFilenames: input.images.map((i) => i.fileName),
  };
}
