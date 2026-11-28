import type { getDb } from "../db.ts";
import type { DecisionEvaluation } from "../ai-sourcing.ts";
import {
  SYNTHETIC_COMPETITOR_SOURCES,
  type CompetitorBenchmark,
  type ReviewInsightInput,
} from "../competitor-insights.ts";
import type { SupplierScorePart } from "../supplier-candidates.ts";

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
  sourceKind: string;
  comparisonReportId: string | null;
  costSheetId: string | null;
  referenceFactoryCostRmb: number | null;
  complianceAttrs: string[];
  eliminatedAt: string | null;
  eliminationReason: string | null;
  eliminationNote: string | null;
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

/** 合成证据来源（AI / 本地模板）不计入门禁与真实价格分位 */
export const SYNTHETIC_SOURCE_SQL = SYNTHETIC_COMPETITOR_SOURCES.map((s) => `'${s}'`).join(", ");

export type AICompetitorSnapshot = {
  id: string;
  hypothesisId: string;
  sourceType?: string | null;
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
  brand?: string | null;
  isSponsored?: boolean;
  boughtPastMonth?: number | null;
  observedAt: string;
};

export type AIReviewInsight = ReviewInsightInput;

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
  reviewInsights: AIReviewInsight[];
  benchmark: CompetitorBenchmark;
  shortlist: AISupplierShortlist[];
  quotes: AISupplierQuote[];
  supplierDiscoveryRuns: AISupplierDiscoveryRun[];
  supplierCandidates: AISupplierCandidate[];
  tasks: AIValidationTask[];
  decision: AISelectionDecision | null;
  counts: {
    competitors: number;
    /** 人工录入 / 浏览器采集，可计入 GO 门禁 */
    verifiedCompetitors?: number;
    /** AI / 本地模板合成，仅作待核实素材 */
    syntheticCompetitors?: number;
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

export type BatchJoinRow = {
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

export type HypothesisRow = {
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
  source_kind?: string | null;
  comparison_report_id?: string | null;
  cost_sheet_id?: string | null;
  reference_factory_cost_rmb?: string | number | null;
  compliance_attrs?: string[] | null;
  eliminated_at?: string | null;
  elimination_reason?: string | null;
  elimination_note?: string | null;
  created_at: string;
};

export type EvidenceRow = {
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

export type CompetitorRow = {
  id: string;
  hypothesis_id: string;
  evidence_id?: string | null;
  source_type?: string | null;
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
  brand?: string | null;
  is_sponsored?: boolean | null;
  bought_past_month?: number | null;
  observed_at: string;
};

export type ReviewInsightRow = {
  id: string;
  hypothesis_id: string;
  competitor_snapshot_id: string | null;
  evidence_id: string;
  theme: string;
  sentiment: "negative" | "neutral" | "positive";
  sample_size: number;
  representative_quote: string;
  source_url?: string | null;
  observed_at?: string | null;
  source_type?: string | null;
};

export type ShortlistRow = {
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

export type QuoteRow = {
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

export type SupplierDiscoveryRunRow = {
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

export type SupplierCandidateRow = {
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

export type PromotableQuoteRow = QuoteRow & {
  supplier_name: string;
  supplier_platform: string;
  supplier_url: string;
  supplier_contact: string | null;
  supplier_country: string | null;
  product_match: string;
};

export type TaskRow = {
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

export type DecisionRow = {
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

export type AppDatabase = Awaited<ReturnType<typeof getDb>>;

