import { getComparisonReports, saveComparisonReport } from "@/lib/competitor-compare/storage";
import { analyzeCompetitors } from "@/lib/competitor-compare/engine";
import { CompetitorClient } from "./competitor-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
  }>;
};

export default async function CompetitorsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const currentMarket = query.market?.toUpperCase() || "US";
  const currentPlatform = query.platform?.toLowerCase() || "amazon";

  let reports = await getComparisonReports();

  // 若尚无任何报告，自动生成首条高质量示例，让用户进入页面即见完整分析
  if (reports.length === 0) {
    try {
      const initialSeed = await analyzeCompetitors({
        rawInputs: `https://www.amazon.com/dp/B08CZ8K652 (Fanttik V8 Apex High-Power Handheld)
https://www.amazon.com/dp/B09M87J11L (Baseus A2 Pro Car Vacuum 6000Pa)
https://www.amazon.com/dp/B0875X3V95 (Anker eufy HomeVac H11 Cordless Pure)`,
        marketCode: "US",
        platformCode: "amazon",
        currency: "USD",
        skipModel: true,
      });
      await saveComparisonReport(initialSeed);
      reports = [initialSeed];
    } catch {
      // ignore seed failure
    }
  }

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
              输入一个或多个竞品链接，AI 穿透分析真实价格分位、核心特点、致命差评痛点与破局进攻策略。
            </p>
          </div>
        </div>
      </header>

      <CompetitorClient
        initialReports={reports}
        currentMarket={currentMarket}
        currentPlatform={currentPlatform}
      />
    </div>
  );
}
