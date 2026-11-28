import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getAppMode, isDemoMode, type AppMode } from "@/lib/app-mode";
import { getDb } from "@/lib/db";

const BACKUP_TABLES = [
  "product_cases",
  "product_case_sites",
  "case_evidence",
  "cost_models",
  "suppliers",
  "rfqs",
  "quotes",
  "supplier_selections",
  "sourcing_sample_logs",
  "case_content_profiles",
  "listings",
  "assets",
  "competitor_comparison_reports",
  "studio_media_assets",
  "operations_settlement_batches",
  "operations_sku_snapshots",
  "app_settings",
  "model_provider_profiles",
  "connector_health_checks",
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

const TABLE_LABELS: Record<BackupTable, string> = {
  product_cases: "商品案卷",
  product_case_sites: "站点配置",
  case_evidence: "案卷证据",
  cost_models: "成本与利润模型",
  suppliers: "1688/工厂库",
  rfqs: "询价单",
  quotes: "工厂报价",
  supplier_selections: "定标记录",
  sourcing_sample_logs: "拿样日记",
  case_content_profiles: "文案配置",
  listings: "Listing 文案",
  assets: "案卷素材",
  competitor_comparison_reports: "竞品研报",
  studio_media_assets: "视觉工坊素材",
  operations_settlement_batches: "实盘结算批次",
  operations_sku_snapshots: "FBA 库存快照",
  app_settings: "运行配置",
  model_provider_profiles: "模型供应商档案",
  connector_health_checks: "连接健康检查",
};

const TOP_LEVEL_MODE_TABLES = new Set<BackupTable>([
  "product_cases",
  "suppliers",
  "competitor_comparison_reports",
  "studio_media_assets",
  "operations_settlement_batches",
  "app_settings",
  "model_provider_profiles",
  "connector_health_checks",
]);

const BACKUP_TABLE_QUERIES: Record<BackupTable, string> = {
  product_cases: `SELECT * FROM product_cases WHERE is_demo = $1`,
  product_case_sites: `SELECT pcs.* FROM product_case_sites pcs
    JOIN product_cases pc ON pc.id = pcs.case_id
    WHERE pc.is_demo = $1`,
  case_evidence: `SELECT ce.* FROM case_evidence ce
    JOIN product_cases pc ON pc.id = ce.case_id
    WHERE pc.is_demo = $1`,
  cost_models: `SELECT cm.* FROM cost_models cm
    JOIN product_cases pc ON pc.id = cm.case_id
    WHERE pc.is_demo = $1`,
  suppliers: `SELECT * FROM suppliers WHERE is_demo = $1`,
  rfqs: `SELECT r.* FROM rfqs r
    JOIN product_cases pc ON pc.id = r.case_id
    WHERE pc.is_demo = $1`,
  quotes: `SELECT q.* FROM quotes q
    JOIN rfqs r ON r.id = q.rfq_id
    JOIN product_cases pc ON pc.id = r.case_id
    WHERE pc.is_demo = $1`,
  supplier_selections: `SELECT ss.* FROM supplier_selections ss
    JOIN product_cases pc ON pc.id = ss.case_id
    WHERE pc.is_demo = $1`,
  sourcing_sample_logs: `SELECT ssl.* FROM sourcing_sample_logs ssl
    JOIN product_cases pc ON pc.id = ssl.case_id
    WHERE pc.is_demo = $1`,
  case_content_profiles: `SELECT ccp.* FROM case_content_profiles ccp
    JOIN product_cases pc ON pc.id = ccp.case_id
    WHERE pc.is_demo = $1`,
  listings: `SELECT l.* FROM listings l
    JOIN product_cases pc ON pc.id = l.case_id
    WHERE pc.is_demo = $1`,
  assets: `SELECT a.* FROM assets a
    JOIN product_cases pc ON pc.id = a.case_id
    WHERE pc.is_demo = $1`,
  competitor_comparison_reports: `SELECT * FROM competitor_comparison_reports WHERE is_demo = $1`,
  studio_media_assets: `SELECT sma.* FROM studio_media_assets sma
    LEFT JOIN product_cases pc ON pc.id = sma.case_id
    WHERE sma.is_demo = $1 AND (sma.case_id IS NULL OR pc.is_demo = $1)`,
  operations_settlement_batches: `SELECT * FROM operations_settlement_batches WHERE is_demo = $1`,
  operations_sku_snapshots: `SELECT oss.* FROM operations_sku_snapshots oss
    JOIN operations_settlement_batches osb ON osb.id = oss.batch_id
    LEFT JOIN product_cases pc ON pc.id = oss.case_id
    WHERE osb.is_demo = $1 AND (oss.case_id IS NULL OR pc.is_demo = $1)`,
  app_settings: `SELECT * FROM app_settings WHERE is_demo = $1`,
  model_provider_profiles: `SELECT * FROM model_provider_profiles WHERE is_demo = $1`,
  connector_health_checks: `SELECT * FROM connector_health_checks WHERE is_demo = $1`,
};

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|secret|token|password|encrypted)/i;
const BACKUP_SCHEMA_VERSION = 3;

