import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-settings-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_SETTINGS_ENCRYPTION_KEY = "test-only-encryption-key";

const {
  clearStoredAIProviderKey,
  loadAIProviderConfig,
  saveAIProviderSettings,
} = await import("./app-settings.ts");
const { getDb } = await import("./db.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  delete process.env.AI_API_KEY;
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(`${dataDir}.ai-key`, { force: true }).catch(() => undefined);
});

test("AI settings default to the template provider without an external key", async () => {
  const config = await loadAIProviderConfig();
  assert.equal(config.provider, "template");
  assert.equal(config.apiKeySource, "none");
  assert.equal(config.apiKey, "");
});

test("page settings override environment values and encrypt the API key", async () => {
  process.env.AI_API_KEY = "env-key-that-must-not-leak";
  const environmentConfig = await loadAIProviderConfig();
  assert.equal(environmentConfig.apiKeySource, "environment");

  const secret = "sk-page-secret-123456";
  const saved = await saveAIProviderSettings({
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    model: "example-model",
    apiKey: secret,
    actor: "设置测试",
  });
  assert.equal(saved.provider, "openai-compatible");
  assert.equal(saved.keyAction, "updated");

  const config = await loadAIProviderConfig();
  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.baseUrl, "https://api.example.com/v1");
  assert.equal(config.model, "example-model");
  assert.equal(config.apiKey, secret);
  assert.equal(config.apiKeySource, "database");
  assert.equal(config.hasSavedSettings, true);
  assert.notEqual(config.apiKey, process.env.AI_API_KEY);

  const db = await getDb();
  const stored = await db.query<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'ai_api_key'",
  );
  const encrypted = stored.rows[0]?.value ?? "";
  assert.notEqual(encrypted, secret);
  assert.match(encrypted, /^v1:/);
  assert.equal(encrypted.includes(secret), false);

  const audit = await db.query<{ details: unknown }>(
    "SELECT details FROM audit_logs WHERE action = 'ai.settings_saved' ORDER BY created_at DESC LIMIT 1",
  );
  assert.equal(JSON.stringify(audit.rows[0]?.details).includes(secret), false);
  delete process.env.AI_API_KEY;
});

test("saving with a blank API key preserves the existing key, clearing it forces template fallback", async () => {
  const before = await loadAIProviderConfig();
  const secret = before.apiKey;

  await saveAIProviderSettings({
    provider: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    model: "example-model-v2",
    apiKey: "",
    actor: "设置测试",
  });
  const preserved = await loadAIProviderConfig();
  assert.equal(preserved.apiKey, secret);
  assert.equal(preserved.model, "example-model-v2");

  await clearStoredAIProviderKey("设置测试");
  const cleared = await loadAIProviderConfig();
  assert.equal(cleared.apiKey, "");
  assert.equal(cleared.apiKeySource, "none");
  assert.equal(cleared.provider, "openai-compatible");
});
