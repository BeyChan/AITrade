import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { OFFICIAL_FX_CONFIG } from "../currency.ts";
import { getFxRatesSnapshot } from "../fx-rates.ts";
import { recordAuditLog } from "../audit-logs.ts";
import { computeBatchMarketContext, evaluateAndGradeCandidate } from "./grading.ts";
import { deriveAutoCandidateSelectionStatus } from "../selection-status.ts";
import { getPlatformConfig } from "./repository.ts";
import type {
  AutoCandidateResult,
  AutoPipelineRunSummary,
  AutoSourceType,
  NormalizedCandidateSeed,
} from "./types.ts";

async function resolveFxToCny(currency: string): Promise<number> {
  const code = (currency || "USD").trim().toUpperCase();
  if (code === "CNY" || code === "RMB") return 1;
  try {
    const snap = await getFxRatesSnapshot();
    const item = snap.byCurrency[code];
    if (item && item.rateToRmb > 0) return item.rateToRmb;
  } catch {
    // 退回内置官方默认汇率
  }
  return OFFICIAL_FX_CONFIG[code]?.rateToRmb ?? 7.22;
}

/**
 * 多平台可配置自动选品编排入口：
 * 接收任意数据源归一化后的 NormalizedCandidateSeed[]，按平台配置执行快筛、估算算账、
 * 18% 目标反推采购天花板与 S/A/B/HOLD/ELIMINATED 自动分级，并幂等写入候选池。
 */
