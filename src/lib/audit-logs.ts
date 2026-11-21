import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { getDb } from "./db.ts";
import {
  AUDIT_LEVEL_OPTIONS,
  AUDIT_MODULE_OPTIONS,
  type AuditLogEntry,
  type AuditLogLevel,
  type AuditLogModule,
  type AuditLogQuery,
  type AuditLogQueryResult,
  type AuditLogSummary,
} from "./audit-logs-shared.ts";

export {
  AUDIT_LEVEL_OPTIONS,
  AUDIT_MODULE_OPTIONS,
  type AuditLogEntry,
  type AuditLogLevel,
  type AuditLogModule,
  type AuditLogQuery,
  type AuditLogQueryResult,
  type AuditLogSummary,
};

export type AuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string | Date;
};

export type RecordAuditLogInput = {
  actor?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|authorization|cookie|credential)/i;

const MODULE_LABELS: Record<Exclude<AuditLogModule, "all">, string> = {
  case: "商品案卷",
  sourcing: "寻源与供应商",
  ai: "AI 选品与处理",
  settings: "系统设置",
  ingestion: "连接与导入",
  system: "系统与审计",
};

const ENTITY_TYPE_META: Record<
  string,
  { label: string; module: Exclude<AuditLogModule, "all">; href?: (entityId: string) => string | null }
> = {
  product_case: {
    label: "商品案卷",
    module: "case",
    href: (id) => (id ? `/cases/${encodeURIComponent(id)}` : null),
  },
  app_settings: {
    label: "系统配置",
    module: "settings",
    href: () => "/settings",
  },
  app_mode: {
    label: "运行模式",
    module: "system",
    href: () => "/",
  },
  data_source: {
    label: "数据源 / 连接器",
    module: "ingestion",
    href: () => "/connections",
  },
  connector_sync_job: {
    label: "同步任务",
    module: "ingestion",
    href: () => "/connections",
  },
  supplier: {
    label: "供应商",
    module: "sourcing",
    href: () => "/sourcing",
  },
  supplier_candidate: {
    label: "候选供应商",
    module: "sourcing",
    href: () => "/sourcing",
  },
  ai_supplier_draft: {
    label: "供应商沟通草稿",
    module: "sourcing",
    href: () => "/sourcing",
  },
  ai_sourcing_run: {
    label: "AI 选品批次",
    module: "ai",
    href: (id) => (id ? `/ai-sourcing/${encodeURIComponent(id)}` : "/ai-sourcing"),
  },
  opportunity_hypothesis: {
    label: "选品机会假设",
    module: "ai",
    href: () => "/ai-sourcing",
  },
  validation_task: {
    label: "验证任务",
    module: "ai",
    href: () => "/ai-sourcing",
  },
  ai_task: {
    label: "AI 收件箱任务",
    module: "ai",
    href: () => "/ai-inbox",
  },
  ai_extracted_field: {
    label: "AI 抽取字段",
    module: "ai",
    href: () => "/ai-inbox",
  },
  audit_log: {
    label: "操作日志",
    module: "system",
    href: () => "/audit-logs",
  },
};

type ActionMeta = {
  label: string;
  level: AuditLogLevel;
  module?: Exclude<AuditLogModule, "all">;
};

