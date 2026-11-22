import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { attachResearchPriority, generateHypotheses } from "../ai-provider.ts";
import {
  evaluateSourcingDecision,
  platformEconomicDefaults,
  validateEvidenceUrl,
  type AISourcingContext,
} from "../ai-sourcing.ts";
import { buildCompetitorBenchmark, isSyntheticCompetitorSource } from "../competitor-insights.ts";
import {
  batchSelect,
  buildValidationTasks,
  clamp,
  groupBy,
  loadHypothesisContext,
  mapBatch,
  mapCompetitor,
  mapDecision,
  mapDecisionQuote,
  mapEvidence,
  mapHypothesis,
  mapQuote,
  mapReviewInsight,
  mapShortlist,
  mapSupplierCandidate,
  mapSupplierDiscoveryRun,
  mapTask,
  validFxRate,
} from "./mappers.ts";
import { refreshAISelectionDecision } from "./decisions.ts";
import type {
  AISourcingBatchDetail,
  AISourcingBatchSummary,
  AISourcingHypothesisDetail,
  AppDatabase,
  BatchJoinRow,
  CompetitorRow,
  DecisionRow,
  EvidenceRow,
  HypothesisRow,
  QuoteRow,
  ReviewInsightRow,
  ShortlistRow,
  SupplierCandidateRow,
  SupplierDiscoveryRunRow,
  TaskRow,
} from "./types.ts";

type ExistingAISourcingRun = {
  runId: string;
  briefId: string;
  provider: string;
  fallback: boolean;
  reused: true;
};

class DuplicateAISourcingRequestError extends Error {}

async function findExistingAISourcingRun(
  db: AppDatabase,
  requestKey: string,
): Promise<ExistingAISourcingRun | null> {
  const result = await db.query<{
    run_id: string;
    brief_id: string;
    provider: string;
    response_summary: Record<string, unknown>;
  }>(
    `SELECT r.id AS run_id, r.brief_id, r.provider, r.response_summary
     FROM ai_sourcing_runs r
     WHERE r.request_key = $1
     LIMIT 1`,
    [requestKey],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    runId: row.run_id,
    briefId: row.brief_id,
    provider: row.provider,
    fallback: Boolean(row.response_summary.fallback),
    reused: true,
  };
}

