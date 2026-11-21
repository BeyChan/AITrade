import Link from "next/link";
import { OperationsReviewClient } from "@/components/operations-review-client";
import { PageHeader } from "@/components/ui";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

export default async function OperationsReviewPage() {
  const [options, scope] = await Promise.all([getSiteOptions(), resolvePersistedSiteScope()]);
  const market = options.markets.find((m) => m.code === scope.marketCode) ?? options.markets[0];

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "实盘复盘" },
        ]}
        eyebrow="经营核算 · Actual vs Plan"
        title="实盘经营复盘"
        description="将上架后的真实结算单与 FBA 库存快照回灌至系统，对照立项成本模型核验真实毛利偏差与断货风险，反哺下一轮选品门禁。"
        actions={<Link href="/cases" className="button secondary">返回案卷台账</Link>}
      />

      <OperationsReviewClient
        defaultMarket={market?.code ?? "US"}
        defaultCurrency={market?.currency ?? "USD"}
      />
    </div>
  );
}
