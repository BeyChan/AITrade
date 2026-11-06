import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import { generateHypotheses, attachResearchPriority, type AIProviderStatus } from "./ai-provider.ts";
import {
  DEFAULT_SOURCING_THRESHOLDS,
  evaluateSourcingDecision,
  normalizeObservedAt,
  platformEconomicDefaults,
  validateEvidenceUrl,
  type AISourcingContext,
  type DecisionEvaluation,
  type QuoteForDecision,
} from "./ai-sourcing.ts";
import { calculateEconomics } from "./economics.ts";
import {
  parseSupplierCandidatePayload,
  type ParsedSupplierCandidate,
  type SupplierCandidateParseResult,
  type SupplierScorePart,
} from "./supplier-candidates.ts";

export type AISourcingHypothesis = {
  id: string;
  runId: string;
  position: number;
  concept: string;
  targetUser: string;
  painPoint: string;
  differentiator: string;
  recommendedPriceCents: number;
  confirmedPriceCents: number | null;
  confirmedPriceSourceUrl: string | null;
  confirmedPriceAt: string | null;
  expectedMarginRate: number;
  firstOrderBudgetCents: number;
  mainRisks: string[];
  supplierKeywords: string[];
  competitorQueries: string[];
  reviewQueries: string[];
  priorityScore: number;
  selectedForValidation: boolean;
  productCaseId: string | null;
  createdAt: string;
};

export type AIOpportunityEvidence = {
  id: string;
  hypothesisId: string;
  evidenceType: string;
  sourceType: string;
  sourceUrl: string;
  title: string;
  summary: string;
  observedAt: string;
  rawSnapshot: Record<string, unknown>;
  confidence: number;
  createdBy: string;
  createdAt: string;
};

export type AICompetitorSnapshot = {
  id: string;
  hypothesisId: string;
  asin: string | null;
  title: string;
  sourceUrl: string;
  priceCents: number;
  rating: number | null;
  reviewCount: number;
  bsr: number | null;
  monthlySalesMin: number | null;
  monthlySalesMax: number | null;
  sellerCount: number | null;
  variationCount: number | null;
  observedAt: string;
};

export type AISupplierShortlist = {
  id: string;
  hypothesisId: string;
  supplierName: string;
  platform: string;
  supplierUrl: string;
  contact: string | null;
  country: string | null;
  productMatch: string;
  sourceType: string;
  observedAt: string;
  createdBy: string;
  createdAt: string;
};

export type AISupplierQuote = {
  id: string;
  hypothesisId: string;
  supplierShortlistId: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  landedCostCents: number;
  currency: string;
  moq: number;
  leadTimeDays: number;
  sampleScore: number | null;
  sampleFeeCents: number;
  certifications: string;
  paymentTerms: string;
  incoterm: string;
  quoteUrl: string;
  observedAt: string;
  createdBy: string;
  createdAt: string;
};

export type AISupplierDiscoveryRun = {
  id: string;
  hypothesisId: string;
  source: string;
  triggerMode: "user_triggered";
  query: string;
  pageUrl: string | null;
  capturedAt: string;
  receivedCount: number;
  parsedCount: number;
  duplicateCount: number;
  topCount: number;
  warnings: string[];
  actor: string;
  createdAt: string;
};

