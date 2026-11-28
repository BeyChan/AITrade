import { AuditLogsClient } from "@/components/audit-logs-client";
import { MetricGrid, PageHeader } from "@/components/ui";
import {
  queryAuditLogs,
  type AuditLogLevel,
  type AuditLogModule,
} from "@/lib/audit-logs";
import { getAppMode } from "@/lib/app-mode";

export const dynamic = "force-dynamic";

const VALID_MODULES = new Set<AuditLogModule>(["all", "case", "sourcing", "ai", "settings", "ingestion", "system"]);
const VALID_LEVELS = new Set<AuditLogLevel | "all">(["all", "info", "success", "warn", "danger"]);

type PageProps = {
  searchParams: Promise<{
    q?: string;
    module?: string;
    level?: string;
    actor?: string;
    days?: string;
    page?: string;
  }>;
};

export default async function AuditLogsPage({ searchParams }: PageProps) {
  const mode = await getAppMode();
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const rawModule = (sp.module ?? "all") as AuditLogModule;
  const selectedModule = VALID_MODULES.has(rawModule) ? rawModule : "all";
  const rawLevel = (sp.level ?? "all") as AuditLogLevel | "all";
  const level = VALID_LEVELS.has(rawLevel) ? rawLevel : "all";
  const actor = sp.actor?.trim() ?? "";
  const days = Number(sp.days ?? "0") || 0;
  const page = Number(sp.page ?? "1") || 1;

  const result = await queryAuditLogs({
    mode,
    q,
    module: selectedModule,
    level,
    actor,
    days,
    page,
    pageSize: 30,
  });

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "操作日志" },
        ]}
        eyebrow="系统治理 · 决策可追溯"
        title="操作日志"
        description="集中追踪全站立项创建、财务模型调整、供应商定标、数据导入导出与模型连接配置变更。所有记录持久化于本地数据库，后续接入用户与权限体系后将自动关联真实操作账号。"
      />

      <MetricGrid
        ariaLabel="操作日志统计"
        items={[
          { label: "累计审计记录", value: result.summary.total, note: "最近 2,000 条持久化留痕" },
          { label: "近 24 小时操作", value: result.summary.last24h, note: `覆盖 ${result.summary.actorCount} 类操作主体` },
          { label: "敏感 / 配置变更", value: result.summary.sensitiveCount, note: "含成本改写、归档、API 配置与模式切换" },
          { label: "异常 / 删除事件", value: result.summary.errorCount, note: "同步失败、导入失败或批次删除" },
        ]}
      />

      <AuditLogsClient
        items={result.items}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        totalPages={result.totalPages}
        actors={result.actors}
        filters={{
          q,
          module: selectedModule,
          level,
          actor,
          days,
        }}
      />
    </div>
  );
}
