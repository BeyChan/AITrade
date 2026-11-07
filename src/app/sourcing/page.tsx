import Link from "next/link";
import { listSourcingCases, listSupplierDirectory } from "@/lib/repository";
import { createSupplierDirectoryEntryAction } from "@/app/actions";
import { SupplierDirectoryClient } from "@/components/supplier-directory-client";

export const dynamic = "force-dynamic";

export default async function SourcingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const query = await searchParams;
  const [{ suppliers, stats }, cases] = await Promise.all([
    listSupplierDirectory(),
    listSourcingCases(),
  ]);

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">SUPPLY CHAIN ASSET POOL · 供应链中台</div>
          <h1>1688 工厂与供应链资产库</h1>
          <p>
            统一沉淀企业合作的 1688 实力商家、超级工厂与源头供应链档案。
            沉淀验厂资质、主营优势与历史定标记录，支持各商品案卷跨品类调取复用，杜绝人走资源丢。
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Link href="/#opportunities" className="button secondary">
            查看商品机会
          </Link>
          <Link href="/competitors" className="button ghost">
            竞品对比
          </Link>
        </div>
      </section>

      <SupplierDirectoryClient
        suppliers={suppliers}
        stats={stats}
        cases={cases}
        createAction={createSupplierDirectoryEntryAction}
        notice={query.notice}
        error={query.error}
      />

      <div className="notice" style={{ marginTop: 24, marginBottom: 0 }}>
        <span className="badge status-researching">BOUNDARY</span>
        <span>
          <strong>供应链资产原则：</strong>
          工厂名录为跨境卖家企业私域数据，系统支持记录 1688 外部链接、验厂要点与实报价。
          实际下单、签署工模保密协议（NDA）及大货付款须遵照公司财务与线下流程。
        </span>
      </div>
    </div>
  );
}
