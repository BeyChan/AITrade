import { NextResponse } from "next/server";
import {
  getCalibrationForCase,
  getCalibrationSuggestionForScope,
} from "@/lib/calibration-repository";
import { getAppMode } from "@/lib/app-mode";


export async function GET(request: Request) {
  try {
    const mode = await getAppMode();
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get("caseId")?.trim();
    if (caseId) {
      const ctx = await getCalibrationForCase(caseId, { mode });
      if (!ctx) {
        return NextResponse.json({ error: "未找到商品案卷" }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...ctx });
    }

    const marketplace = (searchParams.get("marketplace") || "US").toUpperCase();
    const currency = searchParams.get("currency")?.toUpperCase() || undefined;
    const category = searchParams.get("category")?.trim() || null;
    const asin = searchParams.get("asin")?.trim() || null;
    const sku = searchParams.get("sku")?.trim() || null;
    const platformCode = searchParams.get("platformCode")?.trim() || "amazon";
    const salePriceCents = Math.max(100, Number(searchParams.get("salePriceCents") || 2499));

    const suggestion = await getCalibrationSuggestionForScope(
      {
        marketplace,
        currency,
        category,
        asin,
        sku,
        platformCode,
        salePriceCents,
      },
      { mode },
    );

    return NextResponse.json({ ok: true, suggestion });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "计算实盘校准建议失败" },
      { status: 500 },
    );
  }
}