const BACKUP_CONFLICT_CLAUSES: Partial<Record<BackupTable, string>> = {
  app_settings: `ON CONFLICT (key, is_demo) DO UPDATE SET
    value = EXCLUDED.value,
    updated_by = EXCLUDED.updated_by,
    updated_at = EXCLUDED.updated_at`,
  model_provider_profiles: `ON CONFLICT (id) DO UPDATE SET
    service_type = EXCLUDED.service_type,
    vendor = EXCLUDED.vendor,
    protocol = EXCLUDED.protocol,
    name = EXCLUDED.name,
    base_url = EXCLUDED.base_url,
    models_json = EXCLUDED.models_json,
    default_model = EXCLUDED.default_model,
    submit_endpoint = EXCLUDED.submit_endpoint,
    query_endpoint = EXCLUDED.query_endpoint,
    supports_multi_image = EXCLUDED.supports_multi_image,
    is_default = EXCLUDED.is_default,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at
  WHERE model_provider_profiles.is_demo = EXCLUDED.is_demo`,
  connector_health_checks: `ON CONFLICT (id) DO UPDATE SET
    source_code = EXCLUDED.source_code,
    status = EXCLUDED.status,
    verification_level = EXCLUDED.verification_level,
    message = EXCLUDED.message,
    duration_ms = EXCLUDED.duration_ms,
    details = EXCLUDED.details,
    checked_by = EXCLUDED.checked_by,
    checked_at = EXCLUDED.checked_at
  WHERE connector_health_checks.is_demo = EXCLUDED.is_demo`,
};

type BackupPayload = {
  schemaVersion: number;
  exportedMode: AppMode;
  exportedAt: string;
  exportedBy: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
};

function isAppMode(value: unknown): value is AppMode {
  return value === "sandbox" || value === "live";
}

function isSensitiveSettingRow(table: BackupTable, row: Record<string, unknown>): boolean {
  return table === "app_settings" && typeof row.key === "string" && SENSITIVE_KEY_PATTERN.test(row.key);
}

function sanitizeBackupRow(table: BackupTable, row: Record<string, unknown>): Record<string, unknown> | null {
  if (isSensitiveSettingRow(table, row)) return null;
  return Object.fromEntries(Object.entries(row).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key)));
}

async function collectBackupPayload(mode: AppMode): Promise<BackupPayload> {
  const db = await getDb();
  const demo = isDemoMode(mode);
  const tables: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};

  await Promise.all(
    BACKUP_TABLES.map(async (table) => {
      const res = await db
        .query<Record<string, unknown>>(BACKUP_TABLE_QUERIES[table], [demo])
        .catch(() => ({ rows: [] }));
      tables[table] = res.rows
        .map((row) => sanitizeBackupRow(table, row))
        .filter((row): row is Record<string, unknown> => row !== null);
    }),
  );

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedMode: mode,
    exportedAt: new Date().toISOString(),
    exportedBy: "本机工作台",
    tables,
  };
}

