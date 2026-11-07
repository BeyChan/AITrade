"use client";

import { useTransition } from "react";
import type { AppMode } from "@/lib/app-mode";
import { setAppModeAction } from "@/lib/app-mode-actions";

type SandboxBannerProps = {
  mode: AppMode;
};

export function SandboxBanner({ mode }: SandboxBannerProps) {
  const [isPending, startTransition] = useTransition();

  if (mode !== "sandbox") {
    return null;
  }

  function handleSwitchToLive() {
    startTransition(async () => {
      await setAppModeAction("live");
    });
  }

  return (
    <aside className="sandbox-banner" role="status" aria-label="沙盒环境提示">
      <div className="sandbox-banner-content">
        <span className="sandbox-banner-icon" aria-hidden="true">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </span>
        <div className="sandbox-banner-text">
          <strong>当前处于「模拟沙盒」体验模式</strong>
          <span>— 所展示的数据为演示样板，供全流程演练。在此模式下的所有修改不会写入真实店铺。</span>
        </div>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleSwitchToLive}
        className="sandbox-banner-switch-btn"
      >
        {isPending ? "切换中..." : "切换为真实数据"}
      </button>
    </aside>
  );
}
