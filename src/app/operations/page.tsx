import Link from "next/link";
import { OperationsReviewClient } from "@/components/operations-review-client";
import { PageHeader } from "@/components/ui";
import { listOperationsBatches } from "@/lib/operations-repository";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

export default async function OperationsReviewPage() {
  const [options, scope, savedBatches] = await Promise.all([
    getSiteOptions(),
    resolvePersistedSiteScope(),
    listOperationsBatches(30).catch(() => []),
  ]);
  const market = options.markets.find((m) => m.code === scope.marketCode) ?? options.markets[0];

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "实盘账本" },
        ]}
        eyebrow="经营核算 · 持久化账本"
        title="实盘经营账本"
        description="导入 Amazon 结算单与 FBA 库存快照并永久存档，对照立项模型核验真实毛利偏差与断货预警。"
        actions={<Link href="/cases" className="button secondary">返回我的商品</Link>}
      />

      <OperationsReviewClient
        defaultMarket={market?.code ?? "US"}
        defaultCurrency={market?.currency ?? "USD"}
        initialBatches={savedBatches}
      />
    </div>
  );
}
