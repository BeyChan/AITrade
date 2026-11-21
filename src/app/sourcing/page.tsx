import Link from "next/link";
import { listSourcingCases, listSupplierDirectory } from "@/lib/repository";
import { createSupplierDirectoryEntryAction } from "@/app/actions";
import { SupplierDirectoryClient } from "@/components/supplier-directory-client";
import { PageHeader } from "@/components/ui";

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
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "供应商管理" },
        ]}
        eyebrow="供应链资产库"
        title="供应商管理"
        description="统一沉淀合作工厂与源头供应链档案（兼容 1688、线下工厂、微信直采等多渠道）。沉淀验厂资质、主营优势与历史定标记录，支持各商品案卷跨品类调取复用，杜绝人走资源丢。"
        actions={
          <>
            <Link href="/#opportunities" className="button secondary">
              查看商品机会
            </Link>
            <Link href="/competitors" className="button ghost">
              竞品研报
            </Link>
          </>
        }
      />

      <SupplierDirectoryClient
        suppliers={suppliers}
        stats={stats}
        cases={cases}
        createAction={createSupplierDirectoryEntryAction}
        notice={query.notice}
        error={query.error}
      />
    </div>
  );
}
