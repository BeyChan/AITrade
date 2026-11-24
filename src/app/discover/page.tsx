import { randomUUID } from "node:crypto";
import { SelectionWizardClient } from "@/components/selection-wizard-client";
import { PageHeader } from "@/components/ui";
import { listEliminatedHypotheses } from "@/lib/ai-sourcing-repository";
import { loadSourcingConstraints } from "@/lib/app-settings";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { listConfirmedCostSheets } from "@/lib/cost-sheets-repository";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    entry?: string;
    reportId?: string;
    costSheetId?: string;
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

  const [allReports, confirmedCostSheets, savedConstraints, eliminatedHistory] = await Promise.all([
    getComparisonReports(),
    listConfirmedCostSheets(),
    loadSourcingConstraints(),
    listEliminatedHypotheses(),
  ]);

  const siteReports = allReports.filter(
    (r) =>
      r.reviewStatus === "confirmed" &&
      r.marketCode.toUpperCase() === marketCode.toUpperCase() &&
      r.platformCode.toLowerCase() === platformCode.toLowerCase(),
  );

  const requestedReport = query.reportId
    ? allReports.find((r) => r.id === query.reportId && r.reviewStatus === "confirmed") ?? null
    : null;

  const siteCostSheets = confirmedCostSheets.filter(
    (sheet) =>
      sheet.marketCode.toUpperCase() === marketCode.toUpperCase() &&
      sheet.platformCode.toLowerCase() === platformCode.toLowerCase(),
  );

  const requestedCostSheet = query.costSheetId
    ? siteCostSheets.find((sheet) => sheet.id === query.costSheetId) ?? null
    : null;
  const initialEntryMode: "ai" | "competitor" | "sourcing" =
    query.entry === "competitor" || Boolean(requestedReport)
      ? "competitor"
      : query.entry === "sourcing" || Boolean(requestedCostSheet)
        ? "sourcing"
        : "ai";

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品看板", href: "/ai-sourcing" },
          { label: "新建选品" },
        ]}
        eyebrow="统一选品入口"
        title="新建选品"
        description="AI 找方向为主入口；也可从已确认竞品研报或已确认核算单建立候选，创建后进入同一套 4 步选品工作台（1 竞品研报 → 2 成本核算 → 3 找厂与打样 → 4 风险与立项）。"
      />

      <SelectionWizardClient
        marketCode={marketCode}
        marketName={market?.name ?? "美国"}
        platformCode={platformCode}
        platformName={platform?.name ?? "Amazon"}
        currency={market?.currency ?? "USD"}
        requestKey={randomUUID()}
        siteReports={siteReports.slice(0, 12)}
        confirmedCostSheets={siteCostSheets}
        initialReportId={requestedReport?.id ?? ""}
        initialCostSheetId={requestedCostSheet?.id ?? ""}
        initialEntryMode={initialEntryMode}
        initialConstraints={savedConstraints}
        eliminatedHistory={eliminatedHistory}
      />
    </div>
  );
}