export async function createAISourcingBatch(input: {
  marketCode: string;
  platformCode: string;
  category: string;
  brief: string;
  actor: string;
  fxRateToUsd?: number | null;
  fxSourceUrl?: string | null;
  requestKey?: string | null;
}) {
  const db = await getDb();
  const requestKey = input.requestKey?.trim() || null;
  if (requestKey && requestKey.length > 128) {
    throw new Error("研究请求标识无效，请刷新页面后重试");
  }
  if (requestKey) {
    const existing = await findExistingAISourcingRun(db, requestKey);
    if (existing) return existing;
  }
  const site = await db.query<{ market_name: string; currency: string; platform_name: string }>(
    `SELECT m.name AS market_name, m.currency, p.name AS platform_name
     FROM markets m, platforms p
     WHERE m.code = $1 AND p.code = $2 AND m.status = 'active' AND p.status <> 'disabled'`,
    [input.marketCode, input.platformCode],
  );
  const row = site.rows[0];
  if (!row) throw new Error("当前国家或平台站点不可用");

  const fxRate = row.currency === "USD" ? 1 : validFxRate(input.fxRateToUsd);
  const fxSourceUrl = input.fxSourceUrl?.trim() ? validateEvidenceUrl(input.fxSourceUrl.trim()) : null;
  if (fxRate && row.currency !== "USD" && !fxSourceUrl) {
    throw new Error("非 USD 市场录入汇率时必须同时填写汇率来源 URL");
  }
  const context: AISourcingContext = {
    marketCode: input.marketCode,
    marketName: row.market_name,
    platformCode: input.platformCode,
    platformName: row.platform_name,
    currency: row.currency,
    fxRateToUsd: fxRate,
    fxSourceUrl,
  };
  const briefId = randomUUID();
  const runId = randomUUID();
  const actor = input.actor.trim() || "运营人员";
  const category = input.category.trim().slice(0, 80) || "待分类";
  const brief = input.brief.trim().slice(0, 1200);
  if (brief.length < 3) throw new Error("请描述你想验证的商品或场景");

  const generated = await generateHypotheses({ brief, category, context });
  const scored = attachResearchPriority(generated.hypotheses, category, context);

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO sourcing_briefs
          (id, market_code, platform_code, category, brief, currency, fx_rate_to_usd, fx_source_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [briefId, input.marketCode, input.platformCode, category, brief, row.currency, fxRate, fxSourceUrl, actor],
      );
      const insertedRun = await tx.query<{ id: string }>(
        `INSERT INTO ai_sourcing_runs
          (id, brief_id, provider, model, request_key, status, response_summary, completed_at)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6::jsonb, NOW())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [runId, briefId, generated.provider, generated.model, requestKey, JSON.stringify(generated.responseSummary)],
      );
      if (insertedRun.rows.length === 0) throw new DuplicateAISourcingRequestError();
      for (const [index, item] of scored.entries()) {
        const hypothesis = item.hypothesis;
        await tx.query(
          `INSERT INTO opportunity_hypotheses
            (id, run_id, position, concept, target_user, pain_point, differentiator,
             recommended_price_cents, expected_margin_rate, first_order_budget_cents,
             main_risks, supplier_keywords, competitor_queries, review_queries, priority_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15)`,
          [
            randomUUID(),
            runId,
            index + 1,
            hypothesis.concept,
            hypothesis.targetUser,
            hypothesis.painPoint,
            hypothesis.differentiator,
            hypothesis.recommendedPriceCents,
            hypothesis.expectedMarginRate,
            hypothesis.firstOrderBudgetCents,
            JSON.stringify(hypothesis.mainRisks),
            JSON.stringify(hypothesis.supplierKeywords),
            JSON.stringify(hypothesis.competitorQueries),
            JSON.stringify(hypothesis.reviewQueries),
            item.priorityScore,
          ],
        );
      }
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'ai_sourcing.batch_created', 'ai_sourcing_run', $3, $4::jsonb)`,
        [
          randomUUID(),
          actor,
          runId,
          JSON.stringify({
            provider: generated.provider,
            model: generated.model,
            hypothesisCount: generated.hypotheses.length,
            marketCode: input.marketCode,
            platformCode: input.platformCode,
            evidenceCreated: 0,
            requestKeyPresent: Boolean(requestKey),
          }),
        ],
      );
    });
  } catch (error) {
    if (error instanceof DuplicateAISourcingRequestError && requestKey) {
      const existing = await findExistingAISourcingRun(db, requestKey);
      if (existing) return existing;
    }
    throw error;
  }

  return {
    runId,
    briefId,
    provider: generated.provider,
    fallback: Boolean(generated.responseSummary.fallback),
    reused: false as const,
  };
}

