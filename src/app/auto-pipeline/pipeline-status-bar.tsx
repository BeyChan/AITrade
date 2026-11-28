"use client";

import type { PlatformPipelineConfig } from "@/lib/auto-pipeline/types";
import { btn, rowBetweenStyle, rowStyle } from "./ui-styles";

export type EnginePhase = "idle" | "running" | "done";

const STEPS = [
  { id: 1, label: "归一化去重", desc: "CSV · 扩展 · 收件箱", path: "M4 6h16M7 12h10M10 18h4" },
  { id: 2, label: "格局与合规快筛", desc: "HHI · CR3 · 合规红线", path: "M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" },
  { id: 3, label: "采购上限反推", desc: "18% 门禁反推 ¥ 天花板", path: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" },
  { id: 4, label: "S/A/B 分级落池", desc: "自动分级 · 避坑库查重", path: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z" },
];

export function PipelineStatusBar(props: {
  config: PlatformPipelineConfig;
  phase: EnginePhase;
  activeStep: number;
  autoWatch: boolean;
  busy: boolean;
  onToggleAutoWatch: () => void;
  onScanInbox: () => void;
}) {
  const { config, phase, activeStep, autoWatch, busy } = props;
  const engineClass =
    phase === "running" ? "ap-engine-core is-running" : autoWatch ? "ap-engine-core is-watching" : "ap-engine-core";
  const statusText =
    phase === "running"
      ? "涡轮引擎全速快筛中…"
      : phase === "done"
        ? "自动快筛已完成"
        : autoWatch
          ? "引擎自动巡检中 · 每 15s 监听收件箱"
          : "自动化快筛引擎运转中";

  return (
    <div className={`ap-pipeline-shell${phase === "running" ? " is-running" : ""}`}>
      <div style={{ ...rowBetweenStyle, position: "relative", zIndex: 1 }}>
        <div style={{ ...rowStyle, gap: 12 }}>
          <svg className={engineClass} viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <circle className="ap-engine-outer" cx="20" cy="20" r="17.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="8 5 2 5" strokeLinecap="round" opacity="0.85" />
            <circle className="ap-engine-mid" cx="20" cy="20" r="12.5" stroke="currentColor" strokeWidth="2" strokeDasharray="16 8 6 8" strokeLinecap="round" />
            <circle className="ap-engine-inner" cx="20" cy="20" r="7.5" stroke="currentColor" strokeWidth="1.8" strokeDasharray="6 6" strokeLinecap="round" opacity="0.9" />
            <circle className="ap-engine-hub" cx="20" cy="20" r="3.4" fill="currentColor" />
          </svg>

          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <strong style={{ fontSize: 13, color: "var(--ink)" }}>{statusText}</strong>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {config.label} · 净利率门禁 <strong>{(config.economicsDefaults.targetMarginRate * 100).toFixed(0)}%</strong> · S 级{" "}
              <strong>≥{(config.thresholds.sGradeMinMargin * 100).toFixed(0)}%</strong>
            </span>
          </div>
        </div>

        <div style={rowStyle}>
          <button
            type="button"
            disabled={busy}
            onClick={props.onScanInbox}
            style={{ ...btn.secondary, padding: "6px 12px", fontSize: 12 }}
            title={`手动扫描 ${config.inboxDir || `.data/inbox-csv/${config.platformCode}-${config.marketCode}`}`}
          >
            扫描收件箱
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={autoWatch}
            onClick={props.onToggleAutoWatch}
            style={{ ...(autoWatch ? btn.subtleAccent : btn.secondary), padding: "6px 12px", fontSize: 12 }}
            title="开启后每 15 秒自动探测收件箱，发现新 CSV 自动跑批并归档至 processed/"
          >
            {autoWatch ? "● 自动监听：开" : "○ 自动监听：关"}
          </button>
        </div>
      </div>

      <div className="ap-pipeline-grid">
        {STEPS.map((step, idx) => {
          const isDone = phase === "done" || (phase === "running" && activeStep > step.id);
          const isActive = phase === "running" && activeStep === step.id;
          const orbDur = phase === "running" ? "0.65s" : autoWatch ? "1.2s" : "1.8s";
          const glowId = `ap-glow-${step.id}`;

          return (
            <div key={step.id} style={{ display: "contents" }}>
              <div
                className={`ap-node${isDone ? " is-done" : isActive ? " is-active" : ""}`}
                style={{ animationDelay: `${idx * -1.1}s` }}
              >
                <span className="ap-node-icon" aria-hidden="true">
                  {isActive ? (
                    <span className="ap-node-spinner" />
                  ) : isDone ? (
                    "✓"
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={step.path} />
                    </svg>
                  )}
                </span>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isDone ? "var(--green)" : isActive ? "var(--accent)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {step.desc}
                  </div>
                </div>
              </div>

              {idx < STEPS.length - 1 && (
                <svg
                  className={`ap-pipeline-bridge${phase === "running" ? " is-running" : ""}${isDone ? " is-done" : ""}`}
                  viewBox="0 0 56 28"
                  fill="none"
                  aria-hidden="true"
                >
                  <defs>
                    <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2.6" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <path d="M5 14 H51" stroke="var(--line)" strokeWidth="2" />
                  <path
                    className="ap-bridge-dash"
                    d="M5 14 H51"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    filter={`url(#${glowId})`}
                  />
                  <circle cx="5" cy="14" r="3" fill="var(--paper)" stroke="currentColor" strokeWidth="1.8" />
                  <circle cx="51" cy="14" r="3" fill="var(--paper)" stroke="currentColor" strokeWidth="1.8" />
                  {!isDone && (
                    <circle r="3.6" fill="currentColor" filter={`url(#${glowId})`}>
                      <animateMotion
                        dur={orbDur}
                        begin={`${idx * 0.4}s`}
                        repeatCount="indefinite"
                        path="M 5 14 L 51 14"
                      />
                    </circle>
                  )}
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
