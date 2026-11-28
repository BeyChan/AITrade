"use client";

import Link from "next/link";
import type { AutoCandidateResult } from "@/lib/auto-pipeline/types";
import type { EliminatedHistoryRecord } from "@/lib/sourcing-funnel";
import { btn, gradeBadgeStyle, rowBetweenStyle, rowStyle } from "./ui-styles";

export function CandidateCard(props: {
  item: AutoCandidateResult;
  blacklistHit?: EliminatedHistoryRecord | null;
  checked: boolean;
  busy: boolean;
  adopting: boolean;
  unadopting: boolean;
  promoting: boolean;
  unpromoting: boolean;
  deleting: boolean;
  onToggleSelect: (id: string) => void;
  onOpenDrawer: (item: AutoCandidateResult) => void;
  onAdopt: (id: string) => void;
  onUnadopt: (item: AutoCandidateResult) => void;
  onPromote: (id: string) => void;
  onUnpromote: (item: AutoCandidateResult) => void;
  onDelete: (item: AutoCandidateResult) => void;
}) {
  const { item, blacklistHit } = props;
  const isAdopted = Boolean(item.adoptedRunId && item.adoptedHypothesisId);
  const kanbanHref = isAdopted
    ? `/ai-sourcing/${encodeURIComponent(item.adoptedRunId!)}?hypothesisId=${encodeURIComponent(item.adoptedHypothesisId!)}`
    : "";

  return (
    <div
      style={{
        border: `1px solid ${props.checked ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 10,
        padding: 14,
        background: "var(--surface-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ ...rowBetweenStyle, alignItems: "flex-start" }}>
        <div style={{ ...rowStyle, gap: 10 }}>
          <input type="checkbox" checked={props.checked} onChange={() => props.onToggleSelect(item.id)} aria-label={`选择 ${item.externalId}`} />
          <span style={{ ...gradeBadgeStyle(item.grade), padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
            {item.grade} 级
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{item.externalId}</span>
          <strong style={{ fontSize: 14, color: "var(--ink)", cursor: "pointer" }} onClick={() => props.onOpenDrawer(item)}>
            {item.title}
          </strong>
          <span style={{ fontSize: 11, color: "var(--muted)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--line)" }}>
            估算快筛 · {item.verdict}
          </span>
          {blacklistHit && (
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "var(--red-soft)", color: "var(--red)", fontWeight: 600 }}>
              ⚠ 历史已淘汰：{blacklistHit.eliminationReason}
            </span>
          )}
        </div>

        <div style={rowStyle}>
          {isAdopted ? (
            <>
              <Link href={kanbanHref} style={btn.subtleGood}>
                查看看板 →
              </Link>
              <button
                type="button"
                disabled={props.unadopting || props.busy}
                onClick={() => props.onUnadopt(item)}
                style={btn.secondary}
              >
                {props.unadopting ? "取消中…" : "取消采纳"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={props.adopting || props.busy || item.grade === "ELIMINATED"}
              onClick={() => props.onAdopt(item.id)}
              style={item.grade === "ELIMINATED" ? btn.disabled : btn.subtleAccent}
            >
              {props.adopting ? "采纳中…" : "采纳进看板"}
            </button>
          )}

          <button type="button" onClick={() => props.onOpenDrawer(item)} style={btn.secondary}>
            详情
          </button>

          <a href={`/api/sourcing/1688-search?q=${encodeURIComponent(item.title.slice(0, 40))}`} target="_blank" rel="noreferrer" style={btn.secondary}>
            1688 找厂
          </a>

          {item.promotedCaseId ? (
            <>
              <Link href={`/cases/${item.promotedCaseId}`} style={btn.subtleGood}>
                正式案卷 →
              </Link>
              <button type="button" disabled={props.unpromoting || props.busy} onClick={() => props.onUnpromote(item)} style={btn.secondary}>
                {props.unpromoting ? "取消中…" : "取消直达"}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={props.promoting || props.busy || item.grade === "ELIMINATED"}
              onClick={() => props.onPromote(item.id)}
              style={item.grade === "ELIMINATED" ? btn.disabled : btn.secondary}
              title="快轨通道：直接创建正式商品案卷（初始 HOLD）"
            >
              {props.promoting ? "推进中…" : "快轨案卷"}
            </button>
          )}

          <button type="button" disabled={props.deleting || props.busy} onClick={() => props.onDelete(item)} style={btn.danger}>
            {props.deleting ? "删除中…" : "删除"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--muted)" }}>
        <span>售价：<strong style={{ color: "var(--ink)" }}>{(item.priceCents / 100).toFixed(2)} {item.currency}</strong></span>
        <span>估算净利率：<strong style={{ color: "var(--ink)" }}>{(item.estimatedMarginRate * 100).toFixed(1)}%</strong></span>
        <span>机会分：<strong style={{ color: "var(--ink)" }}>{item.score}</strong></span>
        <span>达标采购天花板：<strong style={{ color: "var(--green)" }}>≤ ¥{item.maxLandedCostCny.toFixed(1)}</strong></span>
        <span>评论：{item.reviewCount.toLocaleString()} · 评分：{item.rating ?? "—"}</span>
        <span>品牌：{item.brand || "未识别"}</span>
      </div>

      {item.reasons.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {item.reasons.map((r, idx) => (
            <span
              key={`${item.id}-r-${idx}`}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                background: r.severity === "fail" ? "var(--red-soft)" : r.severity === "warn" ? "var(--amber-soft)" : "var(--green-soft)",
                color: r.severity === "fail" ? "var(--red)" : r.severity === "warn" ? "var(--amber)" : "var(--green)",
              }}
            >
              {r.message}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
