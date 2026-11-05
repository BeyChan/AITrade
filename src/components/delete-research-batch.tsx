"use client";

import type { FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { deleteAISourcingBatchAction } from "@/app/actions";

type DeleteResearchBatchProps = {
  runId: string;
  category: string;
  promotedCount: number;
};

export function DeleteResearchBatch({ runId, category, promotedCount }: DeleteResearchBatchProps) {
  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    const preservation = promotedCount > 0
      ? `已转商品立项的 ${promotedCount} 个商品及其后续数据会保留。`
      : "已转商品立项的数据不会受影响。";
    const confirmed = window.confirm(
      `确定删除研究批次「${category}」吗？\n\n候选假设、研究证据、供应商短名单和报价会一并删除。\n${preservation}\n此操作不可撤销。`,
    );
    if (!confirmed) event.preventDefault();
  }

  return (
    <form action={deleteAISourcingBatchAction} onSubmit={confirmDelete} className="research-batch-delete">
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="actor" value="运营人员" />
      <DeleteButton />
    </form>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button danger batch-delete-button" disabled={pending}>
      {pending ? "删除中…" : "删除"}
    </button>
  );
}
