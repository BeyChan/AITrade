import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ai-inbox-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getDb } = await import("../db.ts");
const { applyAiInboxTask } = await import("./apply.ts");
const { createAiInboxTask, inferSourceKind } = await import("./repository.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

type Target = {
  hypothesisId: string;
  concept: string;
};

type TestField = {
  name: string;
  rawValue: string;
  normalizedValue: string | number | boolean | null;
  excerpt: string;
  status?: "extracted" | "auto_accepted" | "needs_review" | "accepted" | "rejected" | "missing";
  confidence?: number;
};

async function createTarget(suffix: string): Promise<Target> {
  const db = await getDb();
  const briefId = randomUUID();
  const runId = randomUUID();
  const hypothesisId = randomUUID();
  const concept = `AI 证据测试机会 ${suffix}`;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO sourcing_briefs
        (id, market_code, platform_code, category, brief, currency, created_by)
       VALUES ($1, 'US', 'amazon', '宠物用品', $2, 'USD', '测试用户')`,
      [briefId, `验证 ${concept}`],
    );
    await tx.query(
      `INSERT INTO ai_sourcing_runs
        (id, brief_id, provider, model, status, response_summary, completed_at)
       VALUES ($1, $2, 'template', 'deterministic-v1', 'completed', '{}'::jsonb, NOW())`,
      [runId, briefId],
    );
    await tx.query(
      `INSERT INTO opportunity_hypotheses
        (id, run_id, position, concept, target_user, pain_point, differentiator,
         recommended_price_cents, expected_margin_rate, first_order_budget_cents,
         main_risks, supplier_keywords, competitor_queries, review_queries,
         priority_score, selected_for_validation, product_case_id)
       VALUES ($1, $2, 1, $3, '养宠家庭', '清洗不便', '可拆洗结构',
               3999, 0.2500, 300000, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
               78, TRUE, NULL)`,
      [hypothesisId, runId, concept],
    );
  });

  return { hypothesisId, concept };
}

function competitorFields(): TestField[] {
  return [
    { name: "title", rawValue: "Pet Water Fountain", normalizedValue: "Pet Water Fountain", excerpt: "Pet Water Fountain" },
    { name: "price", rawValue: "39.99", normalizedValue: 3999, excerpt: "Price: 39.99 USD" },
    { name: "currency", rawValue: "USD", normalizedValue: "USD", excerpt: "USD" },
    { name: "sourceUrl", rawValue: "https://example.com/item", normalizedValue: "https://example.com/item", excerpt: "https://example.com/item" },
    { name: "observedAt", rawValue: "2026-11-04T08:00:00Z", normalizedValue: "2026-11-04T08:00:00.000Z", excerpt: "2026-11-04T08:00:00Z" },
  ];
}

async function createReadyTask(target: Target, fields = competitorFields()) {
  const db = await getDb();
  const taskId = randomUUID();
  const artifactId = randomUUID();
  const content = fields.map((field) => field.excerpt).join("\n");
  const contentHash = createHash("sha256").update(`${taskId}\n${content}`).digest("hex");

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO ai_tasks
        (id, task_type, status, source_kind, target_hypothesis_id, request_hash,
         requested_by, provider, model, extraction_summary)
       VALUES ($1, 'evidence_extraction', 'ready', 'text', $2, $3,
               '测试用户', 'template', 'deterministic-v1', '{}'::jsonb)`,
      [taskId, target.hypothesisId, randomUUID()],
    );
    await tx.query(
      `INSERT INTO ai_task_artifacts
        (id, task_id, artifact_type, file_name, mime_type, content_text, content_hash, metadata)
       VALUES ($1, $2, 'paste', NULL, 'text/plain', $3, $4, '{"sourceKind":"text"}'::jsonb)`,
      [artifactId, taskId, content, contentHash],
    );

    for (const [position, field] of fields.entries()) {
      const fieldId = randomUUID();
      await tx.query(
        `INSERT INTO ai_extracted_fields
          (id, task_id, document_type, field_name, field_label, raw_value, normalized_value,
           confidence, status, risk_level, validation_message, position)
         VALUES ($1, $2, 'competitor', $3, $3, $4, $5::jsonb, $6, $7, 'normal', '测试字段', $8)`,
        [
          fieldId,
          taskId,
          field.name,
          field.rawValue,
          JSON.stringify(field.normalizedValue),
          field.confidence ?? 0.99,
          field.status ?? "auto_accepted",
          position,
        ],
      );
      await tx.query(
        `INSERT INTO ai_field_sources
          (id, field_id, artifact_id, source_type, excerpt, locator)
         VALUES ($1, $2, $3, 'artifact', $4, $5::jsonb)`,
        [
          randomUUID(),
          fieldId,
          artifactId,
          field.excerpt,
          JSON.stringify({ matched: true, start: 0, end: field.excerpt.length }),
        ],
      );
    }
  });

  return taskId;
}

