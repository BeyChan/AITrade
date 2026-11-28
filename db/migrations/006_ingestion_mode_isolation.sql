-- 006_ingestion_mode_isolation.sql
-- 导入运行、证据快照、供应商外部身份与连接器同步任务同样必须在模式内隔离。

ALTER TABLE ingestion_runs
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE evidence_snapshots
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE supplier_external_ids
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE connector_sync_jobs
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE connector_sync_cursors
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- 有案卷父记录的证据可以安全继承案卷模式；其余历史数据保守归入真实空间。
UPDATE evidence_snapshots AS e
SET is_demo = pc.is_demo
FROM product_cases AS pc
WHERE e.case_id = pc.id
  AND e.is_demo IS DISTINCT FROM pc.is_demo;

UPDATE supplier_external_ids AS sei
SET is_demo = s.is_demo
FROM suppliers AS s
WHERE sei.supplier_id = s.id
  AND sei.is_demo IS DISTINCT FROM s.is_demo;

-- 仅当一次导入的全部可归属证据都来自演示空间时，才把该历史运行归入演示空间。
UPDATE ingestion_runs AS ir
SET is_demo = TRUE
WHERE EXISTS (
  SELECT 1 FROM evidence_snapshots e
  WHERE e.ingestion_run_id = ir.id AND e.is_demo = TRUE
)
AND NOT EXISTS (
  SELECT 1 FROM evidence_snapshots e
  WHERE e.ingestion_run_id = ir.id AND e.is_demo = FALSE
);

UPDATE connector_sync_jobs AS job
SET is_demo = ir.is_demo
FROM ingestion_runs AS ir
WHERE job.run_id = ir.id
  AND job.is_demo IS DISTINCT FROM ir.is_demo;

-- 同一外部证据和供应商身份允许分别存在于演示/真实空间，但模式内仍需去重。
DROP INDEX IF EXISTS idx_evidence_snapshots_dedupe;
CREATE UNIQUE INDEX IF NOT EXISTS idx_evidence_snapshots_dedupe_mode
  ON evidence_snapshots(source_code, source_record_id, evidence_type, content_hash, is_demo);

ALTER TABLE supplier_external_ids
  DROP CONSTRAINT IF EXISTS supplier_external_ids_identity_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_external_ids_identity_mode_key
  ON supplier_external_ids(identity_key, is_demo);

DROP INDEX IF EXISTS idx_connector_sync_jobs_active_request;
CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_sync_jobs_active_request_mode
  ON connector_sync_jobs(source_code, request_hash, is_demo)
  WHERE status IN ('queued', 'running');

ALTER TABLE connector_sync_cursors
  DROP CONSTRAINT IF EXISTS connector_sync_cursors_source_code_marketplace_key;
CREATE UNIQUE INDEX IF NOT EXISTS connector_sync_cursors_source_market_mode_key
  ON connector_sync_cursors(source_code, marketplace, is_demo);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_mode_started
  ON ingestion_runs(is_demo, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_snapshots_mode_source
  ON evidence_snapshots(is_demo, source_code, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_external_ids_mode_source
  ON supplier_external_ids(is_demo, source_code);
CREATE INDEX IF NOT EXISTS idx_connector_sync_jobs_mode_recent
  ON connector_sync_jobs(is_demo, created_at DESC);
