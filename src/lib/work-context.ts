import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { listCases } from "@/lib/repository";
import type { WorkContextItem } from "@/lib/work-context-types";

export type { WorkContextItem } from "@/lib/work-context-types";
export { findWorkContextItem } from "@/lib/work-context-types";

/**
 * 全局对象条的数据。只做轻量映射，不参与业务判断；
 * 任何来源失败都降级为空，绝不阻塞页面渲染。
 */
function batchStage(batch: {
  promotedCount: number;
  goCount: number;
  selectedCount: number;
}) {
  if (batch.promotedCount > 0) return "已立项";
  if (batch.goCount > 0) return "待决策";
  if (batch.selectedCount > 0) return "验证中";
  return "待确认方向";
}

function batchNextHref(batch: { id: string; goCount: number }) {
  const tab = batch.goCount > 0 ? "decision" : "hypotheses";
  return `/ai-sourcing/${encodeURIComponent(batch.id)}?tab=${tab}`;
}

export async function loadWorkContext(): Promise<WorkContextItem[]> {
  const [batches, cases] = await Promise.allSettled([
    listAISourcingBatches(),
    listCases(),
  ]);

  const batchItems: WorkContextItem[] = (batches.status === "fulfilled" ? batches.value : [])
    .slice(0, 6)
    .map((batch) => ({
      id: batch.id,
      kind: "batch",
      label: batch.category,
      stage: batchStage(batch),
      href: `/ai-sourcing/${encodeURIComponent(batch.id)}?tab=overview`,
      nextLabel: batch.goCount > 0 ? "查看门禁结论" : "继续验证",
      nextHref: batchNextHref(batch),
    }));

  const caseItems: WorkContextItem[] = (cases.status === "fulfilled" ? cases.value : [])
    .filter((item) => item.status === "approved")
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      kind: "case",
      label: item.title,
      stage: "已立项",
      href: `/cases/${encodeURIComponent(item.id)}`,
      nextLabel: "查看商品",
      nextHref: `/cases/${encodeURIComponent(item.id)}`,
    }));

  return [...batchItems, ...caseItems];
}
