"use client";

import { useFormStatus } from "react-dom";

export function GenerateResearchButton() {
  const { pending } = useFormStatus();

  return (
    <div className="ai-generation-actions">
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? "AI 正在生成，请勿重复提交…" : "生成 5 个候选方向"}
      </button>
      <span className="ai-generation-status" role="status" aria-live="polite">
        {pending ? "通常需要 10–30 秒，请保持页面打开。" : ""}
      </span>
    </div>
  );
}
