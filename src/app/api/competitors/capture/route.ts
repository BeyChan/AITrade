import { analyzeCompetitors } from "@/lib/competitor-compare/engine.ts";
import { saveComparisonReport } from "@/lib/competitor-compare/storage.ts";
import { readJsonObject, stringField } from "@/app/api/ai-inbox/http.ts";
import { recordAuditLog } from "@/lib/audit-logs.ts";
import type {
  CompetitorFulfillmentType,
  CompetitorInputItem,
  CompetitorNumericField,
  RatingDistribution,
} from "@/lib/competitor-compare/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isLocalRequest(request: Request): boolean {
  const host = (request.headers.get("host") || "").toLowerCase();
  const isLocalHost =
    /^localhost(:\d+)?$/.test(host) ||
    /^127\.0\.0\.1(:\d+)?$/.test(host) ||
    /^\[::1\](:\d+)?$/.test(host);
  if (!isLocalHost) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin.startsWith("chrome-extension://")
    || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "http://localhost:3000",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function numericField(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.]/g, "");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** 扩展若传 "29.99" 之类的元值，统一换算成分 */
function priceToCents(body: Record<string, unknown>): number | undefined {
  const explicit = numericField(body, "priceCents");
  if (explicit !== undefined) return Math.round(explicit);
  const rawPrice = numericField(body, "price");
  if (rawPrice === undefined) return undefined;
  // priceCents 统一按「货币金额 × 100」的最小单位语义存储
  return Math.round(rawPrice * 100);
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  return [];
}

function parseFulfillmentType(value: unknown): CompetitorFulfillmentType | undefined {
  if (value === "amazon_1p" || value === "fba" || value === "fbm" || value === "unknown") {
    return value;
  }
  return undefined;
}

function parseRatingDistribution(value: unknown): RatingDistribution | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const dist: RatingDistribution = {};
  let count = 0;
  for (const k of ["star5", "star4", "star3", "star2", "star1"] as const) {
    const n = Number(obj[k]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      dist[k] = Math.round(n);
      count += 1;
    }
  }
  return count >= 3 ? dist : undefined;
}

function safeImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (/^https?:\/\/.{6,800}$/i.test(trimmed)) return trimmed;
  return undefined;
}

