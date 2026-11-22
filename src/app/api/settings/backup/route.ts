import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
] as const;

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
};

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|secret|token|password|encrypted)/i;

type BackupTable = (typeof BACKUP_TABLES)[number];

type BackupPayload = {
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
};

async function collectBackupPayload(): Promise<BackupPayload> {
  const db = await getDb();
  const tables: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};
  for (const table of BACKUP_TABLES) {
    const res = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`).catch(() => ({ rows: [] }));
    tables[table] = res.rows;
  }

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: "本机工作台",
    tables,
  };
}

function inspectPayload(payload: Partial<BackupPayload>) {
  const previewCounts: Array<{ table: BackupTable; label: string; count: number }> = [];
  let totalRows = 0;
  let sensitiveFieldCount = 0;

  for (const table of BACKUP_TABLES) {
    const rows = payload.tables?.[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    let validRows = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      validRows += 1;
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
    schemaVersion: typeof payload.schemaVersion === "number" ? payload.schemaVersion : 1,
    exportedAt: typeof payload.exportedAt === "string" ? payload.exportedAt : null,
    totalRows,
    previewCounts,
    containsSensitiveKeys: sensitiveFieldCount > 0,
  };
}

async function writePreRestoreSnapshot(): Promise<string | null> {
  try {
    const snapshot = await collectBackupPayload();
    const backupsDir = path.resolve(process.cwd(), ".data", "backups");
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

export async function GET() {
  try {
    const payload = await collectBackupPayload();
    const totalRows = Object.values(payload.tables).reduce((sum, rows) => sum + (rows?.length ?? 0), 0);
    await recordAuditLog({
      actor: "本机用户",
      action: "backup.exported",
      entityType: "workspace_backup",
      entityId: "workspace",
      details: { totalRows, schemaVersion: payload.schemaVersion },
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
    const url = new URL(request.url);
    const isDryRun = url.searchParams.get("dryRun") === "true" || url.searchParams.get("dryRun") === "1";

    const payload = (await request.json()) as Partial<BackupPayload>;
    if (!payload || typeof payload !== "object" || !payload.tables || typeof payload.tables !== "object") {
      return NextResponse.json({ error: "备份文件格式无效，缺少 tables 字段" }, { status: 400 });
    }

    const summary = inspectPayload(payload);
    if (isDryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        ...summary,
      });
    }

    const preRestoreSnapshot = await writePreRestoreSnapshot();
    const db = await getDb();
    const restoredCounts: Record<string, number> = {};

    await db.query("BEGIN");
    try {
      for (const table of BACKUP_TABLES) {
        const rows = payload.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;

        let count = 0;
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const entries = Object.entries(row).filter(
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
            await db.query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values);
            await db.query("RELEASE SAVEPOINT sp_backup_row");
            count += 1;
          } catch {
            await db.query("ROLLBACK TO SAVEPOINT sp_backup_row");
          }
        }
        restoredCounts[table] = count;
      }
      await db.query("COMMIT");
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw txErr;
    }

    const totalRestored = Object.values(restoredCounts).reduce((sum, count) => sum + count, 0);
    await recordAuditLog({
      actor: "本机用户",
      action: "backup.restored",
      entityType: "workspace_backup",
      entityId: "workspace",
      details: {
        totalRestored,
        restoredCounts,
        preRestoreSnapshot: preRestoreSnapshot ?? undefined,
      },
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      restoredCounts,
      preRestoreSnapshot,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "恢复备份失败" },
      { status: 500 },
    );
  }
}
