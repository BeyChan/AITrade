"use client";

import { useState } from "react";

export type StoryboardShotItem = {
  shot: number;
  durationSec: number;
  role: string;
  visualPrompt: string;
  captionEn: string;
  captionZh: string;
};

type Props = {
  title: string;
  metaBadge?: string;
  prompt: string;
  negativePrompt: string;
  onPromptChange: (value: string) => void;
  onNegativePromptChange: (value: string) => void;
  storyboard?: StoryboardShotItem[];
  onAiRefine?: () => void;
  aiRefining?: boolean;
  confirmed: boolean;
  onConfirmedChange: (value: boolean) => void;
  confirmLabel: string;
  actor: string;
  onActorChange: (value: string) => void;
  submitLabel: string;
  submitting: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void;
};

export function StudioPromptCard({
  title,
  metaBadge,
  prompt,
  negativePrompt,
  onPromptChange,
  onNegativePromptChange,
  storyboard,
  onAiRefine,
  aiRefining,
  confirmed,
  onConfirmedChange,
  confirmLabel,
  actor,
  onActorChange,
  submitLabel,
  submitting,
  submitDisabled,
  onSubmit,
}: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <section className="panel" style={{ padding: "18px 20px", display: "grid", gap: "14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "14px", color: "var(--ink)" }}>{title}</strong>
          {metaBadge ? <span className="badge badge-neutral">{metaBadge}</span> : null}
        </div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {onAiRefine ? (
            <button
              type="button"
              className="button secondary"
              style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
              disabled={aiRefining}
              onClick={onAiRefine}
            >
              {aiRefining ? "AI 润色中..." : "✨ AI 重新润色"}
            </button>
          ) : null}
          <button
            type="button"
            className="button ghost"
            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
            onClick={handleCopy}
          >
            {copied ? "✓ 已复制" : "复制 Prompt"}
          </button>
        </div>
      </div>

      {storyboard && storyboard.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "8px" }}>
          {storyboard.map((shot) => (
            <div
              key={shot.shot}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                display: "grid",
                gap: "4px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)" }}>
                镜头 {shot.shot}（{shot.durationSec}s）· {shot.role}
              </div>
              <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.45 }}>{shot.captionEn}</div>
              <div style={{ fontSize: "12px", color: "var(--muted)" }}>{shot.captionZh}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="field" style={{ margin: 0 }}>
        <label>英文提示词（可直接微调）</label>
        <textarea rows={4} value={prompt} onChange={(e) => onPromptChange(e.target.value)} />
      </div>

      <details className="studio-more-details">
        <summary>负向禁止项（Negative Prompt）</summary>
        <div className="studio-more-body">
          <textarea
            rows={2}
            value={negativePrompt}
            onChange={(e) => onNegativePromptChange(e.target.value)}
            placeholder="watermarks, text overlay, flickering, distorted geometry..."
          />
        </div>
      </details>

      <div className="studio-confirm-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--ink)", cursor: "pointer" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
          <span>{confirmLabel}</span>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <input
            type="text"
            value={actor}
            onChange={(e) => onActorChange(e.target.value)}
            placeholder="操作人"
            style={{ width: "100px", padding: "6px 10px", fontSize: "12px" }}
          />
          <button
            type="button"
            className="button primary"
            disabled={!confirmed || submitting || submitDisabled}
            onClick={onSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </section>
  );
}