function parseExtras(source: Record<string, unknown>, currency: string): NonNullable<CompetitorInputItem["captured"]> {
  const bullets = stringArray(source.bullets);
  const criticalReviews = stringArray(source.criticalReviews);
  const boughtPastMonth = numericField(source, "boughtPastMonth");
  const listPriceCents = numericField(source, "listPriceCents");
  const effectivePriceCents = numericField(source, "effectivePriceCents");
  const shippingCents = numericField(source, "shippingCents");
  const couponText = typeof source.couponText === "string" && source.couponText.trim()
    ? source.couponText.trim().slice(0, 80)
    : undefined;
  const imageUrl = safeImageUrl(source.imageUrl);
  const fulfillmentType = parseFulfillmentType(source.fulfillmentType);
  const dateFirstAvailable = typeof source.dateFirstAvailable === "string" && source.dateFirstAvailable.trim()
    ? source.dateFirstAvailable.trim().slice(0, 60)
    : undefined;
  const dimensionsText = typeof source.dimensionsText === "string" && source.dimensionsText.trim()
    ? source.dimensionsText.trim().slice(0, 120)
    : undefined;
  const ratingDistribution = parseRatingDistribution(source.ratingDistribution);

  const captured: NonNullable<CompetitorInputItem["captured"]> = {
    currency,
    ...(bullets.length > 0 ? { bullets } : {}),
    ...(criticalReviews.length > 0 ? { criticalReviews } : {}),
    ...(boughtPastMonth ? { boughtPastMonth: Math.round(boughtPastMonth) } : {}),
    ...(typeof source.isSponsored === "boolean" ? { isSponsored: source.isSponsored } : {}),
    ...(couponText ? { couponText } : {}),
    ...(listPriceCents ? { listPriceCents: Math.round(listPriceCents) } : {}),
    ...(effectivePriceCents ? { effectivePriceCents: Math.round(effectivePriceCents) } : {}),
    ...(shippingCents ? { shippingCents: Math.round(shippingCents) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(fulfillmentType ? { fulfillmentType } : {}),
    ...(dateFirstAvailable ? { dateFirstAvailable } : {}),
    ...(dimensionsText ? { dimensionsText } : {}),
    ...(ratingDistribution ? { ratingDistribution } : {}),
  };

  const numeric: Array<[CompetitorNumericField, number | undefined]> = [
    ["priceCents", priceToCents(source)],
    ["rating", numericField(source, "rating")],
    ["reviewCount", numericField(source, "reviewCount")],
    ["bsr", numericField(source, "bsr")],
  ];
  for (const [field, value] of numeric) {
    if (value !== undefined) captured[field] = value;
  }
  return captured;
}

export async function OPTIONS(request: Request) {
  if (!isLocalRequest(request)) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  if (!isLocalRequest(request)) {
    // 拒绝时不回显 Allow-Origin，避免给非本机来源任何跨域许可
    return Response.json({ error: "仅允许本机工作台或浏览器扩展调用采集端点" }, { status: 403 });
  }

  try {
    const body = await readJsonObject(request) as Record<string, unknown>;
    const marketCode = stringField(body, "marketCode", { maxLength: 10 }) || "US";
    const platformCode = stringField(body, "platformCode", { maxLength: 50 }) || "amazon";
    const currency = (stringField(body, "currency", { maxLength: 10 }) || "USD").toUpperCase();

    // 批量 SERP 采集模式：一次接收当前搜索结果页最多 20 款可见竞品
    if (Array.isArray(body.items) && body.items.length > 0) {
      const keyword = stringField(body, "keyword", { maxLength: 200 }) || "";
      const rawItems = body.items.slice(0, 20);
      const capturedInputs: CompetitorInputItem[] = [];
      const urls: string[] = [];

      for (const rawItem of rawItems) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const item = rawItem as Record<string, unknown>;
        const itemUrl = stringField(item, "url", { maxLength: 2000 });
        const itemAsin = stringField(item, "asin", { maxLength: 20 }) || "";
        const itemTitle = stringField(item, "title", { maxLength: 1000 }) || "";
        const rawBrand = typeof item.brand === "string" ? item.brand.trim() : "";
        const itemBrand = rawBrand.length > 0 && rawBrand.length <= 40 && !/sponsored/i.test(rawBrand)
          ? rawBrand
          : "";
        if (!itemUrl && !itemAsin) continue;

        const captured = parseExtras(item, currency);
        const effectiveUrl = itemUrl || `https://www.amazon.com/dp/${itemAsin}`;
        urls.push(effectiveUrl);
        capturedInputs.push({
          raw: effectiveUrl,
          asin: itemAsin,
          url: effectiveUrl,
          title: itemTitle,
          ...(itemBrand ? { brand: itemBrand } : {}),
          captured,
        });
      }

      if (capturedInputs.length === 0) {
        return Response.json({ error: "SERP 批量采集未包含有效竞品记录" }, { status: 400, headers });
      }

      const report = await analyzeCompetitors({
        rawInputs: urls.join("\n"),
        marketCode,
        platformCode,
        currency,
        skipModel: true,
        capturedInputs,
        evidenceText: keyword ? `Search Keyword: ${keyword}` : "",
      });

      await saveComparisonReport(report);

      await recordAuditLog({
        actor: "Chrome 采集扩展",
        action: "competitor.serp_captured",
        entityType: "competitor_report",
        entityId: report.id,
        details: {
          title: report.title,
          keyword: keyword || undefined,
          marketplace: marketCode,
          count: report.competitors.length,
        },
      }).catch(() => {});

      const missingPriceCount = report.competitors.filter((c) => !c.priceCents || c.priceCents <= 0).length;
      const missingReviewCount = report.competitors.filter((c) => c.reviewCount === null || c.reviewCount === undefined).length;
      const captureWarnings: string[] = [];
      if (missingPriceCount > 0) {
        captureWarnings.push(
          `${missingPriceCount} 款竞品抓取缺失售价（请检查 Amazon 左上角 Deliver to 邮编或页面结构变更），未计入价格分位，请在研报页核对补充`,
        );
      }
      if (missingReviewCount > 0) {
        captureWarnings.push(`${missingReviewCount} 款竞品抓取缺失评论数，已显性留空不编造`);
      }

      return Response.json(
        {
          success: true,
          reportId: report.id,
          title: report.title,
          competitorCount: report.competitors.length,
          missingPriceCount,
          missingReviewCount,
          captureWarnings,
          provenance: report.provenance,
          reviewStatus: report.reviewStatus,
          redirectUrl: `/competitors?id=${encodeURIComponent(report.id)}&market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`,
        },
        { headers },
      );
    }

    const url = stringField(body, "url", { required: true, maxLength: 2000 });
    const asin = stringField(body, "asin", { maxLength: 20 }) || "";
    const title = stringField(body, "title", { maxLength: 1000 }) || "";
    const brand = stringField(body, "brand", { maxLength: 200 }) || "";
    const category = stringField(body, "category", { maxLength: 500 }) || "";
    const rawText = stringField(body, "rawText", { maxLength: 50000 }) || "";

    const captured = parseExtras(body, currency);

    // rawInputs 只放商品 URL：解析器按换行拆分，混入差评原文会把一个商品拆成多个「竞品」
    const evidenceText = [
      brand ? `Brand: ${brand}` : "",
      asin ? `ASIN: ${asin}` : "",
      title ? `Title: ${title}` : "",
      category ? `Category: ${category}` : "",
      rawText,
    ].filter(Boolean).join("\n");

    const capturedInputs: CompetitorInputItem[] = [{ raw: url, asin, url, title, ...(brand ? { brand } : {}), captured }];
    const report = await analyzeCompetitors({
      rawInputs: url,
      marketCode,
      platformCode,
      currency,
      skipModel: true,
      capturedInputs,
      evidenceText,
    });

    await saveComparisonReport(report);

    await recordAuditLog({
      actor: "Chrome 采集扩展",
      action: "competitor.dp_captured",
      entityType: "competitor_report",
      entityId: report.id,
      details: {
        asin: asin || undefined,
        title: report.title,
        marketplace: marketCode,
      },
    }).catch(() => {});

    const missingPriceCount = report.competitors.filter((c) => !c.priceCents || c.priceCents <= 0).length;
    const missingReviewCount = report.competitors.filter((c) => c.reviewCount === null || c.reviewCount === undefined).length;
    const captureWarnings: string[] = [];
    if (missingPriceCount > 0) {
      captureWarnings.push("当前单品抓取缺失售价（可能因邮编未设或页面结构变更），请在研报页核对补充");
    }
    if (missingReviewCount > 0) {
      captureWarnings.push("当前单品抓取缺失评论数，已显性留空不编造");
    }

    return Response.json(
      {
        success: true,
        reportId: report.id,
        title: report.title,
        competitorCount: report.competitors.length,
        missingPriceCount,
        missingReviewCount,
        captureWarnings,
        provenance: report.provenance,
        reviewStatus: report.reviewStatus,
        redirectUrl: `/competitors?id=${encodeURIComponent(report.id)}&market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`,
      },
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "竞品采集写入失败";
    return Response.json({ error: message }, { status: 400, headers });
  }
}
