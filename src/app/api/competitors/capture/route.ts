import { analyzeCompetitors } from "@/lib/competitor-compare/engine.ts";
import { saveComparisonReport } from "@/lib/competitor-compare/storage.ts";
import { readJsonObject, stringField } from "@/app/api/ai-inbox/http.ts";
import type { CompetitorInputItem, CompetitorNumericField } from "@/lib/competitor-compare/types.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_HOSTS = new Set(["127.0.0.1:3000", "localhost:3000", "[::1]:3000"]);

function isLocalRequest(request: Request): boolean {
  const host = (request.headers.get("host") || "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin.startsWith("chrome-extension://")
    || origin.startsWith("http://127.0.0.1:3000")
    || origin.startsWith("http://localhost:3000");
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
    const url = stringField(body, "url", { required: true, maxLength: 2000 });
    const asin = stringField(body, "asin", { maxLength: 20 }) || "";
    const title = stringField(body, "title", { maxLength: 1000 }) || "";
    const brand = stringField(body, "brand", { maxLength: 200 }) || "";
    const category = stringField(body, "category", { maxLength: 500 }) || "";
    const rawText = stringField(body, "rawText", { maxLength: 50000 }) || "";
    const marketCode = stringField(body, "marketCode", { maxLength: 10 }) || "US";
    const platformCode = stringField(body, "platformCode", { maxLength: 50 }) || "amazon";
    const currency = (stringField(body, "currency", { maxLength: 10 }) || "USD").toUpperCase();

    const captured: NonNullable<CompetitorInputItem["captured"]> = {
      currency,
      bullets: stringArray(body.bullets),
      criticalReviews: stringArray(body.criticalReviews),
    };
    const numeric: Array<[CompetitorNumericField, number | undefined]> = [
      ["priceCents", priceToCents(body)],
      ["rating", numericField(body, "rating")],
      ["reviewCount", numericField(body, "reviewCount")],
    ];
    for (const [field, value] of numeric) {
      if (value !== undefined) captured[field] = value;
    }

    // rawInputs 只放商品 URL：解析器按换行拆分，混入差评原文会把一个商品拆成多个「竞品」
    const evidenceText = [
      brand ? `Brand: ${brand}` : "",
      asin ? `ASIN: ${asin}` : "",
      title ? `Title: ${title}` : "",
      category ? `Category: ${category}` : "",
      rawText,
    ].filter(Boolean).join("\n");

    const capturedInputs: CompetitorInputItem[] = [{ raw: url, asin, url, title, captured }];
    const report = await analyzeCompetitors({
      rawInputs: url,
      marketCode,
      platformCode,
      currency,
      capturedInputs,
      evidenceText,
    });

    await saveComparisonReport(report);

    return Response.json(
      {
        success: true,
        reportId: report.id,
        title: report.title,
        competitorCount: report.competitors.length,
        provenance: report.provenance,
        reviewStatus: report.reviewStatus,
        redirectUrl: `/competitors?id=${encodeURIComponent(report.id)}`,
      },
      { headers },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "竞品采集写入失败";
    return Response.json({ error: message }, { status: 400, headers });
  }
}
