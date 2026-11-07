import { getComparisonReports } from "@/lib/competitor-compare/storage";
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
  const currentMarket = query.market?.toUpperCase() || "US";
  const currentPlatform = query.platform?.toLowerCase() || "amazon";

  // 不再自动生成示例研报：没有真实输入时不落盘任何数据
  const reports = await getComparisonReports();

  return (
    <div className="page" style={{ maxWidth: "1280px", margin: "0 auto", padding: "26px 28px 60px" }}>
      <header style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <span className="eyebrow" style={{ color: "var(--green)" }}>竞品情报与多维对标</span>
            <h1 style={{ fontSize: "28px", margin: "6px 0 6px 0", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.02em" }}>
              竞品对比
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
              输入竞品链接或用浏览器扩展采集前台数据。AI 只辅助整理特点与差评线索；价格、评分等数值需采集或人工核实，商品指数仅供参考、不参与 GO 判定。
            </p>
          </div>
        </div>
      </header>

      <CompetitorClient
        initialReports={reports}
        initialReportId={query.id}
        currentMarket={currentMarket}
        currentPlatform={currentPlatform}
      />
    </div>
  );
}
