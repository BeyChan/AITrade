-- 008_audit_log_mode_isolation.sql
-- 审计日志也必须归属单一运行模式，避免演示空间的操作记录进入真实空间。

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS is_demo BOOLEAN;

-- 旧版日志无法可靠判断来源时保守归入演示空间，避免把演示活动带入真实审计视图。
UPDATE audit_logs
SET is_demo = TRUE
WHERE is_demo IS NULL;

-- 明确标记过 live 的记录，以及只能匹配到真实业务对象的记录，回填为真实空间。
UPDATE audit_logs
SET is_demo = FALSE
WHERE is_demo = TRUE
  AND (
    details->>'mode' = 'live'
    OR details->>'isDemo' = 'false'
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM product_cases AS p
WHERE a.entity_type = 'product_case'
  AND a.entity_id = p.id
  AND p.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM product_cases AS demo WHERE demo.id = p.id AND demo.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM suppliers AS s
WHERE a.entity_type = 'supplier'
  AND a.entity_id = s.id
  AND s.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM suppliers AS demo WHERE demo.id = s.id AND demo.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM ai_sourcing_runs AS r
WHERE a.entity_type = 'ai_sourcing_run'
  AND a.entity_id = r.id
  AND r.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM ai_sourcing_runs AS demo WHERE demo.id = r.id AND demo.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM opportunity_hypotheses AS h
JOIN ai_sourcing_runs AS r ON r.id = h.run_id
WHERE a.entity_type = 'opportunity_hypothesis'
  AND a.entity_id = h.id
  AND r.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM opportunity_hypotheses AS demo_h
    JOIN ai_sourcing_runs AS demo_r ON demo_r.id = demo_h.run_id
    WHERE demo_h.id = h.id AND demo_r.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM validation_tasks AS t
JOIN opportunity_hypotheses AS h ON h.id = t.hypothesis_id
JOIN ai_sourcing_runs AS r ON r.id = h.run_id
WHERE a.entity_type = 'validation_task'
  AND a.entity_id = t.id
  AND r.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM validation_tasks AS demo_t
    JOIN opportunity_hypotheses AS demo_h ON demo_h.id = demo_t.hypothesis_id
    JOIN ai_sourcing_runs AS demo_r ON demo_r.id = demo_h.run_id
    WHERE demo_t.id = t.id AND demo_r.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM ai_tasks AS t
WHERE a.entity_type = 'ai_task'
  AND a.entity_id = t.id
  AND t.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM ai_tasks AS demo WHERE demo.id = t.id AND demo.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM competitor_comparison_reports AS r
WHERE a.entity_type = 'competitor_report'
  AND a.entity_id = r.id
  AND r.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM competitor_comparison_reports AS demo WHERE demo.id = r.id AND demo.is_demo = TRUE
  );

UPDATE audit_logs AS a
SET is_demo = FALSE
FROM studio_media_assets AS m
WHERE a.entity_type IN ('studio_image', 'studio_video')
  AND a.entity_id = m.id
  AND m.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM studio_media_assets AS demo WHERE demo.id = m.id AND demo.is_demo = TRUE
  );

-- 不提供默认值：任何新增审计写入都必须显式带上模式，漏传时直接失败而不是串模式。
ALTER TABLE audit_logs ALTER COLUMN is_demo DROP DEFAULT;
ALTER TABLE audit_logs ALTER COLUMN is_demo SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_mode_created
  ON audit_logs(is_demo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_mode_entity
  ON audit_logs(is_demo, entity_type, entity_id, created_at DESC);
