import { getDb } from "../db.ts";
import { deriveAutoCandidateSelectionStatus } from "../selection-status.ts";
import { getDefaultPlatformConfig } from "./config.ts";
import type {
  AutoCandidateResult,
  AutoGrade,
  AutoPipelineRunSummary,
  DeliveryMethodCode,
  PlatformEconomicsDefaults,
  PlatformPipelineConfig,
  AutoGradingThresholds,
} from "./types.ts";

export type ConfigRow = {
  id: string;
  platform_code: string;
  market_code: string;
  currency: string;
  enabled: boolean;
  label: string;
  economics_defaults: PlatformEconomicsDefaults;
  thresholds: AutoGradingThresholds;
  delivery_methods: DeliveryMethodCode[];
  inbox_dir: string | null;
  updated_at: string;
};

export type RunRow = {
  id: string;
  platform_code: string;
  market_code: string;
  source_type: AutoPipelineRunSummary["sourceType"];
  source_label: string;
  status: AutoPipelineRunSummary["status"];
  total_seeds: number;
  s_count: number;
  a_count: number;
  b_count: number;
  hold_count: number;
  eliminated_count: number;
  error_message: string | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
};

export type CandidateRow = {
  id: string;
  run_id: string;
  platform_code: string;
  market_code: string;
  external_id: string;
  title: string;
  brand: string;
  category: string;
  url: string;
  currency: string;
  price_cents: number;
  monthly_sales_estimate: number;
  review_count: number;
  rating: number | null;
  grade: AutoGrade;
  verdict: AutoCandidateResult["verdict"];
  score: number;
  estimated_margin_rate: number;
  max_landed_cost_cents: number;
  max_landed_cost_cny: number;
  pricing_source: "estimated";
  evidence_source: "real" | "ai_generated";
  reasons: AutoCandidateResult["reasons"];
  metrics: AutoCandidateResult["metrics"];
  promoted_case_id: string | null;
  adopted_run_id?: string | null;
  adopted_hypothesis_id?: string | null;
  selection_status?: string | null;
  observed_at: string;
  updated_at: string;
};


export function rowToConfig(row: ConfigRow): PlatformPipelineConfig {
  const fallback = getDefaultPlatformConfig(row.platform_code, row.market_code);
  return {
    id: row.id,
    platformCode: row.platform_code,
    marketCode: row.market_code,
    currency: row.currency || fallback.currency,
    enabled: Boolean(row.enabled),
    label: row.label || fallback.label,
    economicsDefaults: { ...fallback.economicsDefaults, ...(row.economics_defaults || {}) },
    thresholds: { ...fallback.thresholds, ...(row.thresholds || {}) },
    deliveryMethods: Array.isArray(row.delivery_methods) && row.delivery_methods.length > 0
      ? row.delivery_methods
      : fallback.deliveryMethods,
    inboxDir: row.inbox_dir ?? fallback.inboxDir,
    updatedAt: row.updated_at,
  };
}

