-- 003_mode_isolation.sql
-- 演示数据与真实数据按 is_demo 在仓储层和数据库唯一键层面双重隔离。

-- 同一 ASIN 允许分别存在于演示空间与真实空间，但各自空间内仍必须唯一。
ALTER TABLE product_cases
  DROP CONSTRAINT IF EXISTS product_cases_asin_marketplace_key;
CREATE UNIQUE INDEX IF NOT EXISTS product_cases_asin_marketplace_mode_key
  ON product_cases (asin, marketplace, is_demo);

-- 独立于 product_cases 的顶层业务数据也必须可归属到当前模式。
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sourcing_briefs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_sourcing_runs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE competitor_comparison_reports ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE competitor_sourcing_targets ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE studio_media_assets ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE operations_settlement_batches ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cost_sheets ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auto_pipeline_runs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE video_generation_jobs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE channel_sku_mappings ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- 回填有明确演示来源的旧数据；无法证明来源的数据保守归入真实空间。
UPDATE competitor_comparison_reports
SET is_demo = TRUE
WHERE provenance = 'demo'
  AND is_demo = FALSE;

UPDATE suppliers
SET is_demo = TRUE
WHERE id IN ('sup-1688-001', 'sup-1688-002', 'sup-1688-003', 'sup-1688-004')
  AND is_demo = FALSE;

UPDATE studio_media_assets AS sma
SET is_demo = pc.is_demo
FROM product_cases AS pc
WHERE sma.case_id = pc.id
  AND sma.is_demo IS DISTINCT FROM pc.is_demo;

-- 幂等键必须在模式内唯一，避免演示请求占用真实空间的请求键。
DROP INDEX IF EXISTS idx_ai_sourcing_runs_request_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sourcing_runs_request_key_mode
  ON ai_sourcing_runs(request_key, is_demo)
  WHERE request_key IS NOT NULL;

ALTER TABLE auto_candidates
  DROP CONSTRAINT IF EXISTS auto_candidates_platform_code_market_code_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS auto_candidates_platform_external_mode_key
  ON auto_candidates(platform_code, market_code, external_id, is_demo);

DROP INDEX IF EXISTS idx_cost_sheets_group_version_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_sheets_group_version_mode_unique
  ON cost_sheets(group_id, version, is_demo);

ALTER TABLE channel_sku_mappings
  DROP CONSTRAINT IF EXISTS channel_sku_mappings_marketplace_channel_sku_key;
CREATE UNIQUE INDEX IF NOT EXISTS channel_sku_mappings_marketplace_sku_mode_key
  ON channel_sku_mappings(marketplace, channel_sku, is_demo);

CREATE INDEX IF NOT EXISTS idx_suppliers_mode_created
  ON suppliers(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_reports_mode_created
  ON competitor_comparison_reports(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_media_assets_mode_created
  ON studio_media_assets(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_sourcing_runs_mode_created
  ON ai_sourcing_runs(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_mode_created
  ON ai_tasks(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operations_batches_mode_created
  ON operations_settlement_batches(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_sheets_mode_updated
  ON cost_sheets(is_demo, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_pipeline_runs_mode_created
  ON auto_pipeline_runs(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_candidates_mode_grade
  ON auto_candidates(is_demo, platform_code, market_code, grade, score DESC);
CREATE INDEX IF NOT EXISTS idx_auto_run_candidates_mode_run
  ON auto_run_candidates(is_demo, run_id, grade, score DESC);
CREATE INDEX IF NOT EXISTS idx_video_jobs_mode_created
  ON video_generation_jobs(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_sku_mappings_mode
  ON channel_sku_mappings(is_demo, marketplace);
CREATE INDEX IF NOT EXISTS idx_competitor_sourcing_targets_mode
  ON competitor_sourcing_targets(is_demo, report_id);
