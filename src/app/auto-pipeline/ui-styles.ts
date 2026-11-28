import type { CSSProperties } from "react";
import type { AutoCandidateResult, AutoGrade } from "@/lib/auto-pipeline/types";

export type CandidateFunnelState =
  | { kind: "promoted"; label: "已进商品案卷"; href: string }
  | { kind: "adopted"; label: "已进选品看板"; href: string }
  | { kind: "eliminated"; label: "已淘汰" }
  | { kind: "pending"; label: "待分诊" };

/**
 * 选品初筛候选项的唯一互斥漏斗状态（严格按下游优先于上游排序）：
 * 1. promoted   → 已进入正式「我的商品」案卷（不再回流看板）
 * 2. eliminated → 已淘汰（不可采纳或直达案卷）
 * 3. adopted    → 已采纳入「选品看板」（可跳转看板或安全取消采纳）
 * 4. pending    → 待分诊（可采纳进看板 / 淘汰入避坑库 / S·A 级快轨直达案卷）
 */
export function resolveCandidateFunnelState(item: AutoCandidateResult): CandidateFunnelState {
  if (item.promotedCaseId) {
    return {
      kind: "promoted",
      label: "已进商品案卷",
      href: `/cases/${encodeURIComponent(item.promotedCaseId)}`,
    };
  }
  if (item.grade === "ELIMINATED") {
    return { kind: "eliminated", label: "已淘汰" };
  }
  if (item.adoptedRunId && item.adoptedHypothesisId) {
    return {
      kind: "adopted",
      label: "已进选品看板",
      href: `/ai-sourcing/${encodeURIComponent(item.adoptedRunId)}?hypothesisId=${encodeURIComponent(item.adoptedHypothesisId)}`,
    };
  }
  return { kind: "pending", label: "待分诊" };
}

export const panelStyle: CSSProperties = {
  background: "var(--paper)",
  border: "1px solid var(--line)",
  borderRadius: 14,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

export const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

export const rowBetweenStyle: CSSProperties = {
  ...rowStyle,
  justifyContent: "space-between",
};

export const inputStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: 7,
  border: "1px solid var(--line)",
  background: "var(--surface-subtle)",
  color: "var(--ink)",
  fontSize: 13,
};

const baseBtn: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 7,
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

export const btn = {
  primary: { ...baseBtn, border: "1px solid var(--deep)", background: "var(--deep)", color: "var(--paper)" } as CSSProperties,
  secondary: { ...baseBtn, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)" } as CSSProperties,
  subtleAccent: { ...baseBtn, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" } as CSSProperties,
  subtleGood: { ...baseBtn, border: "1px solid var(--green)", background: "var(--green-soft)", color: "var(--green)" } as CSSProperties,
  danger: { ...baseBtn, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--red)" } as CSSProperties,
  disabled: { ...baseBtn, border: "1px solid var(--line)", background: "var(--surface-subtle)", color: "var(--muted)", cursor: "not-allowed" } as CSSProperties,
};

export function pillStyle(active: boolean, mutedWhenInactive = false): CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    background: active ? "var(--accent-soft)" : "var(--paper)",
    color: active ? "var(--accent)" : mutedWhenInactive ? "var(--muted)" : "var(--ink)",
    fontSize: 12,
    fontWeight: active ? 700 : 600,
  };
}

export function feedbackStyle(kind: "ok" | "err"): CSSProperties {
  const ok = kind === "ok";
  return {
    padding: "10px 14px",
    borderRadius: 8,
    fontSize: 13,
    background: ok ? "var(--green-soft)" : "var(--red-soft)",
    color: ok ? "var(--green)" : "var(--red)",
    border: `1px solid ${ok ? "var(--green)" : "var(--red)"}`,
  };
}

export function gradeBadgeStyle(grade: AutoGrade): CSSProperties {
  if (grade === "S") return { background: "var(--green-soft)", color: "var(--green)", border: "1px solid var(--green)" };
  if (grade === "A") return { background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent)" };
  if (grade === "B" || grade === "HOLD") return { background: "var(--amber-soft)", color: "var(--amber)", border: "1px solid var(--amber)" };
  return { background: "var(--red-soft)", color: "var(--red)", border: "1px solid var(--red)" };
}

export function formatRunTime(iso?: string | null, withYear = false): string {
  if (!iso) return withYear ? "—" : "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return withYear ? "—" : "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return withYear ? `${d.getFullYear()}-${base}` : base;
}
