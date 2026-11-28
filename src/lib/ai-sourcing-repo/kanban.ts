import { getDb } from "../db.ts";
import { isDemoMode, resolveAppMode, type ModeOptions } from "../app-mode.ts";
import type { ProductComplianceAttribute } from "../prelaunch-compliance.ts";
import {
  deriveCandidateKanbanStage,
  type DerivedKanbanState,
  type EliminatedHistoryRecord,
} from "../sourcing-funnel.ts";

export type KanbanCandidateItem = {
  id: string;
  runId: string;
  concept: string;
  category: string;
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
  sourceKind: string;
  priorityScore: number;
  productCaseId: string | null;
  comparisonReportId: string | null;
  comparisonReportConfirmed: boolean;
  costSheetId: string | null;
  costSheetStatus: "draft" | "confirmed" | null;
  costSheetMarginRate: number | null;
  costSheetVersion: number | null;
  costSheetIsLatest: boolean;
  costSheetScopeMatches: boolean;
  confirmedPriceCents: number | null;
  referenceFactoryCostRmb: number | null;
  complianceAttrs: ProductComplianceAttribute[];
  eliminatedAt: string | null;
  eliminationReason: string | null;
  eliminationNote: string | null;
  verifiedCompetitorCount: number;
  reviewSampleCount: number;
  supplierCount: number;
  quoteCount: number;
  decision: "GO" | "HOLD" | "NO-GO" | null;
  createdAt: string;
  kanban: DerivedKanbanState;
};

