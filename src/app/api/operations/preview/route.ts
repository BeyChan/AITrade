import { randomUUID } from "node:crypto";
import { parseAdSpendReport, runOperationsPipeline } from "@/lib/operations-pipeline";
import { listChannelSkuMappings } from "@/lib/operations-repository";
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
    const adSpendText =
      typeof body.adSpendText === "string" && body.adSpendText.trim().length > 0
        ? body.adSpendText
        : undefined;
    const marketplaceCode = String(body.marketplaceCode || "US").toUpperCase();
    const reportingCurrency = String(body.reportingCurrency || "USD").toUpperCase();
    const reportTimezone = String(body.reportTimezone || "America/Los_Angeles");
    const policy = body.policy === "order" ? "order" : "settlement";
    const snapshotDate = String(body.snapshotDate || new Date().toISOString().slice(0, 10));

    if (!settlementText.trim()) {
      return Response.json({ error: "请粘贴或上传平台结算单（Settlement V2 TSV/CSV）" }, { status: 400 });
    }
    if (
      settlementText.length > MAX_TEXT_CHARS ||
      (inventoryText && inventoryText.length > MAX_TEXT_CHARS) ||
      (adSpendText && adSpendText.length > MAX_TEXT_CHARS)
    ) {
      return Response.json({ error: "报表文本超过 2 MB 上限" }, { status: 413 });
    }

    // 1. 解析可选的外部广告报表（Amazon Ads Sponsored Products CSV/TSV）
    const externalAdSpendBySku: Record<string, { spendCents: number; source: "ads_report" | "manual" }> = {};
    const extraWarnings: string[] = [];
    if (adSpendText) {
      const parsedAd = parseAdSpendReport(adSpendText);
      extraWarnings.push(...parsedAd.warnings);
      for (const [skuKey, spendCents] of Object.entries(parsedAd.bySku)) {
        externalAdSpendBySku[skuKey] = { spendCents, source: "ads_report" };
      }
    }
    if (body.manualAdSpendBySku && typeof body.manualAdSpendBySku === "object") {
      for (const [sku, rawCents] of Object.entries(body.manualAdSpendBySku as Record<string, unknown>)) {
        const cents = Number(rawCents);
        if (Number.isFinite(cents) && cents >= 0) {
          externalAdSpendBySku[sku.toUpperCase()] = {
            spendCents: Math.round(cents),
            source: "manual",
          };
        }
      }
    }

    // 2. 自动加载同站点已立项案卷的成本模型 + 显式 channel_sku_mappings，用于同口径实盘对比与分项误差归因
    const forecastsBySku: Record<string, ForecastComparisonInput> = {};
    try {
      const [cases, mappings] = await Promise.all([
        listCasesForSite(marketplaceCode, "amazon"),
        listChannelSkuMappings(marketplaceCode).catch(() => []),
      ]);
      const caseById = new Map(cases.map((c) => [c.id, c]));

      const buildForecast = (
        item: (typeof cases)[number],
        landedCostOverride: number | null = null,
      ): ForecastComparisonInput | null => {
        const res = item.costModel?.results;
        const assumptions = item.costModel?.assumptions;
        const netProfitCents = res?.netProfitCents;
        const caseCurrency = (item.currency || assumptions?.currency || "USD").toUpperCase();
        if (typeof netProfitCents !== "number" || caseCurrency !== reportingCurrency) return null;

        const unitLanded =
          landedCostOverride ??
          (typeof res?.landedCostCents === "number"
            ? res.landedCostCents
            : typeof assumptions?.landedCostCents === "number"
              ? assumptions.landedCostCents
              : null);
        const amortized = res?.amortizedFixedCostCents ?? 0;
        const unitPlatformContributionCents =
          typeof res?.platformContributionCents === "number"
            ? res.platformContributionCents
            : unitLanded !== null
              ? netProfitCents + unitLanded + amortized
              : undefined;

        return {
          unitNetProfitCents: netProfitCents,
          unitPlatformContributionCents,
          unitLandedCostCents: unitLanded,
          unitAmortizedFixedCostCents: amortized,
          costModelVersion: `v${item.costModel?.version ?? 1}`,
          forecastCurrency: caseCurrency,
          minDenominatorCents: 1_000,
          ...(assumptions
            ? {
                planBreakdown: {
                  salePriceCents: assumptions.salePriceCents,
                  landedCostCents: unitLanded ?? assumptions.landedCostCents,
                  fbaFeeCents: assumptions.fbaFeeCents,
                  referralRate: assumptions.referralRate,
                  adRate: assumptions.adRate,
                  returnRate: assumptions.returnRate,
                  storageCents: assumptions.storageCents,
                  amortizedFixedCostCents: amortized,
                },
              }
            : {}),
        };
      };

      for (const item of cases) {
        const forecast = buildForecast(item);
        if (!forecast) continue;
        if (item.asin) {
          forecastsBySku[item.asin] = forecast;
          forecastsBySku[item.asin.toUpperCase()] = forecast;
        }
        forecastsBySku[`SKU-${item.asin}`] = forecast;
        forecastsBySku[`SKU-${item.asin.toUpperCase()}`] = forecast;
      }

      // 显式 SKU 映射优先覆盖
      for (const m of mappings) {
        const linkedCase = m.caseId ? caseById.get(m.caseId) : undefined;
        if (linkedCase) {
          const forecast = buildForecast(linkedCase, m.unitLandedCostCentsOverride);
          if (forecast) {
            forecastsBySku[m.channelSku] = forecast;
            forecastsBySku[m.channelSku.toUpperCase()] = forecast;
          }
        } else if (m.unitLandedCostCentsOverride !== null) {
          // 仅绑定了手动单位到岸成本、未关联案卷时，也允许按实盘扣除采购成本
          const existing = forecastsBySku[m.channelSku] ?? forecastsBySku[m.channelSku.toUpperCase()];
          if (existing) {
            forecastsBySku[m.channelSku] = {
              ...existing,
              unitLandedCostCents: m.unitLandedCostCentsOverride,
            };
          } else {
            forecastsBySku[m.channelSku.toUpperCase()] = {
              unitNetProfitCents: 0,
              unitLandedCostCents: m.unitLandedCostCentsOverride,
              costModelVersion: "manual-landed",
              forecastCurrency: reportingCurrency,
              minDenominatorCents: 1_000,
            };
          }
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
              unitLandedCostCents:
                typeof r.unitLandedCostCents === "number" ? Math.round(r.unitLandedCostCents) : undefined,
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
        ...(Object.keys(externalAdSpendBySku).length > 0 ? { externalAdSpendBySku } : {}),
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

    if (extraWarnings.length > 0) {
      result.warnings.push(...extraWarnings);
    }

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
