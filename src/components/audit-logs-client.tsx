"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconDownload, IconSearch } from "@/components/icons";
import {
  AUDIT_LEVEL_OPTIONS,
  AUDIT_MODULE_OPTIONS,
  type AuditLogEntry,
  type AuditLogLevel,
  type AuditLogModule,
} from "@/lib/audit-logs-shared";

type AuditLogsClientProps = {
  items: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  actors: string[];
  filters: {
    q: string;
    module: AuditLogModule;
    level: AuditLogLevel | "all";
    actor: string;
    days: number;
  };
};

const LEVEL_BADGE: Record<AuditLogLevel, { label: string; className: string }> = {
  info: { label: "常规", className: "badge badge-neutral" },
  success: { label: "达成", className: "badge badge-success" },
  warn: { label: "敏感", className: "badge badge-warn" },
  danger: { label: "异常/删", className: "badge badge-danger" },
};

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildQueryString(params: {
  q?: string;
  module?: string;
  level?: string;
  actor?: string;
  days?: number;
  page?: number;
}): string {
  const sp = new URLSearchParams();
  if (params.q?.trim()) sp.set("q", params.q.trim());
  if (params.module && params.module !== "all") sp.set("module", params.module);
  if (params.level && params.level !== "all") sp.set("level", params.level);
  if (params.actor?.trim()) sp.set("actor", params.actor.trim());
  if (params.days && params.days > 0) sp.set("days", String(params.days));
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const str = sp.toString();
  return str ? `?${str}` : "";
}

