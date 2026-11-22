"use client";

import { useState, useTransition } from "react";
import type { AppMode } from "@/lib/app-mode";
import { resetDemoDataAction, setAppModeAction } from "@/lib/app-mode-actions";

type GeneralSettingsPanelProps = {
  currentMode: AppMode;
};

export function GeneralSettingsPanel({ currentMode }: GeneralSettingsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [isResetting, startResetTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);

  const isSandbox = currentMode === "sandbox";

  function switchMode(targetMode: AppMode) {
    if (targetMode === currentMode) return;
    startTransition(async () => {
      await setAppModeAction(targetMode);
    });
  }

  function handleReset() {
    startResetTransition(async () => {
      await resetDemoDataAction();
      setShowConfirm(false);
    });
  }

  return (
    <section
      className="panel settings-info-card"
      style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "18px" }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
          <div className="eyebrow" style={{ margin: 0 }}>工作区数据环境</div>
          <span className={`badge ${isSandbox ? "badge-warn" : "badge-success"}`}>
            {isSandbox ? "当前：演示模式" : "当前：真实数据"}
          </span>
        </div>
        <h2 style={{ margin: "0 0 6px" }}>真实数据 / 演示模式</h2>
        <p className="muted" style={{ margin: 0, fontSize: "13px" }}>
          演示模式提供内置样板熟悉流程；切回「真实数据」后仅展示你的真实选品、报价与实盘账本。
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }} role="radiogroup" aria-label="数据环境选择">
        <button
          type="button"
          role="radio"
          aria-checked={!isSandbox}
          disabled={isPending || isResetting}
          onClick={() => switchMode("live")}
          style={{
            textAlign: "left",
            padding: "14px 16px",
            borderRadius: "10px",
            cursor: isPending ? "wait" : "pointer",
            background: !isSandbox ? "var(--green-soft)" : "var(--canvas)",
            border: !isSandbox ? "1.5px solid var(--green)" : "1px solid var(--line)",
            color: "var(--ink)",
            transition: "border-color 0.15s ease, background 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: 700, fontSize: "14px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: !isSandbox ? "var(--green)" : "var(--muted)" }} />
              真实数据
            </span>
            {!isSandbox ? (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)" }}>已启用</span>
            ) : null}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
            仅展示核准的真实业务案卷、工厂报价与实盘记录。
          </div>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={isSandbox}
          disabled={isPending || isResetting}
          onClick={() => switchMode("sandbox")}
          style={{
            textAlign: "left",
            padding: "14px 16px",
            borderRadius: "10px",
            cursor: isPending ? "wait" : "pointer",
            background: isSandbox ? "var(--amber-soft)" : "var(--canvas)",
            border: isSandbox ? "1.5px solid var(--amber)" : "1px solid var(--line)",
            color: "var(--ink)",
            transition: "border-color 0.15s ease, background 0.15s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", fontWeight: 700, fontSize: "14px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "999px", background: isSandbox ? "var(--amber)" : "var(--muted)" }} />
              演示模式
            </span>
            {isSandbox ? (
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--amber)" }}>已启用</span>
            ) : null}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
            加载固定样板数据，可安全演练立项与导出，不污染实盘。
          </div>
        </button>
      </div>

      {isSandbox ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            flexWrap: "wrap",
            paddingTop: "12px",
            borderTop: "1px solid var(--line)",
            fontSize: "12px",
            color: "var(--muted)",
          }}
        >
          <span>{showConfirm ? "确认将演示样板恢复为初始状态？" : "演示环境数据支持随时一键还原初始样板。"}</span>
          {showConfirm ? (
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="button primary" style={{ padding: "5px 12px", fontSize: "12px" }} disabled={isResetting} onClick={handleReset}>
                {isResetting ? "重置中…" : "确认重置"}
              </button>
              <button type="button" className="button secondary" style={{ padding: "5px 12px", fontSize: "12px" }} disabled={isResetting} onClick={() => setShowConfirm(false)}>
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button secondary"
              style={{ padding: "5px 12px", fontSize: "12px" }}
              disabled={isPending || isResetting}
              onClick={() => setShowConfirm(true)}
            >
              重置演示样板数据
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
