import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-connector-settings-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_SETTINGS_ENCRYPTION_KEY = "test-only-connector-settings-key";
delete process.env.KEEPA_API_KEY;

const { getDb } = await import("./db.ts");
const {
  clearConnectorSettings,
  getConnectorSettingsStatus,
  loadConnectorEnv,
  saveConnectorSettings,
} = await import("./connector-settings.ts");
const { getConnectorReadiness } = await import("./connectors/registry.ts");
const { sanitizeConnectorError } = await import("./connectors/security.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  // 沙箱可能禁止删除 PGlite 的临时文件；清理失败不影响测试结论
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("界面配置覆盖环境变量，readiness 与状态只暴露来源不暴露值", async () => {
  const secret = "keepa-secret-value-9876";
  const saved = await saveConnectorSettings("keepa", { KEEPA_API_KEY: secret }, "测试管理员");
  assert.equal(saved, 1);

  const env = await loadConnectorEnv();
  assert.equal(env.KEEPA_API_KEY, secret);
  const readiness = getConnectorReadiness(env).find((item) => item.code === "keepa");
  assert.equal(readiness?.configured, true);

  const statuses = await getConnectorSettingsStatus();
  const keepa = statuses.get("keepa");
  assert.equal(keepa?.fields[0]?.source, "ui");
  assert.equal(keepa?.hasUiSettings, true);
  assert.equal(JSON.stringify(keepa).includes(secret), false);
});

test("保存的值加密落库，审计日志只记录字段名", async () => {
  const db = await getDb();
  const settings = await db.query<{ key: string; value: string }>(
    "SELECT key, value FROM app_settings WHERE key = $1",
    ["connector.keepa.KEEPA_API_KEY"],
  );
  assert.equal(settings.rows.length, 1);
  assert.equal(settings.rows[0]?.value.includes("keepa-secret-value-9876"), false);
  assert.equal(settings.rows[0]?.value.startsWith("v1:"), true);

  const logs = await db.query<{ details: unknown }>(
    "SELECT details FROM audit_logs WHERE action = 'connector.settings_saved'",
  );
  assert.ok(logs.rows.length >= 1);
  assert.equal(JSON.stringify(logs.rows).includes("keepa-secret-value-9876"), false);
});

test("界面凭证同样进入错误信息脱敏列表", async () => {
  await loadConnectorEnv();
  const message = sanitizeConnectorError(new Error("请求失败 keepa-secret-value-9876"));
  assert.equal(message.includes("keepa-secret-value-9876"), false);
  assert.ok(message.includes("[REDACTED]"));
});

test("清除界面配置后回到未配置状态", async () => {
  const removed = await clearConnectorSettings("keepa", "测试管理员");
  assert.equal(removed, 1);
  const env = await loadConnectorEnv();
  assert.equal(env.KEEPA_API_KEY, undefined);
  const status = await getConnectorSettingsStatus();
  assert.equal(status.get("keepa")?.fields[0]?.source, "none");
  await assert.rejects(() => clearConnectorSettings("keepa", "测试管理员"), /没有界面保存的配置/);
});

test("未知连接器与空表单被拒绝", async () => {
  await assert.rejects(() => saveConnectorSettings("unknown", { A: "b" }, "测试"), /未知的连接器/);
  await assert.rejects(() => saveConnectorSettings("ebay", { EBAY_CLIENT_ID: "  " }, "测试"), /没有填写新值/);
});
