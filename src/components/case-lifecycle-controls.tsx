"use client";

import { type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { restoreCaseAction } from "@/app/actions";

function SubmitButton({ label, pendingLabel, className }: { label: string; pendingLabel: string; className: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
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
