import { randomUUID } from "node:crypto";
import { SelectionWizardClient } from "@/components/selection-wizard-client";
import { PageHeader } from "@/components/ui";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string }>;
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

  const [allReports, batches] = await Promise.all([
    getComparisonReports(),
    listAISourcingBatches(marketCode, platformCode),
  ]);

  const siteReports = allReports.filter(
    (r) =>
      r.marketCode.toUpperCase() === marketCode.toUpperCase() &&
      r.platformCode.toLowerCase() === platformCode.toLowerCase(),
  );

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品中心" },
        ]}
        eyebrow="3 步极简选品向导"
        title="选品中心"
        description="按你手里现有的线索直接开干：看市场（竞品与痛点）→ 核成本（18% 硬门禁倒推）→ 拍板立项（合规红线与一键生成案卷）。"
        actions={
          <span className="badge badge-neutral">
            {market?.name ?? "美国"}站 · {platform?.name ?? "Amazon"} · {market?.currency ?? "USD"}
          </span>
        }
      />

      <SelectionWizardClient
        marketCode={marketCode}
        marketName={market?.name ?? "美国"}
        platformCode={platformCode}
        platformName={platform?.name ?? "Amazon"}
        currency={market?.currency ?? "USD"}
        requestKey={randomUUID()}
        reports={siteReports}
        batches={batches}
      />
    </div>
  );
}
