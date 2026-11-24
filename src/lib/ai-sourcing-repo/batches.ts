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
  checkHypothesisAgainstConstraints,
  deriveCandidateKanbanStage,
  formatConstraintsSummary,
  isValidEliminationReason,
  type DerivedKanbanState,
  type EliminatedHistoryRecord,
  type SourcingConstraints,
} from "../sourcing-funnel.ts";
import type { ProductComplianceAttribute } from "../prelaunch-compliance.ts";
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
  constraints?: SourcingConstraints | null;
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
  const constraintText = input.constraints ? formatConstraintsSummary(input.constraints) : "";
  const rawBrief = input.brief.trim();
  const brief = (rawBrief
    ? constraintText && !rawBrief.includes(constraintText)
      ? `${rawBrief}\n约束条件：${constraintText}`
      : rawBrief
    : constraintText
  ).slice(0, 1200);
  if (brief.length < 3) throw new Error("请描述你想验证的商品或场景");

  const generated = await generateHypotheses({ brief, category, context });
  const rawScored = attachResearchPriority(generated.hypotheses, category, context);
  let filteredOutCount = 0;
  let scored = rawScored;
  if (
    input.constraints &&
    (input.constraints.excludedAttrs.length > 0 ||
      (input.constraints.customExclusions?.some((c) => c.enabled) ?? false) ||
      input.constraints.minPriceUsd ||
      input.constraints.maxPriceUsd)
  ) {
    const fx = context.currency === "USD" ? 1 : (context.fxRateToUsd && context.fxRateToUsd > 0 ? context.fxRateToUsd : 1);
    const kept = rawScored.filter(({ hypothesis }) => {
      const text = `${hypothesis.concept} ${hypothesis.targetUser} ${hypothesis.painPoint} ${hypothesis.differentiator} ${hypothesis.competitorQueries.join(" ")}`;
      const priceUsdCents = Math.round(hypothesis.recommendedPriceCents / fx);
      return checkHypothesisAgainstConstraints(text, priceUsdCents, input.constraints!).length === 0;
    });
    if (kept.length > 0) {
      filteredOutCount = rawScored.length - kept.length;
      scored = kept;
    }
  }

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
        const hypId = randomUUID();
        await tx.query(
          `INSERT INTO opportunity_hypotheses
            (id, run_id, position, concept, target_user, pain_point, differentiator,
             recommended_price_cents, expected_margin_rate, first_order_budget_cents,
             main_risks, supplier_keywords, competitor_queries, review_queries, priority_score,
             selected_for_validation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15, TRUE)`,
          [
            hypId,
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
        const tasks = buildValidationTasks(
          {
            id: hypId,
            runId,
            position: index + 1,
            concept: hypothesis.concept,
            targetUser: hypothesis.targetUser,
            painPoint: hypothesis.painPoint,
            differentiator: hypothesis.differentiator,
            recommendedPriceCents: hypothesis.recommendedPriceCents,
            confirmedPriceCents: null,
            confirmedPriceSourceUrl: null,
            confirmedPriceAt: null,
            expectedMarginRate: hypothesis.expectedMarginRate,
            firstOrderBudgetCents: hypothesis.firstOrderBudgetCents,
            mainRisks: hypothesis.mainRisks,
            supplierKeywords: hypothesis.supplierKeywords,
            competitorQueries: hypothesis.competitorQueries,
            reviewQueries: hypothesis.reviewQueries,
            priorityScore: item.priorityScore,
            selectedForValidation: true,
            productCaseId: null,
            sourceKind: "ai",
            comparisonReportId: null,
            costSheetId: null,
            referenceFactoryCostRmb: null,
            complianceAttrs: [],
            eliminatedAt: null,
            eliminationReason: null,
            eliminationNote: null,
            createdAt: new Date().toISOString(),
          },
          { ...context, brief, category },
        );
        for (const task of tasks) {
          await tx.query(
            `INSERT INTO validation_tasks
              (id, hypothesis_id, task_type, title, description, target_count, owner)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), hypId, task.taskType, task.title, task.description, task.targetCount, actor],
          );
        }
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
    filteredOutCount,
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

export async function eliminateHypothesis(input: {
  hypothesisId: string;
  reason: string;
  note?: string;
  actor?: string;
}) {
  const db = await getDb();
  const reason = input.reason.trim();
  if (!isValidEliminationReason(reason)) {
    throw new Error("请选择有效的淘汰原因");
  }
  const note = (input.note ?? "").trim().slice(0, 400) || null;
  const actor = (input.actor ?? "").trim() || "运营人员";

  const existing = await db.query<{ id: string; run_id: string; concept: string }>(
    "SELECT id, run_id, concept FROM opportunity_hypotheses WHERE id = $1",
    [input.hypothesisId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("候选方向不存在");

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET eliminated_at = NOW(), elimination_reason = $2, elimination_note = $3
       WHERE id = $1`,
      [input.hypothesisId, reason, note],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_eliminated', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({ runId: row.run_id, concept: row.concept, reason, note }),
      ],
    );
  });

  return { id: row.id, runId: row.run_id, reason, note };
}

