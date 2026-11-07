import { analyzeCompetitors } from "@/lib/competitor-compare/engine.ts";
import { saveComparisonReport } from "@/lib/competitor-compare/storage.ts";
import { apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const url = stringField(body, "url", { required: true, maxLength: 2000 });
    const asin = stringField(body, "asin", { maxLength: 20 }) || "";
    const title = stringField(body, "title", { maxLength: 1000 }) || "";
    const brand = stringField(body, "brand", { maxLength: 200 }) || "";
    const category = stringField(body, "category", { maxLength: 500 }) || "";
    const rawText = stringField(body, "rawText", { maxLength: 50000 }) || "";
    const marketCode = stringField(body, "marketCode", { maxLength: 10 }) || "US";
    const platformCode = stringField(body, "platformCode", { maxLength: 50 }) || "amazon";
    const currency = stringField(body, "currency", { maxLength: 10 }) || "USD";

    // 组合输入信息
    const composedInput = [
      url,
      asin ? `ASIN: ${asin}` : "",
      brand ? `Brand: ${brand}` : "",
      title ? `Title: ${title}` : "",
      category ? `Category: ${category}` : "",
      rawText ? `Details:\n${rawText}` : "",
    ].filter(Boolean).join("\n");

    const report = await analyzeCompetitors({
      rawInputs: composedInput,
      marketCode,
      platformCode,
      currency,
    });

    await saveComparisonReport(report);

    return Response.json(
      {
        success: true,
        reportId: report.id,
        title: report.title,
        competitorCount: report.competitors.length,
        redirectUrl: `/competitors?id=${encodeURIComponent(report.id)}`,
      },
      { headers: CORS_HEADERS },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "竞品采集写入失败";
    return Response.json({ error: message }, { status: 400, headers: CORS_HEADERS });
  }
}