export function rowToRun(row: RunRow): AutoPipelineRunSummary {
  return {
    id: row.id,
    platformCode: row.platform_code,
    marketCode: row.market_code,
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    status: row.status,
    totalSeeds: Number(row.total_seeds || 0),
    sCount: Number(row.s_count || 0),
    aCount: Number(row.a_count || 0),
    bCount: Number(row.b_count || 0),
    holdCount: Number(row.hold_count || 0),
    eliminatedCount: Number(row.eliminated_count || 0),
    errorMessage: row.error_message,
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function rowToCandidate(row: CandidateRow): AutoCandidateResult {
  return {
    id: row.id,
    runId: row.run_id,
    platformCode: row.platform_code,
    marketCode: row.market_code,
    externalId: row.external_id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    url: row.url,
    currency: row.currency,
    priceCents: Number(row.price_cents || 0),
    monthlySalesEstimate: Number(row.monthly_sales_estimate || 0),
    reviewCount: Number(row.review_count || 0),
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    grade: row.grade,
    verdict: row.verdict,
    score: Number(row.score || 0),
    estimatedMarginRate: Number(row.estimated_margin_rate || 0),
    maxLandedCostCents: Number(row.max_landed_cost_cents || 0),
    maxLandedCostCny: Number(row.max_landed_cost_cny || 0),
    pricingSource: "estimated",
    evidenceSource: row.evidence_source || "real",
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    metrics: row.metrics || {
      netProfitCents: 0,
      stressProfitCents: 0,
      breakEvenAcos: 0,
      competitorCount: 0,
      hhi: null,
      brandCr3Percent: null,
      medianReviews: null,
      complianceCostUsd: 0,
      complianceStatus: "pass",
      marketStatus: "pending",
    },
    promotedCaseId: row.promoted_case_id ?? null,
    adoptedRunId: row.adopted_run_id ?? null,
    adoptedHypothesisId: row.adopted_hypothesis_id ?? null,
    selectionStatus: deriveAutoCandidateSelectionStatus({
      grade: row.grade,
      promotedCaseId: row.promoted_case_id,
      adoptedRunId: row.adopted_run_id,
      adoptedHypothesisId: row.adopted_hypothesis_id,
      persistedStatus: row.selection_status,
    }),
    observedAt: row.observed_at,
    updatedAt: row.updated_at,
  };
}


export type DbClient = Awaited<ReturnType<typeof getDb>>;

export async function recalculateRunCounts(db: DbClient, runIds: Iterable<string>): Promise<void> {
  const uniqueIds = Array.from(new Set(Array.from(runIds).filter(Boolean)));
  for (const runId of uniqueIds) {
    const res = await db.query<{
      total: number;
      s_count: number;
      a_count: number;
      b_count: number;
      hold_count: number;
      eliminated_count: number;
    }>(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE grade = 'S')::int AS s_count,
         COUNT(*) FILTER (WHERE grade = 'A')::int AS a_count,
         COUNT(*) FILTER (WHERE grade = 'B')::int AS b_count,
         COUNT(*) FILTER (WHERE grade = 'HOLD')::int AS hold_count,
         COUNT(*) FILTER (WHERE grade = 'ELIMINATED')::int AS eliminated_count
       FROM auto_run_candidates
       WHERE run_id = $1`,
      [runId],
    );
    const counts = res.rows[0];
    if (!counts) continue;
    await db.query(
      `UPDATE auto_pipeline_runs
       SET total_seeds = $1,
           s_count = $2,
           a_count = $3,
           b_count = $4,
           hold_count = $5,
           eliminated_count = $6
       WHERE id = $7`,
      [
        counts.total,
        counts.s_count,
        counts.a_count,
        counts.b_count,
        counts.hold_count,
        counts.eliminated_count,
        runId,
      ],
    );
  }
}

export async function syncPooledCandidatesFromSnapshots(
  db: DbClient,
  keys: Array<{ platformCode: string; marketCode: string; externalId: string }>,
  excludeRunId?: string,
): Promise<void> {
  const seen = new Set<string>();
  for (const item of keys) {
    const dedupeKey = `${item.platformCode}:${item.marketCode}:${item.externalId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const fallbackRes = excludeRunId
      ? await db.query<CandidateRow>(
          `SELECT * FROM auto_run_candidates
           WHERE platform_code = $1 AND market_code = $2 AND external_id = $3 AND run_id <> $4
           ORDER BY created_at DESC, updated_at DESC
           LIMIT 1`,
          [item.platformCode, item.marketCode, item.externalId, excludeRunId],
        )
      : await db.query<CandidateRow>(
          `SELECT * FROM auto_run_candidates
           WHERE platform_code = $1 AND market_code = $2 AND external_id = $3
           ORDER BY created_at DESC, updated_at DESC
           LIMIT 1`,
          [item.platformCode, item.marketCode, item.externalId],
        );

    const latest = fallbackRes.rows[0];
    if (latest) {
      await db.query(
        `UPDATE auto_candidates
         SET run_id = $1,
             title = $2,
             brand = $3,
             category = $4,
             url = $5,
             currency = $6,
             price_cents = $7,
             monthly_sales_estimate = $8,
             review_count = $9,
             rating = $10,
             grade = $11,
             verdict = $12,
             score = $13,
             estimated_margin_rate = $14,
             max_landed_cost_cents = $15,
             max_landed_cost_cny = $16,
             pricing_source = $17,
             evidence_source = $18,
             reasons = $19::jsonb,
             metrics = $20::jsonb,
             promoted_case_id = COALESCE(promoted_case_id, $21),
             observed_at = $22,
             updated_at = NOW()
         WHERE platform_code = $23 AND market_code = $24 AND external_id = $25`,
        [
          latest.run_id,
          latest.title,
          latest.brand,
          latest.category,
          latest.url,
          latest.currency,
          latest.price_cents,
          latest.monthly_sales_estimate,
          latest.review_count,
          latest.rating,
          latest.grade,
          latest.verdict,
          latest.score,
          latest.estimated_margin_rate,
          latest.max_landed_cost_cents,
          latest.max_landed_cost_cny,
          latest.pricing_source,
          latest.evidence_source,
          JSON.stringify(latest.reasons ?? []),
          JSON.stringify(latest.metrics ?? {}),
          latest.promoted_case_id,
          latest.observed_at,
          item.platformCode,
          item.marketCode,
          item.externalId,
        ],
      );
    } else {
      await db.query(
        `DELETE FROM auto_candidates
         WHERE platform_code = $1 AND market_code = $2 AND external_id = $3`,
        [item.platformCode, item.marketCode, item.externalId],
      );
    }
  }
}


export async function resolveCandidatesByIds(db: DbClient, candidateIds: string[]): Promise<CandidateRow[]> {
  const uniqueIds = Array.from(new Set(candidateIds.map((s) => s.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const runRows = await db.query<CandidateRow>(
    `SELECT * FROM auto_run_candidates WHERE id = ANY($1::text[])`,
    [uniqueIds],
  );
  const found = new Map<string, CandidateRow>();
  for (const row of runRows.rows) found.set(row.id, row);

  const missing = uniqueIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    const poolRows = await db.query<CandidateRow>(
      `SELECT * FROM auto_candidates WHERE id = ANY($1::text[])`,
      [missing],
    );
    for (const row of poolRows.rows) found.set(row.id, row);
  }
  return uniqueIds.map((id) => found.get(id)).filter((r): r is CandidateRow => Boolean(r));
}
