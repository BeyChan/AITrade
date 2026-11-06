import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { listSourcingCases } from "@/lib/repository";
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
    listSourcingCases(),
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
    .slice(0, 6)
    .map((item) => {
      const hasSelection = Boolean(item.selection);
      const id = encodeURIComponent(item.productCase.id);
      return {
        id: item.productCase.id,
        kind: "case",
        label: item.productCase.title,
        stage: hasSelection ? "内容与上架" : "待定标",
        href: `/cases/${id}`,
        nextLabel: hasSelection ? "制作内容" : "去定标",
        nextHref: hasSelection ? `/cases/${id}/content` : `/cases/${id}/sourcing`,
      };
    });

  return [...batchItems, ...caseItems];
}
