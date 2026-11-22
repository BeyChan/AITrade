import Link from "next/link";
import {
  SelectionRecordsClient,
  type SelectionRecordItem,
} from "@/components/selection-records-client";
import { MetricGrid, PageHeader } from "@/components/ui";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

function makeSiteKey(marketCode: string, platformCode: string) {
  return `${marketCode.toUpperCase()}::${platformCode.toLowerCase()}`;
}

export default async function SelectionRecordsPage() {
  const [options, scope, reports, batches] = await Promise.all([
    getSiteOptions(),
    resolvePersistedSiteScope(),
    getComparisonReports(),
    listAISourcingBatches(),
  ]);

  const marketNameMap = new Map(options.markets.map((m) => [m.code.toUpperCase(), m.name]));
  const platformNameMap = new Map(options.platforms.map((p) => [p.code.toLowerCase(), p.name]));

  const formatSiteLabel = (marketCode: string, platformCode: string) => {
    const marketName = marketNameMap.get(marketCode.toUpperCase()) ?? marketCode.toUpperCase();
    const platformName = platformNameMap.get(platformCode.toLowerCase()) ?? platformCode;
    return `${marketName}站 · ${platformName}`;
  };

  const records: SelectionRecordItem[] = [
    ...reports.map(
      (report): SelectionRecordItem => ({
        kind: "report",
        id: report.id,
        title: report.title,
        marketCode: report.marketCode,
        platformCode: report.platformCode,
        siteKey: makeSiteKey(report.marketCode, report.platformCode),
        siteLabel: formatSiteLabel(report.marketCode, report.platformCode),
        currency: report.currency,
        competitorCount: report.competitors.length,
        p50PriceCents: report.priceStats.p50,
        promotedCaseId: report.promotedCaseId,
        createdAt: report.createdAt,
      }),
    ),
    ...batches.map(
      (batch): SelectionRecordItem => ({
        kind: "batch",
        id: batch.id,
        brief: batch.brief,
        category: batch.category,
        marketCode: batch.marketCode,
        platformCode: batch.platformCode,
        siteKey: makeSiteKey(batch.marketCode, batch.platformCode),
        siteLabel: formatSiteLabel(batch.marketCode, batch.platformCode),
        hypothesisCount: batch.hypothesisCount,
        selectedCount: batch.selectedCount,
        goCount: batch.goCount,
        promotedCount: batch.promotedCount,
        createdAt: batch.createdAt,
      }),
    ),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const siteOptionMap = new Map<string, string>();
  for (const record of records) {
    if (!siteOptionMap.has(record.siteKey)) {
      siteOptionMap.set(record.siteKey, record.siteLabel);
    }
  }
  const siteOptions = Array.from(siteOptionMap.entries()).map(([key, label]) => ({ key, label }));

  const promotedCount =
    reports.filter((r) => Boolean(r.promotedCaseId)).length +
    batches.filter((b) => b.promotedCount > 0).length;

  const importHref = `/import?market=${encodeURIComponent(scope.marketCode)}&platform=${encodeURIComponent(scope.platformCode)}`;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品记录" },
        ]}
        eyebrow="全站点选品台账"
        title="选品记录"
        description="统一汇总全部站点的竞品研报与 AI 发散选品批次，完整展示历史与进行中的每一条记录，点击即可继续核成本或推进验证。"
        actions={
          <Link href={importHref} className="button secondary">
            批量导入 CSV
          </Link>
        }
      />

      <MetricGrid
        ariaLabel="选品记录概览"
        items={[
          { label: "全部选品记录", value: records.length, note: "覆盖所有国家与平台" },
          { label: "竞品研报", value: reports.length, note: "可一键载入向导核成本" },
          { label: "AI 发散批次", value: batches.length, note: "包含候选方向与验证进度" },
          { label: "已立项记录", value: promotedCount, note: "已转为正式商品案卷", tone: "success" },
        ]}
      />

      <SelectionRecordsClient
        records={records}
        siteOptions={siteOptions}
        importHref={importHref}
      />
    </div>
  );
}
