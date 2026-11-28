-- 002_consolidate_runtime_ddl.sql
-- 将原先散落在 API 路由与 Repository 中的运行时建表与 ALTER TABLE 统一收口到版本化迁移。

-- 1. 供应商扩展画像字段（原散落在 api/suppliers/[id]、api/sourcing/capture-1688、lib/repo/sourcing）
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. 自动选品线索采纳状态字段（原散落在 lib/auto-pipeline/repository.ts）
ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS adopted_run_id TEXT;
ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS adopted_hypothesis_id TEXT;
ALTER TABLE auto_candidates ADD COLUMN IF NOT EXISTS selection_status TEXT NOT NULL DEFAULT 'triage_pending';
ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS adopted_run_id TEXT;
ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS adopted_hypothesis_id TEXT;
ALTER TABLE auto_run_candidates ADD COLUMN IF NOT EXISTS selection_status TEXT NOT NULL DEFAULT 'triage_pending';

-- 3. 1688 竞品进价回补目标表（原散落在 api/competitors/sourcing-target）
CREATE TABLE IF NOT EXISTS competitor_sourcing_targets (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  market_code TEXT NOT NULL DEFAULT 'US',
  target_max_cny NUMERIC(10, 2) NOT NULL DEFAULT 0,
  competitor_count INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE competitor_sourcing_targets ADD COLUMN IF NOT EXISTS competitor_count INTEGER NOT NULL DEFAULT 1;

-- 4. 运营复盘 Settlement V2 与 SKU 映射表（原散落在 lib/operations-repository.ts）
CREATE TABLE IF NOT EXISTS channel_sku_mappings (
  id TEXT PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'US',
  channel_sku TEXT NOT NULL,
  case_id TEXT REFERENCES product_cases(id) ON DELETE SET NULL,
  unit_landed_cost_cents_override INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (marketplace, channel_sku)
);

ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS gross_revenue_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS discount_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS gross_units INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS refund_units INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS fulfillment_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS storage_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS other_fee_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS external_ad_spend_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS ad_attribution TEXT NOT NULL DEFAULT 'missing';
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS unit_landed_cost_cents INTEGER;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS landed_cost_cents INTEGER;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS net_profit_cents INTEGER;
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS net_margin_rate NUMERIC(8, 6);
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS plan_platform_margin_rate NUMERIC(8, 6);
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS plan_net_margin_rate NUMERIC(8, 6);
ALTER TABLE operations_sku_snapshots ADD COLUMN IF NOT EXISTS cost_basis TEXT NOT NULL DEFAULT 'platform_contribution_only';

-- 5. 模型供应商配置档案表（原散落在 lib/model-profiles.ts）
CREATE TABLE IF NOT EXISTS model_provider_profiles (
  id TEXT PRIMARY KEY,
  service_type TEXT NOT NULL,
  vendor TEXT NOT NULL,
  protocol TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL DEFAULT '',
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  models_json TEXT NOT NULL DEFAULT '[]',
  default_model TEXT NOT NULL DEFAULT '',
  submit_endpoint TEXT NOT NULL DEFAULT '',
  query_endpoint TEXT NOT NULL DEFAULT '',
  supports_multi_image BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. 视频生成任务表（原散落在 lib/video-jobs.ts）
CREATE TABLE IF NOT EXISTS video_generation_jobs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 5,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  negative_prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  external_task_id TEXT NOT NULL DEFAULT '',
  poll_url TEXT NOT NULL DEFAULT '',
  result_asset_id TEXT,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  error_message TEXT,
  created_by TEXT NOT NULL DEFAULT '本机管理员',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_case_created ON video_generation_jobs (case_id, created_at DESC);
