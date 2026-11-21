export type AuditLogLevel = "info" | "success" | "warn" | "danger";

export type AuditLogModule =
  | "all"
  | "case"
  | "sourcing"
  | "ai"
  | "settings"
  | "ingestion"
  | "system";

export type AuditLogEntry = {
  id: string;
  actor: string;
  action: string;
  actionLabel: string;
  level: AuditLogLevel;
  module: Exclude<AuditLogModule, "all">;
  moduleLabel: string;
  entityType: string;
  entityTypeLabel: string;
  entityId: string;
  entityHref: string | null;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AuditLogSummary = {
  total: number;
  last24h: number;
  sensitiveCount: number;
  errorCount: number;
  actorCount: number;
};

export type AuditLogQuery = {
  q?: string;
  module?: AuditLogModule;
  level?: AuditLogLevel | "all";
  actor?: string;
  days?: number;
  page?: number;
  pageSize?: number;
};

export type AuditLogQueryResult = {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  actors: string[];
  summary: AuditLogSummary;
};

export const AUDIT_MODULE_OPTIONS: Array<{ value: AuditLogModule; label: string }> = [
  { value: "all", label: "全部模块" },
  { value: "case", label: "商品案卷" },
  { value: "sourcing", label: "寻源与供应商" },
  { value: "ai", label: "AI 选品与处理" },
  { value: "settings", label: "系统设置" },
  { value: "ingestion", label: "连接与导入" },
  { value: "system", label: "系统与审计" },
];

export const AUDIT_LEVEL_OPTIONS: Array<{ value: AuditLogLevel | "all"; label: string }> = [
  { value: "all", label: "全部级别" },
  { value: "info", label: "常规记录" },
  { value: "success", label: "关键达成" },
  { value: "warn", label: "敏感变更" },
  { value: "danger", label: "异常 / 删除" },
];