export async function listKanbanCandidates(
  marketCode?: string,
  platformCode?: string,
  options?: ModeOptions,
): Promise<KanbanCandidateItem[]> {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const conditions: string[] = ["r.is_demo = $1", "b.is_demo = $1"];
  const values: Array<string | boolean> = [isDemoMode(mode)];
  if (marketCode) {
    values.push(marketCode);
    conditions.push(`b.market_code = $${values.length}`);
  }
  if (platformCode) {
    values.push(platformCode);
    conditions.push(`b.platform_code = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const res = await db.query<{
    id: string;
    run_id: string;
    concept: string;
    category: string;
    market_code: string;
    market_name: string;
    platform_code: string;
    platform_name: string;
    currency: string;
    source_kind: string | null;
    priority_score: number;
    product_case_id: string | null;
    comparison_report_id: string | null;
    comparison_report_confirmed: boolean;
    cost_sheet_id: string | null;
    cost_sheet_status: "draft" | "confirmed" | null;
    cost_sheet_margin_rate: string | number | null;
    cost_sheet_version: number | null;
    cost_sheet_is_latest: boolean;
    cost_sheet_scope_matches: boolean;
    confirmed_price_cents: number | null;
    reference_factory_cost_rmb: string | number | null;
    compliance_attrs: string[] | null;
    eliminated_at: string | null;
    elimination_reason: string | null;
    elimination_note: string | null;
    verified_competitors: string | number;
    review_samples: string | number;
    suppliers: string | number;
    quotes: string | number;
    decision: "GO" | "HOLD" | "NO-GO" | null;
    created_at: string;
  }>(
    `SELECT
       h.id, h.run_id, h.concept, b.category, b.market_code, m.name AS market_name,
       b.platform_code, p.name AS platform_name, b.currency, h.source_kind,
       h.priority_score, h.product_case_id, h.comparison_report_id,
       COALESCE(cr.review_status = 'confirmed'
         AND cr.market_code = b.market_code
         AND cr.platform_code = b.platform_code
         AND cr.payload->>'currency' = b.currency, FALSE) AS comparison_report_confirmed,
       cs.id AS cost_sheet_id, cs.status AS cost_sheet_status,
       cs.results->>'marginRate' AS cost_sheet_margin_rate, cs.version AS cost_sheet_version,
       COALESCE(cs.id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM cost_sheets newer
         WHERE newer.group_id = cs.group_id
           AND newer.is_demo = cs.is_demo
           AND newer.version > cs.version
       ), FALSE) AS cost_sheet_is_latest,
       COALESCE(cs.hypothesis_id = h.id
         AND cs.market_code = b.market_code
         AND cs.platform_code = b.platform_code
         AND cs.currency = b.currency, FALSE) AS cost_sheet_scope_matches,
       h.confirmed_price_cents, h.reference_factory_cost_rmb, h.compliance_attrs,
       h.eliminated_at, h.elimination_reason, h.elimination_note, h.created_at,
       d.decision,
       (SELECT COUNT(*) FROM competitor_snapshots c
          LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
          WHERE c.hypothesis_id = h.id
            AND COALESCE(e.source_type, '') NOT IN ('ai_generated', 'template_generated')) AS verified_competitors,
       (SELECT COALESCE(SUM(ri.sample_size), 0) FROM review_insights ri
          LEFT JOIN opportunity_evidence e ON e.id = ri.evidence_id
          WHERE ri.hypothesis_id = h.id
            AND COALESCE(e.source_type, '') NOT IN ('ai_generated', 'template_generated')) AS review_samples,
       (SELECT COUNT(*) FROM supplier_shortlists s WHERE s.hypothesis_id = h.id) AS suppliers,
       (SELECT COUNT(*) FROM sourcing_supplier_quotes q WHERE q.hypothesis_id = h.id) AS quotes
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     JOIN markets m ON m.code = b.market_code
     JOIN platforms p ON p.code = b.platform_code
     LEFT JOIN selection_decisions d ON d.hypothesis_id = h.id
     LEFT JOIN cost_sheets cs ON cs.id = h.cost_sheet_id AND cs.is_demo = $1
     LEFT JOIN competitor_comparison_reports cr ON cr.id = h.comparison_report_id AND cr.is_demo = $1
     ${where}
     ORDER BY h.created_at DESC, h.position ASC`,
    values,
  );

  return res.rows.map((r) => {
    const complianceAttrs = (Array.isArray(r.compliance_attrs) ? r.compliance_attrs : []) as ProductComplianceAttribute[];
    const refCost =
      r.reference_factory_cost_rmb === null || r.reference_factory_cost_rmb === undefined
        ? null
        : Number(r.reference_factory_cost_rmb);
    const verifiedCompetitorCount = Number(r.verified_competitors ?? 0);
    const supplierCount = Number(r.suppliers ?? 0);
    const quoteCount = Number(r.quotes ?? 0);
    const kanban = deriveCandidateKanbanStage({
      id: r.id,
      runId: r.run_id,
      productCaseId: r.product_case_id,
      eliminatedAt: r.eliminated_at,
      verifiedCompetitorCount,
      comparisonReportId: r.comparison_report_id,
      comparisonReportConfirmed: Boolean(r.comparison_report_confirmed),
      costSheetId: r.cost_sheet_id,
      costSheetStatus: r.cost_sheet_status,
      costSheetMarginRate:
        r.cost_sheet_margin_rate === null || r.cost_sheet_margin_rate === undefined
          ? null
          : Number(r.cost_sheet_margin_rate),
      costSheetVersion: r.cost_sheet_version === null ? null : Number(r.cost_sheet_version),
      costSheetIsLatest: Boolean(r.cost_sheet_is_latest),
      costSheetScopeMatches: Boolean(r.cost_sheet_scope_matches),
      complianceAttrs,
      quoteCount,
      supplierCount,
      decision: r.decision,
      marketCode: r.market_code,
      platformCode: r.platform_code,
      currency: r.currency,
      concept: r.concept,
    });
    return {
      id: r.id,
      runId: r.run_id,
      concept: r.concept,
      category: r.category,
      marketCode: r.market_code,
      marketName: r.market_name,
      platformCode: r.platform_code,
      platformName: r.platform_name,
      currency: r.currency,
      sourceKind: r.source_kind ?? "ai",
      priorityScore: Number(r.priority_score),
      productCaseId: r.product_case_id,
      comparisonReportId: r.comparison_report_id,
      comparisonReportConfirmed: Boolean(r.comparison_report_confirmed),
      costSheetId: r.cost_sheet_id,
      costSheetStatus: r.cost_sheet_status,
      costSheetMarginRate:
        r.cost_sheet_margin_rate === null || r.cost_sheet_margin_rate === undefined
          ? null
          : Number(r.cost_sheet_margin_rate),
      costSheetVersion: r.cost_sheet_version === null ? null : Number(r.cost_sheet_version),
      costSheetIsLatest: Boolean(r.cost_sheet_is_latest),
      costSheetScopeMatches: Boolean(r.cost_sheet_scope_matches),
      confirmedPriceCents: r.confirmed_price_cents === null ? null : Number(r.confirmed_price_cents),
      referenceFactoryCostRmb: refCost,
      complianceAttrs,
      eliminatedAt: r.eliminated_at,
      eliminationReason: r.elimination_reason,
      eliminationNote: r.elimination_note,
      verifiedCompetitorCount,
      reviewSampleCount: Number(r.review_samples ?? 0),
      supplierCount,
      quoteCount,
      decision: r.decision,
      createdAt: r.created_at,
      kanban,
    };
  });
}

export async function listEliminatedHypotheses(
  marketCode?: string,
  options?: ModeOptions,
): Promise<EliminatedHistoryRecord[]> {
  const db = await getDb();
  const mode = await resolveAppMode(options?.mode);
  const values: Array<string | boolean> = [isDemoMode(mode)];
  const marketClause = marketCode ? (values.push(marketCode), `AND b.market_code = $${values.length}`) : "";
  const res = await db.query<{
    id: string;
    run_id: string;
    concept: string;
    category: string;
    market_code: string;
    competitor_queries: string[] | null;
    elimination_reason: string | null;
    elimination_note: string | null;
    eliminated_at: string;
  }>(
    `SELECT h.id, h.run_id, h.concept, b.category, b.market_code,
            h.competitor_queries, h.elimination_reason, h.elimination_note, h.eliminated_at
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.eliminated_at IS NOT NULL
       AND r.is_demo = $1
       AND b.is_demo = $1
       ${marketClause}
     ORDER BY h.eliminated_at DESC
     LIMIT 200`,
    values,
  );
  return res.rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    concept: r.concept,
    category: r.category,
    marketCode: r.market_code,
    competitorQueries: Array.isArray(r.competitor_queries) ? r.competitor_queries : [],
    eliminationReason: r.elimination_reason ?? "已淘汰",
    eliminationNote: r.elimination_note,
    eliminatedAt: r.eliminated_at,
  }));
}


