"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { loadCalibratedDefaultsForScope } from "@/lib/calibration-repository";
import { convertRmbToForeignCents } from "@/lib/currency";
import { getEffectiveFxRate } from "@/lib/fx-rates";
import { getDb } from "@/lib/db";
import { calculateEconomics, type EconomicsAssumptions } from "@/lib/economics";
import { evaluateWizardServerGate } from "@/lib/export-gates";
import { getComparisonReportById, markComparisonReportPromoted } from "@/lib/competitor-compare/storage";

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
  reviewCount?: number;
  notes?: string;
  sourceReportId?: string | null;
  complianceSummary?: string;
  actor?: string;
  /** NO-GO 例外审批字段（独立于“少于三家报价”的定标例外） */
  exceptionReason?: string;
  exceptionRiskNote?: string;
  exceptionApprover?: string;
};

export type QuickCreateCaseResult = {
  success: boolean;
  caseId?: string;
  caseStatus?: "approved" | "review_pending";
  recommendation?: "GO" | "HOLD" | "NO-GO";
  opportunityScore?: number;
  evidenceScore?: number;
  requiresException?: boolean;
  error?: string;
};

export async function quickCreateCaseFromWizardAction(
  input: QuickCreateCaseInput,
): Promise<QuickCreateCaseResult> {
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

    const [calibratedBundle, sourceReport] = await Promise.all([
      loadCalibratedDefaultsForScope({
        marketplace: marketCode,
        currency,
        category,
        platformCode,
        salePriceCents: targetPriceCents,
      }),
      input.sourceReportId
        ? getComparisonReportById(input.sourceReportId).catch(() => null)
        : Promise.resolve(null),
    ]);
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
    const monthlySalesEstimate = Math.max(100, Math.round(input.monthlySalesEstimate ?? 600));
    const reviewCount = Math.max(
      0,
      Math.round(
        sourceReport?.competitors?.[0]?.reviewCount ??
          (typeof input.reviewCount === "number" && Number.isFinite(input.reviewCount) ? input.reviewCount : 0),
      ),
    );
    const serverGate = evaluateWizardServerGate({
      results,
      monthlySalesEstimate,
      reviewCount,
      competitorCount: sourceReport?.competitors?.length ?? 0,
      hasSourceReport: Boolean(sourceReport && sourceReport.competitors.length > 0),
    });

    const exceptionReason = input.exceptionReason?.trim() || "";
    const exceptionRiskNote = input.exceptionRiskNote?.trim() || "";
    const exceptionApprover = input.exceptionApprover?.trim() || "";
    const hasCompleteException = Boolean(exceptionReason && exceptionRiskNote && exceptionApprover);

    if (serverGate.requiresException && !hasCompleteException) {
      return {
        success: false,
        requiresException: true,
        recommendation: serverGate.recommendation,
        opportunityScore: serverGate.score,
        evidenceScore: serverGate.evidenceScore,
        error: "服务端重算结论为 NO-GO（基准或压力情景不盈利），不能直接创建正式案卷；如需例外推进，请填写原因、风险说明与审批人。",
      };
    }

    const caseId = randomUUID();
    const rawAsin = (input.asin || "").trim().toUpperCase();
    const asin = /^[A-Z0-9]{10}$/.test(rawAsin)
      ? rawAsin
      : `WZ${caseId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

    const stageTag = serverGate.requiresException
      ? "NO-GO 例外创建（待验证）"
      : serverGate.caseStatus === "approved"
        ? "估算快筛达标（正式推进）"
        : "估算快筛（待验证案卷）";

    const combinedNotes = [
      input.notes?.trim() || "",
      `[${stageTag}] 1688 参考拿货价 ¥${factoryCostRmb.toFixed(2)}，估算头程 ${(freightCents / 100).toFixed(2)} ${currency}，服务端机会分 ${serverGate.score}（${serverGate.recommendation}）`,
      input.complianceSummary?.trim() ? `立项合规自查：${input.complianceSummary.trim()}` : "",
      hasCompleteException
        ? `NO-GO 例外审批：审批人 ${exceptionApprover}；原因：${exceptionReason}；风险说明：${exceptionRiskNote}`
        : "",
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, $11, $12, FALSE, 'selection_wizard', $13)`,
        [
          caseId,
          asin,
          marketCode,
          category,
          title,
          serverGate.caseStatus,
          targetPriceCents,
          monthlySalesEstimate,
          reviewCount,
          combinedNotes,
          actor,
          serverGate.evidenceScore,
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
            opportunityScore: serverGate.score,
            evidenceScore: serverGate.evidenceScore,
            recommendation: serverGate.recommendation,
            caseStatus: serverGate.caseStatus,
            isProvisionalEstimate: true,
            sourceReportId: input.sourceReportId ?? null,
          }),
        ],
      );

      if (serverGate.requiresException && hasCompleteException) {
        await tx.query(
          `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
           VALUES ($1, $2, 'case.exception_created', 'product_case', $3, $4::jsonb)`,
          [
            randomUUID(),
            exceptionApprover,
            caseId,
            JSON.stringify({
              reason: exceptionReason,
              riskNote: exceptionRiskNote,
              approver: exceptionApprover,
              gateRecommendation: "NO-GO",
              source: "selection_wizard",
            }),
          ],
        );
      }
    });

    if (input.sourceReportId) {
      await markComparisonReportPromoted(input.sourceReportId, caseId).catch(() => undefined);
    }

    revalidatePath("/");
    revalidatePath("/cases");
    revalidatePath("/discover");
    revalidatePath("/competitors");

    return {
      success: true,
      caseId,
      caseStatus: serverGate.caseStatus,
      recommendation: serverGate.recommendation,
      opportunityScore: serverGate.score,
      evidenceScore: serverGate.evidenceScore,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建案卷失败";
    return { success: false, error: message };
  }
}
