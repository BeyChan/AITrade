import { getDb } from "../db.ts";
import { recordAuditLog } from "../audit-logs.ts";
import { saveFunnelThresholds } from "../app-settings.ts";
import { SELECTION_STATUS, type SelectionStatus } from "../selection-status.ts";
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
import {
  type CandidateRow,
  type ConfigRow,
  type RunRow,
  rowToCandidate,
  rowToConfig,
  rowToRun,
} from "./repo-shared.ts";

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
  const mapped = res.rows.map(rowToCandidate);
  const hypIds = Array.from(
    new Set(
      mapped
        .filter((item) => !item.promotedCaseId && item.grade !== "ELIMINATED" && item.adoptedHypothesisId)
        .map((item) => item.adoptedHypothesisId as string),
    ),
  );
  if (hypIds.length === 0) return mapped;

  // 实时回读选品看板中的真实阶段，保证选品初筛与选品看板的状态枚举 100% 同步
  const hypRes = await db.query<{
    id: string;
    product_case_id: string | null;
    eliminated_at: string | null;
    comparison_report_id: string | null;
    cost_sheet_id: string | null;
    quote_count: number;
  }>(
    `SELECT
       h.id,
       h.product_case_id,
       h.eliminated_at,
       h.comparison_report_id,
       h.cost_sheet_id,
       (SELECT COUNT(*) FROM sourcing_supplier_quotes q WHERE q.hypothesis_id = h.id)::int AS quote_count
     FROM opportunity_hypotheses h
     WHERE h.id = ANY($1::text[])`,
    [hypIds],
  );
  const stageByHypId = new Map<string, SelectionStatus>();
  const caseByHypId = new Map<string, string>();
  for (const h of hypRes.rows) {
    if (h.product_case_id) {
      stageByHypId.set(h.id, SELECTION_STATUS.PROMOTED_CASE);
      caseByHypId.set(h.id, h.product_case_id);
    } else if (h.eliminated_at) {
      stageByHypId.set(h.id, SELECTION_STATUS.ELIMINATED);
    } else if (h.quote_count > 0) {
      stageByHypId.set(h.id, SELECTION_STATUS.KANBAN_SAMPLING);
    } else if (h.cost_sheet_id) {
      stageByHypId.set(h.id, SELECTION_STATUS.KANBAN_PROFITABLE);
    } else if (h.comparison_report_id) {
      stageByHypId.set(h.id, SELECTION_STATUS.KANBAN_SCANNED);
    } else {
      stageByHypId.set(h.id, SELECTION_STATUS.KANBAN_CANDIDATE);
    }
  }

  return mapped.map((item) => {
    if (!item.adoptedHypothesisId) return item;
    const liveStatus = stageByHypId.get(item.adoptedHypothesisId);
    if (!liveStatus) return item;
    return {
      ...item,
      promotedCaseId: item.promotedCaseId ?? caseByHypId.get(item.adoptedHypothesisId) ?? null,
      selectionStatus: liveStatus,
    };
  });
}

