"use client";

import { useState } from "react";

export function CopyDraftButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1_800);
    } catch {
      setState("failed");
    }
  }

  return (
    <button type="button" className="button secondary" onClick={copy}>
      {state === "copied" ? "已复制" : state === "failed" ? "复制失败" : "复制草稿"}
    </button>
  );
}
