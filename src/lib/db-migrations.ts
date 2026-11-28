import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type MigrationRunResult = {
  applied: string[];
  skipped: string[];
};

const DEFAULT_MIGRATIONS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "db", "migrations");

/**
 * 执行带版本号的 SQL 迁移，并在 `schema_migrations` 表中记录已应用的版本与校验和。
 * - 文件命名规范：`NNN_description.sql`（按字典序升序执行）
 * - 已记录版本自动跳过，支持空库初始化与老库幂等升级
 */
export async function runMigrations(
  db: PGlite,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationRunResult> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRes = await db.query<{ version: string }>(
    `SELECT version FROM schema_migrations ORDER BY version ASC`,
  );
  const appliedSet = new Set(appliedRes.rows.map((row) => row.version));

  const files = readdirSync(/* turbopackIgnore: true */ migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort((a, b) => a.localeCompare(b));

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const version = file.split("_")[0]!;
    if (appliedSet.has(version)) {
      skipped.push(file);
      continue;
    }

    const fullPath = path.join(/* turbopackIgnore: true */ migrationsDir, file);
    const sql = readFileSync(fullPath, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    await db.exec(sql);
    await db.query(
      `INSERT INTO schema_migrations (version, name, checksum)
       VALUES ($1, $2, $3)
       ON CONFLICT (version) DO NOTHING`,
      [version, file, checksum],
    );
    applied.push(file);
  }

  return { applied, skipped };
}