export async function listAISourcingBatches(marketCode?: string, platformCode?: string): Promise<AISourcingBatchSummary[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const values: string[] = [];
  if (marketCode) {
    values.push(marketCode);
    conditions.push(`b.market_code = $${values.length}`);
  }
  if (platformCode) {
    values.push(platformCode);
    conditions.push(`b.platform_code = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query<BatchJoinRow>(`${batchSelect}
    ${where}
    GROUP BY r.id, b.id, m.name, p.name
    ORDER BY r.created_at DESC`, values);
  return result.rows.map(mapBatch);
}

export async function deleteAISourcingBatch(runId: string, actor: string) {
  const db = await getDb();
  const normalizedRunId = runId.trim();
  const deletedBy = actor.trim() || "运营人员";
  if (!normalizedRunId) throw new Error("缺少研究批次 ID");

  return db.transaction(async (tx) => {
    const batchResult = await tx.query<{
      id: string;
      brief_id: string;
      market_code: string;
      platform_code: string;
      category: string;
    }>(
      `SELECT r.id, r.brief_id, b.market_code, b.platform_code, b.category
       FROM ai_sourcing_runs r
       JOIN sourcing_briefs b ON b.id = r.brief_id
       WHERE r.id = $1
       FOR UPDATE OF r, b`,
      [normalizedRunId],
    );
    const batch = batchResult.rows[0];
    if (!batch) throw new Error("研究批次不存在或已被删除");

    const countsResult = await tx.query<{
      hypothesis_count: string | number;
      preserved_product_case_count: string | number;
    }>(
      `SELECT
         COUNT(*) AS hypothesis_count,
         COUNT(DISTINCT product_case_id) AS preserved_product_case_count
       FROM opportunity_hypotheses
       WHERE run_id = $1`,
      [normalizedRunId],
    );
    const counts = countsResult.rows[0];
    const deletedHypothesisCount = Number(counts?.hypothesis_count ?? 0);
    const preservedProductCaseCount = Number(counts?.preserved_product_case_count ?? 0);

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.batch_deleted', 'ai_sourcing_run', $3, $4::jsonb)`,
      [
        randomUUID(),
        deletedBy,
        normalizedRunId,
        JSON.stringify({
          briefId: batch.brief_id,
          marketCode: batch.market_code,
          platformCode: batch.platform_code,
          category: batch.category,
          deletedHypothesisCount,
          preservedProductCaseCount,
          productCasesPreserved: true,
          externalActions: "none",
        }),
      ],
    );

    const deleted = await tx.query<{ id: string }>(
      "DELETE FROM sourcing_briefs WHERE id = $1 RETURNING id",
      [batch.brief_id],
    );
    if (deleted.rows.length === 0) throw new Error("研究批次删除失败");

    return {
      runId: normalizedRunId,
      briefId: batch.brief_id,
      category: batch.category,
      marketCode: batch.market_code,
      platformCode: batch.platform_code,
      deletedHypothesisCount,
      preservedProductCaseCount,
    };
  });
}

