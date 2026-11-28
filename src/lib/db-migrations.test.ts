import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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

  it("rejects an applied migration whose contents changed", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "aitrade-mig-checksum-"));
    const migrationPath = path.join(tmpDir, "001_init.sql");
    const db = new PGlite();
    await db.waitReady;
    try {
      writeFileSync(migrationPath, `CREATE TABLE checksum_probe (id TEXT PRIMARY KEY);`, "utf8");
      await runMigrations(db, tmpDir);
      writeFileSync(
        migrationPath,
        `CREATE TABLE checksum_probe (id TEXT PRIMARY KEY, note TEXT);`,
        "utf8",
      );

      await assert.rejects(
        () => runMigrations(db, tmpDir),
        /内容已变更.*已应用的迁移必须保持不可变/,
      );
    } finally {
      await db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects an applied migration whose file is missing", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "aitrade-mig-missing-"));
    const migrationPath = path.join(tmpDir, "001_init.sql");
    const db = new PGlite();
    await db.waitReady;
    try {
      writeFileSync(migrationPath, `CREATE TABLE missing_file_probe (id TEXT PRIMARY KEY);`, "utf8");
      await runMigrations(db, tmpDir);
      unlinkSync(migrationPath);

      await assert.rejects(
        () => runMigrations(db, tmpDir),
        /对应的迁移文件已缺失/,
      );
    } finally {
      await db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rolls back both migration SQL and its version record when a migration fails", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "aitrade-mig-rollback-"));
    const db = new PGlite();
    await db.waitReady;
    try {
      writeFileSync(path.join(tmpDir, "001_init.sql"), `CREATE TABLE rollback_base (id TEXT);`, "utf8");
      await runMigrations(db, tmpDir);
      writeFileSync(
        path.join(tmpDir, "002_fails.sql"),
        `CREATE TABLE rollback_probe (id TEXT); SELECT * FROM table_that_does_not_exist;`,
        "utf8",
      );

      await assert.rejects(() => runMigrations(db, tmpDir));

      const probe = await db.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'rollback_probe'`,
      );
      assert.equal(probe.rows.length, 0, "失败迁移创建的表必须回滚");
      const versions = await db.query<{ version: string }>(
        `SELECT version FROM schema_migrations ORDER BY version`,
      );
      assert.deepEqual(versions.rows.map((row) => row.version), ["001"]);
    } finally {
      await db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate migration version prefixes", async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "aitrade-mig-duplicate-"));
    const db = new PGlite();
    await db.waitReady;
    try {
      writeFileSync(path.join(tmpDir, "001_first.sql"), `SELECT 1;`, "utf8");
      writeFileSync(path.join(tmpDir, "001_second.sql"), `SELECT 2;`, "utf8");

      await assert.rejects(
        () => runMigrations(db, tmpDir),
        /迁移版本 001 重复/,
      );
    } finally {
      await db.close();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
