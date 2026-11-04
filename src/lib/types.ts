import type { EconomicsAssumptions, EconomicsResults } from "./economics";
import type { ListingPreflightResult } from "./listing";
import type { LaunchReadinessResult } from "./launch-readiness";
import type { ScoredSupplierQuote } from "./sourcing";

export type CaseStatus = "draft" | "researching" | "review_pending" | "approved" | "rejected" | "archived";
export type Decision = "approved" | "rejected";

export type ProductCaseRow = {
  id: string;
  asin: string;
  marketplace: string;
  category: string;
  title: string;
  url: string | null;
  status: CaseStatus;
  competitor_price_cents: number;
  monthly_sales_estimate: number;
  review_count: number;
  rating: string | number | null;
  notes: string;
  owner: string;
  evidence_score: number;
  is_demo: boolean;
  source_code: string;
  source_record_id: string | null;
  source_observed_at: string | null;
  currency: string;
  monthly_sales_min: number | null;
  monthly_sales_max: number | null;
  bsr: number | null;
  keyword: string | null;
  keyword_search_volume: number | null;
  seller_count: number | null;
  variation_count: number | null;
  created_at: string;
  updated_at: string;
};

export type CostModelRow = {
  id: string;
  case_id: string;
  version: number;
  assumptions: EconomicsAssumptions;
  results: EconomicsResults;
  created_by: string;
  created_at: string;
};

export type EvidenceRow = {
  id: string;
  case_id: string;
  evidence_type: string;
  source_type: string;
  source_url: string | null;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  confidence: string | number;
  captured_at: string;
};

export type ApprovalRow = {
  id: string;
  case_id: string;
  gate: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decision: string | null;
  reviewer: string | null;
  notes: string;
  created_at: string;
  decided_at: string | null;
};

export type AuditRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown>;
  created_at: string;
};

export type EnrichedCase = ProductCaseRow & {
  costModel: CostModelRow | null;
  opportunityScore: number;
  recommendation: "GO" | "HOLD" | "NO-GO";
  pendingApprovalId: string | null;
};

export type CaseDetail = {
  productCase: ProductCaseRow;
  costModel: CostModelRow | null;
  hasSupplierSelection: boolean;
  evidence: EvidenceRow[];
  approval: ApprovalRow | null;
  auditLogs: AuditRow[];
};

export type SupplierRow = {
  id: string;
  name: string;
  platform: string;
  url: string | null;
  contact: string | null;
  country: string | null;
  rating: string | number | null;
  notes: string;
  created_at: string;
};

export type RfqRow = {
  id: string;
  case_id: string;
  supplier_id: string | null;
  status: string;
  requirements: Record<string, unknown>;
  sent_at: string | null;
  selected_at: string | null;
  created_at: string;
};

export type QuoteRow = {
  id: string;
  rfq_id: string;
  unit_price_cents: number;
  freight_per_unit_cents: number;
  duty_rate: string | number;
  quality_score: number;
  moq: number;
  lead_time_days: number | null;
  payment_terms: string | null;
  incoterm: string | null;
  certifications: string | null;
  sample_fee_cents: number | null;
  raw_payload: Record<string, unknown>;
  selected_at: string | null;
  created_at: string;
};

export type SourcingQuote = QuoteRow & {
  rfq: RfqRow;
  supplier: SupplierRow;
};

export type SupplierSelectionRow = {
  id: string;
  case_id: string;
  supplier_id: string;
  quote_id: string;
  cost_model_id: string;
  selected_by: string;
  exception_reason: string;
  score_snapshot: Record<string, unknown>;
  created_at: string;
};

export type SourcingCaseSummary = {
  productCase: ProductCaseRow;
  costModel: CostModelRow | null;
  quotes: SourcingQuote[];
  scoredQuotes: ScoredSupplierQuote[];
  selection: SupplierSelectionRow | null;
  quoteCount: number;
  eligibleCount: number;
  preferredSupplierName: string | null;
  selectedSupplierName: string | null;
};

export type SourcingDetail = SourcingCaseSummary & {
  auditLogs: AuditRow[];
};

export type ContentProfileRow = {
  id: string;
  case_id: string;
  product_name: string;
  target_customer: string;
  core_differentiator: string;
  specifications: string;
  package_contents: string;
  claims_to_avoid: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  case_id: string;
  asset_type: string;
  file_url: string;
  status: string;
  metadata: Record<string, unknown>;
  parent_asset_id: string | null;
  created_at: string;
};

export type ListingRow = {
  id: string;
  case_id: string;
  marketplace: string;
  external_id: string | null;
  status: string;
  content: Record<string, unknown>;
  version: number;
  created_by: string;
  channel_listing_id: string | null;
  platform_code: string;
  country_code: string | null;
  locale: string | null;
  currency: string;
  created_at: string;
  updated_at: string;
};