function inspectPayload(payload: Partial<BackupPayload>, currentMode: AppMode) {
  const previewCounts: Array<{ table: BackupTable; label: string; count: number }> = [];
  let totalRows = 0;
  let sensitiveFieldCount = 0;
  let crossModeRowCount = 0;
  const exportedMode = isAppMode(payload.exportedMode) ? payload.exportedMode : null;
  const expectedDemo = isDemoMode(exportedMode ?? currentMode);

  for (const table of BACKUP_TABLES) {
    const rows = payload.tables?.[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    let validRows = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      validRows += 1;
      if (TOP_LEVEL_MODE_TABLES.has(table) && row.is_demo !== expectedDemo) {
        crossModeRowCount += 1;
      }
      for (const key of Object.keys(row)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          sensitiveFieldCount += 1;
        }
      }
    }
    if (validRows > 0) {
      previewCounts.push({ table, label: TABLE_LABELS[table], count: validRows });
      totalRows += validRows;
    }
  }

  return {
    schemaVersion: typeof payload.schemaVersion === "number" ? payload.schemaVersion : BACKUP_SCHEMA_VERSION,
    exportedMode,
    currentMode,
    modeMatches: exportedMode === currentMode,
    crossModeRowCount,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    totalRows,
    previewCounts,
    containsSensitiveKeys: sensitiveFieldCount > 0,
  };
}

