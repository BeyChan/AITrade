"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Props = {
  marketCode?: string;
  platformCode?: string;
  label?: string;
};

export function AddSelectionMenu({
  marketCode,
  platformCode,
  label = "+ 添加选品",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const buildDiscoverHref = (entry: "ai" | "competitor" | "sourcing") => {
    const qs = new URLSearchParams({ entry });
    if (marketCode) qs.set("market", marketCode);
    if (platformCode) qs.set("platform", platformCode);
    return `/discover?${qs.toString()}`;
  };

  const itemStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "9px 12px",
    borderRadius: 8,
    textDecoration: "none",
    color: "var(--ink)",
    background: "transparent",
    border: "none",
    textAlign: "left",
    width: "100%",
    cursor: "pointer",
  };

  return (
    <div ref={rootRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="button primary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      >
        <span>{label}</span>
        <span style={{ fontSize: 11, opacity: 0.85 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 272,
            padding: 6,
            borderRadius: 12,
            background: "var(--paper)",
            border: "1px solid var(--line)",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.16)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Link
            href={buildDiscoverHref("ai")}
            role="menuitem"
            style={itemStyle}
            onClick={() => setOpen(false)}
          >
            <strong style={{ fontSize: 13 }}>AI 类目找方向</strong>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              输入类目与红线约束，AI 发散候选方向进看板
            </span>
          </Link>

          <Link
            href={buildDiscoverHref("competitor")}
            role="menuitem"
            style={itemStyle}
            onClick={() => setOpen(false)}
          >
            <strong style={{ fontSize: 13 }}>从已确认竞品研报建品</strong>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              复用已核对竞品价格带与痛点直接进入选品看板
            </span>
          </Link>

          <Link
            href={buildDiscoverHref("sourcing")}
            role="menuitem"
            style={itemStyle}
            onClick={() => setOpen(false)}
          >
            <strong style={{ fontSize: 13 }}>从已确认成本核算单建品</strong>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              复用最新核算模型与毛利测算直接进入选品看板
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}