export type ListingReviewRow = {
  id: string;
  listing_id: string;
  review_type: string;
  status: string;
  findings: Record<string, unknown>;
  reviewer: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type ContentDetail = {
  productCase: ProductCaseRow;
  costModel: CostModelRow | null;
  selection: SupplierSelectionRow | null;
  selectedSupplierName: string | null;
  profile: ContentProfileRow | null;
  assets: AssetRow[];
  listing: ListingRow | null;
  listingReviews: ListingReviewRow[];
  auditLogs: AuditRow[];
};

export type PlatformRow = {
  code: string;
  name: string;
  adapter_type: "api" | "feed" | "manual";
  api_name: string | null;
  capabilities: Record<string, unknown>;
  status: string;
  created_at: string;
};

export type MarketRow = {
  code: string;
  name: string;
  locale: string;
  currency: string;
  region: string;
  measurement_system: string;
  default_tax_mode: string;
  status: string;
  created_at: string;
};

export type ChannelAccountRow = {
  id: string;
  platform_code: string;
  market_code: string;
  name: string;
  external_seller_id: string | null;
  currency: string;
  locale: string;
  status: "unconfigured" | "connected" | "disabled";
  is_demo: boolean;
  created_at: string;
};

export type ProductRow = {
  id: string;
  case_id: string;
  sku: string;
  gtin: string | null;
  hs_code: string | null;
  category: string;
  brand: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ProductMarketVariantRow = {
  id: string;
  product_id: string;
  country_code: string;
  locale: string;
  currency: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ChannelListingRow = {
  id: string;
  product_market_variant_id: string;
  channel_account_id: string;
  external_id: string | null;
  status: string;
  adapter_version: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ChannelListingVersionRow = {
  id: string;
  channel_listing_id: string;
  version: number;
  canonical_snapshot: Record<string, unknown>;
  mapped_payload: Record<string, unknown>;
  preflight_result: Partial<ListingPreflightResult>;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
};

export type ChannelLaunchReviewRow = {
  id: string;
  channel_listing_id: string;
  channel_version_id: string;
  readiness_status: "approval_pending" | "approved_for_publish";
  readiness_snapshot: Record<string, unknown>;
  blocker_count: number;
  reviewer: string;
  decision: "approved" | "rejected";
  notes: string;
  external_actions: "none";
  published: boolean;
  created_at: string;
};

export type ChannelMatrixItem = {
  product: ProductRow;
  variant: ProductMarketVariantRow;
  account: ChannelAccountRow;
  market: MarketRow;
  platform: PlatformRow;
  channelListing: ChannelListingRow;
  latestVersion: ChannelListingVersionRow | null;
  versionCount: number;
};

export type ChannelMatrix = {
  productCase: ProductCaseRow;
  product: ProductRow | null;
  targets: ChannelMatrixItem[];
  markets: MarketRow[];
  platforms: PlatformRow[];
  auditLogs: AuditRow[];
};

export type ChannelTargetDetail = ChannelMatrixItem & {
  versions: ChannelListingVersionRow[];
  auditLogs: AuditRow[];
  launchReviews: ChannelLaunchReviewRow[];
  launchReadiness: LaunchReadinessResult;
};

export type DataSourceRow = {
  id: string;
  code: string;
  name: string;
  kind: string;
  auth_mode: string;
  status: string;
  capabilities: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_synced_at: string | null;
  created_at: string;
};

export type IngestionRunRow = {
  id: string;
  source_code: string;
  import_kind: string;
  status: "running" | "completed" | "partial" | "failed";
  requested_by: string;
  file_name: string | null;
  query: Record<string, unknown>;
  imported_count: number;
  updated_count: number;
  skipped_count: number;
  error_count: number;
  snapshot_count: number;
  warnings: string[];
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export type ConnectorHealthCheckRow = {
  id: string;
  source_code: string;
  status: "verified" | "credentials_valid" | "failed" | "unsupported";
  verification_level: "seller_read" | "application_credentials" | "unsupported";
  message: string;
  duration_ms: number;
  details: Record<string, unknown>;
  checked_by: string;
  checked_at: string;
};

export type EvidenceSnapshotRow = {
  id: string;
  ingestion_run_id: string | null;
  case_id: string | null;
  source_code: string;
  source_record_id: string;
  evidence_type: string;
  source_url: string | null;
  raw_payload: Record<string, unknown>;
  normalized_payload: Record<string, unknown>;
  content_hash: string;
  observed_at: string;
  created_at: string;
};

export type DataSourceDashboardItem = DataSourceRow & {
  adapterImplemented: boolean;
  configured: boolean;
  readiness: "available" | "configured" | "not_configured" | "planned";
  credentialEnv: string[];
  note: string;
  externalActions: "none" | "read_only";
  snapshotCount: number;
  supplierCount: number;
  quoteCount: number;
};

export type DataSourcesDashboard = {
  sources: DataSourceDashboardItem[];
  runs: IngestionRunRow[];
  stats: {
    realCandidateCount: number;
    supplierCount: number;
    quoteCount: number;
    snapshotCount: number;
    configuredApiCount: number;
  };
};
