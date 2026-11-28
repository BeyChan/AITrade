"use client";

import Link from "next/link";
import type { AutoCandidateResult, AutoGrade } from "@/lib/auto-pipeline/types";

function gradeBadgeStyle(grade: AutoGrade): React.CSSProperties {
  if (grade === "S") {
    return { background: "var(--green-soft)", color: "var(--green)", border: "1px solid var(--green)" };
  }
  if (grade === "A") {
    return { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" };
  }
  if (grade === "B" || grade === "HOLD") {
    return { background: "var(--amber-soft)", color: "var(--amber)", border: "1px solid var(--amber)" };
  }
  return { background: "var(--red-soft)", color: "var(--red)", border: "1px solid var(--red)" };
}

export function CandidateCard(props: {
  item: AutoCandidateResult;
  checked: boolean;
  busy: boolean;
  promoting: boolean;
  deleting: boolean;
  onToggleSelect: (id: string) => void;
  onPromote: (id: string) => void;
  onDelete: (item: AutoCandidateResult) => void;
}) {
  const { item } = props;

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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="checkbox"
            checked={props.checked}
            onChange={() => props.onToggleSelect(item.id)}
            aria-label={`选择 ${item.externalId}`}
            style={{ cursor: "pointer" }}
          />
          <span
            style={{
              ...gradeBadgeStyle(item.grade),
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {item.grade} 级
          </span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{item.externalId}</span>
          <strong style={{ fontSize: 14, color: "var(--ink)" }}>{item.title}</strong>
          <span style={{ fontSize: 11, color: "var(--muted)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--line)" }}>
            估算快筛 · {item.verdict}
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <a
            href={`/api/sourcing/1688-search?q=${encodeURIComponent(item.title.slice(0, 40))}`}
            target="_blank"
            rel="noreferrer"
            style={{
              padding: "6px 10px",
              borderRadius: 7,
              border: "1px solid var(--line)",
              background: "var(--paper)",
              color: "var(--ink)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            按 ≤¥{item.maxLandedCostCny.toFixed(1)} 去 1688 找厂
          </a>

          {item.promotedCaseId ? (
            <Link
              href={`/cases/${item.promotedCaseId}`}
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                background: "var(--green-soft)",
                color: "var(--green)",
                border: "1px solid var(--green)",
                fontSize: 12,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              查看正式案卷 →
            </Link>
          ) : (
            <button
              type="button"
              disabled={props.promoting || item.grade === "ELIMINATED"}
              onClick={() => props.onPromote(item.id)}
              style={{
                padding: "6px 12px",
                borderRadius: 7,
                border: "none",
                background: item.grade === "ELIMINATED" ? "var(--line)" : "var(--accent)",
                color: item.grade === "ELIMINATED" ? "var(--muted)" : "var(--paper)",
                fontSize: 12,
                fontWeight: 600,
                cursor: item.grade === "ELIMINATED" ? "not-allowed" : "pointer",
              }}
            >
              {props.promoting ? "推进中…" : "推进为商品案卷"}
            </button>
          )}

          <button
            type="button"
            disabled={props.deleting || props.busy}
            onClick={() => props.onDelete(item)}
            style={{
              padding: "6px 10px",
              borderRadius: 7,
              border: "1px solid var(--line)",
              background: "var(--paper)",
              color: "var(--red)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
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
                background:
                  r.severity === "fail"
                    ? "var(--red-soft)"
                    : r.severity === "warn"
                      ? "var(--amber-soft)"
                      : "var(--green-soft)",
                color:
                  r.severity === "fail"
                    ? "var(--red)"
                    : r.severity === "warn"
                      ? "var(--amber)"
                      : "var(--green)",
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
