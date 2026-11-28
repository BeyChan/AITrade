"use client";

import { useState } from "react";
import type { PlatformPipelineConfig } from "@/lib/auto-pipeline/types";

const inputStyle: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid var(--line)",
  background: "var(--surface-subtle)",
  color: "var(--ink)",
};

export function PlatformConfigEditor(props: {
  initialConfig: PlatformPipelineConfig;
  busy: boolean;
  onClose: () => void;
  onSave: (config: PlatformPipelineConfig) => Promise<void>;
  onCreatePlatform: (input: { platformCode: string; marketCode: string; currency: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PlatformPipelineConfig>(() => structuredClone(props.initialConfig));
  const [newPlatformCode, setNewPlatformCode] = useState("");
  const [newMarketCode, setNewMarketCode] = useState("US");
  const [newCurrency, setNewCurrency] = useState("USD");

  const handleAdd = async () => {
    const p = newPlatformCode.trim().toLowerCase();
    const m = newMarketCode.trim().toUpperCase();
    if (!p || !m) return;
    await props.onCreatePlatform({
      platformCode: p,
      marketCode: m,
      currency: newCurrency.trim().toUpperCase() || "USD",
    });
    setNewPlatformCode("");
  };

  return (
    <section
      style={{
        background: "var(--paper)",
        border: "1px solid var(--accent)",
        borderRadius: 14,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
          平台规则配置：{draft.label}（{draft.platformCode} / {draft.marketCode}）
        </h2>
        <button
          type="button"
          onClick={props.onClose}
          style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13 }}
        >
          关闭
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          平台佣金率 (如 0.15)
          <input
            type="number"
            step="0.01"
            value={draft.economicsDefaults.referralRate}
            onChange={(e) =>
              setDraft({
                ...draft,
                economicsDefaults: { ...draft.economicsDefaults, referralRate: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          目标净利率门禁 (如 0.18)
          <input
            type="number"
            step="0.01"
            value={draft.economicsDefaults.targetMarginRate}
            onChange={(e) =>
              setDraft({
                ...draft,
                economicsDefaults: { ...draft.economicsDefaults, targetMarginRate: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          默认广告费率 (如 0.12)
          <input
            type="number"
            step="0.01"
            value={draft.economicsDefaults.adRate}
            onChange={(e) =>
              setDraft({
                ...draft,
                economicsDefaults: { ...draft.economicsDefaults, adRate: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          S 级最低净利率 (如 0.24)
          <input
            type="number"
            step="0.01"
            value={draft.thresholds.sGradeMinMargin}
            onChange={(e) =>
              setDraft({
                ...draft,
                thresholds: { ...draft.thresholds, sGradeMinMargin: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          最大评论中位数上限
          <input
            type="number"
            step="50"
            value={draft.thresholds.maxMedianReviews}
            onChange={(e) =>
              setDraft({
                ...draft,
                thresholds: { ...draft.thresholds, maxMedianReviews: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
          品牌 HHI 垄断上限
          <input
            type="number"
            step="100"
            value={draft.thresholds.maxHhi}
            onChange={(e) =>
              setDraft({
                ...draft,
                thresholds: { ...draft.thresholds, maxHhi: Number(e.target.value) },
              })
            }
            style={inputStyle}
          />
        </label>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          borderTop: "1px solid var(--line)",
          paddingTop: 12,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>新增其他平台/站点配置：</span>
          <input
            placeholder="平台码如 ebay / temu"
            value={newPlatformCode}
            onChange={(e) => setNewPlatformCode(e.target.value)}
            style={{ ...inputStyle, width: 140, fontSize: 12 }}
          />
          <input
            placeholder="站点如 US/DE"
            value={newMarketCode}
            onChange={(e) => setNewMarketCode(e.target.value)}
            style={{ ...inputStyle, width: 90, fontSize: 12 }}
          />
          <input
            placeholder="币种 USD"
            value={newCurrency}
            onChange={(e) => setNewCurrency(e.target.value)}
            style={{ ...inputStyle, width: 80, fontSize: 12 }}
          />
          <button
            type="button"
            disabled={props.busy || !newPlatformCode.trim()}
            onClick={() => void handleAdd()}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "var(--surface-subtle)",
              color: "var(--ink)",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            + 添加平台
          </button>
        </div>

        <button
          type="button"
          disabled={props.busy}
          onClick={() => void props.onSave(draft)}
          style={{
            padding: "8px 18px",
            borderRadius: 8,
            border: "none",
            background: "var(--accent)",
            color: "var(--paper)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          保存规则配置
        </button>
      </div>
    </section>
  );
}
