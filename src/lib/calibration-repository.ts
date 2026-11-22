import { randomUUID } from "node:crypto";
import { recordAuditLog } from "./audit-logs.ts";
import {
  computeCalibrationSuggestion,
  previewCalibrationImpact,
  type CalibrationImpactPreview,
  type CalibrationSnapshotRow,
  type CalibrationSuggestion,
  type ComputeCalibrationOptions,
} from "./calibration.ts";
import { getDb } from "./db.ts";
import { calculateEconomics, type EconomicsAssumptions } from "./economics.ts";
import type { AdAttributionSource } from "./operations-pipeline.ts";
import { ensureOperationsTables } from "./operations-repository.ts";
import { getCaseDetail } from "./repository.ts";

/**
 * 读取近 N 天（默认 90 天）内的实盘 SKU 快照，关联案卷类目与 ASIN，供校准引擎使用。
 */
export async function loadCalibrationSnapshots(params: {
  marketplace?: string;
  windowDays?: number;
} = {}): Promise<CalibrationSnapshotRow[]> {
  await ensureOperationsTables();
  const db = await getDb();
  const windowDays = Math.max(7, Math.min(365, params.windowDays ?? 90));
  const queryParams: unknown[] = [windowDays];
  const marketClause = params.marketplace ? `AND UPPER(b.marketplace) = UPPER($2)` : "";
  if (params.marketplace) queryParams.push(params.marketplace);

  const res = await db.query<{
    marketplace: string;
    currency: string;
    sku: string;
    case_id: string | null;
    case_asin: string | null;
    category: string | null;
    period_key: string;
    period_end: string;
    units_sold: number;
    gross_units: number;
    refund_units: number;
    gross_revenue_cents: number;
    revenue_cents: number;
    refund_cents: number;
    platform_fee_cents: number;
    fulfillment_fee_cents: number;
    fba_fee_cents: number;
    ad_spend_cents: number;
    ad_attribution: string;
    storage_fee_cents: number;
  }>(
    `SELECT b.marketplace, b.currency, b.period_end,
            s.sku, s.case_id, pc.asin AS case_asin, pc.category,
            s.period_key, s.units_sold, s.gross_units, s.refund_units,
            s.gross_revenue_cents, s.revenue_cents, s.refund_cents,
            s.platform_fee_cents, s.fulfillment_fee_cents, s.fba_fee_cents,
            s.ad_spend_cents, s.ad_attribution, s.storage_fee_cents
     FROM operations_sku_snapshots s
     JOIN operations_settlement_batches b ON b.id = s.batch_id
     LEFT JOIN product_cases pc ON pc.id = s.case_id
     WHERE b.created_at >= NOW() - ($1::int || ' days')::interval
       ${marketClause}
     ORDER BY b.created_at DESC`,
    queryParams,
  );

  return res.rows.map((r) => ({
    marketplace: r.marketplace,
    currency: r.currency,
    sku: r.sku,
    caseId: r.case_id,
    caseAsin: r.case_asin,
    category: r.category,
    periodKey: r.period_key,
    periodEnd: r.period_end || r.period_key,
    unitsSold: Number(r.units_sold ?? 0),
    grossUnits: Number(r.gross_units ?? 0) || Number(r.units_sold ?? 0),
    refundUnits: Number(r.refund_units ?? 0),
    grossRevenueCents: Number(r.gross_revenue_cents ?? 0) || Number(r.revenue_cents ?? 0),
    revenueCents: Number(r.revenue_cents ?? 0),
    refundCents: Number(r.refund_cents ?? 0),
    platformFeeCents: Number(r.platform_fee_cents ?? 0),
    fulfillmentFeeCents:
      Number(r.fulfillment_fee_cents ?? 0) || Number(r.fba_fee_cents ?? 0),
    adSpendCents: Number(r.ad_spend_cents ?? 0),
    adAttribution: (r.ad_attribution as AdAttributionSource) || "missing",
    storageFeeCents: Number(r.storage_fee_cents ?? 0),
  }));
}

export async function getCalibrationSuggestionForScope(
  options: ComputeCalibrationOptions & { windowDays?: number },
): Promise<CalibrationSuggestion> {
  const rows = await loadCalibrationSnapshots({
    marketplace: options.marketplace,
    windowDays: options.windowDays,
  });
  return computeCalibrationSuggestion(rows, options);
}

export type CaseCalibrationContext = {
  caseId: string;
  suggestion: CalibrationSuggestion;
  preview: CalibrationImpactPreview | null;
};

