import { PageHeader } from "@/components/ui";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { CompetitorClient } from "./competitor-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    id?: string;
  }>;
};

export default async function CompetitorsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const siteScope = await resolvePersistedSiteScope(query.market, query.platform);
  const currentMarket = siteScope.marketCode;
  const currentPlatform = siteScope.platformCode;

  // 不再自动生成示例研报：没有真实输入时不落盘任何数据
  const reports = await getComparisonReports();

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "竞品对比" },
        ]}
        eyebrow="竞品情报与多维对标"
        title="竞品对比"
        description="输入竞品链接或用浏览器扩展采集前台数据。AI 只辅助整理特点与差评线索；价格、评分等数值需采集或人工核实，商品指数仅供参考、不参与 GO 判定。"
      />

      <CompetitorClient
        initialReports={reports}
        initialReportId={query.id}
        currentMarket={currentMarket}
        currentPlatform={currentPlatform}
      />
    </div>
  );
}
