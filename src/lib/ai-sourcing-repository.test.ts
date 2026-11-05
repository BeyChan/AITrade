import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ai-sourcing-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_PROVIDER = "template";

const { getDb } = await import("./db.ts");
const {
  createAISourcingBatch,
  deleteAISourcingBatch,
  getAISourcingBatch,
  listAISourcingBatches,
} = await import("./ai-sourcing-repository.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("deleting a research batch cascades research data but preserves promoted product cases", async () => {
  const db = await getDb();
  const created = await createAISourcingBatch({
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物清洁",
    brief: "验证可拆洗宠物梳子的真实需求与供应商报价",
    actor: "测试运营",
  });
  const batch = await getAISourcingBatch(created.runId);
  assert.ok(batch);
  assert.equal(batch.hypotheses.length, 5);
  assert.equal((await listAISourcingBatches()).length, 1);

  const hypothesisId = batch.hypotheses[0]?.id;
  assert.ok(hypothesisId);
  const caseId = randomUUID();
  const taskId = randomUUID();
  const evidenceId = randomUUID();

  await db.query(
    `INSERT INTO product_cases
      (id, asin, marketplace, category, title, competitor_price_cents, owner, evidence_score, is_demo)
     VALUES ($1, 'B0DELETEBATCH', 'US', '宠物清洁', '保留的已立项商品', 2999, '测试运营', 80, FALSE)`,
    [caseId],
  );
  await db.query(
    "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
    [caseId, hypothesisId],
  );
  await db.query(
    `INSERT INTO opportunity_evidence
      (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, created_by)
     VALUES ($1, $2, 'competitor_snapshot', 'manual_verified', 'https://example.com/evidence',
             '测试证据', '删除批次时应级联删除', NOW(), '测试运营')`,
    [evidenceId, hypothesisId],
  );
  await db.query(
    `INSERT INTO ai_tasks
      (id, task_type, status, source_kind, target_hypothesis_id, request_hash, requested_by)
     VALUES ($1, 'evidence_extraction', 'queued', 'paste', $2, $3, '测试运营')`,
    [taskId, hypothesisId, randomUUID()],
  );

  const deleted = await deleteAISourcingBatch(created.runId, "测试运营");
  assert.equal(deleted.deletedHypothesisCount, 5);
  assert.equal(deleted.preservedProductCaseCount, 1);
  assert.equal(await getAISourcingBatch(created.runId), null);
  assert.equal((await listAISourcingBatches()).length, 0);

  const retained = await db.query<{
    briefs: string;
    runs: string;
    hypotheses: string;
    evidence: string;
    tasks: string;
    product_cases: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM sourcing_briefs WHERE id = $1)::text AS briefs,
       (SELECT COUNT(*) FROM ai_sourcing_runs WHERE id = $2)::text AS runs,
       (SELECT COUNT(*) FROM opportunity_hypotheses WHERE id = $3)::text AS hypotheses,
       (SELECT COUNT(*) FROM opportunity_evidence WHERE id = $4)::text AS evidence,
       (SELECT COUNT(*) FROM ai_tasks WHERE id = $5 AND target_hypothesis_id IS NULL)::text AS tasks,
       (SELECT COUNT(*) FROM product_cases WHERE id = $6)::text AS product_cases`,
    [created.briefId, created.runId, hypothesisId, evidenceId, taskId, caseId],
  );
  assert.deepEqual(retained.rows[0], {
    briefs: "0",
    runs: "0",
    hypotheses: "0",
    evidence: "0",
    tasks: "1",
    product_cases: "1",
  });

  const audit = await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_logs
     WHERE action = 'ai_sourcing.batch_deleted' AND entity_id = $1`,
    [created.runId],
  );
  assert.equal(audit.rows[0]?.details.preservedProductCaseCount, 1);
  assert.equal(audit.rows[0]?.details.productCasesPreserved, true);

  await assert.rejects(
    () => deleteAISourcingBatch(created.runId, "测试运营"),
    /研究批次不存在或已被删除/,
  );
});

test("the same research request key reuses one batch", async () => {
  const db = await getDb();
  const requestKey = randomUUID();
  const input = {
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物出行",
    brief: "验证可折叠宠物饮水杯的真实需求与供应商报价",
    actor: "测试运营",
    requestKey,
  };

  const first = await createAISourcingBatch(input);
  const second = await createAISourcingBatch({ ...input, category: "重复提交不应创建新批次" });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.runId, first.runId);
  assert.equal(second.briefId, first.briefId);
  assert.equal((await getAISourcingBatch(first.runId))?.hypotheses.length, 5);
  assert.equal((await listAISourcingBatches()).length, 1);

  const counts = await db.query<{ briefs: string; runs: string; audits: string }>(
    `SELECT
       (SELECT COUNT(*) FROM sourcing_briefs WHERE id = $1)::text AS briefs,
       (SELECT COUNT(*) FROM ai_sourcing_runs WHERE request_key = $2)::text AS runs,
       (SELECT COUNT(*) FROM audit_logs
        WHERE action = 'ai_sourcing.batch_created' AND entity_id = $3)::text AS audits`,
    [first.briefId, requestKey, first.runId],
  );
  assert.deepEqual(counts.rows[0], { briefs: "1", runs: "1", audits: "1" });
});
