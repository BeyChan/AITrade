import { listAISourcingBatches } from "./ai-sourcing-repository.ts";
import { deriveCaseWorkflowSnapshot } from "./case-stage.ts";
import { listCasesForSite } from "./repository.ts";
import type { EnrichedCase } from "./types.ts";
import type { WorkContextItem } from "./work-context-types.ts";

export type { WorkContextItem } from "./work-context-types.ts";
export { findWorkContextItem } from "./work-context-types.ts";

export type WorkContextScope = {
  marketCode: string;
  platformCode: string;
};

/**
 * 全局对象条的数据映射：
 * - 严格按当前解析后的站点 (marketCode + platformCode) 隔离，杜绝 AU / US 跨站点串数据；
 * - 案卷阶段与下一步统一消费 deriveCaseWorkflowSnapshot()，不再手写“待定标 / 内容与上架”。
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

export function buildWorkContextCaseItem(item: EnrichedCase): WorkContextItem {
  const snapshot = deriveCaseWorkflowSnapshot({
    caseId: item.id,
    status: item.status,
    recommendation: item.recommendation,
    hasNoGoException: Boolean(item.hasNoGoException),
    hasCostModel: Boolean(item.costModel),
    quoteCount: item.quoteCount ?? 0,
    hasSupplierSelection: Boolean(item.hasSupplierSelection),
    approvedMainImageCount: item.approvedMainImageCount,
    hasApprovedContent: Boolean(item.hasApprovedContent),
    hasFlatFileExported: Boolean(item.hasFlatFileExported),
    hasMediaPackExported: Boolean(item.hasMediaPackExported),
  });
  const id = encodeURIComponent(item.id);
  return {
    id: item.id,
    kind: "case",
    label: item.title,
    stage: `${snapshot.name} · ${snapshot.subName}`,
    href: `/cases/${id}`,
    nextLabel: snapshot.primaryAction.label,
    nextHref: snapshot.primaryAction.href,
  };
}

export function filterCasesForWorkContextScope(
  cases: EnrichedCase[],
  scope: WorkContextScope,
): EnrichedCase[] {
  const targetMarket = scope.marketCode.toUpperCase();
  return cases.filter(
    (item) =>
      item.status !== "archived" &&
      item.status !== "rejected" &&
      item.marketplace.toUpperCase() === targetMarket,
  );
}

export async function loadWorkContext(scope: WorkContextScope): Promise<WorkContextItem[]> {
  const marketCode = scope.marketCode.toUpperCase();
  const platformCode = scope.platformCode.toLowerCase();

  const [batches, cases] = await Promise.allSettled([
    listAISourcingBatches(marketCode, platformCode),
    listCasesForSite(marketCode, platformCode),
  ]);

  const batchItems: WorkContextItem[] = (batches.status === "fulfilled" ? batches.value : [])
    .filter((b) => b.marketCode.toUpperCase() === marketCode && b.platformCode.toLowerCase() === platformCode)
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

  const scopedCases = filterCasesForWorkContextScope(
    cases.status === "fulfilled" ? cases.value : [],
    { marketCode, platformCode },
  );

  const caseItems: WorkContextItem[] = scopedCases
    .slice(0, 6)
    .map(buildWorkContextCaseItem);

  return [...batchItems, ...caseItems];
}
