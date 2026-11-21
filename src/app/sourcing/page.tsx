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
          { label: "工厂与供应链" },
        ]}
        eyebrow="供应链资产库"
        title="1688 工厂与供应链资产库"
        description="统一沉淀企业合作的 1688 实力商家、超级工厂与源头供应链档案。沉淀验厂资质、主营优势与历史定标记录，支持各商品案卷跨品类调取复用，杜绝人走资源丢。"
        actions={
          <>
            <Link href="/#opportunities" className="button secondary">
              查看商品机会
            </Link>
            <Link href="/competitors" className="button ghost">
              竞品对比
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