export async function restoreHypothesis(hypothesisId: string, actor = "运营人员") {
  const db = await getDb();
  const existing = await db.query<{ id: string; run_id: string; concept: string }>(
    "SELECT id, run_id, concept FROM opportunity_hypotheses WHERE id = $1",
    [hypothesisId],
  );
  const row = existing.rows[0];
  if (!row) throw new Error("候选方向不存在");

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET eliminated_at = NULL, elimination_reason = NULL, elimination_note = NULL
       WHERE id = $1`,
      [hypothesisId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_restored', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), actor.trim() || "运营人员", hypothesisId, JSON.stringify({ runId: row.run_id, concept: row.concept })],
    );
  });

  return { id: row.id, runId: row.run_id };
}

export async function deleteHypothesis(hypothesisId: string, actor = "运营人员") {
  const db = await getDb();
  const normalizedId = hypothesisId.trim();
  const deletedBy = actor.trim() || "运营人员";
  if (!normalizedId) throw new Error("缺少候选方向 ID");

  return db.transaction(async (tx) => {
    const existing = await tx.query<{
      id: string;
      run_id: string;
      concept: string;
      product_case_id: string | null;
    }>(
      "SELECT id, run_id, concept, product_case_id FROM opportunity_hypotheses WHERE id = $1 FOR UPDATE",
      [normalizedId],
    );
    const row = existing.rows[0];
    if (!row) throw new Error("候选方向不存在或已被删除");

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.hypothesis_deleted', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        deletedBy,
        row.id,
        JSON.stringify({
          runId: row.run_id,
          concept: row.concept,
          preservedProductCaseId: row.product_case_id,
        }),
      ],
    );

    await tx.query("DELETE FROM opportunity_hypotheses WHERE id = $1", [row.id]);

    const remaining = await tx.query<{ cnt: string | number }>(
      "SELECT COUNT(*) AS cnt FROM opportunity_hypotheses WHERE run_id = $1",
      [row.run_id],
    );

    return {
      id: row.id,
      runId: row.run_id,
      concept: row.concept,
      remainingCount: Number(remaining.rows[0]?.cnt ?? 0),
      preservedProductCase: Boolean(row.product_case_id),
    };
  });
}

export async function saveHypothesisComplianceAttrs(input: {
  hypothesisId: string;
  complianceAttrs?: string[];
  actor?: string;
}) {
  const db = await getDb();
  const context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("候选方向不存在");
  if (!context.hypothesis.selectedForValidation) {
    await selectHypothesisForValidation(input.hypothesisId, input.actor || "运营人员");
  }

  const attrs =
    input.complianceAttrs === undefined
      ? context.hypothesis.complianceAttrs
      : [...new Set(input.complianceAttrs.map((a) => a.trim()).filter(Boolean))];
  const actor = (input.actor ?? "").trim() || "运营人员";

  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE opportunity_hypotheses SET compliance_attrs = $2::jsonb WHERE id = $1",
      [input.hypothesisId, JSON.stringify(attrs)],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.compliance_attrs_saved', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({ complianceAttrs: attrs }),
      ],
    );
  });

  await refreshAISelectionDecision(input.hypothesisId);
  return { id: input.hypothesisId, runId: context.hypothesis.runId };
}

export async function createQuickCandidateBatch(input: {
  marketCode: string;
  platformCode: string;
  category: string;
  concept: string;
  sourceKind: "manual_idea" | "asin_scan" | "quick_calc";
  searchKeyword?: string;
  recommendedPriceCents?: number | null;
  complianceAttrs?: string[];
  comparisonReportId?: string | null;
  costSheetId?: string | null;
  eliminationReason?: string | null;
  eliminationNote?: string | null;
  actor?: string;
}) {
  const db = await getDb();
  const site = await db.query<{ market_name: string; currency: string; platform_name: string }>(
    `SELECT m.name AS market_name, m.currency, p.name AS platform_name
     FROM markets m, platforms p
     WHERE m.code = $1 AND p.code = $2 AND m.status = 'active' AND p.status <> 'disabled'`,
    [input.marketCode, input.platformCode],
  );
  const row = site.rows[0];
  if (!row) throw new Error("当前国家或平台站点不可用");

  const briefId = randomUUID();
  const runId = randomUUID();
  const hypothesisId = randomUUID();
  const actor = (input.actor ?? "").trim() || "选品负责人";
  const concept = input.concept.trim().slice(0, 140) || "未命名候选方向";
  const category = input.category.trim().slice(0, 80) || "跨境候选";
  const keyword = (input.searchKeyword ?? concept).trim().slice(0, 140);
  let priceCents =
    input.recommendedPriceCents && Number.isFinite(input.recommendedPriceCents) && input.recommendedPriceCents > 0
      ? Math.round(input.recommendedPriceCents)
      : null;
  const requestedCostSheetId = input.costSheetId?.trim() || null;
  if (requestedCostSheetId) {
    const costSheet = await db.query<{
      status: string;
      market_code: string;
      platform_code: string;
      currency: string;
      hypothesis_id: string | null;
      sale_price_cents: string | number;
      is_latest: boolean;
    }>(
      `SELECT cs.status, cs.market_code, cs.platform_code, cs.currency, cs.hypothesis_id,
              cs.assumptions->>'salePriceCents' AS sale_price_cents,
              NOT EXISTS (
                SELECT 1 FROM cost_sheets newer
                WHERE newer.group_id = cs.group_id AND newer.version > cs.version
              ) AS is_latest
       FROM cost_sheets cs WHERE cs.id = $1`,
      [requestedCostSheetId],
    );
    const sheet = costSheet.rows[0];
    if (!sheet) throw new Error("成本核算单不存在");
    if (sheet.status !== "confirmed") throw new Error("只有已确认的成本核算单才能建立候选");
    if (!sheet.is_latest) throw new Error("该核算单已有新版本，请使用最新版本");
    if (sheet.hypothesis_id) throw new Error("该核算单已绑定其他候选");
    if (
      sheet.market_code.toUpperCase() !== input.marketCode.toUpperCase() ||
      sheet.platform_code.toLowerCase() !== input.platformCode.toLowerCase() ||
      sheet.currency.toUpperCase() !== row.currency.toUpperCase()
    ) {
      throw new Error("核算单站点、平台或币种与候选不一致");
    }
    priceCents = Math.round(Number(sheet.sale_price_cents));
  }
  if (!priceCents) throw new Error("缺少成本核算单售价或推荐售价，不能建立候选");
  const attrs = Array.isArray(input.complianceAttrs) ? input.complianceAttrs : [];
  const validReason =
    input.eliminationReason && isValidEliminationReason(input.eliminationReason)
      ? input.eliminationReason
      : null;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO sourcing_briefs
        (id, market_code, platform_code, category, brief, currency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [briefId, input.marketCode, input.platformCode, category, `快速立项候选：${concept}`, row.currency, actor],
    );
    await tx.query(
      `INSERT INTO ai_sourcing_runs
        (id, brief_id, provider, model, status, response_summary, completed_at)
       VALUES ($1, $2, 'manual', $3, 'completed', '{}'::jsonb, NOW())`,
      [runId, briefId, input.sourceKind],
    );
    await tx.query(
      `INSERT INTO opportunity_hypotheses
        (id, run_id, position, concept, target_user, pain_point, differentiator,
         recommended_price_cents, confirmed_price_cents, confirmed_price_at,
         expected_margin_rate, first_order_budget_cents,
         main_risks, supplier_keywords, competitor_queries, review_queries,
         priority_score, selected_for_validation, source_kind,
         comparison_report_id, cost_sheet_id, reference_factory_cost_rmb, compliance_attrs,
         eliminated_at, elimination_reason, elimination_note)
       VALUES ($1, $2, 1, $3, $4, '待通过真实竞品与差评验证', '待通过竞品差异化确认',
         $5, NULL, NULL,
         0.20, 150000, '[]'::jsonb, $6::jsonb, $7::jsonb, $7::jsonb,
         70, TRUE, $8, $9, $10, NULL, $11::jsonb,
         CASE WHEN $12::text IS NOT NULL THEN NOW() ELSE NULL END, $12, $13)`,
      [
        hypothesisId,
        runId,
        concept,
        `${row.market_name}站 · ${row.platform_name}`,
        priceCents,
        JSON.stringify([concept]),
        JSON.stringify([keyword]),
        input.sourceKind,
        input.comparisonReportId ?? null,
        requestedCostSheetId,
        JSON.stringify(attrs),
        validReason,
        input.eliminationNote?.trim().slice(0, 400) || null,
      ],
    );
  });

  // 自动创建 8 项任务（按新口径：供应商 3 家）
  await selectHypothesisForValidation(hypothesisId, actor);
  return { runId, hypothesisId };
}

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

export async function listKanbanCandidates(marketCode?: string, platformCode?: string): Promise<KanbanCandidateItem[]> {
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
         WHERE newer.group_id = cs.group_id AND newer.version > cs.version
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
     LEFT JOIN cost_sheets cs ON cs.id = h.cost_sheet_id
     LEFT JOIN competitor_comparison_reports cr ON cr.id = h.comparison_report_id
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

export async function listEliminatedHypotheses(marketCode?: string): Promise<EliminatedHistoryRecord[]> {
  const db = await getDb();
  const values: string[] = [];
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
     WHERE h.eliminated_at IS NOT NULL ${marketClause}
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

