import Link from "next/link";
import { OperationsReviewClient } from "@/components/operations-review-client";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

export default async function OperationsReviewPage() {
  const [options, scope] = await Promise.all([getSiteOptions(), resolvePersistedSiteScope()]);
  const market = options.markets.find((m) => m.code === scope.marketCode) ?? options.markets[0];

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/">工作台大盘</Link> / 实盘复盘
      </div>

      <div className="title-row">
        <div>
          <h1>实盘经营复盘（Actual vs Plan）</h1>
          <p className="muted">
            将上架后的真实结算单与 FBA 库存快照回灌至系统，对照立项成本模型核验真实毛利偏差与断货风险，反哺下一轮选品门禁。
          </p>
        </div>
        <div className="button-row">
          <Link href="/cases" className="button secondary">返回案卷台账</Link>
        </div>
      </div>

      <OperationsReviewClient
        defaultMarket={market?.code ?? "US"}
        defaultCurrency={market?.currency ?? "USD"}
      />
    </div>
  );
}
