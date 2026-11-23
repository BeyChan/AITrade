import { randomUUID } from "node:crypto";
import { SelectionWizardClient } from "@/components/selection-wizard-client";
import { PageHeader } from "@/components/ui";
import { listEliminatedHypotheses } from "@/lib/ai-sourcing-repository";
import { loadSourcingConstraints } from "@/lib/app-settings";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    entry?: string;
    reportId?: string;
    step?: string;
  }>;
};

export default async function DiscoverPage({ searchParams }: PageProps) {
  const [query, options] = await Promise.all([searchParams, getSiteOptions()]);
  const scope = await resolvePersistedSiteScope(query.market, query.platform);
  const market =
    options.markets.find((m) => m.code === scope.marketCode) ??
    options.markets.find((m) => m.code === "US") ??
    options.markets[0];
  const platform =
    options.platforms.find((p) => p.code === scope.platformCode) ??
    options.platforms.find((p) => p.code === "amazon") ??
    options.platforms[0];

  const marketCode = market?.code ?? "US";
  const platformCode = platform?.code ?? "amazon";

  const [allReports, savedConstraints, eliminatedHistory] = await Promise.all([
    getComparisonReports(),
    loadSourcingConstraints(),
    listEliminatedHypotheses(),
  ]);

  const siteReports = allReports.filter(
    (r) =>
      r.marketCode.toUpperCase() === marketCode.toUpperCase() &&
      r.platformCode.toLowerCase() === platformCode.toLowerCase(),
  );

  const requestedReport = query.reportId
    ? allReports.find((r) => r.id === query.reportId) ?? null
    : null;
  const initialReport = requestedReport ?? siteReports[0] ?? null;
  const initialStep: 1 | 2 | 3 =
    query.step === "2" ? 2 : query.step === "3" ? 3 : 1;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品看板", href: "/ai-sourcing" },
          { label: "新建选品" },
        ]}
        eyebrow="选品入口 · 两条路径"
        title="新建选品"
        description="还没定品就让 AI 发散方向；已有竞品或货源则走 3 步极速立项：看市场 → 核 18% 毛利 → 合规立项。系统负责形成可推进案卷与交付资料，平台发布仍在卖家后台完成。"
      />

      <SelectionWizardClient
        marketCode={marketCode}
        marketName={market?.name ?? "美国"}
        platformCode={platformCode}
        platformName={platform?.name ?? "Amazon"}
        currency={market?.currency ?? "USD"}
        requestKey={randomUUID()}
        initialReport={initialReport}
        initialStep={initialStep}
        initialEntryMode={query.entry === "wizard" ? "wizard" : "ai_brainstorm"}
        initialConstraints={savedConstraints}
        eliminatedHistory={eliminatedHistory}
      />
    </div>
  );
}