const ACTION_META: Record<string, ActionMeta> = {
  "case.created_from_wizard": { label: "向导立项创建案卷", level: "success", module: "case" },
  "case.promoted_from_competitors": { label: "从竞品对比提升为案卷", level: "success", module: "case" },
  "case.imported": { label: "导入商品案卷", level: "info", module: "case" },
  "case.seeded": { label: "初始化演示案卷", level: "info", module: "system" },
  "case.site_linked": { label: "绑定销售站点", level: "info", module: "case" },
  "case.archived": { label: "归档商品案卷", level: "warn", module: "case" },
  "case.restored": { label: "恢复已归档案卷", level: "info", module: "case" },
  "case.deleted": { label: "删除商品案卷", level: "danger", module: "case" },
  "case.flat_file_exported": { label: "导出 Amazon Flat File", level: "info", module: "case" },
  "cost_model.created": { label: "更新财务成本模型", level: "warn", module: "case" },
  "supplier.selected": { label: "定标选中供应商", level: "success", module: "sourcing" },
  "supplier.created": { label: "新增供应商", level: "info", module: "sourcing" },
  "supplier.updated": { label: "更新供应商信息", level: "info", module: "sourcing" },
  "quote.imported": { label: "导入供应商报价", level: "info", module: "sourcing" },
  "channel.target_created": { label: "创建渠道上架目标", level: "info", module: "case" },
  "channel.launch_readiness_checked": { label: "执行上架就绪度检查", level: "info", module: "case" },
  "channel.launch_queue_approved": { label: "确认加入上架队列", level: "success", module: "case" },
  "content_profile.updated": { label: "更新 Listing 文案配置", level: "info", module: "case" },
  "asset.main_image_reviewed": { label: "审核主图视觉素材", level: "info", module: "case" },
  "ai.settings_saved": { label: "保存大模型连接配置", level: "warn", module: "settings" },
  "ai.settings_cleared": { label: "清除大模型 API Key", level: "warn", module: "settings" },
  "image.settings_saved": { label: "保存生图模型配置", level: "warn", module: "settings" },
  "image.settings_cleared": { label: "清除生图模型 API Key", level: "warn", module: "settings" },
  "connector.settings_saved": { label: "保存店铺连接器配置", level: "warn", module: "settings" },
  "connector.settings_cleared": { label: "清除店铺连接器配置", level: "warn", module: "settings" },
  "connector.health_checked": { label: "检测连接器健康状态", level: "info", module: "ingestion" },
  "connector_sync.queued": { label: "创建连接器同步任务", level: "info", module: "ingestion" },
  "connector_sync.retry_queued": { label: "重试连接器同步任务", level: "warn", module: "ingestion" },
  "connector_sync.completed": { label: "连接器同步完成", level: "success", module: "ingestion" },
  "connector_sync.failed": { label: "连接器同步失败", level: "danger", module: "ingestion" },
  "ingestion.completed": { label: "数据导入完成", level: "success", module: "ingestion" },
  "ingestion.failed": { label: "数据导入失败", level: "danger", module: "ingestion" },
  "ai_sourcing.batch_created": { label: "创建 AI 选品批次", level: "info", module: "ai" },
  "ai_sourcing.batch_deleted": { label: "删除 AI 选品批次", level: "danger", module: "ai" },
  "ai_sourcing.hypothesis_selected": { label: "采纳选品机会假设", level: "success", module: "ai" },
  "ai_sourcing.task_status_changed": { label: "变更验证任务状态", level: "info", module: "ai" },
  "ai_sourcing.price_confirmed": { label: "确认目标售价区间", level: "info", module: "ai" },
  "ai_sourcing.competitors_auto_imported": { label: "自动导入竞品样本", level: "info", module: "ai" },
  "ai_sourcing.supplier_candidates_recorded": { label: "记录候选工厂信息", level: "info", module: "sourcing" },
  "ai_sourcing.supplier_candidate_shortlisted": { label: "入围候选工厂", level: "success", module: "sourcing" },
  "ai_sourcing.supplier_candidate_rejected": { label: "淘汰候选工厂", level: "warn", module: "sourcing" },
  "ai_sourcing.decision_evaluated": { label: "系统重算选品决策分", level: "info", module: "ai" },
  "ai_sourcing.promoted_to_case": { label: "选品假设正式立项", level: "success", module: "case" },
  "ai_inbox.task_created": { label: "创建 AI 解析任务", level: "info", module: "ai" },
  "ai_inbox.task_completed": { label: "AI 解析任务完成", level: "success", module: "ai" },
  "ai_inbox.task_retried": { label: "重试 AI 解析任务", level: "warn", module: "ai" },
  "ai_inbox.task_failed": { label: "AI 解析任务失败", level: "danger", module: "ai" },
  "ai_inbox.field_reviewed": { label: "人工复核 AI 抽取字段", level: "info", module: "ai" },
  "ai_inbox.task_applied": { label: "应用 AI 解析结果", level: "success", module: "ai" },
  "ai_inbox.decision_refresh_failed": { label: "应用后刷新决策失败", level: "danger", module: "ai" },
  "ai_supplier.draft_generated": { label: "生成供应商询盘草稿", level: "info", module: "sourcing" },
  "ai_supplier.draft_reviewed": { label: "审核供应商询盘草稿", level: "info", module: "sourcing" },
  "app.mode_switched": { label: "切换演示 / 真实模式", level: "warn", module: "system" },
  "app.demo_reset": { label: "一键重置演示数据", level: "warn", module: "system" },
  "audit_logs.exported": { label: "导出操作日志 CSV", level: "info", module: "system" },
};

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(k)) {
        out[k] = typeof v === "string" && v.length > 0 ? "***" : v;
      } else {
        out[k] = sanitizeAuditValue(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export function sanitizeAuditDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!details || typeof details !== "object") return {};
  return sanitizeAuditValue(details) as Record<string, unknown>;
}

