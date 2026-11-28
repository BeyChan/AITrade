"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  AutoPipelineRunSummary,
  PlatformPipelineConfig,
} from "@/lib/auto-pipeline/types";

const SOURCE_LABELS: Record<string, string> = {
  csv: "CSV 上传",
  extension: "Chrome 扩展",
  inbox: "收件箱扫描",
  api: "API",
};

function formatRunDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function AutoPipelineHistoryClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialPlatform: string;
  initialMarket: string;
}) {
  const [runs, setRuns] = useState<AutoPipelineRunSummary[]>(props.initialRuns);
  const initialConfigKey =
    props.initialPlatform !== "ALL" && props.initialMarket !== "ALL"
      ? `${props.initialPlatform}:${props.initialMarket}`
      : "ALL";
  const [selectedConfigKey, setSelectedConfigKey] = useState<string>(
    initialConfigKey === "ALL" || props.initialConfigs.some((c) => c.id === initialConfigKey)
      ? initialConfigKey
      : "ALL",
  );
  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [keyword, setKeyword] = useState("");
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const configLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of props.initialConfigs) {
      map.set(`${c.platformCode}:${c.marketCode}`, c.label);
    }
    return map;
  }, [props.initialConfigs]);

  const filteredRuns = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return runs.filter((r) => {
      if (selectedConfigKey !== "ALL" && `${r.platformCode}:${r.marketCode}` !== selectedConfigKey) {
        return false;
      }
      if (sourceFilter !== "ALL" && r.sourceType !== sourceFilter) {
        return false;
      }
      if (kw) {
        const hay = `${r.sourceLabel} ${r.platformCode} ${r.marketCode} ${r.sourceType}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [runs, selectedConfigKey, sourceFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRuns = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredRuns.slice(start, start + PAGE_SIZE);
  }, [filteredRuns, safePage]);

  const backHref = useMemo(() => {
    if (selectedConfigKey !== "ALL") {
      const [p, m] = selectedConfigKey.split(":");
      if (p && m) {
        return `/auto-pipeline?platform=${encodeURIComponent(p)}&market=${encodeURIComponent(m)}`;
      }
    }
    return "/auto-pipeline";
  }, [selectedConfigKey]);

  const handleRename = async (runId: string) => {
    const nextLabel = renameDraft.trim();
    if (!nextLabel) return;
    setBusyId(runId);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(runId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceLabel: nextLabel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重命名批次失败");
      setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, sourceLabel: data.run.sourceLabel } : r)));
      setRenamingId(null);
      setFeedback({ kind: "ok", text: `批次已重命名为「${data.run.sourceLabel}」。` });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "重命名失败" });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (run: AutoPipelineRunSummary) => {
    const confirmed = window.confirm(
      `确认删除批次「${run.sourceLabel}」（共 ${run.totalSeeds} 条候选）？\n\n仅删除该批次的选品快照，不会影响已推进生成的正式商品案卷；若同 ASIN 在其他历史批次中存在，其他批次仍会保留。`,
    );
    if (!confirmed) return;

    setBusyId(run.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除批次失败");
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      setFeedback({
        kind: "ok",
        text: `已删除批次「${run.sourceLabel}」（移除 ${data.deletedCandidates ?? run.totalSeeds} 条快照，正式商品案卷不受影响）。`,
      });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 顶部标题栏 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>
              历史自动选品批次
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              每批均保留独立历史快照；点击任意批次即可进入自动选品池查看该批详情，删除批次不会影响已推进的正式商品案卷。
            </p>
          </div>
          <Link
            href={backHref}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-subtle)",
              color: "var(--ink)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            ← 返回自动选品池
          </Link>
        </div>

        {/* 筛选条 */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select
            value={selectedConfigKey}
            onChange={(e) => setSelectedConfigKey(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-subtle)",
              color: "var(--ink)",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <option value="ALL">全部平台与站点</option>
            {props.initialConfigs.map((cfg) => (
              <option key={cfg.id} value={cfg.id}>
                {cfg.label} ({cfg.currency})
              </option>
            ))}
          </select>

          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-subtle)",
              color: "var(--ink)",
              fontSize: 13,
            }}
          >
            <option value="ALL">全部来源</option>
            <option value="csv">CSV 上传</option>
            <option value="extension">Chrome 扩展</option>
            <option value="inbox">收件箱扫描</option>
            <option value="api">API</option>
          </select>

          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索批次名称…"
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "1px solid var(--line)",
              background: "var(--surface-subtle)",
              color: "var(--ink)",
              fontSize: 13,
              minWidth: 220,
            }}
          />

          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
            共 <strong style={{ color: "var(--ink)" }}>{filteredRuns.length}</strong> 个批次
          </span>
        </div>

        {feedback && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              fontSize: 13,
              background: feedback.kind === "ok" ? "var(--green-soft)" : "var(--red-soft)",
              color: feedback.kind === "ok" ? "var(--green)" : "var(--red)",
              border: `1px solid ${feedback.kind === "ok" ? "var(--green)" : "var(--red)"}`,
            }}
          >
            {feedback.text}
          </div>
        )}
      </section>

      {/* 批次列表 */}
      <section
        style={{
          background: "var(--paper)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {pagedRuns.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            暂无符合条件的历史选品批次。
          </div>
        ) : (
          pagedRuns.map((run, idx) => {
            const globalIdx = (safePage - 1) * PAGE_SIZE + idx;
            const platformLabel =
              configLabelMap.get(`${run.platformCode}:${run.marketCode}`) ||
              `${run.platformCode.toUpperCase()} / ${run.marketCode}`;
            const viewHref = `/auto-pipeline?platform=${encodeURIComponent(run.platformCode)}&market=${encodeURIComponent(run.marketCode)}&runId=${encodeURIComponent(run.id)}`;
            const isBusy = busyId === run.id;

            return (
              <div
                key={run.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--surface-subtle)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {globalIdx === 0 && (
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: "var(--accent-soft)",
                          color: "var(--accent)",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        最新
                      </span>
                    )}
                    {renamingId === run.id ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          placeholder="输入批次名称"
                          style={{
                            padding: "5px 8px",
                            borderRadius: 6,
                            border: "1px solid var(--accent)",
                            background: "var(--paper)",
                            color: "var(--ink)",
                            fontSize: 13,
                            width: 220,
                          }}
                        />
                        <button
                          type="button"
                          disabled={isBusy || !renameDraft.trim()}
                          onClick={() => void handleRename(run.id)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: "none",
                            background: "var(--accent)",
                            color: "var(--paper)",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingId(null)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            border: "1px solid var(--line)",
                            background: "var(--paper)",
                            color: "var(--muted)",
                            fontSize: 12,
                          }}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <strong style={{ fontSize: 15, color: "var(--ink)" }}>{run.sourceLabel}</strong>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 5,
                        border: "1px solid var(--line)",
                        color: "var(--muted)",
                      }}
                    >
                      {platformLabel}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {SOURCE_LABELS[run.sourceType] ?? run.sourceType} · {formatRunDateTime(run.createdAt)}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                    <span>
                      共 <strong style={{ color: "var(--ink)" }}>{run.totalSeeds}</strong> 条
                    </span>
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>S: {run.sCount}</span>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>A: {run.aCount}</span>
                    <span style={{ color: "var(--amber)", fontWeight: 600 }}>B: {run.bCount}</span>
                    <span style={{ color: "var(--amber)" }}>HOLD: {run.holdCount}</span>
                    <span style={{ color: "var(--red)" }}>已淘汰: {run.eliminatedCount}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <Link
                    href={viewHref}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 7,
                      background: "var(--accent)",
                      color: "var(--paper)",
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    查看此批 →
                  </Link>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setRenamingId(run.id);
                      setRenameDraft(run.sourceLabel);
                    }}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--line)",
                      background: "var(--paper)",
                      color: "var(--ink)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    重命名
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleDelete(run)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--red)",
                      background: "var(--red-soft)",
                      color: "var(--red)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {isBusy ? "处理中…" : "删除"}
                  </button>
                </div>
              </div>
            );
          })
        )}

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              paddingTop: 10,
              borderTop: "1px solid var(--line)",
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <span>
              第 <strong style={{ color: "var(--ink)" }}>{safePage}</strong> / {totalPages} 页（共 {filteredRuns.length} 批）
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--surface-subtle)",
                  color: safePage <= 1 ? "var(--muted)" : "var(--ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: safePage <= 1 ? "not-allowed" : "pointer",
                }}
              >
                上一页
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: "5px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--line)",
                  background: "var(--surface-subtle)",
                  color: safePage >= totalPages ? "var(--muted)" : "var(--ink)",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: safePage >= totalPages ? "not-allowed" : "pointer",
                }}
              >
                下一页
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
