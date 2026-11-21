import { NextResponse } from "next/server";
import {
  queryAuditLogs,
  type AuditLogLevel,
  type AuditLogModule,
} from "@/lib/audit-logs";

export const dynamic = "force-dynamic";

const VALID_MODULES = new Set<AuditLogModule>(["all", "case", "sourcing", "ai", "settings", "ingestion", "system"]);
const VALID_LEVELS = new Set<AuditLogLevel | "all">(["all", "info", "success", "warn", "danger"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawModule = (searchParams.get("module") ?? "all") as AuditLogModule;
  const rawLevel = (searchParams.get("level") ?? "all") as AuditLogLevel | "all";
  const q = searchParams.get("q") ?? "";
  const actor = searchParams.get("actor") ?? "";
  const days = Number(searchParams.get("days") ?? "0") || 0;
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "30") || 30;

  const result = await queryAuditLogs({
    q,
    module: VALID_MODULES.has(rawModule) ? rawModule : "all",
    level: VALID_LEVELS.has(rawLevel) ? rawLevel : "all",
    actor,
    days,
    page,
    pageSize,
  });

  return NextResponse.json(result);
}
