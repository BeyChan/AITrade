-- AITrade core schema. PostgreSQL compatible; the local MVP runs the same SQL on PGlite.
CREATE TABLE IF NOT EXISTS product_cases (
  id TEXT PRIMARY KEY,
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',
  category TEXT NOT NULL DEFAULT '未分类',
  title TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('draft', 'researching', 'review_pending', 'approved', 'rejected', 'archived')),
  competitor_price_cents INTEGER NOT NULL CHECK (competitor_price_cents > 0),
  monthly_sales_estimate INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(3, 2),
  notes TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '未分配',
  evidence_score INTEGER NOT NULL DEFAULT 0 CHECK (evidence_score BETWEEN 0 AND 100),
  is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asin, marketplace)
);

CREATE TABLE IF NOT EXISTS case_evidence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.500,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cost_models (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  assumptions JSONB NOT NULL,
  results JSONB NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id, version)
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  gate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decision TEXT,
  reviewer TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'manual',
  url TEXT,
  contact TEXT,
  country TEXT,
  rating NUMERIC(3, 2),
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfqs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  supplier_id TEXT REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  unit_price_cents INTEGER NOT NULL,
  moq INTEGER NOT NULL DEFAULT 1,
  lead_time_days INTEGER,
  payment_terms TEXT,
  incoterm TEXT,
  certifications TEXT,
  sample_fee_cents INTEGER,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  parent_asset_id TEXT REFERENCES assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  marketplace TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_reviews (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  review_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  reviewer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES product_cases(id),
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  experiment_type TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  variant TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_cases_status ON product_cases(status);
CREATE INDEX IF NOT EXISTS idx_cost_models_case_version ON cost_models(case_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_case_evidence_case ON case_evidence(case_id);
CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);


-- P0.5 sourcing migration. Additive and safe to run on an existing local database.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS freight_per_unit_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS duty_rate NUMERIC(6, 4) NOT NULL DEFAULT 0;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS quality_score INTEGER NOT NULL DEFAULT 60;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ;
ALTER TABLE rfqs ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS supplier_selections (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  cost_model_id TEXT NOT NULL REFERENCES cost_models(id),
  selected_by TEXT NOT NULL,
  exception_reason TEXT NOT NULL DEFAULT '',
  score_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (case_id)
);

CREATE INDEX IF NOT EXISTS idx_rfqs_case ON rfqs(case_id);
CREATE INDEX IF NOT EXISTS idx_quotes_rfq ON quotes(rfq_id);
CREATE INDEX IF NOT EXISTS idx_supplier_selections_case ON supplier_selections(case_id);

-- P0.6 content studio migration.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE listing_reviews ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS case_content_profiles (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES product_cases(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  target_customer TEXT NOT NULL,
  core_differentiator TEXT NOT NULL,
  specifications TEXT NOT NULL,
  package_contents TEXT NOT NULL,
  claims_to_avoid TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_case_version ON listings(case_id, version);
CREATE INDEX IF NOT EXISTS idx_assets_case_created ON assets(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing ON listing_reviews(listing_id, created_at DESC);

-- P1.1 multi-market and multi-channel foundation.
CREATE TABLE IF NOT EXISTS platforms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapter_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (adapter_type IN ('api', 'feed', 'manual')),
  api_name TEXT,
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS markets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locale TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  region TEXT NOT NULL,
  measurement_system TEXT NOT NULL DEFAULT 'metric',
  default_tax_mode TEXT NOT NULL DEFAULT 'marketplace',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platforms (code, name, adapter_type, api_name, capabilities, status) VALUES
  ('amazon', 'Amazon', 'api', 'Amazon SP-API', '{"listing":true,"price":true,"inventory":true,"orders":true,"webhook":true}', 'planned'),
  ('shopify', 'Shopify', 'api', 'Shopify Admin GraphQL API', '{"listing":true,"price":true,"inventory":true,"orders":true,"webhook":true}', 'planned'),
  ('tiktok_shop', 'TikTok Shop', 'api', 'TikTok Shop Partner API', '{"listing":true,"price":true,"inventory":true,"orders":true,"webhook":true}', 'planned'),
  ('ebay', 'eBay', 'api', 'eBay Sell APIs', '{"listing":true,"price":true,"inventory":true,"orders":true,"webhook":true}', 'planned'),
  ('manual', 'CSV / 人工', 'manual', NULL, '{"listing":true,"price":false,"inventory":false,"orders":false,"webhook":false}', 'available')
ON CONFLICT (code) DO NOTHING;

INSERT INTO markets (code, name, locale, currency, region, measurement_system, default_tax_mode) VALUES
  ('US', '美国', 'en-US', 'USD', 'North America', 'imperial', 'marketplace'),
  ('GB', '英国', 'en-GB', 'GBP', 'Europe', 'metric', 'marketplace'),
  ('DE', '德国', 'de-DE', 'EUR', 'Europe', 'metric', 'marketplace'),
  ('JP', '日本', 'ja-JP', 'JPY', 'Asia Pacific', 'metric', 'marketplace'),
  ('SG', '新加坡', 'en-SG', 'SGD', 'Asia Pacific', 'metric', 'marketplace'),
  ('MY', '马来西亚', 'en-MY', 'MYR', 'Asia Pacific', 'metric', 'marketplace'),
  ('AU', '澳大利亚', 'en-AU', 'AUD', 'Asia Pacific', 'metric', 'marketplace')
ON CONFLICT (code) DO NOTHING;

-- An opportunity is visible only inside an explicit country × platform site.
-- A product case can be linked to multiple sites; channel setup remains separate.
CREATE TABLE IF NOT EXISTS product_case_sites (
  case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
  market_code TEXT NOT NULL REFERENCES markets(code),
  platform_code TEXT NOT NULL REFERENCES platforms(code),
  discovery_source TEXT NOT NULL DEFAULT 'manual',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (case_id, market_code, platform_code)
);

CREATE INDEX IF NOT EXISTS idx_product_case_sites_site
  ON product_case_sites(market_code, platform_code);

-- Existing cases predate explicit site scoping and were Amazon-first.
INSERT INTO product_case_sites (case_id, market_code, platform_code, discovery_source)
SELECT pc.id, pc.marketplace, 'amazon', 'legacy_backfill'
FROM product_cases pc
JOIN markets m ON m.code = pc.marketplace
WHERE NOT EXISTS (
  SELECT 1 FROM product_case_sites pcs WHERE pcs.case_id = pc.id
)
ON CONFLICT (case_id, market_code, platform_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS channel_accounts (
  id TEXT PRIMARY KEY,
  platform_code TEXT NOT NULL REFERENCES platforms(code),
  market_code TEXT NOT NULL REFERENCES markets(code),
  name TEXT NOT NULL,
  external_seller_id TEXT,
  currency TEXT NOT NULL,
  locale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unconfigured'
    CHECK (status IN ('unconfigured', 'connected', 'disabled')),
  is_demo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform_code, market_code, name)
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES product_cases(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  gtin TEXT,
  hs_code TEXT,
  category TEXT NOT NULL,
  brand TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_market_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_code TEXT NOT NULL REFERENCES markets(code),
  locale TEXT NOT NULL,
  currency TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, country_code, locale)
);

CREATE TABLE IF NOT EXISTS channel_listings (
  id TEXT PRIMARY KEY,
  product_market_variant_id TEXT NOT NULL REFERENCES product_market_variants(id) ON DELETE CASCADE,
  channel_account_id TEXT NOT NULL REFERENCES channel_accounts(id),
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  adapter_version TEXT NOT NULL DEFAULT 'p1.1',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_market_variant_id, channel_account_id)
);

CREATE TABLE IF NOT EXISTS channel_listing_versions (
  id TEXT PRIMARY KEY,
  channel_listing_id TEXT NOT NULL REFERENCES channel_listings(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  canonical_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  mapped_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  preflight_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_listing_id, version)
);

CREATE TABLE IF NOT EXISTS channel_launch_reviews (
  id TEXT PRIMARY KEY,
  channel_listing_id TEXT NOT NULL REFERENCES channel_listings(id) ON DELETE CASCADE,
  channel_version_id TEXT NOT NULL REFERENCES channel_listing_versions(id) ON DELETE CASCADE,
  readiness_status TEXT NOT NULL
    CHECK (readiness_status IN ('approval_pending', 'approved_for_publish')),
  readiness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  blocker_count INTEGER NOT NULL DEFAULT 0 CHECK (blocker_count = 0),
  reviewer TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  notes TEXT NOT NULL DEFAULT '',
  external_actions TEXT NOT NULL DEFAULT 'none' CHECK (external_actions = 'none'),
  published BOOLEAN NOT NULL DEFAULT FALSE CHECK (published = FALSE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_listing_id, channel_version_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_launch_reviews_listing
  ON channel_launch_reviews(channel_listing_id, created_at DESC);

CREATE TABLE IF NOT EXISTS channel_launch_validations (
  id TEXT PRIMARY KEY,
  channel_listing_id TEXT NOT NULL REFERENCES channel_listings(id) ON DELETE CASCADE,
  channel_version_id TEXT NOT NULL REFERENCES channel_listing_versions(id) ON DELETE CASCADE,
  channel_account_id TEXT NOT NULL REFERENCES channel_accounts(id),
  platform_code TEXT NOT NULL REFERENCES platforms(code),
  market_code TEXT NOT NULL REFERENCES markets(code),
  operation TEXT NOT NULL DEFAULT 'validation_preview'
    CHECK (operation = 'validation_preview'),
  status TEXT NOT NULL CHECK (status IN ('failed', 'passed', 'unsupported')),
  platform_request_id TEXT,
  platform_submission_id TEXT,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  executed_by TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  external_actions TEXT NOT NULL DEFAULT 'validation_only'
    CHECK (external_actions = 'validation_only'),
  published BOOLEAN NOT NULL DEFAULT FALSE CHECK (published = FALSE),
  UNIQUE (channel_listing_id, channel_version_id, operation)
);

CREATE INDEX IF NOT EXISTS idx_channel_launch_validations_listing
  ON channel_launch_validations(channel_listing_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_channel_launch_validations_version
  ON channel_launch_validations(channel_version_id, executed_at DESC);

ALTER TABLE listings ADD COLUMN IF NOT EXISTS channel_listing_id TEXT REFERENCES channel_listings(id);
ALTER TABLE listings ADD COLUMN IF NOT EXISTS platform_code TEXT NOT NULL DEFAULT 'amazon';
ALTER TABLE listings ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS locale TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

INSERT INTO products (id, case_id, sku, category, brand, status)
SELECT
  'product-' || pc.id,
  pc.id,
  'SKU-' || upper(substr(replace(pc.id, '-', ''), 1, 12)),
  pc.category,
  NULL,
  'active'
FROM product_cases pc
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.case_id = pc.id);

INSERT INTO product_market_variants (id, product_id, country_code, locale, currency, title, status)
SELECT
  'pmv-' || pc.id || '-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  'product-' || pc.id,
  CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END,
  COALESCE(m.locale, 'en-US'),
  COALESCE(m.currency, 'USD'),
  pc.title,
  'active'
FROM product_cases pc
LEFT JOIN markets m ON m.code = pc.marketplace
WHERE NOT EXISTS (
  SELECT 1 FROM product_market_variants pmv
  WHERE pmv.product_id = 'product-' || pc.id
    AND pmv.country_code = CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END
);

INSERT INTO channel_accounts (id, platform_code, market_code, name, currency, locale, status, is_demo)
SELECT
  'account-' || pc.id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  'amazon',
  COALESCE(m.code, 'US'),
  'Amazon ' || COALESCE(m.name, '美国') || ' · ' || pc.asin || ' 验收店铺（测试）',
  COALESCE(m.currency, 'USD'),
  COALESCE(m.locale, 'en-US'),
  'unconfigured',
  TRUE
FROM product_cases pc
LEFT JOIN markets m ON m.code = pc.marketplace
WHERE EXISTS (
  SELECT 1 FROM product_case_sites pcs
  WHERE pcs.case_id = pc.id
    AND pcs.market_code = COALESCE(m.code, 'US')
    AND pcs.platform_code = 'amazon'
)
AND NOT EXISTS (
  SELECT 1 FROM channel_accounts ca
  WHERE ca.id = 'account-' || pc.id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END)
);

INSERT INTO channel_listings
  (id, product_market_variant_id, channel_account_id, external_id, status, adapter_version, metadata)
SELECT
  'channel-' || pc.id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  'pmv-' || pc.id || '-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  'account-' || pc.id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  latest.external_id,
  CASE WHEN latest.status = 'content_approved' THEN 'content_approved' ELSE 'draft' END,
  'legacy-amazon',
  jsonb_build_object('legacy', TRUE, 'sourceMarketplace', pc.marketplace)
FROM product_cases pc
LEFT JOIN markets m ON m.code = pc.marketplace
LEFT JOIN LATERAL (
  SELECT external_id, status
  FROM listings
  WHERE case_id = pc.id
  ORDER BY version DESC
  LIMIT 1
) latest ON TRUE
WHERE EXISTS (
  SELECT 1 FROM product_case_sites pcs
  WHERE pcs.case_id = pc.id
    AND pcs.market_code = COALESCE(m.code, 'US')
    AND pcs.platform_code = 'amazon'
)
AND NOT EXISTS (
  SELECT 1 FROM channel_listings cl
  WHERE cl.id = 'channel-' || pc.id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END)
);

UPDATE listings l
SET
  channel_listing_id = COALESCE(
    l.channel_listing_id,
    'channel-' || l.case_id || '-amazon-' || lower(CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END)
  ),
  platform_code = 'amazon',
  country_code = COALESCE(l.country_code, CASE WHEN m.code IS NULL THEN 'US' ELSE m.code END),
  locale = COALESCE(l.locale, m.locale, 'en-US'),
  currency = COALESCE(l.currency, m.currency, 'USD')
FROM product_cases pc
LEFT JOIN markets m ON m.code = pc.marketplace
WHERE l.case_id = pc.id;

INSERT INTO channel_listing_versions
  (id, channel_listing_id, version, canonical_snapshot, mapped_payload, preflight_result, status, approved_by, approved_at)
SELECT
  'clv-' || l.id,
  l.channel_listing_id,
  l.version,
  l.content,
  '{}'::jsonb,
  COALESCE((
    SELECT lr.findings -> 'preflight'
    FROM listing_reviews lr
    WHERE lr.listing_id = l.id AND lr.review_type = 'automated_preflight'
    ORDER BY lr.created_at DESC
    LIMIT 1
  ), '{}'::jsonb),
  l.status,
  (
    SELECT lr.reviewer
    FROM listing_reviews lr
    WHERE lr.listing_id = l.id AND lr.review_type = 'human_content_review' AND lr.status = 'approved'
    ORDER BY lr.created_at DESC
    LIMIT 1
  ),
  (
    SELECT lr.reviewed_at
    FROM listing_reviews lr
    WHERE lr.listing_id = l.id AND lr.review_type = 'human_content_review' AND lr.status = 'approved'
    ORDER BY lr.created_at DESC
    LIMIT 1
  )
FROM listings l
WHERE l.channel_listing_id IS NOT NULL
ON CONFLICT (channel_listing_id, version) DO NOTHING;

DROP INDEX IF EXISTS idx_listings_case_version;
CREATE UNIQUE INDEX IF NOT EXISTS idx_listings_channel_version ON listings(channel_listing_id, version);
CREATE INDEX IF NOT EXISTS idx_product_market_variants_product ON product_market_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_channel_listings_variant ON channel_listings(product_market_variant_id);
CREATE INDEX IF NOT EXISTS idx_channel_listings_account ON channel_listings(channel_account_id);
CREATE INDEX IF NOT EXISTS idx_channel_listing_versions_listing ON channel_listing_versions(channel_listing_id, version DESC);

-- P1.0 real-data ingestion foundation. Additive and safe to run on an existing database.
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS source_code TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS source_record_id TEXT;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS source_observed_at TIMESTAMPTZ;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS monthly_sales_min INTEGER;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS monthly_sales_max INTEGER;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS bsr INTEGER;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS keyword TEXT;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS keyword_search_volume INTEGER;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS seller_count INTEGER;
ALTER TABLE product_cases ADD COLUMN IF NOT EXISTS variation_count INTEGER;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tooling_fee_cents INTEGER;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS valid_until DATE;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source_code TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS source_hash TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  auth_mode TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'planned',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES data_sources(code),
  import_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  requested_by TEXT NOT NULL,
  file_name TEXT,
  query JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  snapshot_count INTEGER NOT NULL DEFAULT 0,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
  id TEXT PRIMARY KEY,
  ingestion_run_id TEXT REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  case_id TEXT REFERENCES product_cases(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_snapshots_dedupe
  ON evidence_snapshots(source_code, source_record_id, evidence_type, content_hash);
CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_case ON evidence_snapshots(case_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_run ON evidence_snapshots(ingestion_run_id);

CREATE TABLE IF NOT EXISTS supplier_external_ids (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  external_id TEXT,
  normalized_url TEXT,
  identity_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_external_ids_supplier ON supplier_external_ids(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_external_ids_url ON supplier_external_ids(normalized_url);

CREATE TABLE IF NOT EXISTS rfq_messages (
  id TEXT PRIMARY KEY,
  rfq_id TEXT NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  subject TEXT,
  body TEXT,
  external_message_id TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfq_messages_rfq ON rfq_messages(rfq_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quote_documents (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  file_url TEXT,
  source_url TEXT,
  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_documents_quote ON quote_documents(quote_id);

INSERT INTO data_sources (id, code, name, kind, auth_mode, status, capabilities, metadata) VALUES
  ('src-csv-candidates', 'csv_candidates', '候选品 CSV', 'csv', 'none', 'available',
   '{"selection":true,"supplier":false,"quotes":false,"rawSnapshots":true}',
   '{"adapterImplemented":true,"credentialEnv":[],"externalActions":"none"}'),
  ('src-csv-suppliers', 'csv_suppliers', '供应商 CSV', 'csv', 'none', 'available',
   '{"selection":false,"supplier":true,"quotes":false,"rawSnapshots":true}',
   '{"adapterImplemented":true,"credentialEnv":[],"externalActions":"none"}'),
  ('src-csv-quotes', 'csv_quotes', '报价 CSV', 'csv', 'none', 'available',
   '{"selection":false,"supplier":true,"quotes":true,"rawSnapshots":true}',
   '{"adapterImplemented":true,"credentialEnv":[],"externalActions":"none"}'),
  ('src-manual-quotes', 'manual_quotes', '人工报价录入', 'manual', 'none', 'available',
   '{"selection":false,"supplier":true,"quotes":true,"rawSnapshots":true}',
   '{"adapterImplemented":true,"credentialEnv":[],"externalActions":"none"}'),
  ('src-keepa', 'keepa', 'Keepa 商品数据', 'api', 'api_key', 'not_configured',
   '{"selection":true,"supplier":false,"quotes":false,"rawSnapshots":true}',
   '{"adapterImplemented":true,"credentialEnv":["KEEPA_API_KEY"],"externalActions":"read_only"}'),
  ('src-amazon-sp-api', 'amazon_sp_api', 'Amazon SP-API（自有店铺）', 'api', 'oauth2', 'not_configured',
   '{"selection":false,"supplier":false,"quotes":false,"orders":true,"inventory":true,"rawSnapshots":true}',
   '{"adapterImplemented":false,"diagnostic":"seller_read","credentialEnv":["AMAZON_SP_API_CLIENT_ID","AMAZON_SP_API_CLIENT_SECRET","AMAZON_SP_API_REFRESH_TOKEN"],"externalActions":"read_only"}'),
  ('src-shopify', 'shopify', 'Shopify Admin API', 'api', 'oauth2', 'not_configured',
   '{"listing":true,"inventory":true,"orders":true,"rawSnapshots":true}',
   '{"adapterImplemented":false,"diagnostic":"seller_read","credentialEnv":["SHOPIFY_SHOP_DOMAIN","SHOPIFY_ACCESS_TOKEN"],"externalActions":"read_only"}'),
  ('src-tiktok-shop', 'tiktok_shop', 'TikTok Shop Partner API', 'api', 'oauth2', 'not_configured',
   '{"listing":true,"inventory":true,"orders":true,"rawSnapshots":true}',
   '{"adapterImplemented":false,"credentialEnv":["TIKTOK_SHOP_APP_KEY","TIKTOK_SHOP_APP_SECRET"],"externalActions":"none"}'),
  ('src-ebay', 'ebay', 'eBay Sell APIs', 'api', 'oauth2', 'not_configured',
   '{"listing":true,"inventory":true,"orders":true,"rawSnapshots":true}',
   '{"adapterImplemented":false,"diagnostic":"application_credentials","credentialEnv":["EBAY_CLIENT_ID","EBAY_CLIENT_SECRET"],"externalActions":"read_only"}'),
  ('src-alibaba-1688', 'alibaba_1688', '1688 / Alibaba 官方授权接口', 'api', 'oauth2', 'planned',
   '{"selection":false,"supplier":true,"quotes":true,"rawSnapshots":true}',
   '{"adapterImplemented":false,"credentialEnv":["ALIBABA_1688_APP_KEY","ALIBABA_1688_APP_SECRET"],"externalActions":"none","note":"需按官方开放平台授权和应用审核接入"}')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  auth_mode = EXCLUDED.auth_mode,
  capabilities = EXCLUDED.capabilities,
  metadata = EXCLUDED.metadata;

CREATE TABLE IF NOT EXISTS connector_health_checks (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('verified', 'credentials_valid', 'failed', 'unsupported')),
  verification_level TEXT NOT NULL
    CHECK (verification_level IN ('seller_read', 'application_credentials', 'unsupported')),
  message TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_by TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_health_checks_source
  ON connector_health_checks(source_code, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_source ON ingestion_runs(source_code, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_runs_status ON ingestion_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_cases_source ON product_cases(source_code, source_record_id);
CREATE INDEX IF NOT EXISTS idx_quotes_source_hash ON quotes(rfq_id, source_hash);

-- P1.2 durable connector sync jobs. A job records intent and attempts; ingestion_runs
-- continue to record the data mutation, so failed requests never look like imports.
CREATE TABLE IF NOT EXISTS connector_sync_jobs (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES data_sources(code),
  marketplace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  trigger_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('manual', 'scheduled')),
  requested_by TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  request_hash TEXT NOT NULL,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_id TEXT REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  next_run_at TIMESTAMPTZ,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_sync_jobs_active_request
  ON connector_sync_jobs(source_code, request_hash)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_connector_sync_jobs_recent
  ON connector_sync_jobs(source_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_sync_jobs_status
  ON connector_sync_jobs(status, next_run_at, created_at DESC);

CREATE TABLE IF NOT EXISTS connector_sync_cursors (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL REFERENCES data_sources(code),
  marketplace TEXT NOT NULL,
  cursor JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_code, marketplace)
);

CREATE TABLE IF NOT EXISTS connector_api_calls (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES connector_sync_jobs(id) ON DELETE CASCADE,
  source_code TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT 'GET',
  status_code INTEGER,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  request_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connector_api_calls_job
  ON connector_api_calls(job_id, created_at ASC);

-- P1.3 AI sourcing research room. This layer keeps generated hypotheses separate
-- from verified market evidence and the existing approved-case sourcing flow.
CREATE TABLE IF NOT EXISTS sourcing_briefs (
  id TEXT PRIMARY KEY,
  market_code TEXT NOT NULL REFERENCES markets(code),
  platform_code TEXT NOT NULL REFERENCES platforms(code),
  category TEXT NOT NULL,
  brief TEXT NOT NULL,
  currency TEXT NOT NULL,
  fx_rate_to_usd NUMERIC(14, 6),
  fx_source_url TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_sourcing_runs (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL REFERENCES sourcing_briefs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_key TEXT,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('running', 'completed', 'failed')),
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE ai_sourcing_runs ADD COLUMN IF NOT EXISTS request_key TEXT;

CREATE TABLE IF NOT EXISTS opportunity_hypotheses (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ai_sourcing_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  concept TEXT NOT NULL,
  target_user TEXT NOT NULL,
  pain_point TEXT NOT NULL,
  differentiator TEXT NOT NULL,
  recommended_price_cents INTEGER NOT NULL CHECK (recommended_price_cents > 0),
  expected_margin_rate NUMERIC(6, 4) NOT NULL,
  first_order_budget_cents INTEGER NOT NULL CHECK (first_order_budget_cents >= 0),
  main_risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  supplier_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  competitor_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_queries JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 100),
  selected_for_validation BOOLEAN NOT NULL DEFAULT FALSE,
  product_case_id TEXT REFERENCES product_cases(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, position)
);

ALTER TABLE opportunity_hypotheses ADD COLUMN IF NOT EXISTS confirmed_price_cents INTEGER CHECK (confirmed_price_cents > 0);
ALTER TABLE opportunity_hypotheses ADD COLUMN IF NOT EXISTS confirmed_price_source_url TEXT;
ALTER TABLE opportunity_hypotheses ADD COLUMN IF NOT EXISTS confirmed_price_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS opportunity_evidence (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  raw_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0.800,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor_snapshots (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES opportunity_evidence(id) ON DELETE CASCADE,
  asin TEXT,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  rating NUMERIC(3, 2),
  review_count INTEGER NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  bsr INTEGER,
  monthly_sales_min INTEGER,
  monthly_sales_max INTEGER,
  seller_count INTEGER,
  variation_count INTEGER,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_insights (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  competitor_snapshot_id TEXT REFERENCES competitor_snapshots(id) ON DELETE SET NULL,
  evidence_id TEXT NOT NULL REFERENCES opportunity_evidence(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  sentiment TEXT NOT NULL DEFAULT 'negative'
    CHECK (sentiment IN ('negative', 'neutral', 'positive')),
  sample_size INTEGER NOT NULL DEFAULT 1 CHECK (sample_size > 0),
  representative_quote TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_shortlists (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  supplier_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '1688',
  supplier_url TEXT NOT NULL,
  contact TEXT,
  country TEXT,
  product_match TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual_verified',
  observed_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sourcing_supplier_quotes (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  supplier_shortlist_id TEXT NOT NULL REFERENCES supplier_shortlists(id) ON DELETE CASCADE,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents > 0),
  freight_per_unit_cents INTEGER NOT NULL DEFAULT 0 CHECK (freight_per_unit_cents >= 0),
  duty_rate NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (duty_rate >= 0 AND duty_rate <= 1),
  landed_cost_cents INTEGER NOT NULL CHECK (landed_cost_cents > 0),
  currency TEXT NOT NULL,
  moq INTEGER NOT NULL CHECK (moq > 0),
  lead_time_days INTEGER NOT NULL CHECK (lead_time_days > 0),
  sample_score INTEGER CHECK (sample_score BETWEEN 0 AND 100),
  sample_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (sample_fee_cents >= 0),
  certifications TEXT NOT NULL DEFAULT '',
  payment_terms TEXT NOT NULL DEFAULT '',
  incoterm TEXT NOT NULL DEFAULT '',
  quote_url TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_discovery_runs (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT '1688_visible_page',
  trigger_mode TEXT NOT NULL DEFAULT 'user_triggered',
  query TEXT NOT NULL DEFAULT '',
  page_url TEXT,
  payload_text TEXT NOT NULL DEFAULT '',
  captured_at TIMESTAMPTZ NOT NULL,
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  parsed_count INTEGER NOT NULL DEFAULT 0 CHECK (parsed_count >= 0),
  duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  top_count INTEGER NOT NULL DEFAULT 0 CHECK (top_count >= 0),
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_candidates (
  id TEXT PRIMARY KEY,
  discovery_run_id TEXT NOT NULL REFERENCES supplier_discovery_runs(id) ON DELETE CASCADE,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '1688',
  offer_url TEXT NOT NULL DEFAULT '',
  supplier_url TEXT NOT NULL DEFAULT '',
  offer_id TEXT,
  price_cents INTEGER CHECK (price_cents IS NULL OR price_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  moq INTEGER CHECK (moq IS NULL OR moq > 0),
  location TEXT NOT NULL DEFAULT '',
  badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  lead_time_days INTEGER CHECK (lead_time_days IS NULL OR lead_time_days > 0),
  source_text TEXT NOT NULL DEFAULT '',
  fingerprint TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'shortlisted', 'rejected')),
  shortlist_id TEXT REFERENCES supplier_shortlists(id) ON DELETE SET NULL,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hypothesis_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS validation_tasks (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done', 'blocked')),
  owner TEXT NOT NULL DEFAULT '未分配',
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (hypothesis_id, task_type)
);

CREATE TABLE IF NOT EXISTS selection_decisions (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL UNIQUE REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('GO', 'HOLD', 'NO-GO')),
  decision_score INTEGER NOT NULL CHECK (decision_score BETWEEN 0 AND 100),
  opportunity_score INTEGER NOT NULL CHECK (opportunity_score BETWEEN 0 AND 100),
  evidence_completeness INTEGER NOT NULL CHECK (evidence_completeness BETWEEN 0 AND 100),
  landed_cost_cents INTEGER,
  landed_cost_usd_cents INTEGER,
  margin_rate NUMERIC(8, 6),
  stress_margin_rate NUMERIC(8, 6),
  best_quote_id TEXT REFERENCES sourcing_supplier_quotes(id) ON DELETE SET NULL,
  gates JSONB NOT NULL DEFAULT '[]'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_briefs_site ON sourcing_briefs(market_code, platform_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sourcing_runs_brief ON ai_sourcing_runs(brief_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sourcing_runs_request_key
  ON ai_sourcing_runs(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opportunity_hypotheses_run ON opportunity_hypotheses(run_id, position);
CREATE INDEX IF NOT EXISTS idx_opportunity_evidence_hypothesis ON opportunity_evidence(hypothesis_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_snapshots_hypothesis ON competitor_snapshots(hypothesis_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_insights_hypothesis ON review_insights(hypothesis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_shortlists_hypothesis ON supplier_shortlists(hypothesis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_supplier_quotes_hypothesis ON sourcing_supplier_quotes(hypothesis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_discovery_runs_hypothesis ON supplier_discovery_runs(hypothesis_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_candidates_hypothesis ON supplier_candidates(hypothesis_id, score DESC, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_candidates_run ON supplier_candidates(discovery_run_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_validation_tasks_hypothesis ON validation_tasks(hypothesis_id, status, created_at);

-- Item selection no longer uses a human approval queue. Keep the legacy status
-- in the CHECK constraint for historical rows, but migrate every pending item
-- into the actionable state idempotently on startup.
UPDATE product_cases
SET status = 'approved',
    updated_at = NOW()
WHERE status = 'review_pending';

-- P2.0 AI evidence inbox. Extracted values are staged here first and remain
-- separate from verified business facts until a human review + transaction apply.
INSERT INTO data_sources (id, code, name, kind, auth_mode, status, capabilities, metadata) VALUES
  ('src-ai-inbox', 'ai_inbox', 'AI 证据收件箱', 'manual', 'none', 'available',
   '{"selection":true,"supplier":true,"quotes":true,"rawSnapshots":true,"aiExtraction":true}',
   '{"adapterImplemented":true,"externalActions":"none","supportedInputs":["text","csv","json","markdown"],"unsupportedInputs":["image","pdf"]}')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  kind = EXCLUDED.kind,
  status = EXCLUDED.status,
  capabilities = EXCLUDED.capabilities,
  metadata = EXCLUDED.metadata;

CREATE TABLE IF NOT EXISTS ai_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL DEFAULT 'evidence_extraction'
    CHECK (task_type IN ('evidence_extraction')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'needs_review', 'ready', 'applied', 'failed')),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('paste', 'csv', 'json', 'text', 'markdown')),
  target_hypothesis_id TEXT REFERENCES opportunity_hypotheses(id) ON DELETE SET NULL,
  ingestion_run_id TEXT REFERENCES ingestion_runs(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL UNIQUE,
  requested_by TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'template',
  model TEXT NOT NULL DEFAULT 'deterministic-v1',
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  extraction_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  applied_entity_type TEXT,
  applied_entity_id TEXT,
  applied_at TIMESTAMPTZ,
  applied_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_target ON ai_tasks(target_hypothesis_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('paste', 'file')),
  file_name TEXT,
  mime_type TEXT,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source_url TEXT,
  observed_at TIMESTAMPTZ,
  evidence_snapshot_id TEXT REFERENCES evidence_snapshots(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (task_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_task_artifacts_task ON ai_task_artifacts(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_task_artifacts_snapshot ON ai_task_artifacts(evidence_snapshot_id);

CREATE TABLE IF NOT EXISTS ai_extracted_fields (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  raw_value TEXT,
  normalized_value JSONB,
  confidence NUMERIC(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'needs_review'
    CHECK (status IN ('extracted', 'auto_accepted', 'needs_review', 'accepted', 'rejected', 'missing')),
  risk_level TEXT NOT NULL DEFAULT 'normal'
    CHECK (risk_level IN ('normal', 'sensitive')),
  validation_message TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 同一字段允许多个候选值，以便保留冲突来源并交由人工裁决。
ALTER TABLE ai_extracted_fields DROP CONSTRAINT IF EXISTS ai_extracted_fields_task_id_field_name_key;

CREATE INDEX IF NOT EXISTS idx_ai_extracted_fields_task ON ai_extracted_fields(task_id, position);
CREATE INDEX IF NOT EXISTS idx_ai_extracted_fields_status ON ai_extracted_fields(task_id, status);

CREATE TABLE IF NOT EXISTS ai_field_sources (
  id TEXT PRIMARY KEY,
  field_id TEXT NOT NULL UNIQUE REFERENCES ai_extracted_fields(id) ON DELETE CASCADE,
  artifact_id TEXT REFERENCES ai_task_artifacts(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('artifact', 'manual')),
  excerpt TEXT NOT NULL,
  locator JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_review_actions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  field_id TEXT REFERENCES ai_extracted_fields(id) ON DELETE SET NULL,
  action TEXT NOT NULL
    CHECK (action IN ('accept', 'correct', 'reject', 'retry', 'apply')),
  previous_value JSONB,
  new_value JSONB,
  actor TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_review_actions_task ON ai_review_actions(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_review_actions_field ON ai_review_actions(field_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_model_calls (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES ai_tasks(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  latency_ms INTEGER NOT NULL DEFAULT 0,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_calls_task ON ai_model_calls(task_id, created_at DESC);

-- P2.1 supplier assistant. Drafts are internal artifacts only. There is no
-- sent_at column and no status that can be mistaken for an external delivery.
CREATE TABLE IF NOT EXISTS ai_supplier_drafts (
  id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES opportunity_hypotheses(id) ON DELETE CASCADE,
  supplier_shortlist_id TEXT REFERENCES supplier_shortlists(id) ON DELETE SET NULL,
  draft_type TEXT NOT NULL
    CHECK (draft_type IN ('rfq', 'followup', 'expiry_reminder')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'reviewed')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  facts_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_mode TEXT NOT NULL
    CHECK (generation_mode IN ('deterministic', 'model_polished')),
  generation_note TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_supplier_drafts_hypothesis
  ON ai_supplier_drafts(hypothesis_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_supplier_drafts_status
  ON ai_supplier_drafts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_supplier_drafts_supplier
  ON ai_supplier_drafts(supplier_shortlist_id, created_at DESC);
