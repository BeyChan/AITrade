import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-connection-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getDb } = await import("./db.ts");
const { checkConnectorConnection, getLatestConnectorHealthChecks } = await import("./connection-diagnostics.ts");
const { ConnectorNotConfiguredError } = await import("./connectors/types.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("connection checks persist guarded health records and credential-free audit logs", async () => {
  const db = await getDb();

  const table = await db.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'connector_health_checks'
     ) AS exists`,
  );
  assert.equal(table.rows[0]?.exists, true);

  await assert.rejects(
    checkConnectorConnection("shopify", "测试管理员", {
      SHOPIFY_ACCESS_TOKEN: "shpat_should_not_be_persisted",
    }),
    (error: unknown) => error instanceof ConnectorNotConfiguredError,
  );

  const healthAfterMissingCredentials = await db.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM connector_health_checks",
  );
  assert.equal(healthAfterMissingCredentials.rows[0]?.count, "0");

  const result = await checkConnectorConnection("tiktok_shop", "测试管理员", {
    TIKTOK_SHOP_APP_KEY: "app-key-not-configured",
    TIKTOK_SHOP_APP_SECRET: "secret_should_not_be_persisted",
  });
  assert.equal(result.status, "unsupported");
  assert.equal(result.externalActions, "none");
  assert.equal(result.details.externalRequestAttempted, false);

  const health = await getLatestConnectorHealthChecks();
  assert.equal(health.length, 1);
  assert.equal(health[0]?.source_code, "tiktok_shop");
  assert.equal(health[0]?.status, "unsupported");
  assert.equal(health[0]?.verification_level, "unsupported");
  assert.equal(health[0]?.checked_by, "测试管理员");

  const audit = await db.query<{ details: Record<string, unknown>; entity_id: string }>(
    `SELECT details, entity_id FROM audit_logs
     WHERE action = 'connector.health_checked'
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  assert.equal(audit.rows[0]?.entity_id, "tiktok_shop");
  assert.equal(audit.rows[0]?.details.status, "unsupported");
  assert.equal(audit.rows[0]?.details.externalActions, "none");
  assert.equal(audit.rows[0]?.details.credentialsExposed, false);

  const persisted = JSON.stringify({ health, audit: audit.rows });
  assert.equal(persisted.includes("secret_should_not_be_persisted"), false);
  assert.equal(persisted.includes("shpat_should_not_be_persisted"), false);
});