export async function recordAuditLog(input: RecordAuditLogInput, dbOverride?: PGlite): Promise<string> {
  const db = dbOverride ?? (await getDb());
  const id = randomUUID();
  const actor = input.actor?.trim() || "本地操作员";
  const safeDetails = sanitizeAuditDetails(input.details);

  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [id, actor, input.action, input.entityType, input.entityId, JSON.stringify(safeDetails)],
  );

  return id;
}

export function describeAuditAction(action: string, entityType: string): {
  label: string;
  level: AuditLogLevel;
  module: Exclude<AuditLogModule, "all">;
} {
  const exact = ACTION_META[action];
  const entityMeta = ENTITY_TYPE_META[entityType];
  if (exact) {
    return {
      label: exact.label,
      level: exact.level,
      module: exact.module ?? entityMeta?.module ?? "system",
    };
  }

  let level: AuditLogLevel = "info";
  if (/(failed|error|deleted|removed)/i.test(action)) level = "danger";
  else if (/(archived|cleared|saved|switched|reset|retry|rejected)/i.test(action)) level = "warn";
  else if (/(approved|completed|selected|created|promoted|shortlisted|applied)/i.test(action)) level = "success";

  let module: Exclude<AuditLogModule, "all"> = entityMeta?.module ?? "system";
  if (!entityMeta) {
    if (action.startsWith("case.") || action.startsWith("cost_model.") || action.startsWith("channel.") || action.startsWith("content_")) {
      module = "case";
    } else if (action.startsWith("supplier.") || action.startsWith("quote.") || action.startsWith("ai_supplier.")) {
      module = "sourcing";
    } else if (action.startsWith("ai_sourcing.") || action.startsWith("ai_inbox.")) {
      module = "ai";
    } else if (action.startsWith("ai.settings") || action.startsWith("image.settings") || action.startsWith("connector.settings")) {
      module = "settings";
    } else if (action.startsWith("connector") || action.startsWith("ingestion.")) {
      module = "ingestion";
    }
  }

  return { label: action, level, module };
}

function buildDetailSummary(details: Record<string, unknown>): string {
  const keys = Object.keys(details);
  if (keys.length === 0) return "—";

  const preferred = [
    "asin",
    "title",
    "marketplace",
    "provider",
    "model",
    "mode",
    "status",
    "supplierName",
    "supplier_name",
    "reason",
    "error",
    "count",
    "fileName",
    "format",
    "score",
  ];

  const parts: string[] = [];
  const used = new Set<string>();
  for (const key of preferred) {
    if (key in details && details[key] !== null && details[key] !== undefined && details[key] !== "") {
      const val = typeof details[key] === "object" ? JSON.stringify(details[key]) : String(details[key]);
      parts.push(`${key}: ${val.length > 48 ? `${val.slice(0, 45)}...` : val}`);
      used.add(key);
      if (parts.length >= 3) break;
    }
  }

  if (parts.length < 3) {
    for (const key of keys) {
      if (used.has(key)) continue;
      const raw = details[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const val = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
      parts.push(`${key}: ${val.length > 48 ? `${val.slice(0, 45)}...` : val}`);
      if (parts.length >= 3) break;
    }
  }

  return parts.length > 0 ? parts.join(" · ") : "—";
}

function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  const details =
    row.details && typeof row.details === "object" && !Array.isArray(row.details)
      ? (row.details as Record<string, unknown>)
      : {};
  const actionInfo = describeAuditAction(row.action, row.entity_type);
  const entityMeta = ENTITY_TYPE_META[row.entity_type];
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString();

  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    actionLabel: actionInfo.label,
    level: actionInfo.level,
    module: actionInfo.module,
    moduleLabel: MODULE_LABELS[actionInfo.module],
    entityType: row.entity_type,
    entityTypeLabel: entityMeta?.label ?? row.entity_type,
    entityId: row.entity_id,
    entityHref: entityMeta?.href ? entityMeta.href(row.entity_id) : null,
    summary: buildDetailSummary(details),
    details,
    createdAt,
  };
}