export async function runAutoSourcingPipeline(input: {
  platformCode: string;
  marketCode: string;
  sourceType: AutoSourceType;
  sourceLabel?: string;
  seeds: NormalizedCandidateSeed[];
  actor?: string;
}): Promise<{
  run: AutoPipelineRunSummary;
  candidates: AutoCandidateResult[];
}> {
  const config = await getPlatformConfig(input.platformCode, input.marketCode);
  const runId = randomUUID();
  const actor = input.actor || "运营人员";
  const sourceLabel = input.sourceLabel?.trim() || `${input.sourceType}:${config.platformCode}-${config.marketCode}`;
  const db = await getDb();

  // 按 externalId 去重
  const dedupedSeeds: NormalizedCandidateSeed[] = [];
  const seen = new Set<string>();
  for (const seed of input.seeds) {
    const key = seed.externalId.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupedSeeds.push({
      ...seed,
      platformCode: config.platformCode,
      marketCode: config.marketCode,
      externalId: key,
      currency: seed.currency || config.currency,
    });
  }

  await db.query(
    `INSERT INTO auto_pipeline_runs
     (id, platform_code, market_code, source_type, source_label, status, total_seeds, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, 'running', $6, $7, NOW())`,
    [runId, config.platformCode, config.marketCode, input.sourceType, sourceLabel, dedupedSeeds.length, actor],
  );

  try {
    const fxToCny = await resolveFxToCny(config.currency);
    const batchContext = computeBatchMarketContext(dedupedSeeds);

    const results: AutoCandidateResult[] = [];
    const counts = { S: 0, A: 0, B: 0, HOLD: 0, ELIMINATED: 0 };

    for (const seed of dedupedSeeds) {
      const candidateId = randomUUID();
      const evaluated = evaluateAndGradeCandidate({
        id: candidateId,
        runId,
        seed,
        config,
        batchContext,
        fxToCnyRate: fxToCny,
      });
      counts[evaluated.grade] += 1;

      const upserted = await db.query<{ id: string; promoted_case_id: string | null }>(
        `INSERT INTO auto_candidates
         (id, run_id, platform_code, market_code, external_id, title, brand, category, url, currency,
          price_cents, monthly_sales_estimate, review_count, rating, grade, verdict, score,
          estimated_margin_rate, max_landed_cost_cents, max_landed_cost_cny, pricing_source,
          evidence_source, reasons, metrics, observed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,$24::jsonb,$25,NOW(),NOW())
         ON CONFLICT (platform_code, market_code, external_id) DO UPDATE SET
           run_id = EXCLUDED.run_id,
           title = EXCLUDED.title,
           brand = EXCLUDED.brand,
           category = CASE WHEN EXCLUDED.category <> '' THEN EXCLUDED.category ELSE auto_candidates.category END,
           url = CASE WHEN EXCLUDED.url <> '' THEN EXCLUDED.url ELSE auto_candidates.url END,
           currency = EXCLUDED.currency,
           price_cents = EXCLUDED.price_cents,
           monthly_sales_estimate = EXCLUDED.monthly_sales_estimate,
           review_count = EXCLUDED.review_count,
           rating = EXCLUDED.rating,
           grade = EXCLUDED.grade,
           verdict = EXCLUDED.verdict,
           score = EXCLUDED.score,
           estimated_margin_rate = EXCLUDED.estimated_margin_rate,
           max_landed_cost_cents = EXCLUDED.max_landed_cost_cents,
           max_landed_cost_cny = EXCLUDED.max_landed_cost_cny,
           pricing_source = EXCLUDED.pricing_source,
           evidence_source = EXCLUDED.evidence_source,
           reasons = EXCLUDED.reasons,
           metrics = EXCLUDED.metrics,
           observed_at = EXCLUDED.observed_at,
           updated_at = NOW()
         RETURNING id, promoted_case_id`,
        [
          evaluated.id,
          evaluated.runId,
          evaluated.platformCode,
          evaluated.marketCode,
          evaluated.externalId,
          evaluated.title,
          evaluated.brand,
          evaluated.category,
          evaluated.url,
          evaluated.currency,
          evaluated.priceCents,
          evaluated.monthlySalesEstimate,
          evaluated.reviewCount,
          evaluated.rating,
          evaluated.grade,
          evaluated.verdict,
          evaluated.score,
          evaluated.estimatedMarginRate,
          evaluated.maxLandedCostCents,
          evaluated.maxLandedCostCny,
          evaluated.pricingSource,
          evaluated.evidenceSource,
          JSON.stringify(evaluated.reasons),
          JSON.stringify(evaluated.metrics),
          evaluated.observedAt,
        ],
      );

      const upsertedId = upserted.rows[0]?.id ?? evaluated.id;
      const promotedCaseId = upserted.rows[0]?.promoted_case_id ?? null;
      const snapshotId = randomUUID();

      await db.query(
        `INSERT INTO auto_run_candidates
         (id, run_id, candidate_id, platform_code, market_code, external_id, title, brand, category, url, currency,
          price_cents, monthly_sales_estimate, review_count, rating, grade, verdict, score,
          estimated_margin_rate, max_landed_cost_cents, max_landed_cost_cny, pricing_source,
          evidence_source, reasons, metrics, promoted_case_id, observed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24::jsonb,$25::jsonb,$26,$27,NOW(),NOW())
         ON CONFLICT (run_id, external_id) DO UPDATE SET
           candidate_id = EXCLUDED.candidate_id,
           title = EXCLUDED.title,
           brand = EXCLUDED.brand,
           category = EXCLUDED.category,
           url = EXCLUDED.url,
           currency = EXCLUDED.currency,
           price_cents = EXCLUDED.price_cents,
           monthly_sales_estimate = EXCLUDED.monthly_sales_estimate,
           review_count = EXCLUDED.review_count,
           rating = EXCLUDED.rating,
           grade = EXCLUDED.grade,
           verdict = EXCLUDED.verdict,
           score = EXCLUDED.score,
           estimated_margin_rate = EXCLUDED.estimated_margin_rate,
           max_landed_cost_cents = EXCLUDED.max_landed_cost_cents,
           max_landed_cost_cny = EXCLUDED.max_landed_cost_cny,
           pricing_source = EXCLUDED.pricing_source,
           evidence_source = EXCLUDED.evidence_source,
           reasons = EXCLUDED.reasons,
           metrics = EXCLUDED.metrics,
           promoted_case_id = COALESCE(EXCLUDED.promoted_case_id, auto_run_candidates.promoted_case_id),
           observed_at = EXCLUDED.observed_at,
           updated_at = NOW()`,
        [
          snapshotId,
          evaluated.runId,
          upsertedId,
          evaluated.platformCode,
          evaluated.marketCode,
          evaluated.externalId,
          evaluated.title,
          evaluated.brand,
          evaluated.category,
          evaluated.url,
          evaluated.currency,
          evaluated.priceCents,
          evaluated.monthlySalesEstimate,
          evaluated.reviewCount,
          evaluated.rating,
          evaluated.grade,
          evaluated.verdict,
          evaluated.score,
          evaluated.estimatedMarginRate,
          evaluated.maxLandedCostCents,
          evaluated.maxLandedCostCny,
          evaluated.pricingSource,
          evaluated.evidenceSource,
          JSON.stringify(evaluated.reasons),
          JSON.stringify(evaluated.metrics),
          promotedCaseId,
          evaluated.observedAt,
        ],
      );

      results.push({
        ...evaluated,
        id: snapshotId,
        promotedCaseId,
        selectionStatus: deriveAutoCandidateSelectionStatus({
          grade: evaluated.grade,
          promotedCaseId,
        }),
      });
    }

    const completedAt = new Date().toISOString();
    await db.query(
      `UPDATE auto_pipeline_runs
       SET status = 'completed',
           s_count = $1, a_count = $2, b_count = $3, hold_count = $4, eliminated_count = $5,
           summary = $6::jsonb,
           completed_at = NOW()
       WHERE id = $7`,
      [
        counts.S,
        counts.A,
        counts.B,
        counts.HOLD,
        counts.ELIMINATED,
        JSON.stringify({
          fxToCny,
          batchContext,
          configId: config.id,
        }),
        runId,
      ],
    );

    await recordAuditLog({
      actor,
      action: "auto_pipeline.run_completed",
      entityType: "auto_pipeline_run",
      entityId: runId,
      details: {
        platformCode: config.platformCode,
        marketCode: config.marketCode,
        sourceType: input.sourceType,
        totalSeeds: dedupedSeeds.length,
        counts,
      },
    }).catch(() => {});

    return {
      run: {
        id: runId,
        platformCode: config.platformCode,
        marketCode: config.marketCode,
        sourceType: input.sourceType,
        sourceLabel,
        status: "completed",
        totalSeeds: dedupedSeeds.length,
        sCount: counts.S,
        aCount: counts.A,
        bCount: counts.B,
        holdCount: counts.HOLD,
        eliminatedCount: counts.ELIMINATED,
        createdBy: actor,
        createdAt: completedAt,
        completedAt,
      },
      candidates: results,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.query(
      `UPDATE auto_pipeline_runs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`,
      [message.slice(0, 500), runId],
    );
    throw error;
  }
}