async function writePreRestoreSnapshot(mode: AppMode): Promise<string | null> {
  try {
    const snapshot = await collectBackupPayload(mode);
    const backupsDir = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data", "backups");
    await fs.mkdir(backupsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `pre-restore-${stamp}.json`;
    const filePath = path.join(backupsDir, filename);
    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
    return `.data/backups/${filename}`;
  } catch {
    return null;
  }
}

async function restoreRowBelongsToMode(
  db: Awaited<ReturnType<typeof getDb>>,
  table: BackupTable,
  row: Record<string, unknown>,
  demo: boolean,
): Promise<boolean> {
  const caseId = typeof row.case_id === "string" ? row.case_id : null;
  if (caseId) {
    const caseRes = await db.query<{ id: string }>(
      `SELECT id FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [caseId, demo],
    );
    if (!caseRes.rows[0]) return false;
  }

  if (table === "rfqs" && typeof row.supplier_id === "string" && row.supplier_id) {
    const supplierRes = await db.query<{ id: string }>(
      `SELECT id FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [row.supplier_id, demo],
    );
    if (!supplierRes.rows[0]) return false;
  }

  if (table === "quotes" && typeof row.rfq_id === "string") {
    const rfqRes = await db.query<{ id: string }>(
      `SELECT r.id FROM rfqs r
       JOIN product_cases pc ON pc.id = r.case_id
       WHERE r.id = $1 AND pc.is_demo = $2 LIMIT 1`,
      [row.rfq_id, demo],
    );
    if (!rfqRes.rows[0]) return false;
  }

  if (table === "supplier_selections") {
    if (typeof row.supplier_id === "string") {
      const supplierRes = await db.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`,
        [row.supplier_id, demo],
      );
      if (!supplierRes.rows[0]) return false;
    }
    if (typeof row.cost_model_id === "string" && caseId) {
      const costRes = await db.query<{ id: string }>(
        `SELECT id FROM cost_models WHERE id = $1 AND case_id = $2 LIMIT 1`,
        [row.cost_model_id, caseId],
      );
      if (!costRes.rows[0]) return false;
    }
    if (typeof row.quote_id === "string" && caseId) {
      const quoteRes = await db.query<{ id: string }>(
        `SELECT q.id FROM quotes q
         JOIN rfqs r ON r.id = q.rfq_id
         WHERE q.id = $1 AND r.case_id = $2 LIMIT 1`,
        [row.quote_id, caseId],
      );
      if (!quoteRes.rows[0]) return false;
    }
  }

  if (table === "assets" && typeof row.parent_asset_id === "string" && row.parent_asset_id) {
    const parentRes = await db.query<{ id: string }>(
      `SELECT a.id FROM assets a
       JOIN product_cases pc ON pc.id = a.case_id
       WHERE a.id = $1 AND pc.is_demo = $2 LIMIT 1`,
      [row.parent_asset_id, demo],
    );
    if (!parentRes.rows[0]) return false;
  }

  if (table === "operations_sku_snapshots" && typeof row.batch_id === "string") {
    const batchRes = await db.query<{ id: string }>(
      `SELECT id FROM operations_settlement_batches WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [row.batch_id, demo],
    );
    if (!batchRes.rows[0]) return false;
  }

  return true;
}

export async function GET() {
  try {
    const mode = await getAppMode();
    const payload = await collectBackupPayload(mode);
    const totalRows = Object.values(payload.tables).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "backup.exported",
      entityType: "workspace_backup",
      entityId: "workspace",
      details: { totalRows, schemaVersion: payload.schemaVersion, mode },
    }).catch(() => {});
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="aitrade-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "导出整库备份失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const mode = await getAppMode();
    const url = new URL(request.url);
    const isDryRun = url.searchParams.get("dryRun") === "true" || url.searchParams.get("dryRun") === "1";

    const payload = (await request.json()) as Partial<BackupPayload>;
    if (!payload || typeof payload !== "object" || !payload.tables || typeof payload.tables !== "object") {
      return NextResponse.json({ error: "备份文件格式无效，缺少 tables 字段" }, { status: 400 });
    }

    const summary = inspectPayload(payload, mode);
    if (!summary.exportedMode) {
      return NextResponse.json(
        {
          error: "备份缺少 exportedMode 标识，旧版混合备份不允许直接恢复，请切换到对应模式后重新导出。",
          code: "BACKUP_MODE_REQUIRED",
          ...summary,
        },
        { status: 409 },
      );
    }
    if (!summary.modeMatches) {
      return NextResponse.json(
        {
          error: `该备份来自 ${summary.exportedMode} 模式，当前为 ${mode} 模式，不能跨模式恢复。`,
          code: "BACKUP_MODE_MISMATCH",
          ...summary,
        },
        { status: 409 },
      );
    }
    if (summary.crossModeRowCount > 0) {
      return NextResponse.json(
        {
          error: "备份内含与导出模式不一致的数据行，已拒绝恢复。",
          code: "BACKUP_MIXED_MODES",
          ...summary,
        },
        { status: 409 },
      );
    }
    if (isDryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        ...summary,
      });
    }

    const preRestoreSnapshot = await writePreRestoreSnapshot(mode);
    const db = await getDb();
    const demo = isDemoMode(mode);
    const restoredCounts: Record<string, number> = {};
    const skippedCounts: Record<string, number> = {};

    await db.query("BEGIN");
    try {
      for (const table of BACKUP_TABLES) {
        const rows = payload.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        let count = 0;
        let skipped = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          if (!(await restoreRowBelongsToMode(db, table, row, demo))) {
            skipped += 1;
            continue;
          }
          if (isSensitiveSettingRow(table, row)) {
            skipped += 1;
            continue;
          }
          const normalizedRow = TOP_LEVEL_MODE_TABLES.has(table) ? { ...row, is_demo: demo } : row;
          const entries = Object.entries(normalizedRow).filter(
            ([k]) => /^[a-z_][a-z0-9_]*$/i.test(k) && !SENSITIVE_KEY_PATTERN.test(k),
          );
          if (entries.length === 0) continue;

          const cols = entries.map(([k]) => `"${k}"`).join(", ");
          const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
          const values = entries.map(([, v]) =>
            v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v,
          );

          await db.query("SAVEPOINT sp_backup_row");
          try {
            const inserted = await db.query<{ inserted: number }>(
              `INSERT INTO ${table} (${cols}) VALUES (${placeholders})
               ${BACKUP_CONFLICT_CLAUSES[table] ?? "ON CONFLICT DO NOTHING"}
               RETURNING 1 AS inserted`,
              values,
            );
            await db.query("RELEASE SAVEPOINT sp_backup_row");
            if (inserted.rows[0]) count += 1;
            else skipped += 1;
          } catch {
            await db.query("ROLLBACK TO SAVEPOINT sp_backup_row");
            skipped += 1;
          }
        }
        restoredCounts[table] = count;
        if (skipped > 0) skippedCounts[table] = skipped;
      }
      await db.query("COMMIT");
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw txErr;
    }

    const totalRestored = Object.values(restoredCounts).reduce((sum, count) => sum + count, 0);
    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "backup.restored",
      entityType: "workspace_backup",
      entityId: "workspace",
      details: {
        totalRestored,
        restoredCounts,
        skippedCounts,
        mode,
        preRestoreSnapshot: preRestoreSnapshot ?? undefined,
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      mode,
      restoredCounts,
      skippedCounts,
      preRestoreSnapshot,
      securityNotice: "API Key、Token 与加密密钥不会写入备份，也不会在恢复时覆盖现有值；请恢复后按需重新配置。",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "恢复备份失败" },
      { status: 500 },
    );
  }
}