export async function getAISourcingBatch(runId: string): Promise<AISourcingBatchDetail | null> {
  const db = await getDb();
  const batchResult = await db.query<BatchJoinRow>(`${batchSelect}
    WHERE r.id = $1
    GROUP BY r.id, b.id, m.name, p.name`, [runId]);
  const batch = batchResult.rows[0];
  if (!batch) return null;

  const [
    hypothesisRows,
    evidenceRows,
    competitorRows,
    reviewInsightRows,
    shortlistRows,
    quoteRows,
    supplierDiscoveryRunRows,
    supplierCandidateRows,
    taskRows,
    decisionRows,
  ] = await Promise.all([
    db.query<HypothesisRow>(
      "SELECT * FROM opportunity_hypotheses WHERE run_id = $1 ORDER BY position ASC",
      [runId],
    ),
    db.query<EvidenceRow>(
      `SELECT e.* FROM opportunity_evidence e
       JOIN opportunity_hypotheses h ON h.id = e.hypothesis_id
       WHERE h.run_id = $1 ORDER BY e.observed_at DESC`,
      [runId],
    ),
    db.query<CompetitorRow>(
      `SELECT c.*, e.source_type FROM competitor_snapshots c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
       WHERE h.run_id = $1 ORDER BY c.observed_at DESC`,
      [runId],
    ),
    db.query<ReviewInsightRow>(
      `SELECT ri.*, e.source_url, e.observed_at, e.source_type
       FROM review_insights ri
       JOIN opportunity_hypotheses h ON h.id = ri.hypothesis_id
       LEFT JOIN opportunity_evidence e ON e.id = ri.evidence_id
       WHERE h.run_id = $1
       ORDER BY ri.sample_size DESC, ri.created_at DESC`,
      [runId],
    ),
    db.query<ShortlistRow>(
      `SELECT s.* FROM supplier_shortlists s
       JOIN opportunity_hypotheses h ON h.id = s.hypothesis_id
       WHERE h.run_id = $1 ORDER BY s.created_at DESC`,
      [runId],
    ),
    db.query<QuoteRow>(
      `SELECT q.* FROM sourcing_supplier_quotes q
       JOIN opportunity_hypotheses h ON h.id = q.hypothesis_id
       WHERE h.run_id = $1 ORDER BY q.landed_cost_cents ASC`,
      [runId],
    ),
    db.query<SupplierDiscoveryRunRow>(
      `SELECT r.* FROM supplier_discovery_runs r
       JOIN opportunity_hypotheses h ON h.id = r.hypothesis_id
       WHERE h.run_id = $1 ORDER BY r.captured_at DESC, r.created_at DESC`,
      [runId],
    ),
    db.query<SupplierCandidateRow>(
      `SELECT c.* FROM supplier_candidates c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       WHERE h.run_id = $1 ORDER BY c.score DESC, c.observed_at DESC, c.created_at DESC`,
      [runId],
    ),
    db.query<TaskRow>(
      `SELECT t.* FROM validation_tasks t
       JOIN opportunity_hypotheses h ON h.id = t.hypothesis_id
       WHERE h.run_id = $1 ORDER BY t.created_at ASC`,
      [runId],
    ),
    db.query<DecisionRow>(
      `SELECT d.* FROM selection_decisions d
       JOIN opportunity_hypotheses h ON h.id = d.hypothesis_id
       WHERE h.run_id = $1`,
      [runId],
    ),
  ]);

  const evidenceByHypothesis = groupBy(evidenceRows.rows, (row) => row.hypothesis_id);
  const competitorByHypothesis = groupBy(competitorRows.rows, (row) => row.hypothesis_id);
  const reviewInsightsByHypothesis = groupBy(reviewInsightRows.rows, (row) => row.hypothesis_id);
  const shortlistByHypothesis = groupBy(shortlistRows.rows, (row) => row.hypothesis_id);
  const quotesByHypothesis = groupBy(quoteRows.rows, (row) => row.hypothesis_id);
  const supplierDiscoveryRunsByHypothesis = groupBy(supplierDiscoveryRunRows.rows, (row) => row.hypothesis_id);
  const supplierCandidatesByHypothesis = groupBy(supplierCandidateRows.rows, (row) => row.hypothesis_id);
  const tasksByHypothesis = groupBy(taskRows.rows, (row) => row.hypothesis_id);
  const decisionByHypothesis = new Map(decisionRows.rows.map((row) => [row.hypothesis_id, mapDecision(row)]));
  const mappedBatch = mapBatch(batch);

  const hypotheses = hypothesisRows.rows.map((row) => {
    const mappedHyp = mapHypothesis(row);
    const evidence = (evidenceByHypothesis.get(row.id) ?? []).map(mapEvidence);
    const competitors = (competitorByHypothesis.get(row.id) ?? []).map(mapCompetitor);
    const reviewInsights = (reviewInsightsByHypothesis.get(row.id) ?? []).map(mapReviewInsight);
    const shortlist = (shortlistByHypothesis.get(row.id) ?? []).map(mapShortlist);
    const quotes = (quotesByHypothesis.get(row.id) ?? []).map(mapQuote);
    const supplierDiscoveryRuns = (supplierDiscoveryRunsByHypothesis.get(row.id) ?? []).map(mapSupplierDiscoveryRun);
    const supplierCandidates = (supplierCandidatesByHypothesis.get(row.id) ?? []).map(mapSupplierCandidate);
    const tasks = (tasksByHypothesis.get(row.id) ?? []).map(mapTask);
    const decision = decisionByHypothesis.get(row.id) ?? null;
    const bestQuote = quotes.find((q) => q.currency === mappedBatch.currency) ?? quotes[0] ?? null;
    const benchmark = buildCompetitorBenchmark({
      snapshots: competitors,
      insights: reviewInsights,
      scope: {
        runId: mappedBatch.id,
        hypothesisId: mappedHyp.id,
        caseId: mappedHyp.productCaseId,
        marketCode: mappedBatch.marketCode,
        platformCode: mappedBatch.platformCode,
        currency: mappedBatch.currency,
      },
      hypothesis: {
        concept: mappedHyp.concept,
        targetUser: mappedHyp.targetUser,
        painPoint: mappedHyp.painPoint,
        differentiator: mappedHyp.differentiator,
        recommendedPriceCents: mappedHyp.recommendedPriceCents,
        confirmedPriceCents: mappedHyp.confirmedPriceCents,
        expectedMarginRate: mappedHyp.expectedMarginRate,
        bestQuoteLandedCostCents: bestQuote?.landedCostCents ?? decision?.landedCostCents ?? null,
        bestQuoteId: bestQuote?.id ?? decision?.bestQuoteId ?? null,
      },
    });
    const verifiedReviewInsights = reviewInsights.filter((item) => !isSyntheticCompetitorSource(item.sourceType));
    const reviewSampleTotal = verifiedReviewInsights.length > 0
      ? verifiedReviewInsights.reduce((sum, item) => sum + item.sampleSize, 0)
      : evidence.reduce((sum, item) => {
          if (item.evidenceType !== "review_insight") return sum;
          const value = Number(item.rawSnapshot.reviewSampleSize ?? item.rawSnapshot.sampleSize ?? 0);
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);
    return {
      ...mappedHyp,
      evidence,
      competitors,
      reviewInsights,
      benchmark,
      shortlist,
      quotes,
      supplierDiscoveryRuns,
      supplierCandidates,
      tasks,
      decision,
      counts: {
        competitors: competitors.length,
        verifiedCompetitors: competitors.filter((c) => !isSyntheticCompetitorSource(c.sourceType)).length,
        syntheticCompetitors: competitors.filter((c) => isSyntheticCompetitorSource(c.sourceType)).length,
        reviewSamples: reviewSampleTotal,
        suppliers: shortlist.length,
        supplierCandidates: supplierCandidates.length,
        quotes: quotes.length,
        completedTasks: tasks.filter((task) => task.status === "done").length,
        totalTasks: tasks.length,
      },
    };
  });

  return { ...mappedBatch, createdBy: batch.created_by, hypotheses };
}

export async function selectHypothesisForValidation(hypothesisId: string, actor: string) {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  const owner = actor.trim() || "运营人员";

  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE opportunity_hypotheses SET selected_for_validation = TRUE WHERE id = $1",
      [hypothesisId],
    );
    for (const task of buildValidationTasks(context.hypothesis, context.batch)) {
      await tx.query(
        `INSERT INTO validation_tasks
          (id, hypothesis_id, task_type, title, description, target_count, owner)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (hypothesis_id, task_type) DO UPDATE SET
           description = EXCLUDED.description,
           target_count = EXCLUDED.target_count,
           owner = CASE WHEN validation_tasks.owner = '未分配' THEN EXCLUDED.owner ELSE validation_tasks.owner END,
           updated_at = NOW()`,
        [randomUUID(), hypothesisId, task.taskType, task.title, task.description, task.targetCount, owner],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_selected', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), owner, hypothesisId, JSON.stringify({ taskCount: 8, externalActions: "none" })],
    );
  });
  await refreshAISelectionDecision(hypothesisId);
}

export async function toggleValidationTaskStatus(
  taskId: string,
  requestedStatus?: "done" | "todo",
  actor = "运营人员",
) {
  const db = await getDb();
  const res = await db.query<{ id: string; status: string; hypothesis_id: string; title: string }>(
    "SELECT id, status, hypothesis_id, title FROM validation_tasks WHERE id = $1",
    [taskId],
  );
  const task = res.rows[0];
  if (!task) throw new Error("验证任务不存在");

  const nextStatus = requestedStatus ?? (task.status === "done" ? "todo" : "done");
  await db.query(
    "UPDATE validation_tasks SET status = $1, updated_at = NOW() WHERE id = $2",
    [nextStatus, taskId],
  );

  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'ai_sourcing.task_status_changed', 'validation_task', $3, $4::jsonb)`,
    [randomUUID(), actor, taskId, JSON.stringify({ title: task.title, status: nextStatus })],
  );

  await refreshAISelectionDecision(task.hypothesis_id);
  return { id: taskId, status: nextStatus, hypothesisId: task.hypothesis_id };
}


export function getBatchSiteLabel(batch: Pick<AISourcingBatchSummary, "marketName" | "platformName">) {
  return `${batch.marketName}站 · ${batch.platformName}`;
}

