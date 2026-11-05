import Link from "next/link";
import { DeleteResearchBatch } from "@/components/delete-research-batch";
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
      <section className="ai-batch-overview ai-batch-list-overview">
        <div>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>Research library</span>
          <h2>所有研究批次</h2>
          <p>统一查看所有国家和平台的研究记录，按创建时间倒序完整展示。打开批次可继续补充证据、报价并执行确定性决策。</p>
          <div className="button-row ai-batch-list-actions">
            <Link href="/" className="button primary">新建选品研究</Link>
            <Link href="/" className="button secondary">返回工作台</Link>
          </div>
        </div>
        <div className="ai-batch-overview-side">
          <span>全部批次</span>
          <strong>{batches.length}</strong>
          <small>{hypothesisCount} 个候选方向 · {promotedCount} 个已立项商品</small>
        </div>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Research pipeline</div>
            <h2>研究批次列表</h2>
            <p>删除批次会移除关联的候选假设、证据、供应商短名单和报价；已转商品立项的数据保留。</p>
          </div>
          <span className="info-pill">全部显示 · 不合并重复记录</span>
        </div>

        {batches.length === 0 ? (
          <div className="empty-state">
            <h3>还没有选品研究</h3>
            <p>回到工作台选择国家和平台，填写类目与研究条件即可创建第一个批次。</p>
            <div className="button-row" style={{ justifyContent: "center" }}>
              <Link href="/" className="button primary">新建第一个研究</Link>
              <Link href="/data-sources" className="button secondary">查看数据源</Link>
            </div>
          </div>
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
