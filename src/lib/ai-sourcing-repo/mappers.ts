import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { attachResearchPriority } from "../ai-provider.ts";
import {
  DEFAULT_SOURCING_THRESHOLDS,
  type AISourcingContext,
  type QuoteForDecision,
} from "../ai-sourcing.ts";
import { SYNTHETIC_SOURCE_SQL } from "./types.ts";
import type {
  AISelectionDecision,
  AISourcingBatchSummary,
  AISourcingHypothesis,
  AICompetitorSnapshot,
  AIOpportunityEvidence,
  AIReviewInsight,
  AISupplierCandidate,
  AISupplierDiscoveryRun,
  AISupplierQuote,
  AISupplierShortlist,
  AIValidationTask,
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

export async function loadHypothesisContext(hypothesisId: string) {
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
  const counts = await db.query<{ competitors: string | number; synthetic_competitors: string | number; review_samples: string | number; suppliers: string | number; quotes: string | number }>(
    `SELECT
       (SELECT COUNT(*) FROM competitor_snapshots c
          LEFT JOIN opportunity_evidence e ON e.id = c.evidence_id
          WHERE c.hypothesis_id = $1
            AND COALESCE(e.source_type, '') NOT IN (${SYNTHETIC_SOURCE_SQL})) AS competitors,
       (SELECT COUNT(*) FROM competitor_snapshots c
          JOIN opportunity_evidence e ON e.id = c.evidence_id
          WHERE c.hypothesis_id = $1
            AND e.source_type IN (${SYNTHETIC_SOURCE_SQL})) AS synthetic_competitors,
       (SELECT COALESCE(SUM(ri.sample_size), 0) FROM review_insights ri
          LEFT JOIN opportunity_evidence e ON e.id = ri.evidence_id
          WHERE ri.hypothesis_id = $1
            AND COALESCE(e.source_type, '') NOT IN (${SYNTHETIC_SOURCE_SQL})) AS review_samples,
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
      syntheticCompetitors: Number(count?.synthetic_competitors ?? 0),
      reviewSamples: Number(count?.review_samples ?? 0),
      suppliers: Number(count?.suppliers ?? 0),
      quotes: Number(count?.quotes ?? 0),
    },
  };
}

export function buildValidationTasks(
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
      description: `优先看 1–3 星评论，按「${batch.category}」核心痛点、质量缺陷、使用体验、尺寸与退货原因归类，记录样本数与原文摘录。`,
      targetCount: DEFAULT_SOURCING_THRESHOLDS.minReviewSamples,
    },
    {
      taskType: "supplier_shortlist",
      title: `建立 ${DEFAULT_SOURCING_THRESHOLDS.minSuppliers} 家供应商短名单`,
      description: `在 1688 / Alibaba 搜索「${supplierQuery}」，核验工厂链接、主营类目、起订量、认证和最近更新时间。`,
      targetCount: DEFAULT_SOURCING_THRESHOLDS.minSuppliers,
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

export const batchSelect = `
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

export function mapBatch(row: BatchJoinRow): AISourcingBatchSummary {
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

export function mapHypothesis(row: HypothesisRow): AISourcingHypothesis {
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
    sourceKind: row.source_kind ?? "ai",
    comparisonReportId: row.comparison_report_id ?? null,
    referenceFactoryCostRmb:
      row.reference_factory_cost_rmb === null || row.reference_factory_cost_rmb === undefined
        ? null
        : Number(row.reference_factory_cost_rmb),
    complianceAttrs: Array.isArray(row.compliance_attrs) ? row.compliance_attrs : [],
    eliminatedAt: row.eliminated_at ?? null,
    eliminationReason: row.elimination_reason ?? null,
    eliminationNote: row.elimination_note ?? null,
    createdAt: row.created_at,
  };
}

export function mapEvidence(row: EvidenceRow): AIOpportunityEvidence {
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

export function mapCompetitor(row: CompetitorRow): AICompetitorSnapshot {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    sourceType: row.source_type ?? null,
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
    brand: row.brand ?? null,
    isSponsored: Boolean(row.is_sponsored),
    boughtPastMonth: row.bought_past_month === null || row.bought_past_month === undefined ? null : Number(row.bought_past_month),
    observedAt: row.observed_at,
  };
}

export function mapReviewInsight(row: ReviewInsightRow): AIReviewInsight {
  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    competitorSnapshotId: row.competitor_snapshot_id,
    evidenceId: row.evidence_id,
    theme: row.theme,
    sentiment: row.sentiment,
    sampleSize: Number(row.sample_size),
    representativeQuote: row.representative_quote ?? "",
    sourceUrl: row.source_url ?? null,
    observedAt: row.observed_at ?? null,
    sourceType: row.source_type ?? null,
  };
}

export function mapShortlist(row: ShortlistRow): AISupplierShortlist {
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

export function mapQuote(row: QuoteRow): AISupplierQuote {
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

export function mapSupplierDiscoveryRun(row: SupplierDiscoveryRunRow): AISupplierDiscoveryRun {
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

export function mapSupplierCandidate(row: SupplierCandidateRow): AISupplierCandidate {
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

export function mapTask(row: TaskRow): AIValidationTask {
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

export function mapDecisionQuote(row: QuoteRow): QuoteForDecision {
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

export function mapDecision(row: DecisionRow): AISelectionDecision {
  const rawCalibrationStatus = row.metrics?.calibrationStatus;
  const calibrationStatus: "uncalibrated" | "partial" | "calibrated" =
    rawCalibrationStatus === "calibrated" || rawCalibrationStatus === "partial"
      ? rawCalibrationStatus
      : "uncalibrated";
  const calibrationSuffix =
    calibrationStatus === "calibrated"
      ? "已校准"
      : calibrationStatus === "partial"
        ? "部分校准"
        : "待校准";
  const decisionLabel =
    typeof row.metrics?.decisionLabel === "string" && row.metrics.decisionLabel.trim()
      ? row.metrics.decisionLabel
      : `${row.decision}（${calibrationSuffix}）`;

  return {
    id: row.id,
    hypothesisId: row.hypothesis_id,
    decision: row.decision,
    decisionLabel,
    calibrationStatus,
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

export function groupBy<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const group = map.get(key(row)) ?? [];
    group.push(row);
    map.set(key(row), group);
  }
  return map;
}

export async function assertSelected(hypothesisId: string) {
  const db = await getDb();
  const result = await db.query<{ selected_for_validation: boolean }>(
    "SELECT selected_for_validation FROM opportunity_hypotheses WHERE id = $1",
    [hypothesisId],
  );
  if (!result.rows[0]) throw new Error("机会假设不存在");
  if (!result.rows[0].selected_for_validation) throw new Error("请先把机会加入验证，再录入证据");
}

export function riskLevel(value: string | null | undefined, fallback: "clear" | "review" | "found" | "missing") {
  return value === "clear" || value === "review" || value === "found" ? value : fallback;
}

export function metricNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validFxRate(value: number | null | undefined) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("汇率必须大于 0");
  return number;
}

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

