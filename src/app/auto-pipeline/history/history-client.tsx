"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AutoPipelineRunSummary, PlatformPipelineConfig } from "@/lib/auto-pipeline/types";
import { btn, feedbackStyle, formatRunTime, inputStyle, panelStyle, rowBetweenStyle, rowStyle } from "../ui-styles";

const SOURCE_LABELS: Record<string, string> = {
  csv: "CSV 上传",
  extension: "Chrome 扩展",
  inbox: "收件箱扫描",
  api: "API",
};

const PAGE_SIZE = 20;

export function AutoPipelineHistoryClient(props: {
  initialConfigs: PlatformPipelineConfig[];
  initialRuns: AutoPipelineRunSummary[];
  initialPlatform: string;
  initialMarket: string;
}) {
  const [runs, setRuns] = useState(props.initialRuns);
  const initialKey =
    props.initialPlatform !== "ALL" && props.initialMarket !== "ALL"
      ? `${props.initialPlatform}:${props.initialMarket}`
      : "ALL";
  const [selectedConfigKey, setSelectedConfigKey] = useState(
    initialKey === "ALL" || props.initialConfigs.some((c) => c.id === initialKey) ? initialKey : "ALL",
  );
  const [sourceFilter, setSourceFilter] = useState("ALL");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const configLabelMap = useMemo(
    () => new Map(props.initialConfigs.map((c) => [`${c.platformCode}:${c.marketCode}`, c.label])),
    [props.initialConfigs],
  );

  const filteredRuns = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return runs.filter((r) => {
      if (selectedConfigKey !== "ALL" && `${r.platformCode}:${r.marketCode}` !== selectedConfigKey) return false;
      if (sourceFilter !== "ALL" && r.sourceType !== sourceFilter) return false;
      return !kw || `${r.sourceLabel} ${r.platformCode} ${r.marketCode} ${r.sourceType}`.toLowerCase().includes(kw);
    });
  }, [runs, selectedConfigKey, sourceFilter, keyword]);

  const totalPages = Math.max(1, Math.ceil(filteredRuns.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRuns = useMemo(() => filteredRuns.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [filteredRuns, safePage]);

  const backHref = useMemo(() => {
    const [p, m] = selectedConfigKey.split(":");
    return selectedConfigKey !== "ALL" && p && m
      ? `/auto-pipeline?platform=${encodeURIComponent(p)}&market=${encodeURIComponent(m)}`
      : "/auto-pipeline";
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
    if (!window.confirm(`确认删除批次「${run.sourceLabel}」（共 ${run.totalSeeds} 条候选）？\n\n仅删除该批次的选品快照，不影响已推进生成的正式商品案卷。`)) {
      return;
    }
    setBusyId(run.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/auto-pipeline/runs/${encodeURIComponent(run.id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除批次失败");
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
      setFeedback({ kind: "ok", text: `已删除批次「${run.sourceLabel}」（移除 ${data.deletedCandidates ?? run.totalSeeds} 条快照）。` });
    } catch (err) {
      setFeedback({ kind: "err", text: err instanceof Error ? err.message : "删除失败" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={{ ...panelStyle, padding: 20 }}>
        <div style={{ ...rowBetweenStyle, alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink)" }}>历史自动选品批次</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--muted)" }}>
              每批保留独立历史快照；点击任意批次即可进入自动选品查看该批详情，删除批次不影响已推进的正式商品案卷。
            </p>
          </div>
          <Link href={backHref} style={{ ...btn.secondary, padding: "8px 14px", fontSize: 13 }}>
            ← 返回自动选品
          </Link>
        </div>

        <div style={rowStyle}>
          <select value={selectedConfigKey} onChange={(e) => { setSelectedConfigKey(e.target.value); setPage(1); }} style={{ ...inputStyle, fontWeight: 600 }}>
            <option value="ALL">全部平台与站点</option>
            {props.initialConfigs.map((cfg) => (
              <option key={cfg.id} value={cfg.id}>{cfg.label} ({cfg.currency})</option>
            ))}
          </select>

          <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }} style={inputStyle}>
            <option value="ALL">全部来源</option>
            <option value="csv">CSV 上传</option>
            <option value="extension">Chrome 扩展</option>
            <option value="inbox">收件箱扫描</option>
            <option value="api">API</option>
          </select>

          <input value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} placeholder="搜索批次名称…" style={{ ...inputStyle, minWidth: 220 }} />
          <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
            共 <strong style={{ color: "var(--ink)" }}>{filteredRuns.length}</strong> 个批次
          </span>
        </div>

        {feedback && <div style={feedbackStyle(feedback.kind)}>{feedback.text}</div>}
      </section>

      <section style={panelStyle}>
        {pagedRuns.length === 0 ? (
          <div style={{ padding: 36, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>暂无符合条件的历史选品批次。</div>
        ) : (
          pagedRuns.map((run, idx) => {
            const globalIdx = (safePage - 1) * PAGE_SIZE + idx;
            const platformLabel = configLabelMap.get(`${run.platformCode}:${run.marketCode}`) || `${run.platformCode.toUpperCase()} / ${run.marketCode}`;
            const viewHref = `/auto-pipeline?platform=${encodeURIComponent(run.platformCode)}&market=${encodeURIComponent(run.marketCode)}&runId=${encodeURIComponent(run.id)}`;
            const isBusy = busyId === run.id;

            return (
              <div
                key={run.id}
                style={{
                  ...rowBetweenStyle,
                  border: "1px solid var(--line)",
                  borderRadius: 10,
                  padding: 14,
                  background: "var(--surface-subtle)",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
                  <div style={rowStyle}>
                    {globalIdx === 0 && (
                      <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
                        最新
                      </span>
                    )}
                    {renamingId === run.id ? (
                      <div style={rowStyle}>
                        <input value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)} placeholder="输入批次名称" style={{ ...inputStyle, width: 220, border: "1px solid var(--accent)", background: "var(--paper)" }} />
                        <button type="button" disabled={isBusy || !renameDraft.trim()} onClick={() => void handleRename(run.id)} style={btn.primary}>保存</button>
                        <button type="button" onClick={() => setRenamingId(null)} style={btn.secondary}>取消</button>
                      </div>
                    ) : (
                      <strong style={{ fontSize: 15, color: "var(--ink)" }}>{run.sourceLabel}</strong>
                    )}
                    <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 5, border: "1px solid var(--line)", color: "var(--muted)" }}>{platformLabel}</span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>{SOURCE_LABELS[run.sourceType] ?? run.sourceType} · {formatRunTime(run.createdAt, true)}</span>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
                    <span>共 <strong style={{ color: "var(--ink)" }}>{run.totalSeeds}</strong> 条</span>
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>S: {run.sCount}</span>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>A: {run.aCount}</span>
                    <span style={{ color: "var(--amber)", fontWeight: 600 }}>B: {run.bCount}</span>
                    <span style={{ color: "var(--amber)" }}>HOLD: {run.holdCount}</span>
                    <span style={{ color: "var(--red)" }}>已淘汰: {run.eliminatedCount}</span>
                  </div>
                </div>

                <div style={rowStyle}>
                  <Link href={viewHref} style={btn.subtleAccent}>查看此批 →</Link>
                  <button type="button" disabled={isBusy} onClick={() => { setRenamingId(run.id); setRenameDraft(run.sourceLabel); }} style={btn.secondary}>重命名</button>
                  <button type="button" disabled={isBusy} onClick={() => void handleDelete(run)} style={btn.danger}>{isBusy ? "处理中…" : "删除"}</button>
                </div>
              </div>
            );
          })
        )}

        {totalPages > 1 && (
          <div style={{ ...rowBetweenStyle, paddingTop: 10, borderTop: "1px solid var(--line)", fontSize: 12, color: "var(--muted)" }}>
            <span>第 <strong style={{ color: "var(--ink)" }}>{safePage}</strong> / {totalPages} 页（共 {filteredRuns.length} 批）</span>
            <div style={rowStyle}>
              <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} style={safePage <= 1 ? btn.disabled : btn.secondary}>上一页</button>
              <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} style={safePage >= totalPages ? btn.disabled : btn.secondary}>下一页</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
