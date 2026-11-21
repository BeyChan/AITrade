import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { canManageSettings, getCurrentMember } from "@/lib/operator";

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

type BackupTable = (typeof BACKUP_TABLES)[number];

type BackupPayload = {
  schemaVersion: number;
  exportedAt: string;
  exportedBy: string;
  tables: Partial<Record<BackupTable, Record<string, unknown>[]>>;
};

export async function GET() {
  const member = await getCurrentMember();
  if (!canManageSettings(member.role)) {
    return NextResponse.json({ error: "仅管理员角色可执行整库备份导出" }, { status: 403 });
  }

  try {
    const db = await getDb();
    const tables: Partial<Record<BackupTable, Record<string, unknown>[]>> = {};
    for (const table of BACKUP_TABLES) {
      const res = await db.query<Record<string, unknown>>(`SELECT * FROM ${table}`).catch(() => ({ rows: [] }));
      tables[table] = res.rows;
    }

    const payload: BackupPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: member.name,
      tables,
    };

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
  const member = await getCurrentMember();
  if (!canManageSettings(member.role)) {
    return NextResponse.json({ error: "仅管理员角色可执行整库数据恢复" }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as Partial<BackupPayload>;
    if (!payload || typeof payload !== "object" || !payload.tables || typeof payload.tables !== "object") {
      return NextResponse.json({ error: "备份文件格式无效，缺少 tables 字段" }, { status: 400 });
    }

    const db = await getDb();
    const restoredCounts: Record<string, number> = {};

    for (const table of BACKUP_TABLES) {
      const rows = payload.tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      let count = 0;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const entries = Object.entries(row).filter(([k]) => /^[a-z_][a-z0-9_]*$/i.test(k));
        if (entries.length === 0) continue;

        const cols = entries.map(([k]) => `"${k}"`).join(", ");
        const placeholders = entries.map((_, idx) => `$${idx + 1}`).join(", ");
        const values = entries.map(([, v]) =>
          v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v,
        );

        await db
          .query(`INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`, values)
          .then(() => {
            count += 1;
          })
          .catch(() => undefined);
      }
      restoredCounts[table] = count;
    }

    return NextResponse.json({ ok: true, restoredCounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "恢复备份失败" },
      { status: 500 },
    );
  }
}
