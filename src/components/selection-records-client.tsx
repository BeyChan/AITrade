"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { moneyIn, shortDate } from "@/lib/format";

export type SelectionRecordItem =
  | {
      kind: "report";
      id: string;
      title: string;
      marketCode: string;
      platformCode: string;
      siteKey: string;
      siteLabel: string;
      currency: string;
      competitorCount: number;
      p50PriceCents: number;
      promotedCaseId?: string | null;
      createdAt: string;
    }
  | {
      kind: "batch";
      id: string;
      brief: string;
      category: string;
      marketCode: string;
      platformCode: string;
      siteKey: string;
      siteLabel: string;
      hypothesisCount: number;
      selectedCount: number;
      goCount: number;
      promotedCount: number;
      createdAt: string;
    };

type SiteOption = {
  key: string;
  label: string;
};

type Props = {
  records: SelectionRecordItem[];
  siteOptions: SiteOption[];
  importHref: string;
};

type TypeFilter = "all" | "report" | "batch";
type StatusFilter = "all" | "in_progress" | "promoted";

export function SelectionRecordsClient({ records, siteOptions, importHref }: Props) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");

  const filteredRecords = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return records.filter((record) => {
      if (typeFilter !== "all" && record.kind !== typeFilter) return false;
      if (siteFilter !== "all" && record.siteKey !== siteFilter) return false;

      const isPromoted =
        record.kind === "report" ? Boolean(record.promotedCaseId) : record.promotedCount > 0;
      if (statusFilter === "promoted" && !isPromoted) return false;
      if (statusFilter === "in_progress" && isPromoted) return false;

      if (q) {
        const haystack =
          record.kind === "report"
            ? `${record.title} ${record.siteLabel} ${record.marketCode} ${record.platformCode}`
            : `${record.brief} ${record.category} ${record.siteLabel} ${record.marketCode} ${record.platformCode}`;
        if (!haystack.toLowerCase().includes(q)) return false;
      }

      return true;
    });
  }, [records, typeFilter, statusFilter, siteFilter, keyword]);

  const hasActiveFilter =
    typeFilter !== "all" || statusFilter !== "all" || siteFilter !== "all" || keyword.trim().length > 0;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>全部选品记录</h2>
          <p>竞品研报与 AI 选品批次统一汇总在此，按更新时间倒序完整展示，点击任意一条即可继续推进。</p>
        </div>
      </div>

      {/* 筛选过滤栏 */}
      <div
        style={{
          background: "var(--surface-subtle, var(--canvas))",
          padding: "11px 14px",
          borderRadius: "10px",
          border: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>类型</span>
            {(
              [
                { id: "all", label: "全部" },
                { id: "report", label: "竞品研报" },
                { id: "batch", label: "AI 发散批次" },
              ] as const
            ).map((tab) => {
              const active = typeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setTypeFilter(tab.id)}
                  style={{
                    fontSize: "12px",
                    padding: "5px 11px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    cursor: "pointer",
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--deep)" : "var(--paper)",
                    color: active ? "var(--deep-fg)" : "var(--ink)",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>状态</span>
            {(
              [
                { id: "all", label: "全部" },
                { id: "in_progress", label: "进行中" },
                { id: "promoted", label: "已立项" },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  style={{
                    fontSize: "12px",
                    padding: "5px 11px",
                    borderRadius: "6px",
                    border: "1px solid var(--line)",
                    cursor: "pointer",
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--deep)" : "var(--paper)",
                    color: active ? "var(--deep-fg)" : "var(--ink)",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {siteOptions.length > 1 ? (
            <select
              aria-label="按站点筛选"
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              style={{
                fontSize: "12px",
                padding: "5px 10px",
                borderRadius: "6px",
                border: "1px solid var(--line)",
                background: "var(--paper)",
                color: "var(--ink)",
              }}
            >
              <option value="all">全部站点</option>
              {siteOptions.map((site) => (
                <option key={site.key} value={site.key}>
                  {site.label}
                </option>
              ))}
            </select>
          ) : null}

          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索标题、类目或站点…"
            aria-label="搜索选品记录"
            style={{
              fontSize: "12px",
              padding: "5px 10px",
              borderRadius: "6px",
              border: "1px solid var(--line)",
              background: "var(--paper)",
              color: "var(--ink)",
              minWidth: "180px",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "12px", color: "var(--muted)" }}>
          <span>
            共展示 <strong style={{ color: "var(--ink)" }}>{filteredRecords.length}</strong> / {records.length} 条选品记录
          </span>
          {hasActiveFilter ? (
            <button
              type="button"
              className="button ghost"
              style={{ padding: "3px 8px", fontSize: "12px" }}
              onClick={() => {
                setTypeFilter("all");
                setStatusFilter("all");
                setSiteFilter("all");
                setKeyword("");
              }}
            >
              重置筛选
            </button>
          ) : null}
        </div>
      </div>

      {records.length === 0 ? (
        <div className="empty-state">
          <h3>还没有选品记录</h3>
          <p>可以通过「3 步快速选品」或「竞品研报」开启你的第一款选品测试。</p>
          <div className="button-row" style={{ justifyContent: "center", marginTop: 12 }}>
            <Link href="/discover" className="button primary">
              进入 3 步快速选品
            </Link>
            <Link href={importHref} className="button secondary">
              批量导入 CSV
            </Link>
          </div>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="empty-state">
          <h3>没有匹配的选品记录</h3>
          <p>请调整筛选条件或清空搜索关键词后重试。</p>
        </div>
      ) : (
        <div className="wizard-history-list">
          {filteredRecords.map((record) =>
            record.kind === "report" ? (
              <div key={`report-${record.id}`} className="wizard-history-item">
                <div>
                  <div className="button-row" style={{ marginBottom: 4 }}>
                    <span className="badge badge-neutral">竞品研报</span>
                    <span className="badge badge-neutral mono">{record.competitorCount} 款竞品</span>
                    <span className="badge badge-neutral">{record.siteLabel}</span>
                    {record.promotedCaseId ? <span className="badge badge-success">已立项</span> : null}
                  </div>
                  <strong>{record.title}</strong>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    P50 中位价 {moneyIn(record.currency, record.p50PriceCents)} · 更新于 {shortDate(record.createdAt)}
                  </div>
                </div>
                <div className="button-row">
                  <Link
                    href={`/discover?reportId=${encodeURIComponent(record.id)}&step=2&market=${encodeURIComponent(record.marketCode)}&platform=${encodeURIComponent(record.platformCode)}`}
                    className="button secondary"
                  >
                    载入向导核成本
                  </Link>
                  <Link href={`/competitors?id=${encodeURIComponent(record.id)}`} className="button ghost">
                    详细研报
                  </Link>
                </div>
              </div>
            ) : (
              <div key={`batch-${record.id}`} className="wizard-history-item">
                <div>
                  <div className="button-row" style={{ marginBottom: 4 }}>
                    <span className="badge badge-neutral">AI 发散批次</span>
                    <span className="badge badge-neutral">{record.category}</span>
                    <span className="badge badge-neutral">{record.siteLabel}</span>
                    <span className="badge badge-success">{record.goCount} 个 GO</span>
                    {record.promotedCount > 0 ? (
                      <span className="badge badge-success">{record.promotedCount} 个已立项</span>
                    ) : null}
                  </div>
                  <strong>{record.brief}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {record.hypothesisCount} 个方向 · {record.selectedCount} 个验证中 · 更新于 {shortDate(record.createdAt)}
                  </div>
                </div>
                <div className="button-row">
                  <Link
                    href={`/ai-sourcing/${encodeURIComponent(record.id)}?tab=hypotheses&market=${encodeURIComponent(record.marketCode)}&platform=${encodeURIComponent(record.platformCode)}`}
                    className="button secondary"
                  >
                    继续验证
                  </Link>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
  );
}