export async function queryAuditLogs(
  query: AuditLogQuery = {},
  dbOverride?: PGlite,
): Promise<AuditLogQueryResult> {
  const db = dbOverride ?? (await getDb());
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize ?? 30)));
  const q = query.q?.trim().toLowerCase() ?? "";
  const targetModule = query.module ?? "all";
  const targetLevel = query.level ?? "all";
  const targetActor = query.actor?.trim() ?? "";
  const days = query.days && query.days > 0 ? Math.floor(query.days) : 0;

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (targetActor) {
    params.push(targetActor);
    whereParts.push(`actor = $${params.length}`);
  }
  if (days > 0) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    params.push(cutoff);
    whereParts.push(`created_at >= $${params.length}::timestamptz`);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

  const [rowsResult, actorsResult, allRecentResult] = await Promise.all([
    db.query<AuditLogRow>(
      `SELECT id, actor, action, entity_type, entity_id, details, created_at
       FROM audit_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT 2000`,
      params,
    ),
    db.query<{ actor: string }>(`SELECT DISTINCT actor FROM audit_logs ORDER BY actor ASC`),
    db.query<AuditLogRow>(
      `SELECT id, actor, action, entity_type, entity_id, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT 2000`,
    ),
  ]);

  const allEntries = allRecentResult.rows.map(toAuditLogEntry);
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const summary: AuditLogSummary = {
    total: allEntries.length,
    last24h: allEntries.filter((item) => Date.parse(item.createdAt) >= cutoff24h).length,
    sensitiveCount: allEntries.filter((item) => item.level === "warn" || item.module === "settings").length,
    errorCount: allEntries.filter((item) => item.level === "danger").length,
    actorCount: actorsResult.rows.length,
  };

  let filtered = rowsResult.rows.map(toAuditLogEntry);
  if (targetModule !== "all") {
    filtered = filtered.filter((item) => item.module === targetModule);
  }
  if (targetLevel !== "all") {
    filtered = filtered.filter((item) => item.level === targetLevel);
  }
  if (q) {
    filtered = filtered.filter((item) => {
      const haystack = [
        item.actor,
        item.action,
        item.actionLabel,
        item.entityType,
        item.entityTypeLabel,
        item.entityId,
        item.summary,
        JSON.stringify(item.details),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: filtered.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
    actors: actorsResult.rows.map((r) => r.actor),
    summary,
  };
}

function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportAuditLogsCsv(query: AuditLogQuery = {}, dbOverride?: PGlite): Promise<string> {
  const result = await queryAuditLogs({ ...query, page: 1, pageSize: 2000 }, dbOverride);
  const headers = ["时间", "操作人", "模块", "级别", "动作名称", "动作标识", "对象类型", "对象 ID", "详情 JSON"];
  const lines = [headers.map(escapeCsvCell).join(",")];

  for (const item of result.items) {
    lines.push(
      [
        item.createdAt,
        item.actor,
        item.moduleLabel,
        item.level,
        item.actionLabel,
        item.action,
        item.entityTypeLabel,
        item.entityId,
        JSON.stringify(item.details),
      ]
        .map((cell) => escapeCsvCell(String(cell ?? "")))
        .join(","),
    );
  }

  return `\uFEFF${lines.join("\r\n")}`;
}
