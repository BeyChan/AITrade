"use client";

import { useState, useTransition } from "react";
import type { AppMode } from "@/lib/app-mode";
import { setAppModeAction, resetDemoDataAction } from "@/lib/app-mode-actions";

type ModeSwitcherProps = {
  currentMode: AppMode;
};

export function ModeSwitcher({ currentMode }: ModeSwitcherProps) {
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
    <div className={`mode-switcher-card ${isSandbox ? "mode-sandbox" : "mode-live"}`}>
      {/* 分段双选控制器：真实数据 vs 演示模式 */}
      <div className="mode-segmented-control" role="group" aria-label="数据环境切换">
        <button
          type="button"
          disabled={isPending || isResetting}
          onClick={() => switchMode("live")}
          className={`mode-seg-btn ${!isSandbox ? "active-live" : ""}`}
          title="切换至真实数据环境"
        >
          <span className={`mode-indicator-dot ${!isSandbox ? "dot-live" : "dot-dim"}`} />
          <span>真实数据</span>
        </button>
        <button
          type="button"
          disabled={isPending || isResetting}
          onClick={() => switchMode("sandbox")}
          className={`mode-seg-btn ${isSandbox ? "active-sandbox" : ""}`}
          title="切换至演示体验环境"
        >
          <span className={`mode-indicator-dot ${isSandbox ? "dot-sandbox" : "dot-dim"}`} />
          <span>演示模式</span>
        </button>
      </div>

      <p className="mode-desc">
        {isSandbox ? "当前使用演示样板与模拟测试店铺" : "当前仅展示真实店铺与核准数据"}
      </p>

      {/* 演示模式下提供一键重置功能 */}
      {isSandbox ? (
        <div className="mode-sandbox-actions">
          {showConfirm ? (
            <div className="mode-reset-confirm">
              <span className="mode-confirm-text">将演示数据恢复为初始样板？</span>
              <div className="mode-confirm-buttons">
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={handleReset}
                  className="mode-btn-confirm"
                >
                  {isResetting ? "重置中..." : "确定重置"}
                </button>
                <button
                  type="button"
                  disabled={isResetting}
                  onClick={() => setShowConfirm(false)}
                  className="mode-btn-cancel"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={isPending || isResetting}
              onClick={() => setShowConfirm(true)}
              className="mode-reset-button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              <span>重置演示样板数据</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
