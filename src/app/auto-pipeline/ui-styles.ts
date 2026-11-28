import type { CSSProperties } from "react";
import type { AutoGrade } from "@/lib/auto-pipeline/types";

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