test("应用证据会事务写入业务事实、重算确定性门禁并保持幂等", async () => {
  const db = await getDb();
  const target = await createTarget("成功写入");
  const taskId = await createReadyTask(target);

  const applied = await applyAiInboxTask({ taskId, actor: "测试审核员" });
  assert.equal(applied.task.status, "applied");
  assert.equal(applied.task.appliedEntityType, "competitor_snapshot");
  assert.ok(applied.task.appliedEntityId);

  const snapshots = await db.query<{ price_cents: number; title: string; observed_at: string }>(
    "SELECT price_cents, title, observed_at FROM competitor_snapshots WHERE hypothesis_id = $1",
    [target.hypothesisId],
  );
  assert.equal(snapshots.rows.length, 1);
  assert.equal(snapshots.rows[0]?.price_cents, 3999);
  assert.equal(snapshots.rows[0]?.title, "Pet Water Fountain");

  const decision = await db.query<{ decision: string }>(
    "SELECT decision FROM selection_decisions WHERE hypothesis_id = $1",
    [target.hypothesisId],
  );
  assert.equal(decision.rows.length, 1);
  assert.ok(["GO", "HOLD", "NO-GO"].includes(decision.rows[0]?.decision ?? ""));

  const audit = await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_logs
     WHERE entity_type = 'ai_task' AND entity_id = $1 AND action = 'ai_inbox.task_applied'`,
    [taskId],
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0]?.details.externalActions, "none");

  const repeated = await applyAiInboxTask({ taskId, actor: "测试审核员" });
  assert.equal(repeated.task.status, "applied");
  const counts = await db.query<{ snapshots: string; apply_actions: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM competitor_snapshots WHERE hypothesis_id = $1) AS snapshots,
       (SELECT COUNT(*)::text FROM ai_review_actions WHERE task_id = $2 AND action = 'apply') AS apply_actions`,
    [target.hypothesisId, taskId],
  );
  assert.equal(counts.rows[0]?.snapshots, "1");
  assert.equal(counts.rows[0]?.apply_actions, "1");
});

test("业务写入失败会回滚整个事务，修复后可重新应用", async () => {
  const db = await getDb();
  const target = await createTarget("回滚");
  const taskId = await createReadyTask(target);

  await db.exec(
    "ALTER TABLE competitor_snapshots ADD CONSTRAINT ai_inbox_test_forced_failure CHECK (false) NOT VALID",
  );
  try {
    await assert.rejects(
      applyAiInboxTask({ taskId, actor: "测试审核员" }),
      /ai_inbox_test_forced_failure|check constraint/i,
    );
  } finally {
    await db.exec("ALTER TABLE competitor_snapshots DROP CONSTRAINT ai_inbox_test_forced_failure");
  }

  const afterFailure = await db.query<{ evidence_count: string; status: string; error_message: string | null }>(
    `SELECT
       (SELECT COUNT(*)::text FROM opportunity_evidence WHERE hypothesis_id = $1) AS evidence_count,
       t.status, t.error_message
     FROM ai_tasks t WHERE t.id = $2`,
    [target.hypothesisId, taskId],
  );
  assert.equal(afterFailure.rows[0]?.evidence_count, "0");
  assert.equal(afterFailure.rows[0]?.status, "ready");
  assert.ok(afterFailure.rows[0]?.error_message);

  const recovered = await applyAiInboxTask({ taskId, actor: "测试审核员" });
  assert.equal(recovered.task.status, "applied");
  const evidence = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM opportunity_evidence WHERE hypothesis_id = $1",
    [target.hypothesisId],
  );
  assert.equal(evidence.rows[0]?.count, "1");
});

test("相同目标与原文重复提交返回同一任务，artifact 不重复", async () => {
  const db = await getDb();
  const target = await createTarget("请求幂等");
  const input = {
    content: "标题：Pet Water Fountain\n价格：39.99 USD\n币种：USD\n来源：https://example.com/item\n观察时间：2026-11-04T08:00:00Z",
    sourceKind: "text" as const,
    targetHypothesisId: target.hypothesisId,
    requestedBy: "测试用户",
  };

  const first = await createAiInboxTask(input);
  const second = await createAiInboxTask(input);
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.task.id, second.task.id);
  assert.equal(first.artifact?.contentHash, second.artifact?.contentHash);

  const counts = await db.query<{ tasks: string; artifacts: string; audits: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM ai_tasks WHERE target_hypothesis_id = $1) AS tasks,
       (SELECT COUNT(*)::text FROM ai_task_artifacts WHERE task_id = $2) AS artifacts,
       (SELECT COUNT(*)::text FROM audit_logs
        WHERE action = 'ai_inbox.task_created' AND entity_id = $2) AS audits`,
    [target.hypothesisId, first.task.id],
  );
  assert.equal(counts.rows[0]?.tasks, "1");
  assert.equal(counts.rows[0]?.artifacts, "1");
  assert.equal(counts.rows[0]?.audits, "1");

  assert.throws(() => inferSourceKind("supplier-quote.pdf"), /不支持图片或 PDF/);
});