export function AuditLogsClient({
  items,
  total,
  page,
  totalPages,
  actors,
  filters,
}: AuditLogsClientProps) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const [selectedModule, setSelectedModule] = useState<AuditLogModule>(filters.module);
  const [level, setLevel] = useState<AuditLogLevel | "all">(filters.level);
  const [actor, setActor] = useState(filters.actor);
  const [days, setDays] = useState<number>(filters.days);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const applyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const qs = buildQueryString({
      q,
      module: selectedModule,
      level,
      actor,
      days,
      page: 1,
    });
    router.push(`/audit-logs${qs}`);
  };

  const resetFilters = () => {
    setQ("");
    setSelectedModule("all");
    setLevel("all");
    setActor("");
    setDays(0);
    router.push("/audit-logs");
  };

  const goPage = (targetPage: number) => {
    const qs = buildQueryString({
      q: filters.q,
      module: filters.module,
      level: filters.level,
      actor: filters.actor,
      days: filters.days,
      page: targetPage,
    });
    router.push(`/audit-logs${qs}`);
  };

  const exportUrl = `/api/audit-logs/export${buildQueryString({
    q: filters.q,
    module: filters.module,
    level: filters.level,
    actor: filters.actor,
    days: filters.days,
  })}`;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">全域审计台账</div>
          <h2>操作记录明细</h2>
          <p>
            共匹配 <strong>{total}</strong> 条记录；敏感凭据字段（API Key / Token / Secret）写入前已自动脱敏。
          </p>
        </div>
        <div className="button-row">
          <a href={exportUrl} className="button secondary">
            <IconDownload size={15} />
            导出 CSV
          </a>
        </div>
      </div>

      <form
        onSubmit={applyFilters}
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(200px, 2fr) repeat(4, minmax(120px, 1fr)) auto",
          gap: "10px",
          alignItems: "end",
          marginBottom: "18px",
        }}
      >
        <div className="field">
          <label htmlFor="audit-q">关键词检索</label>
          <input
            id="audit-q"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索动作、ASIN、案卷 ID、详情..."
          />
        </div>

        <div className="field">
          <label htmlFor="audit-module">业务模块</label>
          <select
            id="audit-module"
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value as AuditLogModule)}
          >
            {AUDIT_MODULE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="audit-level">事件级别</label>
          <select
            id="audit-level"
            value={level}
            onChange={(e) => setLevel(e.target.value as AuditLogLevel | "all")}
          >
            {AUDIT_LEVEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="audit-actor">操作人</label>
          <select id="audit-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">全部操作人</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="audit-days">时间范围</label>
          <select id="audit-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="0">全部时间</option>
            <option value="1">近 24 小时</option>
            <option value="7">近 7 天</option>
            <option value="30">近 30 天</option>
          </select>
        </div>

        <div className="button-row" style={{ marginBottom: "2px" }}>
          <button type="submit" className="button primary">
            <IconSearch size={14} />
            筛选
          </button>
          <button type="button" className="button ghost" onClick={resetFilters}>
            重置
          </button>
        </div>
      </form>

      {items.length === 0 ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            borderRadius: "10px",
            border: "1px dashed var(--line)",
            background: "var(--surface-subtle)",
            color: "var(--muted)",
          }}
        >
          当前筛选条件下暂无操作日志。
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: "160px" }}>时间</th>
                <th style={{ width: "110px" }}>操作人</th>
                <th style={{ width: "110px" }}>模块</th>
                <th style={{ width: "84px" }}>级别</th>
                <th>动作</th>
                <th style={{ width: "180px" }}>关联对象</th>
                <th>详情摘要</th>
                <th style={{ width: "76px" }}>原始数据</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const badge = LEVEL_BADGE[item.level];
                const isOpen = Boolean(expandedIds[item.id]);
                const hasDetails = Object.keys(item.details).length > 0;
                return (
                  <Fragment key={item.id}>
                    <tr>
                      <td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "12px", whiteSpace: "nowrap" }}>
                        {formatLocalTime(item.createdAt)}
                      </td>
                      <td>
                        <span style={{ fontWeight: 500 }}>{item.actor}</span>
                      </td>
                      <td>
                        <span className="badge badge-neutral">{item.moduleLabel}</span>
                      </td>
                      <td>
                        <span className={badge.className}>{badge.label}</span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.actionLabel}</div>
                        <div style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "var(--font-mono, monospace)" }}>
                          {item.action}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>{item.entityTypeLabel}</div>
                        {item.entityHref ? (
                          <Link
                            href={item.entityHref}
                            style={{
                              fontSize: "12px",
                              fontFamily: "var(--font-mono, monospace)",
                              textDecoration: "underline",
                            }}
                          >
                            {item.entityId.length > 20 ? `${item.entityId.slice(0, 18)}…` : item.entityId}
                          </Link>
                        ) : (
                          <span style={{ fontSize: "12px", fontFamily: "var(--font-mono, monospace)" }}>
                            {item.entityId.length > 20 ? `${item.entityId.slice(0, 18)}…` : item.entityId}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: "12px", color: "var(--muted)", maxWidth: "320px", wordBreak: "break-word" }}>
                        {item.summary}
                      </td>
                      <td>
                        {hasDetails ? (
                          <button
                            type="button"
                            className="button ghost"
                            style={{ padding: "4px 8px", fontSize: "12px" }}
                            onClick={() => toggleExpand(item.id)}
                          >
                            {isOpen ? "收起" : "JSON"}
                          </button>
                        ) : (
                          <span style={{ fontSize: "12px", color: "var(--muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr>
                        <td
                          colSpan={8}
                          style={{
                            background: "var(--surface-subtle)",
                            padding: "12px 16px",
                            borderTop: "1px solid var(--line)",
                          }}
                        >
                          <pre
                            style={{
                              margin: 0,
                              fontSize: "12px",
                              lineHeight: 1.55,
                              overflowX: "auto",
                              color: "var(--ink)",
                              fontFamily: "var(--font-mono, monospace)",
                            }}
                          >
                            {JSON.stringify(item.details, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "16px",
            paddingTop: "14px",
            borderTop: "1px solid var(--line)",
            fontSize: "13px",
            color: "var(--muted)",
          }}
        >
          <span>
            第 <strong>{page}</strong> / {totalPages} 页 · 共 {total} 条
          </span>
          <div className="button-row">
            <button
              type="button"
              className="button secondary"
              disabled={page <= 1}
              onClick={() => goPage(page - 1)}
            >
              上一页
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={page >= totalPages}
              onClick={() => goPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
