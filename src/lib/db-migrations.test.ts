import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { runMigrations } from "./db-migrations.ts";

describe("versioned database migrations", () => {
  it("applies baseline + runtime-ddl migrations on fresh DB and stays idempotent on rerun", async () => {
    const db = new PGlite();
    await db.waitReady;
    try {
      const first = await runMigrations(db);
      assert.ok(first.applied.includes("001_baseline.sql"));
      assert.ok(first.applied.includes("002_consolidate_runtime_ddl.sql"));
      assert.equal(first.skipped.length, 0);

      // Verify consolidated tables & columns exist
      const tables = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN (
             'schema_migrations',
             'competitor_sourcing_targets',
             'channel_sku_mappings',
             'model_provider_profiles',
             'video_generation_jobs',
             'sourcing_sample_logs'
           )
         ORDER BY table_name`,
      );
      assert.equal(tables.rows.length, 6);

      // Verify consolidated columns exist
      const supplierProfileCol = await db.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'suppliers' AND column_name = 'profile'`,
      );
      assert.equal(supplierProfileCol.rows.length, 1);

      // Re-run should skip all already-applied migrations
      const second = await runMigrations(db);
      assert.equal(second.applied.length, 0);
      assert.equal(second.skipped.length, first.applied.length);
    } finally {
      await db.close();
    }
  });

  it("applies only newly added migrations in order", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "aitrade-mig-"));
    const db = new PGlite();
    await db.waitReady;
    try {
      writeFileSync(
        path.join(tmpDir, "001_init.sql"),
        `CREATE TABLE demo_mig (id TEXT PRIMARY KEY);`,
        "utf8",
      );
      const r1 = await runMigrations(db, tmpDir);
      assert.deepEqual(r1.applied, ["001_init.sql"]);

      writeFileSync(
        path.join(tmpDir, "002_add_col.sql"),
        `ALTER TABLE demo_mig ADD COLUMN note TEXT NOT NULL DEFAULT '';`,
        "utf8",
      );
      const r2 = await runMigrations(db, tmpDir);
      assert.deepEqual(r2.applied, ["002_add_col.sql"]);
      assert.deepEqual(r2.skipped, ["001_init.sql"]);
    } finally {
      await db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
