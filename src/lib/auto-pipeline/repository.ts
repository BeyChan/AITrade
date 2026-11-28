import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { calculateEconomics, type EconomicsAssumptions } from "../economics.ts";
import { recordAuditLog } from "../audit-logs.ts";
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

export async function listAutoPipelineRuns(limit = 20): Promise<AutoPipelineRunSummary[]> {
  const db = await getDb();
  const res = await db.query<RunRow>(
    `SELECT * FROM auto_pipeline_runs ORDER BY created_at DESC LIMIT $1`,
    [Math.max(1, Math.min(100, limit))],
  );
  return res.rows.map(rowToRun);
}

export async function listAutoCandidates(filter: {
  platformCode?: string;
  marketCode?: string;
  grade?: AutoGrade | "ALL";
  limit?: number;
} = {}): Promise<AutoCandidateResult[]> {
  const db = await getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

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

  params.push(Math.max(1, Math.min(300, filter.limit ?? 150)));
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates ${where}
     ORDER BY
       CASE grade WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 WHEN 'HOLD' THEN 4 ELSE 5 END ASC,
       score DESC,
       updated_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return res.rows.map(rowToCandidate);
}

/**
 * 人工确认将候选池条目推进为正式商品案卷（仍保持 HOLD/provisional，等补真实工厂报价定标后才转 GO）。
 */
export async function promoteAutoCandidateToCase(candidateId: string, actor = "运营人员"): Promise<{ caseId: string; alreadyExisted: boolean }> {
  const db = await getDb();
  const res = await db.query<CandidateRow>(
    `SELECT * FROM auto_candidates WHERE id = $1 LIMIT 1`,
    [candidateId],
  );
  const candidate = res.rows[0];
  if (!candidate) {
    throw new Error("未找到对应的自动选品候选记录");
  }
  if (candidate.promoted_case_id) {
    return { caseId: candidate.promoted_case_id, alreadyExisted: true };
  }

  // 检查是否已存在相同 ASIN/external_id + marketplace 的案卷
  const existingCase = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE asin = $1 AND marketplace = $2 LIMIT 1`,
    [candidate.external_id, candidate.market_code],
  );
  if (existingCase.rows[0]) {
    const existingId = existingCase.rows[0].id;
    await db.query(
      `UPDATE auto_candidates SET promoted_case_id = $1, updated_at = NOW() WHERE id = $2`,
      [existingId, candidateId],
    );
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
  const notes = `自动选品池 ${candidate.grade} 级推进（平台 ${candidate.platform_code}/${candidate.market_code}，估算达标采购上限 ≤ ¥${Number(candidate.max_landed_cost_cny || 0).toFixed(1)}，待补真实工厂报价与人工定标）。`;

  await db.query(
    `INSERT INTO product_cases
     (id, asin, title, category, marketplace, currency, competitor_price_cents, monthly_sales_estimate, review_count, rating, evidence_score, opportunity_score, recommendation, status, notes, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'HOLD', 'sourcing', $13, NOW(), NOW())`,
    [
      caseId,
      candidate.external_id,
      candidate.title,
      candidate.category || "未分类",
      candidate.market_code,
      candidate.currency || config.currency,
      priceCents,
      Number(candidate.monthly_sales_estimate || 300),
      Number(candidate.review_count || 0),
      candidate.rating ?? 4.2,
      70,
      Number(candidate.score || 0),
      notes,
    ],
  );

  await db.query(
    `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_at)
     VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, NOW())`,
    [costModelId, caseId, JSON.stringify(assumptions), JSON.stringify(econ)],
  );

  await db.query(
    `UPDATE auto_candidates SET promoted_case_id = $1, updated_at = NOW() WHERE id = $2`,
    [caseId, candidateId],
  );

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
