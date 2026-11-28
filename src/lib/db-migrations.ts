import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type MigrationRunResult = {
  applied: string[];
  skipped: string[];
};

const DEFAULT_MIGRATIONS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "db", "migrations");
const MIGRATION_FILE_PATTERN = /^(\d+)_.+\.sql$/;

type AppliedMigration = {
  version: string;
  name: string;
  checksum: string;
};

type MigrationFile = {
  version: string;
  name: string;
  sql: string;
  checksum: string;
};

export class MigrationIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationIntegrityError";
  }
}

function checksumSql(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  const files = readdirSync(/* turbopackIgnore: true */ migrationsDir)
    .filter((file) => MIGRATION_FILE_PATTERN.test(file))
    .sort((a, b) => a.localeCompare(b));
  const seenVersions = new Map<string, string>();

  return files.map((file) => {
    const version = MIGRATION_FILE_PATTERN.exec(file)?.[1];
    if (!version) throw new MigrationIntegrityError(`迁移文件名不合法：${file}`);
    const duplicate = seenVersions.get(version);
    if (duplicate) {
      throw new MigrationIntegrityError(`迁移版本 ${version} 重复：${duplicate}、${file}`);
    }
    seenVersions.set(version, file);
    const sql = readFileSync(
      path.join(/* turbopackIgnore: true */ migrationsDir, file),
      "utf8",
    );
    return { version, name: file, sql, checksum: checksumSql(sql) };
  });
}

function verifyAppliedMigrations(
  appliedRows: AppliedMigration[],
  files: MigrationFile[],
): Set<string> {
  const filesByVersion = new Map(files.map((file) => [file.version, file]));
  const appliedVersions = new Set<string>();

  for (const row of appliedRows) {
    const file = filesByVersion.get(row.version);
    if (!file) {
      throw new MigrationIntegrityError(
        `数据库记录了迁移 ${row.version}（${row.name}），但对应的迁移文件已缺失`,
      );
    }
    if (file.checksum !== row.checksum) {
      throw new MigrationIntegrityError(
        `迁移 ${file.name} 的内容已变更（数据库校验和 ${row.checksum.slice(0, 12)}，当前校验和 ${file.checksum.slice(0, 12)}）。已应用的迁移必须保持不可变，请新增迁移修正。`,
      );
    }
    appliedVersions.add(row.version);
  }

  return appliedVersions;
}

/**
 * 执行带版本号的 SQL 迁移，并在 `schema_migrations` 表中记录已应用的版本与校验和。
 * - 文件命名规范：`NNN_description.sql`（按字典序升序执行）
 * - 已记录版本自动跳过，支持空库初始化与老库幂等升级
 * - 每个迁移的 SQL 与版本记录在同一事务中提交，失败时整体回滚
 * - 已应用迁移必须保持内容不变；校验和不一致或文件缺失会拒绝启动
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

  const appliedRes = await db.query<AppliedMigration>(
    `SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC`,
  );
  const files = readMigrationFiles(migrationsDir);
  const appliedSet = verifyAppliedMigrations(appliedRes.rows, files);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file.version)) {
      skipped.push(file.name);
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(file.sql);
      await tx.query(
        `INSERT INTO schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [file.version, file.name, file.checksum],
      );
    });
    applied.push(file.name);
  }

  return { applied, skipped };
}
