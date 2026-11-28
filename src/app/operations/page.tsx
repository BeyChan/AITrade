import Link from "next/link";
import { getAppMode } from "@/lib/app-mode";
import { OperationsReviewClient } from "@/components/operations-review-client";
import { PageHeader } from "@/components/ui";
import { listChannelSkuMappings, listOperationsBatches } from "@/lib/operations-repository";
import { getSiteOptions, listCasesForSite } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

export default async function OperationsReviewPage() {
  const mode = await getAppMode();
  const [options, scope, savedBatches, mappings] = await Promise.all([
    getSiteOptions(),
    resolvePersistedSiteScope(),
    listOperationsBatches(30, { mode }).catch(() => []),
    listChannelSkuMappings(undefined, { mode }).catch(() => []),
  ]);
  const market = options.markets.find((m) => m.code === scope.marketCode) ?? options.markets[0];
  const siteCases = await listCasesForSite(market?.code ?? "US", "amazon", { mode }).catch(() => []);
  const caseOptions = siteCases.map((c) => ({
    id: c.id,
    asin: c.asin,
    title: c.title,
    category: c.category,
    landedCostCents: c.costModel?.assumptions.landedCostCents ?? null,
  }));

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "实盘账本" },
        ]}
        eyebrow="经营核算 · 持久化账本与实盘校准"
        title="实盘经营账本"
        description="导入 Amazon 结算单、可选广告报表与 FBA 库存快照并存档，保留完整费用归因，按同口径核验真实净利偏差并反哺新品立项校准。"
        actions={<Link href="/cases" className="button secondary">返回我的商品</Link>}
      />

      <OperationsReviewClient
        defaultMarket={market?.code ?? "US"}
        defaultCurrency={market?.currency ?? "USD"}
        initialBatches={savedBatches}
        initialMappings={mappings}
        caseOptions={caseOptions}
      />
    </div>
  );
}
