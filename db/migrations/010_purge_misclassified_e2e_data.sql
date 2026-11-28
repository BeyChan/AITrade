-- 010_purge_misclassified_e2e_data.sql
-- 旧版 E2E/演示写入路径曾把测试样本记为 is_demo = FALSE，导致“真实数据”空间出现
-- e2e-pool.csv、B0E2E*、Demo Kitchen & Pet Batch 等测试记录。这里只清理高置信度的
-- 测试签名及其派生物，不按时间范围或整表清空，避免误伤 mop / umbrella 等真实批次。

CREATE TEMP TABLE _aitrade_e2e_cases ON COMMIT DROP AS
SELECT id
FROM product_cases
WHERE is_demo = FALSE
  AND (asin ILIKE 'B0E2E%' OR title ILIKE 'E2E %');

CREATE TEMP TABLE _aitrade_e2e_auto_runs ON COMMIT DROP AS
SELECT id
FROM auto_pipeline_runs
WHERE is_demo = FALSE
  AND (
    source_label ILIKE 'e2e-%'
    OR source_label = 'Demo Kitchen & Pet Batch'
  );

-- 先记录由 E2E 案卷证据产生的导入运行；若同一次导入还含非 E2E 证据则保留该运行。
CREATE TEMP TABLE _aitrade_e2e_ingestion_runs ON COMMIT DROP AS
SELECT run.id
FROM ingestion_runs AS run
WHERE run.is_demo = FALSE
  AND EXISTS (
    SELECT 1
    FROM evidence_snapshots AS evidence
    JOIN _aitrade_e2e_cases AS test_case ON test_case.id = evidence.case_id
    WHERE evidence.ingestion_run_id = run.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM evidence_snapshots AS evidence
    LEFT JOIN _aitrade_e2e_cases AS test_case ON test_case.id = evidence.case_id
    WHERE evidence.ingestion_run_id = run.id
      AND evidence.case_id IS NOT NULL
      AND test_case.id IS NULL
  );

CREATE TEMP TABLE _aitrade_e2e_hypotheses ON COMMIT DROP AS
SELECT id
FROM opportunity_hypotheses
WHERE concept ILIKE 'B0E2E%' OR concept ILIKE 'E2E %';

-- 仅当整批 hypotheses 都是 E2E 概念时，才删除对应的看板运行与来源简报。
CREATE TEMP TABLE _aitrade_e2e_ai_runs ON COMMIT DROP AS
SELECT run.id, run.brief_id
FROM ai_sourcing_runs AS run
JOIN opportunity_hypotheses AS hypothesis ON hypothesis.run_id = run.id
WHERE run.is_demo = FALSE
GROUP BY run.id, run.brief_id
HAVING BOOL_AND(
  hypothesis.concept ILIKE 'B0E2E%' OR hypothesis.concept ILIKE 'E2E %'
);

CREATE TEMP TABLE _aitrade_e2e_reports ON COMMIT DROP AS
SELECT id
FROM competitor_comparison_reports
WHERE is_demo = FALSE
  AND (
    payload->>'title' ILIKE 'E2E %'
    OR payload::text ILIKE '%B0E2E%'
  );

DELETE FROM cost_sheets
WHERE is_demo = FALSE
  AND (
    case_id IN (SELECT id FROM _aitrade_e2e_cases)
    OR hypothesis_id IN (SELECT id FROM _aitrade_e2e_hypotheses)
  );

DELETE FROM opportunity_hypotheses
WHERE id IN (SELECT id FROM _aitrade_e2e_hypotheses)
   OR run_id IN (SELECT id FROM _aitrade_e2e_ai_runs);

DELETE FROM ai_sourcing_runs
WHERE id IN (SELECT id FROM _aitrade_e2e_ai_runs);

DELETE FROM sourcing_briefs AS brief
WHERE brief.id IN (SELECT brief_id FROM _aitrade_e2e_ai_runs)
  AND brief.is_demo = FALSE
  AND NOT EXISTS (
    SELECT 1 FROM ai_sourcing_runs AS run WHERE run.brief_id = brief.id
  );

DELETE FROM competitor_sourcing_targets
WHERE report_id IN (SELECT id FROM _aitrade_e2e_reports);

DELETE FROM competitor_comparison_reports
WHERE id IN (SELECT id FROM _aitrade_e2e_reports);

DELETE FROM auto_candidates
WHERE is_demo = FALSE
  AND (
    run_id IN (SELECT id FROM _aitrade_e2e_auto_runs)
    OR external_id ILIKE 'B0E2E%'
    OR title ILIKE 'E2E %'
  );

DELETE FROM auto_pipeline_runs
WHERE id IN (SELECT id FROM _aitrade_e2e_auto_runs);

DELETE FROM ingestion_runs
WHERE id IN (SELECT id FROM _aitrade_e2e_ingestion_runs);

DELETE FROM product_cases
WHERE id IN (SELECT id FROM _aitrade_e2e_cases);