export type AISupplierCandidate = {
  id: string;
  discoveryRunId: string;
  hypothesisId: string;
  title: string;
  supplierName: string;
  platform: string;
  offerUrl: string;
  supplierUrl: string;
  offerId: string | null;
  priceCents: number | null;
  currency: string;
  moq: number | null;
  location: string;
  badges: string[];
  leadTimeDays: number | null;
  sourceText: string;
  fingerprint: string;
  score: number;
  scoreParts: SupplierScorePart[];
  reasons: string[];
  riskNotes: string[];
  status: "candidate" | "shortlisted" | "rejected";
  shortlistId: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AIValidationTask = {
  id: string;
  hypothesisId: string;
  taskType: string;
  title: string;
  description: string;
  targetCount: number;
  status: "todo" | "in_progress" | "done" | "blocked";
  owner: string;
  dueAt: string | null;
};

export type AISelectionDecision = DecisionEvaluation & {
  id: string;
  hypothesisId: string;
  evaluatedAt: string;
};

export type AISourcingHypothesisDetail = AISourcingHypothesis & {
  evidence: AIOpportunityEvidence[];
  competitors: AICompetitorSnapshot[];
  shortlist: AISupplierShortlist[];
  quotes: AISupplierQuote[];
  supplierDiscoveryRuns: AISupplierDiscoveryRun[];
  supplierCandidates: AISupplierCandidate[];
  tasks: AIValidationTask[];
  decision: AISelectionDecision | null;
  counts: {
    competitors: number;
    reviewSamples: number;
    suppliers: number;
    supplierCandidates: number;
    quotes: number;
    completedTasks: number;
    totalTasks: number;
  };
};

export type AISourcingBatchSummary = {
  id: string;
  briefId: string;
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  category: string;
  brief: string;
  currency: string;
  fxRateToUsd: number | null;
  fxSourceUrl: string | null;
  provider: string;
  model: string;
  status: string;
  createdAt: string;
  hypothesisCount: number;
  selectedCount: number;
  goCount: number;
  promotedCount: number;
  templateFallback: boolean;
  providerError: string | null;
};

export type AISourcingBatchDetail = AISourcingBatchSummary & {
  createdBy: string;
  hypotheses: AISourcingHypothesisDetail[];
};

type BatchJoinRow = {
  id: string;
  brief_id: string;
  market_code: string;
  market_name: string;
  platform_code: string;
  platform_name: string;
  category: string;
  brief: string;
  currency: string;
  fx_rate_to_usd: string | number | null;
  fx_source_url: string | null;
  created_by: string;
  provider: string;
  model: string;
  status: string;
  created_at: string;
  hypothesis_count: string | number;
  selected_count: string | number;
  go_count: string | number;
  promoted_count: string | number;
  fallback: string | null;
  provider_error: string | null;
};

type HypothesisRow = {
  id: string;
  run_id: string;
  position: number;
  concept: string;
  target_user: string;
  pain_point: string;
  differentiator: string;
  recommended_price_cents: number;
  confirmed_price_cents: number | null;
  confirmed_price_source_url: string | null;
  confirmed_price_at: string | null;
  expected_margin_rate: string | number;
  first_order_budget_cents: number;
  main_risks: string[];
  supplier_keywords: string[];
  competitor_queries: string[];
  review_queries: string[];
  priority_score: number;
  selected_for_validation: boolean;
  product_case_id: string | null;
  created_at: string;
};

type EvidenceRow = {
  id: string;
  hypothesis_id: string;
  evidence_type: string;
  source_type: string;
  source_url: string;
  title: string;
  summary: string;
  observed_at: string;
  raw_snapshot: Record<string, unknown>;
  confidence: string | number;
  created_by: string;
  created_at: string;
};

type CompetitorRow = {
  id: string;
  hypothesis_id: string;
  asin: string | null;
  title: string;
  source_url: string;
  price_cents: number;
  rating: string | number | null;
  review_count: number;
  bsr: number | null;
  monthly_sales_min: number | null;
  monthly_sales_max: number | null;
  seller_count: number | null;
  variation_count: number | null;
  observed_at: string;
};

type ShortlistRow = {
  id: string;
  hypothesis_id: string;
  supplier_name: string;
  platform: string;
  supplier_url: string;
  contact: string | null;
  country: string | null;
  product_match: string;
  source_type: string;
  observed_at: string;
  created_by: string;
  created_at: string;
};

type QuoteRow = {
  id: string;
  hypothesis_id: string;
  supplier_shortlist_id: string;
  unit_price_cents: number;
  freight_per_unit_cents: number;
  duty_rate: string | number;
  landed_cost_cents: number;
  currency: string;
  moq: number;
  lead_time_days: number;
  sample_score: number | null;
  sample_fee_cents: number;
  certifications: string;
  payment_terms: string;
  incoterm: string;
  quote_url: string;
  observed_at: string;
  created_by: string;
  created_at: string;
};

type SupplierDiscoveryRunRow = {
  id: string;
  hypothesis_id: string;
  source: string;
  trigger_mode: string;
  query: string;
  page_url: string | null;
  captured_at: string;
  received_count: number;
  parsed_count: number;
  duplicate_count: number;
  top_count: number;
  warnings: string[];
  actor: string;
  created_at: string;
};

type SupplierCandidateRow = {
  id: string;
  discovery_run_id: string;
  hypothesis_id: string;
  title: string;
  supplier_name: string;
  platform: string;
  offer_url: string;
  supplier_url: string;
  offer_id: string | null;
  price_cents: number | null;
  currency: string;
  moq: number | null;
  location: string;
  badges: string[];
  lead_time_days: number | null;
  source_text: string;
  fingerprint: string;
  score: number;
  score_parts: SupplierScorePart[];
  reasons: string[];
  risk_notes: string[];
  status: AISupplierCandidate["status"];
  shortlist_id: string | null;
  verified_by: string | null;
  verified_at: string | null;
  observed_at: string;
  created_at: string;
  updated_at: string;
};

type PromotableQuoteRow = QuoteRow & {
  supplier_name: string;
  supplier_platform: string;
  supplier_url: string;
  supplier_contact: string | null;
  supplier_country: string | null;
  product_match: string;
};

type TaskRow = {
  id: string;
  hypothesis_id: string;
  task_type: string;
  title: string;
  description: string;
  target_count: number;
  status: AIValidationTask["status"];
  owner: string;
  due_at: string | null;
};

type DecisionRow = {
  id: string;
  hypothesis_id: string;
  decision: DecisionEvaluation["decision"];
  decision_score: number;
  opportunity_score: number;
  evidence_completeness: number;
  landed_cost_cents: number | null;
  landed_cost_usd_cents: number | null;
  margin_rate: string | number | null;
  stress_margin_rate: string | number | null;
  best_quote_id: string | null;
  gates: DecisionEvaluation["gates"];
  blockers: string[];
  metrics: Record<string, unknown>;
  evaluated_at: string;
};

type AppDatabase = Awaited<ReturnType<typeof getDb>>;

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
      `SELECT c.* FROM competitor_snapshots c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       WHERE h.run_id = $1 ORDER BY c.observed_at DESC`,
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
  const shortlistByHypothesis = groupBy(shortlistRows.rows, (row) => row.hypothesis_id);
  const quotesByHypothesis = groupBy(quoteRows.rows, (row) => row.hypothesis_id);
  const supplierDiscoveryRunsByHypothesis = groupBy(supplierDiscoveryRunRows.rows, (row) => row.hypothesis_id);
  const supplierCandidatesByHypothesis = groupBy(supplierCandidateRows.rows, (row) => row.hypothesis_id);
  const tasksByHypothesis = groupBy(taskRows.rows, (row) => row.hypothesis_id);
  const decisionByHypothesis = new Map(decisionRows.rows.map((row) => [row.hypothesis_id, mapDecision(row)]));

  const hypotheses = hypothesisRows.rows.map((row) => {
    const evidence = (evidenceByHypothesis.get(row.id) ?? []).map(mapEvidence);
    const competitors = (competitorByHypothesis.get(row.id) ?? []).map(mapCompetitor);
    const shortlist = (shortlistByHypothesis.get(row.id) ?? []).map(mapShortlist);
    const quotes = (quotesByHypothesis.get(row.id) ?? []).map(mapQuote);
    const supplierDiscoveryRuns = (supplierDiscoveryRunsByHypothesis.get(row.id) ?? []).map(mapSupplierDiscoveryRun);
    const supplierCandidates = (supplierCandidatesByHypothesis.get(row.id) ?? []).map(mapSupplierCandidate);
    const tasks = (tasksByHypothesis.get(row.id) ?? []).map(mapTask);
    return {
      ...mapHypothesis(row),
      evidence,
      competitors,
      shortlist,
      quotes,
      supplierDiscoveryRuns,
      supplierCandidates,
      tasks,
      decision: decisionByHypothesis.get(row.id) ?? null,
      counts: {
        competitors: competitors.length,
        reviewSamples: evidence.reduce((sum, item) => {
          if (item.evidenceType !== "review_insight") return sum;
          const value = Number(item.rawSnapshot.reviewSampleSize ?? item.rawSnapshot.sampleSize ?? 0);
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0),
        suppliers: shortlist.length,
        supplierCandidates: supplierCandidates.length,
        quotes: quotes.length,
        completedTasks: tasks.filter((task) => task.status === "done").length,
        totalTasks: tasks.length,
      },
    };
  });

  return { ...mapBatch(batch), createdBy: batch.created_by, hypotheses };
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

export async function confirmHypothesisPrice(input: {
  hypothesisId: string;
  priceCents: number;
  sourceUrl: string;
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) throw new Error("已确认售价必须大于 0");
  const sourceUrl = validateEvidenceUrl(input.sourceUrl.trim());
  const actor = input.actor.trim() || "运营人员";
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE opportunity_hypotheses
       SET confirmed_price_cents = $2, confirmed_price_source_url = $3, confirmed_price_at = NOW()
       WHERE id = $1`,
      [input.hypothesisId, input.priceCents, sourceUrl],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.price_confirmed', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [randomUUID(), actor, input.hypothesisId, JSON.stringify({ priceCents: input.priceCents, sourceUrl, externalActions: "none" })],
    );
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function recordOpportunityEvidence(input: {
  hypothesisId: string;
  evidenceType: "review_insight" | "patent_check" | "logistics_check" | "supplier_discovery" | "other";
  sourceType: string;
  sourceUrl: string;
  title: string;
  summary: string;
  observedAt: string;
  reviewSampleSize?: number;
  representativeQuote?: string;
  sentiment?: "negative" | "neutral" | "positive";
  riskLevel?: "clear" | "review" | "found";
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  const evidenceId = randomUUID();
  const observedAt = normalizeObservedAt(input.observedAt);
  const sourceUrl = validateEvidenceUrl(input.sourceUrl.trim());
  const sampleSize = Math.max(1, Math.round(input.reviewSampleSize || 1));
  const riskLevel = input.riskLevel ?? (input.evidenceType === "patent_check" || input.evidenceType === "logistics_check" ? "review" : undefined);

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
      [
        evidenceId,
        input.hypothesisId,
        input.evidenceType,
        input.sourceType.trim().slice(0, 60) || "manual",
        sourceUrl,
        input.title.trim().slice(0, 240),
        input.summary.trim().slice(0, 1500),
        observedAt,
        JSON.stringify({
          reviewSampleSize: input.evidenceType === "review_insight" ? sampleSize : undefined,
          representativeQuote: input.representativeQuote?.trim().slice(0, 500) || undefined,
          riskLevel,
        }),
        input.actor.trim() || "运营人员",
      ],
    );
    if (input.evidenceType === "review_insight") {
      await tx.query(
        `INSERT INTO review_insights
          (id, hypothesis_id, evidence_id, theme, sentiment, sample_size, representative_quote)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.hypothesisId,
          evidenceId,
          input.title.trim().slice(0, 180),
          input.sentiment ?? "negative",
          sampleSize,
          input.representativeQuote?.trim().slice(0, 500) || "",
        ],
      );
    }
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function recordCompetitorEvidence(input: {
  hypothesisId: string;
  asin?: string;
  title: string;
  sourceUrl: string;
  priceCents: number;
  rating?: number | null;
  reviewCount: number;
  bsr?: number | null;
  monthlySalesMin?: number | null;
  monthlySalesMax?: number | null;
  sellerCount?: number | null;
  variationCount?: number | null;
  observedAt: string;
  actor: string;
}) {
  const db = await getDb();
  await assertSelected(input.hypothesisId);
  const evidenceId = randomUUID();
  const sourceUrl = validateEvidenceUrl(input.sourceUrl.trim());
  const observedAt = normalizeObservedAt(input.observedAt);
  if (!input.title.trim()) throw new Error("请填写竞品标题");
  if (input.priceCents <= 0) throw new Error("竞品价格必须大于 0");

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, 'competitor_snapshot', 'marketplace', $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        evidenceId,
        input.hypothesisId,
        sourceUrl,
        input.title.trim().slice(0, 240),
        `竞品快照：${input.title.trim()}`.slice(0, 1500),
        observedAt,
        JSON.stringify({
          asin: input.asin?.trim() || null,
          priceCents: input.priceCents,
          rating: input.rating ?? null,
          reviewCount: input.reviewCount,
          bsr: input.bsr ?? null,
        }),
        input.actor.trim() || "运营人员",
      ],
    );
    await tx.query(
      `INSERT INTO competitor_snapshots
        (id, hypothesis_id, evidence_id, asin, title, source_url, price_cents, rating, review_count,
         bsr, monthly_sales_min, monthly_sales_max, seller_count, variation_count, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        randomUUID(),
        input.hypothesisId,
        evidenceId,
        input.asin?.trim() || null,
        input.title.trim().slice(0, 240),
        sourceUrl,
        input.priceCents,
        input.rating ?? null,
        input.reviewCount,
        input.bsr ?? null,
        input.monthlySalesMin ?? null,
        input.monthlySalesMax ?? null,
        input.sellerCount ?? null,
        input.variationCount ?? null,
        observedAt,
      ],
    );
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function recordSupplierCandidates(input: {
  hypothesisId: string;
  query: string;
  payload: string;
  actor: string;
  observedAt?: string;
}) {
  const context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证，再采集供应商候选");

  const query = input.query.trim().slice(0, 500)
    || context.hypothesis.supplierKeywords[0]
    || context.hypothesis.concept;
  const parsed = parseSupplierCandidatePayload(input.payload, {
    query,
    observedAt: input.observedAt,
    platform: "1688",
  });
  const capturedAt = normalizeObservedAt(parsed.capturedAt);
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const db = await getDb();

  return db.transaction(async (tx) => {
    const selected = await tx.query<{ selected_for_validation: boolean }>(
      "SELECT selected_for_validation FROM opportunity_hypotheses WHERE id = $1 FOR UPDATE",
      [input.hypothesisId],
    );
    if (!selected.rows[0]) throw new Error("机会假设不存在");
    if (!selected.rows[0].selected_for_validation) throw new Error("请先把机会加入验证，再采集供应商候选");

    const runId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_discovery_runs
        (id, hypothesis_id, source, trigger_mode, query, page_url, payload_text, captured_at,
         received_count, parsed_count, duplicate_count, top_count, warnings, actor)
       VALUES ($1, $2, $3, 'user_triggered', $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
      [
        runId,
        input.hypothesisId,
        parsed.source.trim().slice(0, 80) || "visible_page_capture",
        query,
        parsed.pageUrl,
        input.payload.slice(0, 200_000),
        capturedAt,
        parsed.receivedCount,
        parsed.candidates.length,
        parsed.duplicateCount,
        parsed.candidates.length,
        JSON.stringify(parsed.warnings),
        actor,
      ],
    );

    let newCount = 0;
    for (const candidate of parsed.candidates) {
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO supplier_candidates
          (id, discovery_run_id, hypothesis_id, title, supplier_name, platform, offer_url, supplier_url,
           offer_id, price_cents, currency, moq, location, badges, lead_time_days, source_text,
           fingerprint, score, score_parts, reasons, risk_notes, observed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16,
                 $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22)
         ON CONFLICT (hypothesis_id, fingerprint) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          runId,
          input.hypothesisId,
          candidate.title,
          candidate.supplierName,
          candidate.platform,
          candidate.offerUrl,
          candidate.supplierUrl,
          candidate.offerId,
          candidate.priceCents,
          candidate.currency,
          candidate.moq,
          candidate.location,
          JSON.stringify(candidate.badges),
          candidate.leadTimeDays,
          candidate.sourceText,
          candidate.fingerprint,
          candidate.score,
          JSON.stringify(candidate.scoreParts),
          JSON.stringify(candidate.reasons),
          JSON.stringify(candidate.riskNotes),
          normalizeObservedAt(candidate.observedAt),
        ],
      );
      if (inserted.rows.length > 0) newCount += 1;
    }

    const skippedExistingCount = parsed.candidates.length - newCount;
    const duplicateCount = parsed.duplicateCount + skippedExistingCount;
    const warnings = skippedExistingCount > 0
      ? [...parsed.warnings, `另有 ${skippedExistingCount} 个候选已在候选池中，本次未重复写入。`]
      : parsed.warnings;
    await tx.query(
      `UPDATE supplier_discovery_runs
       SET duplicate_count = $1, warnings = $2::jsonb
       WHERE id = $3`,
      [duplicateCount, JSON.stringify(warnings), runId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidates_recorded', 'opportunity_hypothesis', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.hypothesisId,
        JSON.stringify({
          discoveryRunId: runId,
          query,
          receivedCount: parsed.receivedCount,
          parsedCount: parsed.candidates.length,
          newCount,
          duplicateCount,
          triggerMode: "user_triggered",
          externalActions: "none",
        }),
      ],
    );

    return {
      runId,
      receivedCount: parsed.receivedCount,
      parsedCount: parsed.candidates.length,
      newCount,
      duplicateCount,
      skippedExistingCount,
      topCount: parsed.candidates.length,
      warnings,
      capturedAt,
    };
  });
}

export async function shortlistSupplierCandidate(input: {
  candidateId: string;
  supplierName: string;
  productMatch: string;
  actor: string;
  verified: boolean;
}) {
  if (!input.verified) throw new Error("请先确认已经人工核验供应商和产品，再加入短名单");
  const candidateId = input.candidateId.trim();
  if (!candidateId) throw new Error("缺少候选 ID");
  const supplierName = input.supplierName.trim().slice(0, 180);
  if (!supplierName) throw new Error("请填写核验后的供应商名称");
  const productMatch = input.productMatch.trim().slice(0, 500);
  if (!productMatch) throw new Error("请填写人工核验后的产品匹配说明");
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const db = await getDb();

  const outcome = await db.transaction(async (tx) => {
    const candidateResult = await tx.query<SupplierCandidateRow & { selected_for_validation: boolean }>(
      `SELECT c.*, h.selected_for_validation
       FROM supplier_candidates c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [candidateId],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new Error("供应商候选不存在");
    if (!candidate.selected_for_validation) throw new Error("请先把机会加入验证，再加入供应商短名单");
    if (candidate.status === "shortlisted") throw new Error("该候选已加入短名单，不能重复加入");
    if (candidate.status === "rejected") throw new Error("该候选已被拒绝，不能加入短名单");

    const supplierUrl = validateEvidenceUrl((candidate.supplier_url || candidate.offer_url).trim());
    const observedAt = normalizeObservedAt(candidate.observed_at);
    const shortlistId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_shortlists
        (id, hypothesis_id, supplier_name, platform, supplier_url, contact, country, product_match,
         source_type, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'visible_page_manual_verification', $9, $10)`,
      [
        shortlistId,
        candidate.hypothesis_id,
        supplierName,
        candidate.platform.slice(0, 60) || "1688",
        supplierUrl,
        null,
        candidate.location.trim().slice(0, 60) || null,
        productMatch,
        observedAt,
        actor,
      ],
    );
    const updated = await tx.query<{ id: string }>(
      `UPDATE supplier_candidates
       SET status = 'shortlisted', shortlist_id = $1, verified_by = $2, verified_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'candidate'
       RETURNING id`,
      [shortlistId, actor, candidateId],
    );
    if (updated.rows.length === 0) throw new Error("候选状态已变化，请刷新后重试");

    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidate_shortlisted', 'supplier_candidate', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        candidateId,
        JSON.stringify({
          hypothesisId: candidate.hypothesis_id,
          shortlistId,
          supplierName,
          sourceUrl: supplierUrl,
          sourceType: "visible_page_manual_verification",
          manuallyVerified: true,
          externalActions: "none",
        }),
      ],
    );

    return { candidateId, shortlistId, supplierName, hypothesisId: candidate.hypothesis_id };
  });
  await refreshAISelectionDecision(outcome.hypothesisId);
  return outcome;
}

export async function rejectSupplierCandidate(input: {
  candidateId: string;
  actor: string;
  reason: string;
}) {
  const candidateId = input.candidateId.trim();
  if (!candidateId) throw new Error("缺少候选 ID");
  const actor = input.actor.trim().slice(0, 80) || "采购人员";
  const reason = input.reason.trim().slice(0, 300) || "人工排除";
  const db = await getDb();

  return db.transaction(async (tx) => {
    const candidateResult = await tx.query<SupplierCandidateRow>(
      `SELECT * FROM supplier_candidates WHERE id = $1 FOR UPDATE`,
      [candidateId],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) throw new Error("供应商候选不存在");
    if (candidate.status === "rejected") throw new Error("该候选已经排除");
    if (candidate.status === "shortlisted") throw new Error("已加入短名单的候选不能直接排除");

    await tx.query(
      `UPDATE supplier_candidates
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'candidate'`,
      [candidateId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.supplier_candidate_rejected', 'supplier_candidate', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        candidateId,
        JSON.stringify({
          hypothesisId: candidate.hypothesis_id,
          reason,
          externalActions: "none",
        }),
      ],
    );

    return {
      candidateId,
      hypothesisId: candidate.hypothesis_id,
      reason,
    };
  });
}

export async function recordAISupplierQuote(input: {
  hypothesisId: string;
  supplierName: string;
  supplierPlatform: string;
  supplierUrl: string;
  contact?: string;
  country?: string;
  productMatch: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  moq: number;
  leadTimeDays: number;
  sampleScore?: number | null;
  sampleFeeCents: number;
  certifications: string;
  paymentTerms: string;
  incoterm: string;
  quoteUrl: string;
  observedAt: string;
  actor: string;
}) {
  const db = await getDb();
  const context = await loadHypothesisContext(input.hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证");
  const supplierUrl = validateEvidenceUrl(input.supplierUrl.trim());
  const quoteUrl = validateEvidenceUrl(input.quoteUrl.trim());
  const observedAt = normalizeObservedAt(input.observedAt);
  const unitPriceCents = Math.round(input.unitPriceCents);
  const freightPerUnitCents = Math.round(input.freightPerUnitCents);
  const dutyRate = clamp(input.dutyRate, 0, 1);
  const landedCostCents = unitPriceCents + freightPerUnitCents + Math.round((unitPriceCents + freightPerUnitCents) * dutyRate);
  if (unitPriceCents <= 0) throw new Error("采购单价必须大于 0");
  if (input.moq <= 0 || input.leadTimeDays <= 0) throw new Error("MOQ 和交期必须大于 0");
  if (!input.supplierName.trim()) throw new Error("请填写供应商名称");

  await db.transaction(async (tx) => {
    const shortlistId = randomUUID();
    const quoteId = randomUUID();
    await tx.query(
      `INSERT INTO supplier_shortlists
        (id, hypothesis_id, supplier_name, platform, supplier_url, contact, country, product_match, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        shortlistId,
        input.hypothesisId,
        input.supplierName.trim().slice(0, 180),
        input.supplierPlatform.trim().slice(0, 60) || "1688",
        supplierUrl,
        input.contact?.trim().slice(0, 180) || null,
        input.country?.trim().slice(0, 60) || null,
        input.productMatch.trim().slice(0, 500),
        observedAt,
        input.actor.trim() || "采购人员",
      ],
    );
    await tx.query(
      `INSERT INTO sourcing_supplier_quotes
        (id, hypothesis_id, supplier_shortlist_id, unit_price_cents, freight_per_unit_cents,
         duty_rate, landed_cost_cents, currency, moq, lead_time_days, sample_score, sample_fee_cents,
         certifications, payment_terms, incoterm, quote_url, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        quoteId,
        input.hypothesisId,
        shortlistId,
        unitPriceCents,
        freightPerUnitCents,
        dutyRate,
        landedCostCents,
        context.batch.currency,
        Math.round(input.moq),
        Math.round(input.leadTimeDays),
        input.sampleScore == null ? null : clamp(Math.round(input.sampleScore), 0, 100),
        Math.max(0, Math.round(input.sampleFeeCents)),
        input.certifications.trim().slice(0, 500),
        input.paymentTerms.trim().slice(0, 200),
        input.incoterm.trim().slice(0, 80),
        quoteUrl,
        observedAt,
        input.actor.trim() || "采购人员",
      ],
    );
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, raw_snapshot, created_by)
       VALUES ($1, $2, 'supplier_quote', 'supplier', $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        randomUUID(),
        input.hypothesisId,
        quoteUrl,
        `${input.supplierName.trim()} 真实报价`,
        `含税到岸 ${(landedCostCents / 100).toFixed(2)} ${context.batch.currency}；MOQ ${input.moq}；交期 ${input.leadTimeDays} 天`,
        observedAt,
        JSON.stringify({ quoteId, supplierShortlistId: shortlistId, landedCostCents, dutyRate }),
        input.actor.trim() || "采购人员",
      ],
    );
  });
  return refreshAISelectionDecision(input.hypothesisId);
}

export async function refreshAISelectionDecision(hypothesisId: string): Promise<AISelectionDecision> {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  const [counts, reviews, quotes, patent, logistics] = await Promise.all([
    db.query<{ competitors: string | number; suppliers: string | number; quotes: string | number }>(
      `SELECT
        (SELECT COUNT(*) FROM competitor_snapshots WHERE hypothesis_id = $1) AS competitors,
        (SELECT COUNT(*) FROM supplier_shortlists WHERE hypothesis_id = $1) AS suppliers,
        (SELECT COUNT(*) FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) AS quotes`,
      [hypothesisId],
    ),
    db.query<{ sample_count: string | number }>(
      `SELECT COALESCE(SUM(sample_size), 0) AS sample_count
       FROM review_insights WHERE hypothesis_id = $1`,
      [hypothesisId],
    ),
    db.query<QuoteRow>(
      "SELECT * FROM sourcing_supplier_quotes WHERE hypothesis_id = $1 ORDER BY landed_cost_cents ASC",
      [hypothesisId],
    ),
    db.query<{ risk_level: string | null }>(
      `SELECT raw_snapshot->>'riskLevel' AS risk_level
       FROM opportunity_evidence
       WHERE hypothesis_id = $1 AND evidence_type = 'patent_check'
       ORDER BY observed_at DESC LIMIT 1`,
      [hypothesisId],
    ),
    db.query<{ risk_level: string | null }>(
      `SELECT raw_snapshot->>'riskLevel' AS risk_level
       FROM opportunity_evidence
       WHERE hypothesis_id = $1 AND evidence_type = 'logistics_check'
       ORDER BY observed_at DESC LIMIT 1`,
      [hypothesisId],
    ),
  ]);

  const count = counts.rows[0];
  const decision = evaluateSourcingDecision({
    opportunityScore: context.hypothesis.priorityScore,
    confirmedPriceCents: context.hypothesis.confirmedPriceCents,
    context: context.batch,
    competitorCount: Number(count?.competitors ?? 0),
    reviewSampleCount: Number(reviews.rows[0]?.sample_count ?? 0),
    supplierCount: Number(count?.suppliers ?? 0),
    quotes: quotes.rows.map(mapDecisionQuote),
    latestPatentRisk: riskLevel(patent.rows[0]?.risk_level, "missing"),
    latestLogisticsRisk: riskLevel(logistics.rows[0]?.risk_level, "missing"),
  });

  const decisionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO selection_decisions
        (id, hypothesis_id, decision, decision_score, opportunity_score, evidence_completeness,
         landed_cost_cents, landed_cost_usd_cents, margin_rate, stress_margin_rate, best_quote_id,
         gates, blockers, metrics, evaluated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb, NOW())
       ON CONFLICT (hypothesis_id) DO UPDATE SET
         decision = EXCLUDED.decision,
         decision_score = EXCLUDED.decision_score,
         opportunity_score = EXCLUDED.opportunity_score,
         evidence_completeness = EXCLUDED.evidence_completeness,
         landed_cost_cents = EXCLUDED.landed_cost_cents,
         landed_cost_usd_cents = EXCLUDED.landed_cost_usd_cents,
         margin_rate = EXCLUDED.margin_rate,
         stress_margin_rate = EXCLUDED.stress_margin_rate,
         best_quote_id = EXCLUDED.best_quote_id,
         gates = EXCLUDED.gates,
         blockers = EXCLUDED.blockers,
         metrics = EXCLUDED.metrics,
         evaluated_at = NOW()`,
      [
        decisionId,
        hypothesisId,
        decision.decision,
        decision.decisionScore,
        decision.opportunityScore,
        decision.evidenceCompleteness,
        decision.landedCostCents,
        decision.landedCostUsdCents,
        decision.marginRate,
        decision.stressMarginRate,
        decision.bestQuoteId,
        JSON.stringify(decision.gates),
        JSON.stringify(decision.blockers),
        JSON.stringify(decision.metrics),
      ],
    );
    await tx.query(
      `UPDATE validation_tasks SET status = 'done', updated_at = NOW()
       WHERE hypothesis_id = $1 AND (
         (task_type = 'competitor_scan' AND $2 >= target_count) OR
         (task_type = 'review_research' AND $3 >= target_count) OR
         (task_type = 'supplier_shortlist' AND $4 >= target_count) OR
         (task_type = 'quote_collection' AND $5 >= target_count)
       )`,
      [
        hypothesisId,
        Number(count?.competitors ?? 0),
        Number(reviews.rows[0]?.sample_count ?? 0),
        Number(count?.suppliers ?? 0),
        Number(count?.quotes ?? 0),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, 'system', 'ai_sourcing.decision_evaluated', 'opportunity_hypothesis', $2, $3::jsonb)`,
      [randomUUID(), hypothesisId, JSON.stringify({ decision: decision.decision, evidenceCompleteness: decision.evidenceCompleteness })],
    );
  });

  return {
    ...decision,
    id: decisionId,
    hypothesisId,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function promoteHypothesisToProductCase(hypothesisId: string, actor: string) {
  const db = await getDb();
  const context = await loadHypothesisContext(hypothesisId);
  if (!context) throw new Error("机会假设不存在");
  if (!context.hypothesis.selectedForValidation) throw new Error("请先把机会加入验证");
  if (context.hypothesis.productCaseId) return { caseId: context.hypothesis.productCaseId, created: false };

  const decision = await refreshAISelectionDecision(hypothesisId);
  if (decision.decision !== "GO") throw new Error("确定性门禁尚未给出 GO，不能转入商品立项");

  const quotes = await db.query<PromotableQuoteRow>(
    `SELECT q.*, s.supplier_name, s.platform AS supplier_platform, s.supplier_url,
            s.contact AS supplier_contact, s.country AS supplier_country, s.product_match
     FROM sourcing_supplier_quotes q
     JOIN supplier_shortlists s ON s.id = q.supplier_shortlist_id
     WHERE q.hypothesis_id = $1
     ORDER BY q.landed_cost_cents ASC, q.moq ASC`,
    [hypothesisId],
  );
  const bestQuote = quotes.rows[0];
  if (!bestQuote) throw new Error("缺少真实报价");
  const caseId = randomUUID();
  const asin = `AI-${hypothesisId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const confirmedPrice = context.hypothesis.confirmedPriceCents;
  if (!confirmedPrice) throw new Error("请先录入已确认售价，再转商品立项");
  const assumptions = {
    currency: context.batch.currency,
    salePriceCents: confirmedPrice,
    landedCostCents: bestQuote.landed_cost_cents,
    ...platformEconomicDefaults(context.batch.platformCode, confirmedPrice),
  };
  const economics = calculateEconomics(assumptions);
  const owner = actor.trim() || "运营人员";

  await db.transaction(async (tx) => {
    const guard = await tx.query<{ product_case_id: string | null }>(
      "SELECT product_case_id FROM opportunity_hypotheses WHERE id = $1 FOR UPDATE",
      [hypothesisId],
    );
    if (guard.rows[0]?.product_case_id) return;
    await tx.query(
      `INSERT INTO product_cases
        (id, asin, marketplace, category, title, status, competitor_price_cents, monthly_sales_estimate,
         review_count, rating, notes, owner, evidence_score, is_demo, source_code, source_record_id,
         source_observed_at, currency)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, 0, 0, NULL, $7, $8, $9, FALSE,
               'ai_sourcing', $10, NOW(), $11)`,
      [
        caseId,
        asin,
        context.batch.marketCode,
        context.batch.category,
        context.hypothesis.concept,
        confirmedPrice,
        `由 AI 选品验证批次转入；真实竞品 ${context.counts.competitors} 个，差评样本 ${context.counts.reviewSamples} 条，供应商 ${context.counts.suppliers} 家，报价 ${context.counts.quotes} 份。决策证据完整度 ${decision.evidenceCompleteness}%。`,
        owner,
        decision.evidenceCompleteness,
        hypothesisId,
        context.batch.currency,
      ],
    );
    await tx.query(
      `INSERT INTO cost_models (id, case_id, version, assumptions, results, created_by)
       VALUES ($1, $2, 1, $3::jsonb, $4::jsonb, $5)`,
      [randomUUID(), caseId, JSON.stringify(assumptions), JSON.stringify(economics), owner],
    );
    await tx.query(
      `INSERT INTO product_case_sites (case_id, market_code, platform_code, discovery_source)
       VALUES ($1, $2, $3, 'ai_sourcing')
       ON CONFLICT (case_id, market_code, platform_code) DO NOTHING`,
      [caseId, context.batch.marketCode, context.batch.platformCode],
    );
    for (const quote of quotes.rows) {
      const supplierId = randomUUID();
      const rfqId = randomUUID();
      const quoteId = randomUUID();
      const requirements = {
        source: "ai_sourcing_quote",
        hypothesisId,
        productMatch: quote.product_match,
        incoterm: quote.incoterm || null,
        paymentTerms: quote.payment_terms || null,
        requestedCertifications: quote.certifications || null,
        quoteObservedAt: quote.observed_at,
        note: "由 AI 选品验证阶段录入的真实报价转入；系统未自动联系供应商、未发送 RFQ、未下单。",
      };
      await tx.query(
        `INSERT INTO suppliers
          (id, name, platform, url, contact, country, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          supplierId,
          quote.supplier_name,
          quote.supplier_platform,
          quote.supplier_url,
          quote.supplier_contact,
          quote.supplier_country,
          `AI 选品转立项；产品匹配：${quote.product_match}`,
        ],
      );
      await tx.query(
        `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements, sent_at)
         VALUES ($1, $2, $3, 'quote_received', $4::jsonb, NULL)`,
        [rfqId, caseId, supplierId, JSON.stringify(requirements)],
      );
      await tx.query(
        `INSERT INTO quotes
          (id, rfq_id, unit_price_cents, freight_per_unit_cents, duty_rate, quality_score,
           moq, lead_time_days, payment_terms, incoterm, certifications, sample_fee_cents,
           raw_payload, currency, observed_at, source_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, 'ai_sourcing')`,
        [
          quoteId,
          rfqId,
          quote.unit_price_cents,
          quote.freight_per_unit_cents,
          quote.duty_rate,
          quote.sample_score ?? 60,
          quote.moq,
          quote.lead_time_days,
          quote.payment_terms || null,
          quote.incoterm || null,
          quote.certifications || null,
          quote.sample_fee_cents,
          JSON.stringify({
            sourceQuoteId: quote.id,
            sourceHypothesisId: hypothesisId,
            sourceShortlistId: quote.supplier_shortlist_id,
            landedCostCents: quote.landed_cost_cents,
            quoteUrl: quote.quote_url,
            observedAt: quote.observed_at,
            enteredBy: quote.created_by,
            importedByPromotion: true,
          }),
          quote.currency,
          quote.observed_at,
        ],
      );
    }
    const evidence = await tx.query<EvidenceRow>(
      "SELECT * FROM opportunity_evidence WHERE hypothesis_id = $1 ORDER BY observed_at DESC",
      [hypothesisId],
    );
    for (const item of evidence.rows) {
      await tx.query(
        `INSERT INTO case_evidence
          (id, case_id, evidence_type, source_type, source_url, title, summary, payload, confidence, captured_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          randomUUID(),
          caseId,
          item.evidence_type,
          item.source_type,
          item.source_url,
          item.title,
          item.summary,
          JSON.stringify(item.raw_snapshot),
          item.confidence,
          item.observed_at,
        ],
      );
    }
    await tx.query(
      "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
      [caseId, hypothesisId],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_sourcing.promoted_to_case', 'product_case', $3, $4::jsonb)`,
      [
        randomUUID(),
        owner,
        caseId,
        JSON.stringify({
          hypothesisId,
          decision: decision.decision,
          evidenceCompleteness: decision.evidenceCompleteness,
          landedCostCents: decision.landedCostCents,
          marginRate: decision.marginRate,
          externalActions: "none",
        }),
      ],
    );
  });

  return { caseId, created: true };
}

