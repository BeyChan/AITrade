-- 供应商草稿继承所属机会假设的模式，并让幂等键只在同一模式内唯一。
ALTER TABLE ai_supplier_drafts
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai_supplier_drafts AS d
SET is_demo = r.is_demo
FROM opportunity_hypotheses AS h
JOIN ai_sourcing_runs AS r ON r.id = h.run_id
WHERE d.hypothesis_id = h.id
  AND d.is_demo IS DISTINCT FROM r.is_demo;

ALTER TABLE ai_supplier_drafts
  DROP CONSTRAINT IF EXISTS ai_supplier_drafts_idempotency_key_key;

CREATE UNIQUE INDEX IF NOT EXISTS ai_supplier_drafts_idempotency_mode_key
  ON ai_supplier_drafts(idempotency_key, is_demo);

CREATE INDEX IF NOT EXISTS idx_ai_supplier_drafts_mode_hypothesis
  ON ai_supplier_drafts(is_demo, hypothesis_id, created_at DESC);
