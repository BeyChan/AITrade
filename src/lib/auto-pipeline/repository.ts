import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { calculateEconomics, type EconomicsAssumptions } from "../economics.ts";
import { recordAuditLog } from "../audit-logs.ts";
import { saveFunnelThresholds } from "../app-settings.ts";
import {
  BUILTIN_PLATFORM_CONFIGS,
  buildConfigId,
  getDefaultPlatformConfig,
  sanitizePlatformConfigPatch,
} from "./config.ts";
import type {
  AutoCandidateResult,
  AutoGrade,
  AutoPipelineRunSummary,
  DeliveryMethodCode,
  PlatformEconomicsDefaults,
  PlatformPipelineConfig,
  AutoGradingThresholds,
} from "./types.ts";

type ConfigRow = {
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

type RunRow = {
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

type CandidateRow = {
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
  observed_at: string;
  updated_at: string;
};

function rowToConfig(row: ConfigRow): PlatformPipelineConfig {
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

function rowToRun(row: RunRow): AutoPipelineRunSummary {
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

function rowToCandidate(row: CandidateRow): AutoCandidateResult {
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
    observedAt: row.observed_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureBuiltinPlatformConfigs(): Promise<void> {
  const db = await getDb();
  for (const cfg of BUILTIN_PLATFORM_CONFIGS) {
    await db.query(
      `INSERT INTO auto_pipeline_configs
       (id, platform_code, market_code, currency, enabled, label, economics_defaults, thresholds, delivery_methods, inbox_dir, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, NOW())
       ON CONFLICT (platform_code, market_code) DO NOTHING`,
      [
        cfg.id,
        cfg.platformCode,
        cfg.marketCode,
        cfg.currency,
        cfg.enabled,
        cfg.label,
        JSON.stringify(cfg.economicsDefaults),
        JSON.stringify(cfg.thresholds),
        JSON.stringify(cfg.deliveryMethods),
        cfg.inboxDir,
      ],
    );
  }
}

export async function listPlatformConfigs(): Promise<PlatformPipelineConfig[]> {
  await ensureBuiltinPlatformConfigs();
  const db = await getDb();
  const res = await db.query<ConfigRow>(
    `SELECT * FROM auto_pipeline_configs ORDER BY platform_code ASC, market_code ASC`,
  );
  return res.rows.map(rowToConfig);
}

export async function getPlatformConfig(
  platformCode: string,
  marketCode: string,
): Promise<PlatformPipelineConfig> {
  await ensureBuiltinPlatformConfigs();
  const db = await getDb();
  const p = platformCode.trim().toLowerCase() || "amazon";
  const m = marketCode.trim().toUpperCase() || "US";
  const res = await db.query<ConfigRow>(
    `SELECT * FROM auto_pipeline_configs WHERE platform_code = $1 AND market_code = $2 LIMIT 1`,
    [p, m],
  );
  if (res.rows[0]) return rowToConfig(res.rows[0]);
  return getDefaultPlatformConfig(p, m);
}

export async function upsertPlatformConfig(input: {
  platformCode: string;
  marketCode: string;
  currency?: string;
  enabled?: boolean;
  label?: string;
  economicsDefaults?: Partial<PlatformEconomicsDefaults>;
  thresholds?: Partial<AutoGradingThresholds>;
  deliveryMethods?: DeliveryMethodCode[];
  inboxDir?: string | null;
  actor?: string;
}): Promise<PlatformPipelineConfig> {
  const existing = await getPlatformConfig(input.platformCode, input.marketCode);
  const next = sanitizePlatformConfigPatch(existing, input);
  const id = buildConfigId(next.platformCode, next.marketCode);
  const db = await getDb();

  await db.query(
    `INSERT INTO auto_pipeline_configs
     (id, platform_code, market_code, currency, enabled, label, economics_defaults, thresholds, delivery_methods, inbox_dir, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, NOW())
     ON CONFLICT (platform_code, market_code) DO UPDATE SET
       currency = EXCLUDED.currency,
       enabled = EXCLUDED.enabled,
       label = EXCLUDED.label,
       economics_defaults = EXCLUDED.economics_defaults,
       thresholds = EXCLUDED.thresholds,
       delivery_methods = EXCLUDED.delivery_methods,
       inbox_dir = EXCLUDED.inbox_dir,
       updated_at = NOW()`,
    [
      id,
      next.platformCode,
      next.marketCode,
      next.currency,
      next.enabled,
      next.label,
      JSON.stringify(next.economicsDefaults),
      JSON.stringify(next.thresholds),
      JSON.stringify(next.deliveryMethods),
      next.inboxDir,
    ],
  );

  await saveFunnelThresholds(
    {
      minCompetitorsForPass: next.thresholds.minCompetitorsForPass,
      maxHhi: next.thresholds.maxHhi,
      maxBrandCr3Percent: next.thresholds.maxBrandCr3Percent,
      maxMedianReviews: next.thresholds.maxMedianReviews,
      minMarginRate: next.economicsDefaults.targetMarginRate,
      maxComplianceCostUsd: next.thresholds.maxComplianceCostUsd,
    },
    input.actor || "运营人员",
  ).catch(() => {});

  await recordAuditLog({
    actor: input.actor || "运营人员",
    action: "auto_pipeline.config_updated",
    entityType: "auto_pipeline_config",
    entityId: id,
    details: {
      platformCode: next.platformCode,
      marketCode: next.marketCode,
      targetMarginRate: next.economicsDefaults.targetMarginRate,
      sGradeMinMargin: next.thresholds.sGradeMinMargin,
      deliveryMethods: next.deliveryMethods,
    },
  }).catch(() => {});

  return getPlatformConfig(next.platformCode, next.marketCode);
}

export async function listAutoPipelineRuns(
  filter:
    | number
    | {
        platformCode?: string;
        marketCode?: string;
        limit?: number;
      } = 50,
): Promise<AutoPipelineRunSummary[]> {
  const db = await getDb();
  const opts = typeof filter === "number" ? { limit: filter } : filter;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (opts.platformCode && opts.platformCode !== "ALL") {
    params.push(opts.platformCode.trim().toLowerCase());
    clauses.push(`platform_code = $${params.length}`);
  }
  if (opts.marketCode && opts.marketCode !== "ALL") {
    params.push(opts.marketCode.trim().toUpperCase());
    clauses.push(`market_code = $${params.length}`);
  }

  params.push(Math.max(1, Math.min(100, opts.limit ?? 50)));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await db.query<RunRow>(
    `SELECT * FROM auto_pipeline_runs ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(rowToRun);
}

export async function listAutoCandidates(filter: {
  platformCode?: string;
  marketCode?: string;
  grade?: AutoGrade | "ALL";
  runId?: string;
  limit?: number;
} = {}): Promise<AutoCandidateResult[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  const useRunSnapshot = Boolean(filter.runId && filter.runId !== "ALL");

  if (useRunSnapshot && filter.runId) {
    params.push(filter.runId.trim());
    clauses.push(`run_id = $${params.length}`);
  }
  if (filter.platformCode && filter.platformCode !== "ALL") {
    params.push(filter.platformCode.trim().toLowerCase());
    clauses.push(`platform_code = $${params.length}`);
  }
  if (filter.marketCode && filter.marketCode !== "ALL") {
    params.push(filter.marketCode.trim().toUpperCase());
    clauses.push(`market_code = $${params.length}`);
  }
  if (filter.grade && filter.grade !== "ALL") {
    params.push(filter.grade);
    clauses.push(`grade = $${params.length}`);
  }

  const maxLimit = useRunSnapshot ? 500 : 300;
  params.push(Math.max(1, Math.min(maxLimit, filter.limit ?? maxLimit)));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const table = useRunSnapshot ? "auto_run_candidates" : "auto_candidates";
  const res = await db.query<CandidateRow>(
    `SELECT * FROM ${table} ${where}
     ORDER BY
       CASE grade WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'HOLD' THEN 4 ELSE 5 END ASC,
       score DESC,
       updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(rowToCandidate);
}

type DbClient = Awaited<ReturnType<typeof getDb>>;

async function recalculateRunCounts(db: DbClient, runIds: Iterable<string>): Promise<void> {
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

async function syncPooledCandidatesFromSnapshots(
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

export async function renameAutoPipelineRun(
  runId: string,
  sourceLabel: string,
  actor = "运营人员",
): Promise<AutoPipelineRunSummary> {
  const trimmed = sourceLabel.trim();
  if (!trimmed) {
    throw new Error("批次名称不能为空");
  }
  const db = await getDb();
  const res = await db.query<RunRow>(
    `UPDATE auto_pipeline_runs
     SET source_label = $1
     WHERE id = $2
     RETURNING *`,
    [trimmed.slice(0, 120), runId],
  );
  const row = res.rows[0];
  if (!row) {
    throw new Error("未找到对应的自动选品批次");
  }
  await recordAuditLog({
    actor,
    action: "auto_pipeline.run_renamed",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: { sourceLabel: trimmed.slice(0, 120) },
  }).catch(() => {});
  return rowToRun(row);
}

/**
 * 删除整批自动选品记录：
 * - 级联删除该批次在 auto_run_candidates 中的独立快照
 * - 若某 ASIN 在其他历史批次中仍有快照，则将汇总池 auto_candidates 回迁到最新剩余快照，避免误删
 * - 不影响已推进生成的正式商品案卷（product_cases）
 */
export async function deleteAutoPipelineRun(
  runId: string,
  actor = "运营人员",
): Promise<{ deletedRunId: string; deletedCandidates: number }> {
  const db = await getDb();
  const runRes = await db.query<RunRow>(
    `SELECT * FROM auto_pipeline_runs WHERE id = $1 LIMIT 1`,
    [runId],
  );
  const run = runRes.rows[0];
  if (!run) {
    throw new Error("未找到对应的自动选品批次");
  }

  const affectedPooled = await db.query<{
    platform_code: string;
    market_code: string;
    external_id: string;
  }>(
    `SELECT platform_code, market_code, external_id
     FROM auto_candidates
     WHERE run_id = $1`,
    [runId],
  );

  // 先把仍存在于其他历史批次的汇总记录回迁到剩余最新快照，防止被 ON DELETE CASCADE 误删
  if (affectedPooled.rows.length > 0) {
    await syncPooledCandidatesFromSnapshots(
      db,
      affectedPooled.rows.map((r) => ({
        platformCode: r.platform_code,
        marketCode: r.market_code,
        externalId: r.external_id,
      })),
      runId,
    );
  }

  const snapCountRes = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM auto_run_candidates WHERE run_id = $1`,
    [runId],
  );
  const deletedCandidates = snapCountRes.rows[0]?.count ?? 0;

  await db.query(`DELETE FROM auto_pipeline_runs WHERE id = $1`, [runId]);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.run_deleted",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: {
      platformCode: run.platform_code,
      marketCode: run.market_code,
      sourceLabel: run.source_label,
      deletedCandidates,
    },
  }).catch(() => {});

  return { deletedRunId: runId, deletedCandidates };
}

/**
 * 删除单批次内的单条/多条候选记录，或按分级一键清理（如清理 ELIMINATED）。
 * 同步维护汇总池 auto_candidates 与批次统计计数，不影响已推进的正式商品案卷。
 */
export async function deleteAutoCandidates(input: {
  ids?: string[];
  runId: string;
  grade?: AutoGrade;
  actor?: string;
}): Promise<{ deletedCount: number; affectedRunIds: string[] }> {
  const db = await getDb();
  const actor = input.actor || "运营人员";
  const runId = input.runId?.trim();
  const ids = Array.isArray(input.ids) ? input.ids.map((s) => s.trim()).filter(Boolean) : [];

  if (!runId || runId === "ALL") {
    throw new Error("请指定有效的批次 ID");
  }
  if (ids.length === 0 && !input.grade) {
    throw new Error("请指定要删除的候选记录或清理条件");
  }

  const clauses: string[] = [`run_id = $1`];
  const params: unknown[] = [runId];

  if (ids.length > 0) {
    params.push(ids);
    clauses.push(`id = ANY($${params.length}::text[])`);
  }
  if (input.grade) {
    params.push(input.grade);
    clauses.push(`grade = $${params.length}`);
  }

  const targets = await db.query<{
    id: string;
    platform_code: string;
    market_code: string;
    external_id: string;
  }>(
    `SELECT id, platform_code, market_code, external_id
     FROM auto_run_candidates
     WHERE ${clauses.join(" AND ")}`,
    params,
  );

  if (targets.rows.length === 0) {
    return { deletedCount: 0, affectedRunIds: [] };
  }

  const targetIds = targets.rows.map((r) => r.id);
  await db.query(`DELETE FROM auto_run_candidates WHERE id = ANY($1::text[])`, [targetIds]);

  await syncPooledCandidatesFromSnapshots(
    db,
    targets.rows.map((r) => ({
      platformCode: r.platform_code,
      marketCode: r.market_code,
      externalId: r.external_id,
    })),
  );
  await recalculateRunCounts(db, [runId]);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidates_deleted",
    entityType: "auto_pipeline_run",
    entityId: runId,
    details: {
      grade: input.grade ?? null,
      deletedCount: targetIds.length,
    },
  }).catch(() => {});

  return { deletedCount: targetIds.length, affectedRunIds: [runId] };
}

/**
 * 人工确认将候选池条目推进为正式商品案卷（仍保持 HOLD/provisional，等补真实工厂报价定标后才转 GO）。
 * 兼容传入 auto_candidates.id 或 auto_run_candidates.id。
 */
export async function promoteAutoCandidateToCase(candidateId: string, actor = "运营人员"): Promise<{ caseId: string; alreadyExisted: boolean }> {
  const db = await getDb();
  let res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates WHERE id = $1 LIMIT 1`,
    [candidateId],
  );
  if (!res.rows[0]) {
    res = await db.query<CandidateRow>(
      `SELECT * FROM auto_run_candidates WHERE id = $1 LIMIT 1`,
      [candidateId],
    );
  }
  const candidate = res.rows[0];
  if (!candidate) {
    throw new Error("未找到对应的自动选品候选记录");
  }

  const syncPromotedCase = async (caseId: string) => {
    await db.query(
      `UPDATE auto_candidates
       SET promoted_case_id = $1, updated_at = NOW()
       WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
      [caseId, candidate.platform_code, candidate.market_code, candidate.external_id],
    );
    await db.query(
      `UPDATE auto_run_candidates
       SET promoted_case_id = $1, updated_at = NOW()
       WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
      [caseId, candidate.platform_code, candidate.market_code, candidate.external_id],
    );
  };

  if (candidate.promoted_case_id) {
    await syncPromotedCase(candidate.promoted_case_id);
    return { caseId: candidate.promoted_case_id, alreadyExisted: true };
  }

  // 检查是否已存在相同 ASIN/external_id + marketplace 的案卷
  const existingCase = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE asin = $1 AND marketplace = $2 LIMIT 1`,
    [candidate.external_id, candidate.market_code],
  );
  if (existingCase.rows[0]) {
    const existingId = existingCase.rows[0].id;
    await syncPromotedCase(existingId);
    return { caseId: existingId, alreadyExisted: true };
  }

  const config = await getPlatformConfig(candidate.platform_code, candidate.market_code);
  const econCfg = config.economicsDefaults;
  const priceCents = Math.max(100, Number(candidate.price_cents || 100));
  const fbaFeeCents = Math.max(econCfg.fbaFeeMinCents, Math.round(priceCents * econCfg.fbaFeeRate));
  const landedCostCents = Math.round(priceCents * econCfg.estimatedLandedCostRatio);

  const assumptions: EconomicsAssumptions = {
    currency: candidate.currency || config.currency,
    salePriceCents: priceCents,
    landedCostCents,
    fbaFeeCents,
    referralRate: econCfg.referralRate,
    adRate: econCfg.adRate,
    returnRate: econCfg.returnRate,
    returnProcessingCents: Math.round(fbaFeeCents * 0.25),
    returnRecoveryRate: 0.3,
    couponCents: 0,
    storageCents: Math.round(priceCents * 0.015),
    otherCostCents: 0,
    oneTimeFixedCostCents: 0,
    initialOrderUnits: 300,
  };
  const econ = calculateEconomics(assumptions);

  const caseId = randomUUID();
  const costModelId = randomUUID();
  const notes = `自动选品 ${candidate.grade} 级推进（平台 ${candidate.platform_code}/${candidate.market_code}，估算达标采购上限 ≤ ¥${Number(candidate.max_landed_cost_cny || 0).toFixed(1)}，待补真实工厂报价与人工定标）。`;

  await db.query(
    `INSERT INTO product_cases
     (id, asin, marketplace, category, title, url, status, competitor_price_cents, monthly_sales_estimate, review_count, rating, notes, owner, evidence_score, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'researching', $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())`,
    [
      caseId,
      candidate.external_id,
      candidate.market_code,
      candidate.category || "未分类",
      candidate.title,
      candidate.url || null,
      priceCents,
      Number(candidate.monthly_sales_estimate || 300),
      Number(candidate.review_count || 0),
      candidate.rating ?? 4.2,
      notes,
      actor,
      70,
    ],
  );

  await db.query(
    `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_at)
     VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, NOW())`,
    [costModelId, caseId, JSON.stringify(assumptions), JSON.stringify(econ)],
  );

  await syncPromotedCase(caseId);

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidate_promoted",
    entityType: "product_case",
    entityId: caseId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      grade: candidate.grade,
    },
  }).catch(() => {});

  return { caseId, alreadyExisted: false };
}

/**
 * 取消候选推进：
 * - 清空 auto_candidates 与 auto_run_candidates 的 promoted_case_id 关联
 * - 若关联的商品案卷仍是刚推进的初始空案卷（无证据/报价/审批/文案/素材/拿样/实盘记录），自动删除该空案卷
 * - 若已录入真实业务数据或已进入审批，则保留正式案卷不误删，仅解除选品池关联
 */
export async function unpromoteAutoCandidate(
  candidateId: string,
  actor = "运营人员",
): Promise<{ caseId: string | null; caseDeleted: boolean }> {
  const db = await getDb();
  let res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates WHERE id = $1 LIMIT 1`,
    [candidateId],
  );
  if (!res.rows[0]) {
    res = await db.query<CandidateRow>(
      `SELECT * FROM auto_run_candidates WHERE id = $1 LIMIT 1`,
      [candidateId],
    );
  }
  const candidate = res.rows[0];
  if (!candidate) {
    throw new Error("未找到对应的自动选品候选记录");
  }

  const caseId = candidate.promoted_case_id;
  await db.query(
    `UPDATE auto_candidates
     SET promoted_case_id = NULL, updated_at = NOW()
     WHERE platform_code = $1 AND market_code = $2 AND external_id = $3`,
    [candidate.platform_code, candidate.market_code, candidate.external_id],
  );
  await db.query(
    `UPDATE auto_run_candidates
     SET promoted_case_id = NULL, updated_at = NOW()
     WHERE platform_code = $1 AND market_code = $2 AND external_id = $3`,
    [candidate.platform_code, candidate.market_code, candidate.external_id],
  );

  let caseDeleted = false;
  if (caseId) {
    const caseRes = await db.query<{ status: string }>(
      `SELECT status FROM product_cases WHERE id = $1 LIMIT 1`,
      [caseId],
    );
    const caseRow = caseRes.rows[0];
    if (caseRow && caseRow.status === "researching") {
      const workRes = await db.query<{
        extra_records: number;
        cost_model_count: number;
      }>(
        `SELECT
           (
             (SELECT COUNT(*) FROM case_evidence WHERE case_id = $1) +
             (SELECT COUNT(*) FROM approvals WHERE case_id = $1) +
             (SELECT COUNT(*) FROM rfqs WHERE case_id = $1) +
             (SELECT COUNT(*) FROM assets WHERE case_id = $1) +
             (SELECT COUNT(*) FROM listings WHERE case_id = $1) +
             (SELECT COUNT(*) FROM supplier_selections WHERE case_id = $1) +
             (SELECT COUNT(*) FROM sourcing_sample_logs WHERE case_id = $1) +
             (SELECT COUNT(*) FROM studio_media_assets WHERE case_id = $1) +
             (SELECT COUNT(*) FROM operations_sku_snapshots WHERE case_id = $1)
           )::int AS extra_records,
           (SELECT COUNT(*) FROM cost_models WHERE case_id = $1)::int AS cost_model_count`,
        [caseId],
      );
      const work = workRes.rows[0];
      if (work && work.extra_records === 0 && work.cost_model_count <= 1) {
        await db.query(`DELETE FROM product_cases WHERE id = $1`, [caseId]);
        caseDeleted = true;
      }
    }
  }

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidate_unpromoted",
    entityType: "product_case",
    entityId: caseId || candidateId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      caseDeleted,
    },
  }).catch(() => {});

  return { caseId, caseDeleted };
}

async function resolveCandidatesByIds(db: DbClient, candidateIds: string[]): Promise<CandidateRow[]> {
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

async function ensureKanbanRunForPool(
  db: DbClient,
  opts: {
    platformCode: string;
    marketCode: string;
    currency: string;
    category: string;
    brief: string;
    requestKey: string;
    actor: string;
  },
): Promise<{ runId: string; nextPosition: number }> {
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM ai_sourcing_runs WHERE request_key = $1 LIMIT 1`,
    [opts.requestKey],
  );
  let runId = existing.rows[0]?.id;
  if (!runId) {
    const briefId = randomUUID();
    runId = randomUUID();
    await db.query(
      `INSERT INTO sourcing_briefs
        (id, market_code, platform_code, category, brief, currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        briefId,
        opts.marketCode.toUpperCase(),
        opts.platformCode.toLowerCase(),
        opts.category.slice(0, 80),
        opts.brief.slice(0, 1200),
        opts.currency || "USD",
        opts.actor,
      ],
    );
    await db.query(
      `INSERT INTO ai_sourcing_runs
        (id, brief_id, provider, model, request_key, status, response_summary, completed_at)
       VALUES ($1, $2, 'auto_pool', 'pool_triage', $3, 'completed', '{}'::jsonb, NOW())`,
      [runId, briefId, opts.requestKey],
    );
  }
  const posRes = await db.query<{ max_pos: number }>(
    `SELECT COALESCE(MAX(position), 0)::int AS max_pos FROM opportunity_hypotheses WHERE run_id = $1`,
    [runId],
  );
  return { runId, nextPosition: Number(posRes.rows[0]?.max_pos ?? 0) + 1 };
}

