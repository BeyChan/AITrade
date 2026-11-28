import { NextResponse } from "next/server";
import {
  exportAuditLogsCsv,
  recordAuditLog,
  type AuditLogLevel,
  type AuditLogModule,
} from "@/lib/audit-logs";
import { getAppMode } from "@/lib/app-mode";


const VALID_MODULES = new Set<AuditLogModule>(["all", "case", "sourcing", "ai", "settings", "ingestion", "system"]);
const VALID_LEVELS = new Set<AuditLogLevel | "all">(["all", "info", "success", "warn", "danger"]);

export async function GET(request: Request) {
  const mode = await getAppMode();
  const { searchParams } = new URL(request.url);
  const rawModule = (searchParams.get("module") ?? "all") as AuditLogModule;
  const rawLevel = (searchParams.get("level") ?? "all") as AuditLogLevel | "all";
  const q = searchParams.get("q") ?? "";
  const actor = searchParams.get("actor") ?? "";
  const days = Number(searchParams.get("days") ?? "0") || 0;

  const query = {
    mode,
    q,
    module: VALID_MODULES.has(rawModule) ? rawModule : ("all" as const),
    level: VALID_LEVELS.has(rawLevel) ? rawLevel : ("all" as const),
    actor,
    days,
  };

  const csv = await exportAuditLogsCsv(query);

  await recordAuditLog({
    mode,
    actor: "本地操作员",
    action: "audit_logs.exported",
    entityType: "audit_log",
    entityId: "global",
    details: {
      module: query.module,
      level: query.level,
      actor: query.actor || "all",
      days: query.days,
      q: query.q || undefined,
      format: "csv",
    },
  }).catch(() => {});

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="aitrade-audit-logs-${stamp}.csv"`,
    },
  });
}
