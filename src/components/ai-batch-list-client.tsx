"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { DeleteResearchBatch } from "@/components/delete-research-batch";
import { EmptyState } from "@/components/ui";
import { shortDate } from "@/lib/format";

export type AIBatchListItem = {
  id: string;
  brief: string;
  category: string;
  marketCode: string;
  platformCode: string;
  siteKey: string;
  siteLabel: string;
  provider: string;
  model: string;
  templateFallback: boolean;
  hypothesisCount: number;
  selectedCount: number;
  goCount: number;
  promotedCount: number;
  createdAt: string;
};

type Props = {
  batches: AIBatchListItem[];
};

type StatusFilter = "all" | "in_progress" | "promoted";

export function AIBatchListClient({ batches }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [siteFilter, setSiteFilter] = useState<string>("all");
  const [keyword, setKeyword] = useState("");

  const siteOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) {
      if (!map.has(b.siteKey)) map.set(b.siteKey, b.siteLabel);
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [batches]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return batches.filter((batch) => {
      if (siteFilter !== "all" && batch.siteKey !== siteFilter) return false;
      const isPromoted = batch.promotedCount > 0;
      if (statusFilter === "promoted" && !isPromoted) return false;
      if (statusFilter === "in_progress" && isPromoted) return false;
      if (q) {
        const haystack = `${batch.brief} ${batch.category} ${batch.siteLabel} ${batch.marketCode} ${batch.platformCode} ${batch.provider} ${batch.model}`;
        if (!haystack.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [batches, statusFilter, siteFilter, keyword]);

  const hasActiveFilter = statusFilter !== "all" || siteFilter !== "all" || keyword.trim().length > 0;

  if (batches.length === 0) {
    return (
      <EmptyState
        title="还没有选品研究"
        description="前往选品中心填写类目与约束条件即可创建第一个批次。"
        actions={<Link href="/discover" className="button primary">新建第一个研究</Link>}
      />
    );
  }

  return (
    <>
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
            aria-label="搜索研究批次"
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
            共展示 <strong style={{ color: "var(--ink)" }}>{filtered.length}</strong> / {batches.length} 个批次
          </span>
          {hasActiveFilter ? (
            <button
              type="button"
              className="button ghost"
              style={{ padding: "3px 8px", fontSize: "12px" }}
              onClick={() => {
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

      {filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的研究批次"
          description="请调整筛选条件或清空搜索关键词后重试。"
        />
      ) : (
        <div className="ai-batch-list">
          {filtered.map((batch) => (
            <article className="ai-batch-card" key={batch.id}>
              <Link
                href={`/ai-sourcing/${batch.id}?tab=hypotheses&market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}`}
                className="ai-batch-main research-batch-link"
              >
                <div className="button-row">
                  <span className="badge badge-neutral">{batch.category}</span>
                  <span className="badge badge-neutral">{batch.siteLabel}</span>
                  <span className="badge badge-success">{batch.goCount} 个 GO</span>
                  {batch.promotedCount > 0 ? (
                    <span className="badge status-approved">{batch.promotedCount} 个已立项</span>
                  ) : null}
                  {batch.templateFallback ? (
                    <span className="badge status-review_pending">模板回退</span>
                  ) : null}
                </div>
                <h3>{batch.brief}</h3>
                <p>
                  {shortDate(batch.createdAt)} · {batch.provider} / {batch.model}
                </p>
              </Link>
              <div className="research-batch-side">
                <div className="ai-batch-counts">
                  <span><strong>{batch.hypothesisCount}</strong> 候选方向</span>
                  <span><strong>{batch.selectedCount}</strong> 验证中</span>
                </div>
                <div className="research-batch-actions">
                  <Link
                    href={`/ai-sourcing/${batch.id}?tab=hypotheses&market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}`}
                    className="button ghost batch-open-button"
                  >
                    查看详情
                  </Link>
                  <DeleteResearchBatch
                    runId={batch.id}
                    category={batch.category}
                    promotedCount={batch.promotedCount}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
