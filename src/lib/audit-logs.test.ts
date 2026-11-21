import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  describeAuditAction,
  exportAuditLogsCsv,
  queryAuditLogs,
  recordAuditLog,
  sanitizeAuditDetails,
} from "./audit-logs.ts";

async function createTestDb() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  return db;
}

test("sanitizeAuditDetails masks nested sensitive keys", () => {
  const safe = sanitizeAuditDetails({
    provider: "openai-compatible",
    apiKey: "sk-1234567890",
    nested: {
      access_token: "tok_secret",
      normalField: "keep-me",
    },
    items: [{ password: "p1", label: "ok" }],
  });

  assert.equal(safe.provider, "openai-compatible");
  assert.equal(safe.apiKey, "***");
  assert.deepEqual(safe.nested, { access_token: "***", normalField: "keep-me" });
  assert.deepEqual(safe.items, [{ password: "***", label: "ok" }]);
});

test("recordAuditLog and queryAuditLogs support filtering, pagination, and summary", async () => {
  const db = await createTestDb();
  try {
    await recordAuditLog(
      {
        actor: "运营A",
        action: "case.created_from_wizard",
        entityType: "product_case",
        entityId: "case-001",
        details: { asin: "B0TEST001", marketplace: "US" },
      },
      db,
    );
    await recordAuditLog(
      {
        actor: "管理员",
        action: "ai.settings_saved",
        entityType: "app_settings",
        entityId: "ai",
        details: { provider: "deepseek", apiKey: "sk-top-secret" },
      },
      db,
    );
    await recordAuditLog(
      {
        actor: "系统",
        action: "connector_sync.failed",
        entityType: "connector_sync_job",
        entityId: "job-99",
        details: { error: "timeout" },
      },
      db,
    );

    const all = await queryAuditLogs({}, db);
    assert.equal(all.total, 3);
    assert.equal(all.summary.total, 3);
    assert.equal(all.summary.sensitiveCount, 1);
    assert.equal(all.summary.errorCount, 1);
    assert.equal(all.summary.actorCount, 3);

    const settingsOnly = await queryAuditLogs({ module: "settings" }, db);
    assert.equal(settingsOnly.total, 1);
    assert.equal(settingsOnly.items[0].details.apiKey, "***");
    assert.equal(settingsOnly.items[0].actionLabel, "保存大模型连接配置");

    const byKeyword = await queryAuditLogs({ q: "B0TEST001" }, db);
    assert.equal(byKeyword.total, 1);
    assert.equal(byKeyword.items[0].entityHref, "/cases/case-001");

    const dangerOnly = await queryAuditLogs({ level: "danger" }, db);
    assert.equal(dangerOnly.total, 1);
    assert.equal(dangerOnly.items[0].action, "connector_sync.failed");

    const paged = await queryAuditLogs({ page: 2, pageSize: 2 }, db);
    assert.equal(paged.items.length, 1);
    assert.equal(paged.totalPages, 2);
  } finally {
    await db.close();
  }
});

test("exportAuditLogsCsv emits UTF-8 BOM and escapes commas and quotes", async () => {
  const db = await createTestDb();
  try {
    await recordAuditLog(
      {
        actor: "采购B",
        action: "supplier.selected",
        entityType: "product_case",
        entityId: "case-csv",
        details: { supplierName: '义乌"旗舰",工厂' },
      },
      db,
    );

    const csv = await exportAuditLogsCsv({ module: "sourcing" }, db);
    assert.ok(csv.startsWith("\uFEFF时间,操作人,模块,级别,动作名称"));
    assert.ok(csv.includes("采购B"));
    assert.ok(csv.includes("定标选中供应商"));
    assert.ok(csv.includes("case-csv"));
  } finally {
    await db.close();
  }
});

test("describeAuditAction infers fallback level and module for unknown actions", () => {
  const err = describeAuditAction("custom.task_failed", "unknown_entity");
  assert.equal(err.level, "danger");
  assert.equal(err.module, "system");

  const ok = describeAuditAction("case.custom_created", "product_case");
  assert.equal(ok.level, "success");
  assert.equal(ok.module, "case");

  const profileDel = describeAuditAction("model_profile.deleted", "model_profile");
  assert.equal(profileDel.label, "删除模型配置档案");
  assert.equal(profileDel.level, "danger");
  assert.equal(profileDel.module, "settings");

  const videoGen = describeAuditAction("video_studio.job_submitted", "studio_video");
  assert.equal(videoGen.label, "视频工坊提交生成任务");
  assert.equal(videoGen.module, "ai");
});