/**
 * 将选品线索池的一条或多条候选采纳进「推进看板」（opportunity_hypotheses）：
 * - 已采纳且看板记录仍存在的候选幂等复用，不重复建卡
 * - 自动带入 ASIN、售价、估算净利率、采购天花板与竞品检索词，进入统一 4 步选品验证工作台
 */
let adoptionColumnsEnsured = false;

async function ensureAdoptionColumns(db: DbClient): Promise<void> {
  if (adoptionColumnsEnsured) return;
  await db.query(`ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS adopted_run_id TEXT`);
  await db.query(`ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS adopted_hypothesis_id TEXT`);
  await db.query(`ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS adopted_run_id TEXT`);
  await db.query(`ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS adopted_hypothesis_id TEXT`);
  adoptionColumnsEnsured = true;
}

export async function adoptAutoCandidatesToKanban(input: {
  candidateIds: string[];
  actor?: string;
}): Promise<{
  adoptedCount: number;
  reusedCount: number;
  items: Array<{ candidateId: string; runId: string; hypothesisId: string; alreadyExisted: boolean }>;
}> {
  const db = await getDb();
  await ensureAdoptionColumns(db);
  const actor = input.actor?.trim() || "运营人员";
  const rows = await resolveCandidatesByIds(db, input.candidateIds);
  if (rows.length === 0) {
    throw new Error("未找到要采纳的候选记录");
  }

  const results: Array<{ candidateId: string; runId: string; hypothesisId: string; alreadyExisted: boolean }> = [];
  let adoptedCount = 0;
  let reusedCount = 0;

  // 按 platform × market 分组，每组落入对应站点的“线索池采纳”批次
  const groups = new Map<string, CandidateRow[]>();
  for (const row of rows) {
    const key = `${row.platform_code.toLowerCase()}:${row.market_code.toUpperCase()}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    const platformCode = first.platform_code.toLowerCase();
    const marketCode = first.market_code.toUpperCase();
    const currency = first.currency || "USD";
    const requestKey = `pool_adopted:${platformCode}:${marketCode}`;

    let runIdCache: string | null = null;
    let nextPos = 1;

    for (const candidate of groupRows) {
      // 检查是否已有有效关联
      if (candidate.adopted_run_id && candidate.adopted_hypothesis_id) {
        const check = await db.query<{ id: string }>(
          `SELECT id FROM opportunity_hypotheses WHERE id = $1 LIMIT 1`,
          [candidate.adopted_hypothesis_id],
        );
        if (check.rows[0]) {
          reusedCount += 1;
          results.push({
            candidateId: candidate.id,
            runId: candidate.adopted_run_id,
            hypothesisId: candidate.adopted_hypothesis_id,
            alreadyExisted: true,
          });
          continue;
        }
      }

      if (!runIdCache) {
        const ensured = await ensureKanbanRunForPool(db, {
          platformCode,
          marketCode,
          currency,
          category: "线索池采纳",
          brief: `来自 ${platformCode.toUpperCase()} ${marketCode} 选品线索池初筛采纳的候选品，进入统一 4 步验证漏斗。`,
          requestKey,
          actor,
        });
        runIdCache = ensured.runId;
        nextPos = ensured.nextPosition;
      }

      const hypothesisId = randomUUID();
      const priceCents = Math.max(100, Number(candidate.price_cents || 100));
      const marginRate = Math.max(0, Math.min(0.95, Number(candidate.estimated_margin_rate || 0.18)));
      const maxLandedCny = Number(candidate.max_landed_cost_cny || 0);
      const priorityScore = Math.max(0, Math.min(100, Math.round(Number(candidate.score || 60))));
      const concept = `${candidate.external_id} · ${candidate.title}`.slice(0, 120);
      const reasonSummary = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
        .slice(0, 3)
        .map((r) => r.message)
        .join("；");
      const painPoint = `竞品参考价 ${(priceCents / 100).toFixed(2)} ${currency}，评论 ${Number(candidate.review_count || 0)}，评分 ${candidate.rating ?? "—"}；18% 门禁达标采购上限 ≤ ¥${maxLandedCny.toFixed(1)}。`;
      const differentiator = `线索池 ${candidate.grade} 级初筛采纳（机会分 ${priorityScore}，估算净利率 ${(marginRate * 100).toFixed(1)}%）${reasonSummary ? `：${reasonSummary}` : ""}`;
      const risks = (Array.isArray(candidate.reasons) ? candidate.reasons : [])
        .filter((r) => r.severity === "fail" || r.severity === "warn")
        .map((r) => r.message);

      await db.query(
        `INSERT INTO opportunity_hypotheses
          (id, run_id, position, concept, target_user, pain_point, differentiator,
           recommended_price_cents, expected_margin_rate, first_order_budget_cents,
           main_risks, supplier_keywords, competitor_queries, review_queries,
           priority_score, selected_for_validation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, TRUE, NOW())`,
        [
          hypothesisId,
          runIdCache,
          nextPos++,
          concept,
          `${marketCode} ${platformCode.toUpperCase()} 买家`,
          painPoint,
          differentiator,
          priceCents,
          marginRate,
          Math.max(0, Math.round(Number(candidate.max_landed_cost_cents || 0) * 300)),
          JSON.stringify(risks),
          JSON.stringify([candidate.category || candidate.title.slice(0, 32)].filter(Boolean)),
          JSON.stringify([candidate.external_id, candidate.title.slice(0, 48)].filter(Boolean)),
          JSON.stringify([candidate.external_id].filter(Boolean)),
          priorityScore,
        ],
      );

      await db.query(
        `UPDATE auto_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
        [runIdCache, hypothesisId, candidate.platform_code, candidate.market_code, candidate.external_id],
      );
      await db.query(
        `UPDATE auto_run_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
        [runIdCache, hypothesisId, candidate.platform_code, candidate.market_code, candidate.external_id],
      );

      adoptedCount += 1;
      results.push({
        candidateId: candidate.id,
        runId: runIdCache,
        hypothesisId,
        alreadyExisted: false,
      });

      await recordAuditLog({
        actor,
        action: "auto_pipeline.candidate_adopted",
        entityType: "opportunity_hypothesis",
        entityId: hypothesisId,
        details: {
          candidateId: candidate.id,
          runId: runIdCache,
          platformCode,
          marketCode,
          externalId: candidate.external_id,
          grade: candidate.grade,
        },
      }).catch(() => {});
    }
  }

  return { adoptedCount, reusedCount, items: results };
}

/**
 * 取消采纳入选品看板：
 * - 清空 auto_candidates 与 auto_run_candidates 的 adopted_run_id / adopted_hypothesis_id 关联
 * - 若关联的看板候选仍是刚采纳的空白记录（未绑定研报/核算单/案卷，且无竞品/报价/证据/定标记录），同步删除该空候选（若所属采纳批次已空则一并清理）
 * - 若已在看板中录入真实调研数据，则保留看板候选不误删，仅解除初筛池关联
 */
export async function unadoptAutoCandidate(
  candidateId: string,
  actor = "运营人员",
): Promise<{ hypothesisId: string | null; hypothesisDeleted: boolean }> {
  const db = await getDb();
  await ensureAdoptionColumns(db);
  const rows = await resolveCandidatesByIds(db, [candidateId]);
  const candidate = rows[0];
  if (!candidate) {
    throw new Error("未找到对应的初筛候选记录");
  }

  const hypothesisId = candidate.adopted_hypothesis_id ?? null;
  const runId = candidate.adopted_run_id ?? null;

  await db.query(
    `UPDATE auto_candidates
     SET adopted_run_id = NULL, adopted_hypothesis_id = NULL, updated_at = NOW()
     WHERE platform_code = $1 AND market_code = $2 AND external_id = $3`,
    [candidate.platform_code, candidate.market_code, candidate.external_id],
  );
  await db.query(
    `UPDATE auto_run_candidates
     SET adopted_run_id = NULL, adopted_hypothesis_id = NULL, updated_at = NOW()
     WHERE platform_code = $1 AND market_code = $2 AND external_id = $3`,
    [candidate.platform_code, candidate.market_code, candidate.external_id],
  );

  let hypothesisDeleted = false;
  if (hypothesisId) {
    const hypRes = await db.query<{
      run_id: string;
      comparison_report_id: string | null;
      cost_sheet_id: string | null;
      product_case_id: string | null;
      eliminated_at: string | null;
      extra_records: number;
    }>(
      `SELECT
         h.run_id,
         h.comparison_report_id,
         h.cost_sheet_id,
         h.product_case_id,
         h.eliminated_at,
         (
           (SELECT COUNT(*) FROM opportunity_evidence WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM competitor_snapshots WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM review_insights WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM supplier_shortlists WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) +
           (SELECT COUNT(*) FROM selection_decisions WHERE hypothesis_id = $1)
         )::int AS extra_records
       FROM opportunity_hypotheses h
       WHERE h.id = $1
       LIMIT 1`,
      [hypothesisId],
    );
    const hyp = hypRes.rows[0];
    if (
      hyp &&
      !hyp.comparison_report_id &&
      !hyp.cost_sheet_id &&
      !hyp.product_case_id &&
      !hyp.eliminated_at &&
      hyp.extra_records === 0
    ) {
      await db.query(`DELETE FROM opportunity_hypotheses WHERE id = $1`, [hypothesisId]);
      hypothesisDeleted = true;

      // 如果所属“线索池采纳”批次下已无任何候选，顺手清理该空批次避免看板出现空批 pill
      const targetRunId = runId || hyp.run_id;
      if (targetRunId) {
        const remainRes = await db.query<{ count: number; brief_id: string | null; request_key: string | null }>(
          `SELECT
             (SELECT COUNT(*) FROM opportunity_hypotheses WHERE run_id = $1)::int AS count,
             r.brief_id,
             r.request_key
           FROM ai_sourcing_runs r
           WHERE r.id = $1
           LIMIT 1`,
          [targetRunId],
        );
        const remain = remainRes.rows[0];
        if (remain && remain.count === 0 && remain.request_key?.startsWith("pool_adopted:")) {
          await db.query(`DELETE FROM ai_sourcing_runs WHERE id = $1`, [targetRunId]);
          if (remain.brief_id) {
            await db.query(`DELETE FROM sourcing_briefs WHERE id = $1`, [remain.brief_id]);
          }
        }
      }
    }
  }

  await recordAuditLog({
    actor,
    action: "auto_pipeline.candidate_unadopted",
    entityType: "opportunity_hypothesis",
    entityId: hypothesisId || candidateId,
    details: {
      candidateId,
      platformCode: candidate.platform_code,
      marketCode: candidate.market_code,
      externalId: candidate.external_id,
      hypothesisDeleted,
    },
  }).catch(() => {});

  return { hypothesisId, hypothesisDeleted };
}

/**
 * 在选品线索池将一条或多条候选批量淘汰，并同步沉淀到统一避坑库（opportunity_hypotheses.eliminated_at）：
 * - 更新 auto_candidates / auto_run_candidates 为 ELIMINATED + NO-GO，刷新批次统计
 * - 写入统一避坑记录，后续在推进看板、添加选品、线索池导入时自动触发历史避坑预警
 */
export async function eliminateAutoCandidatesToBlacklist(input: {
  candidateIds: string[];
  reason: string;
  note?: string;
  actor?: string;
}): Promise<{ eliminatedCount: number }> {
  const db = await getDb();
  await ensureAdoptionColumns(db);
  const actor = input.actor?.trim() || "运营人员";
  const reason = input.reason?.trim() || "其他";
  const note = input.note?.trim() || null;
  const rows = await resolveCandidatesByIds(db, input.candidateIds);
  if (rows.length === 0) {
    throw new Error("未找到要淘汰的候选记录");
  }

  const affectedRunIds = new Set<string>();

  for (const candidate of rows) {
    affectedRunIds.add(candidate.run_id);
    const existingReasons = Array.isArray(candidate.reasons) ? candidate.reasons : [];
    const nextReasons = [
      { code: "MANUAL_BLACKLIST", severity: "fail" as const, message: `人工淘汰入避坑库：${reason}${note ? `（${note}）` : ""}` },
      ...existingReasons.filter((r) => r.code !== "MANUAL_BLACKLIST"),
    ];

    await db.query(
      `UPDATE auto_candidates
       SET grade = 'ELIMINATED', verdict = 'NO-GO', reasons = $1::jsonb, updated_at = NOW()
       WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
      [JSON.stringify(nextReasons), candidate.platform_code, candidate.market_code, candidate.external_id],
    );
    await db.query(
      `UPDATE auto_run_candidates
       SET grade = 'ELIMINATED', verdict = 'NO-GO', reasons = $1::jsonb, updated_at = NOW()
       WHERE platform_code = $2 AND market_code = $3 AND external_id = $4`,
      [JSON.stringify(nextReasons), candidate.platform_code, candidate.market_code, candidate.external_id],
    );

    // 若已采纳进看板，直接把该看板记录标记为淘汰；否则写入统一的“线索池避坑沉淀”批次
    if (candidate.adopted_hypothesis_id) {
      await db.query(
        `UPDATE opportunity_hypotheses
         SET eliminated_at = NOW(), elimination_reason = $1, elimination_note = $2
         WHERE id = $3`,
        [reason, note || `${candidate.platform_code}/${candidate.market_code} 线索池淘汰`, candidate.adopted_hypothesis_id],
      );
    } else {
      const platformCode = candidate.platform_code.toLowerCase();
      const marketCode = candidate.market_code.toUpperCase();
      const currency = candidate.currency || "USD";
      const ensured = await ensureKanbanRunForPool(db, {
        platformCode,
        marketCode,
        currency,
        category: "线索池避坑库",
        brief: `从 ${platformCode.toUpperCase()} ${marketCode} 选品线索池直接淘汰沉淀的避坑记录。`,
        requestKey: `pool_blacklist:${platformCode}:${marketCode}`,
        actor,
      });

      const hypId = randomUUID();
      const concept = `${candidate.external_id} · ${candidate.title}`.slice(0, 120);
      await db.query(
        `INSERT INTO opportunity_hypotheses
          (id, run_id, position, concept, target_user, pain_point, differentiator,
           recommended_price_cents, expected_margin_rate, first_order_budget_cents,
           main_risks, supplier_keywords, competitor_queries, review_queries,
           priority_score, selected_for_validation, eliminated_at, elimination_reason, elimination_note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10::jsonb, '[]'::jsonb, $11::jsonb, '[]'::jsonb, 0, FALSE, NOW(), $12, $13, NOW())`,
        [
          hypId,
          ensured.runId,
          ensured.nextPosition,
          concept,
          `${marketCode} ${platformCode.toUpperCase()} 买家`,
          `线索池淘汰：${reason}`,
          candidate.category || "线索池淘汰",
          Math.max(100, Number(candidate.price_cents || 100)),
          Math.max(0, Math.min(0.95, Number(candidate.estimated_margin_rate || 0))),
          JSON.stringify([reason]),
          JSON.stringify([candidate.external_id, candidate.title.slice(0, 48)].filter(Boolean)),
          reason,
          note || `线索池淘汰（${candidate.external_id}）`,
        ],
      );

      await db.query(
        `UPDATE auto_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
        [ensured.runId, hypId, candidate.platform_code, candidate.market_code, candidate.external_id],
      );
      await db.query(
        `UPDATE auto_run_candidates
         SET adopted_run_id = $1, adopted_hypothesis_id = $2, updated_at = NOW()
         WHERE platform_code = $3 AND market_code = $4 AND external_id = $5`,
        [ensured.runId, hypId, candidate.platform_code, candidate.market_code, candidate.external_id],
      );
    }

    await recordAuditLog({
      actor,
      action: "auto_pipeline.candidate_eliminated",
      entityType: "auto_candidate",
      entityId: candidate.id,
      details: {
        platformCode: candidate.platform_code,
        marketCode: candidate.market_code,
        externalId: candidate.external_id,
        reason,
        note,
      },
    }).catch(() => {});
  }

  await recalculateRunCounts(db, affectedRunIds);
  return { eliminatedCount: rows.length };
}
