"use client";

import { useState } from "react";
import type { PlatformPipelineConfig } from "@/lib/auto-pipeline/types";
import { btn, inputStyle, panelStyle, rowBetweenStyle, rowStyle } from "./ui-styles";

type NumericField = {
  label: string;
  step: string;
  get: (c: PlatformPipelineConfig) => number;
  set: (c: PlatformPipelineConfig, v: number) => PlatformPipelineConfig;
};

const FIELDS: NumericField[] = [
  {
    label: "平台佣金率 (如 0.15)",
    step: "0.01",
    get: (c) => c.economicsDefaults.referralRate,
    set: (c, v) => ({ ...c, economicsDefaults: { ...c.economicsDefaults, referralRate: v } }),
  },
  {
    label: "目标净利率门禁 (如 0.18)",
    step: "0.01",
    get: (c) => c.economicsDefaults.targetMarginRate,
    set: (c, v) => ({ ...c, economicsDefaults: { ...c.economicsDefaults, targetMarginRate: v } }),
  },
  {
    label: "默认广告费率 (如 0.12)",
    step: "0.01",
    get: (c) => c.economicsDefaults.adRate,
    set: (c, v) => ({ ...c, economicsDefaults: { ...c.economicsDefaults, adRate: v } }),
  },
  {
    label: "S 级最低净利率 (如 0.24)",
    step: "0.01",
    get: (c) => c.thresholds.sGradeMinMargin,
    set: (c, v) => ({ ...c, thresholds: { ...c.thresholds, sGradeMinMargin: v } }),
  },
  {
    label: "最大评论中位数上限",
    step: "50",
    get: (c) => c.thresholds.maxMedianReviews,
    set: (c, v) => ({ ...c, thresholds: { ...c.thresholds, maxMedianReviews: v } }),
  },
  {
    label: "品牌 HHI 垄断上限",
    step: "100",
    get: (c) => c.thresholds.maxHhi,
    set: (c, v) => ({ ...c, thresholds: { ...c.thresholds, maxHhi: v } }),
  },
];

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
    await props.onCreatePlatform({ platformCode: p, marketCode: m, currency: newCurrency.trim().toUpperCase() || "USD" });
    setNewPlatformCode("");
  };

  return (
    <section style={{ ...panelStyle, padding: 20, border: "1px solid var(--accent)" }}>
      <div style={rowBetweenStyle}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
          平台规则配置：{draft.label}（{draft.platformCode} / {draft.marketCode}）
        </h2>
        <button type="button" onClick={props.onClose} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 13 }}>
          关闭
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        {FIELDS.map((f) => (
          <label key={f.label} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--muted)" }}>
            {f.label}
            <input type="number" step={f.step} value={f.get(draft)} onChange={(e) => setDraft((c) => f.set(c, Number(e.target.value)))} style={inputStyle} />
          </label>
        ))}
      </div>

      <div style={{ ...rowBetweenStyle, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        <div style={rowStyle}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>新增其他平台/站点：</span>
          <input placeholder="平台码如 ebay / temu" value={newPlatformCode} onChange={(e) => setNewPlatformCode(e.target.value)} style={{ ...inputStyle, width: 140, fontSize: 12 }} />
          <input placeholder="站点如 US/DE" value={newMarketCode} onChange={(e) => setNewMarketCode(e.target.value)} style={{ ...inputStyle, width: 90, fontSize: 12 }} />
          <input placeholder="币种 USD" value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} style={{ ...inputStyle, width: 80, fontSize: 12 }} />
          <button type="button" disabled={props.busy || !newPlatformCode.trim()} onClick={() => void handleAdd()} style={btn.secondary}>
            + 添加平台
          </button>
        </div>

        <button type="button" disabled={props.busy} onClick={() => void props.onSave(draft)} style={{ ...btn.primary, padding: "8px 18px", fontSize: 13 }}>
          保存规则配置
        </button>
      </div>
    </section>
  );
}