export function getBatchSiteLabel(batch: Pick<AISourcingBatchSummary, "marketName" | "platformName">) {
  return `${batch.marketName}站 · ${batch.platformName}`;
}

async function loadHypothesisContext(hypothesisId: string) {
  const db = await getDb();
  const result = await db.query<HypothesisRow & {
    market_code: string;
    market_name: string;
    platform_code: string;
    platform_name: string;
    currency: string;
    fx_rate_to_usd: string | number | null;
    fx_source_url: string | null;
    brief: string;
    category: string;
    provider: string;
    model: string;
    run_created_at: string;
  }>(
    `SELECT h.*, b.market_code, m.name AS market_name, b.platform_code, p.name AS platform_name,
            b.currency, b.fx_rate_to_usd, b.fx_source_url, b.brief, b.category,
            r.provider, r.model, r.created_at AS run_created_at
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     JOIN markets m ON m.code = b.market_code
     JOIN platforms p ON p.code = b.platform_code
     WHERE h.id = $1`,
    [hypothesisId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const hypothesis = mapHypothesis(row);
  const counts = await db.query<{ competitors: string | number; review_samples: string | number; suppliers: string | number; quotes: string | number }>(
    `SELECT
       (SELECT COUNT(*) FROM competitor_snapshots WHERE hypothesis_id = $1) AS competitors,
       (SELECT COALESCE(SUM(sample_size), 0) FROM review_insights WHERE hypothesis_id = $1) AS review_samples,
       (SELECT COUNT(*) FROM supplier_shortlists WHERE hypothesis_id = $1) AS suppliers,
       (SELECT COUNT(*) FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) AS quotes`,
    [hypothesisId],
  );
  const count = counts.rows[0];
  const batch: AISourcingContext & { brief: string; category: string } = {
    marketCode: row.market_code,
    marketName: row.market_name,
    platformCode: row.platform_code,
    platformName: row.platform_name,
    currency: row.currency,
    fxRateToUsd: row.fx_rate_to_usd === null ? null : Number(row.fx_rate_to_usd),
    fxSourceUrl: row.fx_source_url,
    brief: row.brief,
    category: row.category,
  };
  return {
    hypothesis,
    batch,
    counts: {
      competitors: Number(count?.competitors ?? 0),
      reviewSamples: Number(count?.review_samples ?? 0),
      suppliers: Number(count?.suppliers ?? 0),
      quotes: Number(count?.quotes ?? 0),
    },
  };
}

function buildValidationTasks(
  hypothesis: AISourcingHypothesis,
  batch: AISourcingContext & { brief: string; category: string },
) {
  const query = hypothesis.competitorQueries[0] ?? hypothesis.concept;
  const supplierQuery = hypothesis.supplierKeywords[0] ?? hypothesis.concept;
  return [
    {
      taskType: "competitor_scan",
      title: `采集 ${DEFAULT_SOURCING_THRESHOLDS.minCompetitors} 个真实竞品`,
      description: `在 ${batch.platformName} ${batch.marketCode} 站搜索「${query}」，记录链接、价格、评分、评论数和观察时间。只录你实际看到的数据。`,
      targetCount: DEFAULT_SOURCING_THRESHOLDS.minCompetitors,
    },
    {
      taskType: "review_research",
      title: `整理 ${DEFAULT_SOURCING_THRESHOLDS.minReviewSamples} 条差评样本`,
      description: `优先看 1–3 星评论，按“卡毛、难清理、耐用性、尺寸、退货”等主题归类，记录样本数与原文摘录。`,
      targetCount: DEFAULT_SOURCING_THRESHOLDS.minReviewSamples,
    },
    {
      taskType: "supplier_shortlist",
      title: "建立 10 家供应商短名单",
      description: `在 1688 / Alibaba 搜索「${supplierQuery}」，核验工厂链接、主营类目、起订量、认证和最近更新时间。`,
      targetCount: 10,
    },
    {
      taskType: "rfq_draft",
      title: "生成并人工确认询盘",
      description: `询盘应说明目标市场 ${batch.marketCode}、预计首单、MOQ、包装、认证、样品和交期要求。系统不会自动发送。`,
      targetCount: 1,
    },
    {
      taskType: "quote_collection",
      title: `收集 ${DEFAULT_SOURCING_THRESHOLDS.minQuotes} 份真实报价`,
      description: "记录采购价、单件运费、关税、MOQ、交期、样品费、付款条件、贸易条款、报价链接和有效期。",
      targetCount: DEFAULT_SOURCING_THRESHOLDS.minQuotes,
    },
    {
      taskType: "sample_order",
      title: "完成 2 家样品测试",
      description: "按统一测试表检查结构、清洁难度、耐用性、包装、重量与使用说明；样品评分低于 80 不进入 GO。",
      targetCount: 2,
    },
    {
      taskType: "patent_check",
      title: "完成专利与合规初筛",
      description: "由人检索目标国家专利、商标和平台合规要求，并在证据中明确记录 clear / review / found；AI 不提供法律结论。",
      targetCount: 1,
    },
    {
      taskType: "logistics_check",
      title: "确认包装与物流可执行",
      description: "测量真实包装尺寸和重量，确认体积重、关税、平台限制、退货处理与首单现金占用。",
      targetCount: 1,
    },
  ];
}

const batchSelect = `
  SELECT
    r.id,
    b.id AS brief_id,
    b.market_code,
    m.name AS market_name,
    b.platform_code,
    p.name AS platform_name,
    b.category,
    b.brief,
    b.currency,
    b.fx_rate_to_usd,
    b.fx_source_url,
    b.created_by,
    r.provider,
    r.model,
    r.status,
    r.created_at,
    r.response_summary->>'fallback' AS fallback,
    r.response_summary->>'providerError' AS provider_error,
    COUNT(h.id) AS hypothesis_count,
    COUNT(h.id) FILTER (WHERE h.selected_for_validation = TRUE) AS selected_count,
    COUNT(h.id) FILTER (WHERE d.decision = 'GO') AS go_count,
    COUNT(DISTINCT h.product_case_id) FILTER (WHERE h.product_case_id IS NOT NULL) AS promoted_count
  FROM ai_sourcing_runs r
  JOIN sourcing_briefs b ON b.id = r.brief_id
  JOIN markets m ON m.code = b.market_code
  JOIN platforms p ON p.code = b.platform_code
  LEFT JOIN opportunity_hypotheses h ON h.run_id = r.id
  LEFT JOIN selection_decisions d ON d.hypothesis_id = h.id
`;

function mapBatch(row: BatchJoinRow): AISourcingBatchSummary {
  return {
    id: row.id,
    briefId: row.brief_id,
    marketCode: row.market_code,
    marketName: row.market_name,
    platformCode: row.platform_code,
    platformName: row.platform_name,
    category: row.category,
    brief: row.brief,
    currency: row.currency,
    fxRateToUsd: row.fx_rate_to_usd === null ? null : Number(row.fx_rate_to_usd),
    fxSourceUrl: row.fx_source_url,
    provider: row.provider,
    model: row.model,
    status: row.status,
    createdAt: row.created_at,
    hypothesisCount: Number(row.hypothesis_count),
    selectedCount: Number(row.selected_count),
    goCount: Number(row.go_count),
    promotedCount: Number(row.promoted_count),
    templateFallback: row.fallback === "true",
    providerError: row.provider_error,
  };
}

function mapHypothesis(row: HypothesisRow): AISourcingHypothesis {
  return {
    id: row.id,
    runId: row.run_id,
    position: Number(row.position),
    concept: row.concept,
    targetUser: row.target_user,
    painPoint: row.pain_point,
    differentiator: row.differentiator,
    recommendedPriceCents: Number(row.recommended_price_cents),
    confirmedPriceCents: row.confirmed_price_cents === null ? null : Number(row.confirmed_price_cents),
    confirmedPriceSourceUrl: row.confirmed_price_source_url,
    confirmedPriceAt: row.confirmed_price_at,
    expectedMarginRate: Number(row.expected_margin_rate),
    firstOrderBudgetCents: Number(row.first_order_budget_cents),
    mainRisks: Array.isArray(row.main_risks) ? row.main_risks : [],
    supplierKeywords: Array.isArray(row.supplier_keywords) ? row.supplier_keywords : [],
    competitorQueries: Array.isArray(row.competitor_queries) ? row.competitor_queries : [],
    reviewQueries: Array.isArray(row.review_queries) ? row.review_queries : [],
    priorityScore: Number(row.priority_score),
    selectedForValidation: Boolean(row.selected_for_validation),
    productCaseId: row.product_case_id,
    createdAt: row.created_at,
  };
}

function mapEvidence(row: EvidenceRow): AIOpportunityEvidence {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    evidenceType: row.evidence_type,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    title: row.title,
    summary: row.summary,
    observedAt: row.observed_at,
    rawSnapshot: row.raw_snapshot ?? {},
    confidence: Number(row.confidence),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapCompetitor(row: CompetitorRow): AICompetitorSnapshot {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    asin: row.asin,
    title: row.title,
    sourceUrl: row.source_url,
    priceCents: Number(row.price_cents),
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: Number(row.review_count),
    bsr: row.bsr === null ? null : Number(row.bsr),
    monthlySalesMin: row.monthly_sales_min === null ? null : Number(row.monthly_sales_min),
    monthlySalesMax: row.monthly_sales_max === null ? null : Number(row.monthly_sales_max),
    sellerCount: row.seller_count === null ? null : Number(row.seller_count),
    variationCount: row.variation_count === null ? null : Number(row.variation_count),
    observedAt: row.observed_at,
  };
}

function mapShortlist(row: ShortlistRow): AISupplierShortlist {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    supplierName: row.supplier_name,
    platform: row.platform,
    supplierUrl: row.supplier_url,
    contact: row.contact,
    country: row.country,
    productMatch: row.product_match,
    sourceType: row.source_type,
    observedAt: row.observed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapQuote(row: QuoteRow): AISupplierQuote {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    supplierShortlistId: row.supplier_shortlist_id,
    unitPriceCents: Number(row.unit_price_cents),
    freightPerUnitCents: Number(row.freight_per_unit_cents),
    dutyRate: Number(row.duty_rate),
    landedCostCents: Number(row.landed_cost_cents),
    currency: row.currency,
    moq: Number(row.moq),
    leadTimeDays: Number(row.lead_time_days),
    sampleScore: row.sample_score === null ? null : Number(row.sample_score),
    sampleFeeCents: Number(row.sample_fee_cents),
    certifications: row.certifications,
    paymentTerms: row.payment_terms,
    incoterm: row.incoterm,
    quoteUrl: row.quote_url,
    observedAt: row.observed_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapSupplierDiscoveryRun(row: SupplierDiscoveryRunRow): AISupplierDiscoveryRun {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    source: row.source,
    triggerMode: "user_triggered",
    query: row.query,
    pageUrl: row.page_url,
    capturedAt: row.captured_at,
    receivedCount: Number(row.received_count),
    parsedCount: Number(row.parsed_count),
    duplicateCount: Number(row.duplicate_count),
    topCount: Number(row.top_count),
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    actor: row.actor,
    createdAt: row.created_at,
  };
}

function mapSupplierCandidate(row: SupplierCandidateRow): AISupplierCandidate {
  return {
    id: row.id,
    discoveryRunId: row.discovery_run_id,
    hypothesisId: row.hypothesis_id,
    title: row.title,
    supplierName: row.supplier_name,
    platform: row.platform,
    offerUrl: row.offer_url,
    supplierUrl: row.supplier_url,
    offerId: row.offer_id,
    priceCents: row.price_cents === null ? null : Number(row.price_cents),
    currency: row.currency,
    moq: row.moq === null ? null : Number(row.moq),
    location: row.location,
    badges: Array.isArray(row.badges) ? row.badges : [],
    leadTimeDays: row.lead_time_days === null ? null : Number(row.lead_time_days),
    sourceText: row.source_text,
    fingerprint: row.fingerprint,
    score: Number(row.score),
    scoreParts: Array.isArray(row.score_parts) ? row.score_parts : [],
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    riskNotes: Array.isArray(row.risk_notes) ? row.risk_notes : [],
    status: row.status,
    shortlistId: row.shortlist_id,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTask(row: TaskRow): AIValidationTask {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    taskType: row.task_type,
    title: row.title,
    description: row.description,
    targetCount: Number(row.target_count),
    status: row.status,
    owner: row.owner,
    dueAt: row.due_at,
  };
}

function mapDecisionQuote(row: QuoteRow): QuoteForDecision {
  return {
    id: row.id,
    unitPriceCents: Number(row.unit_price_cents),
    freightPerUnitCents: Number(row.freight_per_unit_cents),
    dutyRate: Number(row.duty_rate),
    landedCostCents: Number(row.landed_cost_cents),
    currency: row.currency,
    moq: Number(row.moq),
    leadTimeDays: Number(row.lead_time_days),
    sampleScore: row.sample_score === null ? null : Number(row.sample_score),
    sampleFeeCents: Number(row.sample_fee_cents),
    observedAt: row.observed_at,
  };
}

function mapDecision(row: DecisionRow): AISelectionDecision {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    decision: row.decision,
    decisionScore: Number(row.decision_score),
    opportunityScore: Number(row.opportunity_score),
    evidenceCompleteness: Number(row.evidence_completeness),
    gates: Array.isArray(row.gates) ? row.gates : [],
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    warnings: Array.isArray(row.metrics?.warnings) ? (row.metrics.warnings as string[]) : [],
    bestQuoteId: row.best_quote_id,
    landedCostCents: row.landed_cost_cents === null ? null : Number(row.landed_cost_cents),
    landedCostUsdCents: row.landed_cost_usd_cents === null ? null : Number(row.landed_cost_usd_cents),
    marginRate: row.margin_rate === null ? null : Number(row.margin_rate),
    stressMarginRate: row.stress_margin_rate === null ? null : Number(row.stress_margin_rate),
    netProfitCents: metricNumber(row.metrics?.netProfitCents),
    firstOrderCashCents: metricNumber(row.metrics?.firstOrderCashCents),
    firstOrderCashUsdCents: metricNumber(row.metrics?.firstOrderCashUsdCents),
    metrics: row.metrics ?? {},
    evaluatedAt: row.evaluated_at,
  };
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const group = map.get(key(row)) ?? [];
    group.push(row);
    map.set(key(row), group);
  }
  return map;
}

async function assertSelected(hypothesisId: string) {
  const db = await getDb();
  const result = await db.query<{ selected_for_validation: boolean }>(
    "SELECT selected_for_validation FROM opportunity_hypotheses WHERE id = $1",
    [hypothesisId],
  );
  if (!result.rows[0]) throw new Error("机会假设不存在");
  if (!result.rows[0].selected_for_validation) throw new Error("请先把机会加入验证，再录入证据");
}

function riskLevel(value: string | null | undefined, fallback: "clear" | "review" | "found" | "missing") {
  return value === "clear" || value === "review" || value === "found" ? value : fallback;
}

function metricNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validFxRate(value: number | null | undefined) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("汇率必须大于 0");
  return number;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
