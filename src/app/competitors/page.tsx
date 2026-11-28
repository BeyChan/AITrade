import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { getAppMode } from "@/lib/app-mode";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { getDb } from "@/lib/db";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { CompetitorClient, type CandidateContext } from "./competitor-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    id?: string;
    returnRunId?: string;
    returnHypothesisId?: string;
    returnTab?: string;
  }>;
};

export default async function CompetitorsPage({ searchParams }: PageProps) {
  const [query, appMode] = await Promise.all([searchParams, getAppMode()]);
  const demoMode = appMode === "sandbox";
  const reports = await getComparisonReports({ mode: appMode });
  const targetById = query.id ? reports.find((r) => r.id === query.id) : undefined;

  let candidateContext: CandidateContext | null = null;
  if (query.returnRunId && query.returnHypothesisId) {
    const db = await getDb();
    const result = await db.query<{
      id: string;
      concept: string;
      run_id: string;
      market_code: string;
      platform_code: string;
      currency: string;
      comparison_report_id: string | null;
    }>(
      `SELECT h.id, h.concept, h.run_id, b.market_code, b.platform_code, b.currency,
              h.comparison_report_id
       FROM opportunity_hypotheses h
       JOIN ai_sourcing_runs r ON r.id = h.run_id
       JOIN sourcing_briefs b ON b.id = r.brief_id
       WHERE h.id = $1 AND r.is_demo = $2 AND b.is_demo = $2`,
      [query.returnHypothesisId, demoMode],
    );
    const row = result.rows[0];
    const returnTab =
      query.returnTab === "profit" || query.returnTab === "suppliers" || query.returnTab === "decision"
        ? query.returnTab
        : "hypotheses";
    if (row && row.run_id === query.returnRunId) {
      candidateContext = {
        runId: row.run_id,
        hypothesisId: row.id,
        concept: row.concept,
        marketCode: row.market_code,
        platformCode: row.platform_code,
        currency: row.currency,
        tab: returnTab,
        comparisonReportId: row.comparison_report_id,
      };
    }
  }

  if (
    candidateContext
    && (
      query.market?.trim().toUpperCase() !== candidateContext.marketCode.toUpperCase()
      || query.platform?.trim().toLowerCase() !== candidateContext.platformCode.toLowerCase()
    )
  ) {
    const params = new URLSearchParams();
    if (query.id) params.set("id", query.id);
    params.set("market", candidateContext.marketCode);
    params.set("platform", candidateContext.platformCode);
    params.set("returnRunId", candidateContext.runId);
    params.set("returnHypothesisId", candidateContext.hypothesisId);
    params.set("returnTab", candidateContext.tab);
    redirect(`/competitors?${params.toString()}`);
  }

  const siteScope = await resolvePersistedSiteScope(
    query.market || targetById?.marketCode,
    query.platform || targetById?.platformCode,
  );
  const currentMarket = candidateContext?.marketCode ?? siteScope.marketCode;
  const currentPlatform = candidateContext?.platformCode ?? siteScope.platformCode;
  const returnSearch = candidateContext
    ? new URLSearchParams({
        tab: candidateContext.tab,
        hypothesisId: candidateContext.hypothesisId,
      }).toString()
    : "";

  return (
    <div className="page">
      <PageHeader
        backLink={candidateContext ? {
          label: "返回当前候选",
          href: `/ai-sourcing/${encodeURIComponent(candidateContext.runId)}?${returnSearch}#hypothesis-${encodeURIComponent(candidateContext.hypothesisId)}`,
          meta: candidateContext.concept,
        } : undefined}
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "竞品研报" },
        ]}
        eyebrow={candidateContext ? "候选证据补齐" : "竞品情报与多维对标"}
        title="竞品研报"
        description={candidateContext
          ? demoMode
            ? `正在为候选「${candidateContext.concept}」补充竞品证据。站点、平台和币种已按候选锁定；演示模式可直接确认并绑定，再返回候选继续推进。`
            : `正在为候选「${candidateContext.concept}」补充竞品证据。站点、平台和币种已按候选锁定；选择或生成研报，人工确认后绑定，再返回候选继续推进。`
          : "输入竞品链接或用浏览器扩展采集前台数据。AI 只辅助整理特点与差评线索；价格、评分等数值需采集或人工核实，商品指数仅供参考、不参与 GO 判定。"}
      />

      <CompetitorClient
        initialReports={reports}
        initialReportId={query.id || candidateContext?.comparisonReportId || undefined}
        currentMarket={currentMarket}
        currentPlatform={currentPlatform}
        candidateContext={candidateContext}
        demoMode={demoMode}
        mode={appMode}
      />
    </div>
  );
}
