"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import { loadCalibratedDefaultsForScope } from "@/lib/calibration-repository";
import { convertRmbToForeignCents } from "@/lib/currency";
import { getEffectiveFxRate } from "@/lib/fx-rates";
import { getDb } from "@/lib/db";
import { calculateEconomics, type EconomicsAssumptions } from "@/lib/economics";
import { markComparisonReportPromoted } from "@/lib/competitor-compare/storage";

export type QuickCreateCaseInput = {
  title: string;
  category: string;
  asin?: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  targetPriceCents: number;
  factoryCostRmb: number;
  freightPerUnitCents?: number;
  fbaFeeCents?: number;
  adRate?: number;
  returnRate?: number;
  monthlySalesEstimate?: number;
  notes?: string;
  sourceReportId?: string | null;
  complianceSummary?: string;
  actor?: string;
};

export async function quickCreateCaseFromWizardAction(
  input: QuickCreateCaseInput,
): Promise<{ success: boolean; caseId?: string; error?: string }> {
  try {
    const title = input.title.trim();
    if (!title) {
      return { success: false, error: "请填写商品名称或选品方向" };
    }
    const targetPriceCents = Math.round(input.targetPriceCents);
    if (!Number.isFinite(targetPriceCents) || targetPriceCents < 100) {
      return { success: false, error: "请填写有效的拟定售价（至少 1.00）" };
    }
    const factoryCostRmb = Number(input.factoryCostRmb);
    if (!Number.isFinite(factoryCostRmb) || factoryCostRmb <= 0) {
      return { success: false, error: "请填写有效的 1688 拿货单价（RMB）" };
    }

    const marketCode = (input.marketCode || "US").toUpperCase();
    const platformCode = (input.platformCode || "amazon").toLowerCase();
    const currency = (input.currency || "USD").toUpperCase();
    const category = input.category.trim() || "未分类";
    const actor = input.actor?.trim() || "选品向导";

    const calibratedBundle = await loadCalibratedDefaultsForScope({
      marketplace: marketCode,
      currency,
      category,
      platformCode,
      salePriceCents: targetPriceCents,
    });
    const defaults = calibratedBundle.defaults;
    await getEffectiveFxRate(currency);
    const purchaseForeignCents = convertRmbToForeignCents(factoryCostRmb, currency);
    const freightCents =
      typeof input.freightPerUnitCents === "number" && input.freightPerUnitCents >= 0
        ? Math.round(input.freightPerUnitCents)
        : Math.max(120, Math.round(purchaseForeignCents * 0.25));
    const landedCostCents = purchaseForeignCents + freightCents;

    const assumptions: EconomicsAssumptions = {
      currency,
      salePriceCents: targetPriceCents,
      landedCostCents,
      fbaFeeCents:
        typeof input.fbaFeeCents === "number" && input.fbaFeeCents >= 0
          ? Math.round(input.fbaFeeCents)
          : defaults.fbaFeeCents,
      referralRate: defaults.referralRate,
      adRate:
        typeof input.adRate === "number" && input.adRate >= 0 && input.adRate <= 0.6
          ? input.adRate
          : defaults.adRate,
      returnRate:
        typeof input.returnRate === "number" && input.returnRate >= 0 && input.returnRate <= 0.5
          ? input.returnRate
          : defaults.returnRate,
      returnProcessingCents: defaults.returnProcessingCents,
      returnRecoveryRate: defaults.returnRecoveryRate,
      couponCents: defaults.couponCents,
      storageCents: defaults.storageCents,
      otherCostCents: defaults.otherCostCents,
      ...(calibratedBundle.calibrationMeta ? { calibrationMeta: calibratedBundle.calibrationMeta } : {}),
    };

    const results = calculateEconomics(assumptions);
    const caseId = randomUUID();
    const rawAsin = (input.asin || "").trim().toUpperCase();
    const asin = /^[A-Z0-9]{10}$/.test(rawAsin)
      ? rawAsin
      : `WZ${caseId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    const combinedNotes = [
      input.notes?.trim() || "",
      `选品向导立项：1688 参考拿货价 ¥${factoryCostRmb.toFixed(2)}，估算头程 ${(freightCents / 100).toFixed(2)} ${currency}`,
      input.complianceSummary?.trim() ? `立项合规自查：${input.complianceSummary.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const db = await getDb();
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO product_cases
          (id, asin, marketplace, category, title, status, competitor_price_cents,
           monthly_sales_estimate, review_count, rating, notes, owner, evidence_score,
           is_demo, source_code, currency)
         VALUES ($1, $2, $3, $4, $5, 'approved', $6, $7, 0, NULL, $8, $9, 60, FALSE, 'selection_wizard', $10)`,
        [
          caseId,
          asin,
          marketCode,
          category,
          title,
          targetPriceCents,
          Math.max(100, Math.round(input.monthlySalesEstimate ?? 600)),
          combinedNotes,
          actor,
          currency,
        ],
      );

      await tx.query(
        `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
         VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
        [randomUUID(), caseId, JSON.stringify(assumptions), JSON.stringify(results), actor],
      );

      await tx.query(
        `INSERT INTO product_case_sites (case_id, market_code, platform_code, discovery_source)
         VALUES ($1, $2, $3, 'selection_wizard')
         ON CONFLICT (case_id, market_code, platform_code) DO NOTHING`,
        [caseId, marketCode, platformCode],
      );

      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'case.created_from_wizard', 'product_case', $3, $4::jsonb)`,
        [
          randomUUID(),
          actor,
          caseId,
          JSON.stringify({
            factoryCostRmb,
            targetPriceCents,
            marginRate: results.marginRate,
            sourceReportId: input.sourceReportId ?? null,
          }),
        ],
      );
    });

    if (input.sourceReportId) {
      await markComparisonReportPromoted(input.sourceReportId, caseId).catch(() => undefined);
    }

    revalidatePath("/");
    revalidatePath("/cases");
    revalidatePath("/discover");
    revalidatePath("/competitors");

    return { success: true, caseId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "快速立项失败";
    return { success: false, error: message };
  }
}