export async function getCalibrationForCase(caseId: string): Promise<CaseCalibrationContext | null> {
  const detail = await getCaseDetail(caseId);
  if (!detail) return null;

  const { productCase, costModel } = detail;
  const assumptions = costModel?.assumptions;
  const salePriceCents = assumptions?.salePriceCents ?? productCase.competitor_price_cents;
  const currency = assumptions?.currency ?? "USD";

  const suggestion = await getCalibrationSuggestionForScope({
    marketplace: productCase.marketplace,
    currency,
    category: productCase.category,
    asin: productCase.asin,
    platformCode: "amazon",
    salePriceCents,
  });

  const preview = assumptions
    ? previewCalibrationImpact({
        assumptions,
        suggestion,
        monthlySalesEstimate: productCase.monthly_sales_estimate,
        reviewCount: productCase.review_count,
        evidenceScore: productCase.evidence_score,
      })
    : null;

  return { caseId, suggestion, preview };
}

/**
 * 用户显式确认后，将实盘校准假设应用到指定商品案卷，生成新版本 cost_models 并写入审计日志。
 */
export async function applyCalibrationToCase(params: {
  caseId: string;
  actor: string;
  action: "apply" | "dismiss";
  reason?: string;
}): Promise<{
  ok: boolean;
  action: "apply" | "dismiss";
  newVersion: number | null;
  preview: CalibrationImpactPreview | null;
}> {
  const ctx = await getCalibrationForCase(params.caseId);
  if (!ctx) throw new Error("未找到对应商品案卷");
  const { suggestion, preview } = ctx;
  const actor = params.actor.trim() || "本机用户";

  if (params.action === "dismiss") {
    await recordAuditLog({
      actor,
      action: "calibration.dismissed",
      entityType: "product_case",
      entityId: params.caseId,
      details: {
        scope: suggestion.scope,
        scopeLabel: suggestion.scopeLabel,
        sampleSkuCount: suggestion.sampleSkuCount,
        totalUnits: suggestion.totalUnits,
        reason: params.reason?.trim() || "用户选择保留现有假设",
      },
    });
    return { ok: true, action: "dismiss", newVersion: null, preview };
  }

  if (!preview || !preview.canApply) {
    throw new Error("当前没有可应用的实盘校准差异（样本不足或参数已与实盘一致）");
  }

  const db = await getDb();
  const verRes = await db.query<{ next_version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM cost_models WHERE case_id = $1`,
    [params.caseId],
  );
  const nextVersion = Number(verRes.rows[0]?.next_version ?? 1);

  const stampedAssumptions: EconomicsAssumptions = {
    ...preview.nextAssumptions,
    calibrationMeta: {
      ...(preview.nextAssumptions.calibrationMeta ?? {
        status: suggestion.status,
        scope: suggestion.scope,
        sampleSkuCount: suggestion.sampleSkuCount,
        totalUnits: suggestion.totalUnits,
        appliedFields: preview.appliedFields.map((f) => f.field),
        latestPeriodEnd: suggestion.latestPeriodEnd,
      }),
      appliedAt: new Date().toISOString(),
    },
  };
  const results = calculateEconomics(stampedAssumptions);

  await db.query(
    `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
    [
      randomUUID(),
      params.caseId,
      nextVersion,
      JSON.stringify(stampedAssumptions),
      JSON.stringify(results),
      actor,
    ],
  );

  await db.query(`UPDATE product_cases SET updated_at = NOW() WHERE id = $1`, [params.caseId]);

  await recordAuditLog({
    actor,
    action: "calibration.applied",
    entityType: "product_case",
    entityId: params.caseId,
    details: {
      costModelVersion: nextVersion,
      scope: suggestion.scope,
      scopeLabel: suggestion.scopeLabel,
      sampleSkuCount: suggestion.sampleSkuCount,
      totalUnits: suggestion.totalUnits,
      latestPeriodEnd: suggestion.latestPeriodEnd,
      appliedFields: preview.appliedFields.map((f) => ({
        field: f.field,
        label: f.label,
        before: f.before,
        after: f.after,
      })),
      beforeRecommendation: preview.before.recommendation,
      afterRecommendation: preview.after.recommendation,
      decisionChanged: preview.decisionChanged,
      beforeMarginRate: preview.before.marginRate,
      afterMarginRate: preview.after.marginRate,
      beforeMaxLandedCostCents: preview.before.maxLandedCostCents,
      afterMaxLandedCostCents: preview.after.maxLandedCostCents,
    },
  });

  return { ok: true, action: "apply", newVersion: nextVersion, preview };
}
