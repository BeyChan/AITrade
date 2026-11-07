"use client";

import { useState, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { archiveCaseAction, restoreCaseAction } from "@/app/actions";

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/** 终止商品：原因必填 + 二次确认 + pending 反馈；不删除任何数据 */
export function TerminateCaseControl({
  caseId,
  title,
  returnPath,
}: {
  caseId: string;
  title: string;
  returnPath: string;
}) {
  const [open, setOpen] = useState(false);

  function confirmTerminate(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `确定终止「${title}」吗？\n\n商品会从商品进度和内容工作台移出，但成本模型、报价、定标、证据与 Listing 草稿全部保留。\n之后可在「已终止」列表中随时恢复。`,
    );
    if (!confirmed) event.preventDefault();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="button ghost"
        onClick={() => setOpen(true)}
        aria-expanded={false}
      >
        终止
      </button>
    );
  }

  return (
    <form
      action={archiveCaseAction}
      onSubmit={confirmTerminate}
      className="case-terminate-form"
      style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: "220px" }}
    >
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <input type="hidden" name="actor" value="运营人员" />
      <label htmlFor={`terminate-reason-${caseId}`} style={{ fontSize: "11px", color: "var(--muted)" }}>
        终止原因（必填，写入审计日志）
      </label>
      <input
        id={`terminate-reason-${caseId}`}
        name="reason"
        required
        minLength={4}
        maxLength={300}
        placeholder="例如：专利风险 / 报价不达毛利门槛 / 品类下线"
        style={{ padding: "6px 8px", fontSize: "12px", borderRadius: "8px", border: "1px solid var(--line)" }}
      />
      <div style={{ display: "flex", gap: "6px" }}>
        <SubmitButton label="确认终止" pendingLabel="处理中…" className="button danger" />
        <button type="button" className="button ghost" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
    </form>
  );
}

/** 恢复已终止商品：回到 approved，重新出现在进度与内容工作台 */
export function RestoreCaseButton({ caseId, title, returnPath }: { caseId: string; title: string; returnPath: string }) {
  function confirmRestore(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(`确定恢复「${title}」吗？\n\n将重新出现在商品进度与内容工作台，原有证据与版本保持不变。`);
    if (!confirmed) event.preventDefault();
  }

  return (
    <form action={restoreCaseAction} onSubmit={confirmRestore} style={{ margin: 0 }}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="returnPath" value={returnPath} />
      <input type="hidden" name="actor" value="运营人员" />
      <SubmitButton label="恢复" pendingLabel="恢复中…" className="button secondary" />
    </form>
  );
}
