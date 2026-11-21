import { randomUUID } from "node:crypto";
import { runOperationsPipeline } from "@/lib/operations-pipeline";
import type { ForecastComparisonInput } from "@/lib/operations-settlement";
import { listCasesForSite } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_CHARS = 2 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const settlementText = typeof body.settlementText === "string" ? body.settlementText : "";
    const inventoryText =
      typeof body.inventoryText === "string" && body.inventoryText.trim().length > 0
        ? body.inventoryText
        : undefined;
    const marketplaceCode = String(body.marketplaceCode || "US").toUpperCase();
    const reportingCurrency = String(body.reportingCurrency || "USD").toUpperCase();
    const reportTimezone = String(body.reportTimezone || "America/Los_Angeles");
    const policy = body.policy === "order" ? "order" : "settlement";
    const snapshotDate = String(body.snapshotDate || new Date().toISOString().slice(0, 10));

    if (!settlementText.trim()) {
      return Response.json({ error: "请粘贴或上传平台结算单（Settlement V2 TSV/CSV）" }, { status: 400 });
    }
    if (settlementText.length > MAX_TEXT_CHARS || (inventoryText && inventoryText.length > MAX_TEXT_CHARS)) {
      return Response.json({ error: "报表文本超过 2 MB 上限" }, { status: 413 });
    }

    // 自动加载同站点已立项案卷的成本模型，用于 SKU 级「实盘 vs 立项预测」对比
    const forecastsBySku: Record<string, ForecastComparisonInput> = {};
    try {
      const cases = await listCasesForSite(marketplaceCode, "amazon");
      for (const item of cases) {
        const netProfitCents = item.costModel?.results?.netProfitCents;
        const caseCurrency = (item.currency || item.costModel?.assumptions.currency || "USD").toUpperCase();
        if (typeof netProfitCents === "number" && caseCurrency === reportingCurrency) {
          const forecast: ForecastComparisonInput = {
            unitNetProfitCents: netProfitCents,
            costModelVersion: `v${item.costModel?.version ?? 1}`,
            forecastCurrency: caseCurrency,
            minDenominatorCents: 1_000,
          };
          if (item.asin) forecastsBySku[item.asin] = forecast;
          forecastsBySku[`SKU-${item.asin}`] = forecast;
        }
      }
    } catch {
      // 无匹配案卷时仍可正常试算结算归集
    }

    // 允许调用方补充单品测试预测（如示例模式）
    if (body.customForecasts && typeof body.customForecasts === "object") {
      for (const [sku, raw] of Object.entries(body.customForecasts as Record<string, unknown>)) {
        if (raw && typeof raw === "object") {
          const r = raw as Record<string, unknown>;
          if (typeof r.unitNetProfitCents === "number") {
            forecastsBySku[sku] = {
              unitNetProfitCents: Math.round(r.unitNetProfitCents),
              costModelVersion: String(r.costModelVersion || "plan-v1"),
              forecastCurrency: reportingCurrency,
              minDenominatorCents: 1_000,
            };
          }
        }
      }
    }

    const dailySalesBySku: Record<string, number[]> | undefined =
      body.dailySalesBySku && typeof body.dailySalesBySku === "object"
        ? (body.dailySalesBySku as Record<string, number[]>)
        : undefined;

    const result = runOperationsPipeline(
      { settlementText, inventoryText },
      {
        settlement: {
          ingestionRunId: `preview-set-${randomUUID().slice(0, 8)}`,
          marketplaceCode,
          reportTimezone,
          reportingCurrency,
        },
        ...(inventoryText
          ? {
              inventory: {
                ingestionRunId: `preview-inv-${randomUUID().slice(0, 8)}`,
                marketplaceCode,
                reportTimezone,
                reportingCurrency,
                snapshotDate,
              },
            }
          : {}),
        policy,
        reportingCurrency,
        forecastsBySku,
        ...(dailySalesBySku
          ? {
              inventoryDays: {
                windowDays: 7,
                minDailySales: 0.5,
                dailySalesBySku,
              },
            }
          : {}),
      },
    );

    return Response.json({
      success: true,
      dryRun: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "结算报表试算失败";
    return Response.json({ error: message }, { status: 400 });
  }
}
