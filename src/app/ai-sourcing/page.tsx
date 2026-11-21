import Link from "next/link";
import { DeleteResearchBatch } from "@/components/delete-research-batch";
import { EmptyState, MetricGrid, PageHeader, QueryNotices } from "@/components/ui";
import { getBatchSiteLabel, listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function AISourcingBatchListPage({ searchParams }: PageProps) {
  const [query, batches] = await Promise.all([searchParams, listAISourcingBatches()]);
  const hypothesisCount = batches.reduce((sum, batch) => sum + batch.hypothesisCount, 0);
  const promotedCount = batches.reduce((sum, batch) => sum + batch.promotedCount, 0);

  return (
    <div className="page ai-sourcing-page ai-batch-list-page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "AI 选品批次" },
        ]}
        eyebrow="研究批次"
        title="AI 选品批次"
        description="统一查看所有国家和平台的研究记录，按创建时间倒序完整展示。打开批次可继续补充证据、报价并执行确定性决策。"
        actions={
          <>
            <Link href="/discover" className="button primary">新建选品（3 步向导）</Link>
            <Link href="/" className="button secondary">返回工作台</Link>
          </>
        }
      />

      <MetricGrid
        ariaLabel="研究批次概览"
        columns={3}
        items={[
          { label: "全部研究批次", value: batches.length, note: "覆盖所有国家与平台" },
          { label: "候选方向总数", value: hypothesisCount, note: "待验证与已评估假设" },
          { label: "已立项商品", value: promotedCount, note: "通过门禁并转入商品案卷", tone: "success" },
        ]}
      />

      <QueryNotices notice={query.notice} error={query.error} />

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">研究流程</div>
            <h2>研究批次列表</h2>
            <p>删除批次会移除关联的候选假设、证据、供应商短名单和报价；已转商品立项的数据保留。</p>
          </div>
          <span className="info-pill">全部显示 · 不合并重复记录</span>
        </div>

        {batches.length === 0 ? (
          <EmptyState
            title="还没有选品研究"
            description="回到工作台选择国家和平台，填写类目与研究条件即可创建第一个批次。"
            actions={
              <>
                <Link href="/" className="button primary">新建第一个研究</Link>
                <Link href="/import" className="button secondary">批量导入 CSV</Link>
              </>
            }
          />
        ) : (
          <div className="ai-batch-list">
            {batches.map((batch) => (
              <article className="ai-batch-card" key={batch.id}>
                <Link
                  href={`/ai-sourcing/${batch.id}?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}`}
                  className="ai-batch-main research-batch-link"
                >
                  <div className="button-row">
                    <span className="badge badge-neutral">{batch.category}</span>
                    <span className="badge badge-neutral">{getBatchSiteLabel(batch)}</span>
                    <span className="badge badge-success">{batch.goCount} 个 GO</span>
                    {batch.promotedCount > 0 ? <span className="badge status-approved">{batch.promotedCount} 个已立项</span> : null}
                    {batch.templateFallback ? <span className="badge status-review_pending">模板回退</span> : null}
                  </div>
                  <h3>{batch.brief}</h3>
                  <p>{shortDate(batch.createdAt)} · {batch.provider} / {batch.model}</p>
                </Link>
                <div className="research-batch-side">
                  <div className="ai-batch-counts">
                    <span><strong>{batch.hypothesisCount}</strong> 候选方向</span>
                    <span><strong>{batch.selectedCount}</strong> 已加入验证</span>
                  </div>
                  <div className="research-batch-actions">
                    <Link
                      href={`/ai-sourcing/${batch.id}?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}`}
                      className="button ghost batch-open-button"
                    >
                      查看详情
                    </Link>
                    <DeleteResearchBatch
                      runId={batch.id}
                      category={batch.category}
                      promotedCount={batch.promotedCount}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
