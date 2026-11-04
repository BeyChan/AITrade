import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { money, shortDate } from "@/lib/format";
import { listSourcingCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ContentWorkbenchPage() {
  const cases = await listSourcingCases();
  const ready = cases.filter((item) => item.selection);
  const pending = cases.filter((item) => !item.selection);
  const withQuotes = cases.filter((item) => item.quoteCount > 0);

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Content &amp; listing studio</div>
          <h1>内容工作台</h1>
          <p>集中管理已立项商品的主图、商品定义、Listing 草稿与发布预检。未完成供应商定标的商品只能查看状态，不能开始内容制作。</p>
        </div>
        <Link href="/" className="button secondary">返回 AI 选品</Link>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-label">已立项商品</div>
          <div className="metric-value">{cases.length}</div>
          <div className="metric-note">进入内容阶段的项目总数</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">可开始内容</div>
          <div className="metric-value">{ready.length}</div>
          <div className="metric-note">供应商已完成人工定标</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">待供应商定标</div>
          <div className="metric-value">{pending.length}</div>
          <div className="metric-note">完成定标后自动解锁内容页</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已有供应商报价</div>
          <div className="metric-value">{withQuotes.length}</div>
          <div className="metric-note">至少录入一份真实报价</div>
        </article>
      </section>

      <div className="notice">
        <span className="badge badge-success">RULE</span>
        <span><strong>进入条件：</strong>商品已立项，并完成供应商人工定标。内容页不会绕过定标生成采购承诺，主图和 Listing 仍需人工核验。</span>
      </div>

      {cases.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h3>还没有可进入内容阶段的商品</h3>
            <p>先在 AI 选品工作台完成验证并转为商品立项，之后在这里继续内容制作。</p>
            <Link href="/" className="button primary">前往 AI 选品工作台</Link>
          </div>
        </section>
      ) : (
        <section className="sourcing-list">
          {cases.map((item) => (
            <article className="sourcing-case-card" key={item.productCase.id}>
              <div className="sourcing-case-main">
                <div className="evidence-top">
                  <div>
                    <div className="product-title">
                      {item.productCase.title}
                      {item.productCase.is_demo ? <span className="badge demo-badge">演示</span> : null}
                    </div>
                    <div className="product-meta">
                      <span>{item.productCase.marketplace}</span>
                      <span>{item.productCase.category}</span>
                      <span>{item.productCase.asin}</span>
                      <span>更新 {shortDate(item.productCase.updated_at)}</span>
                    </div>
                  </div>
                  <span className={`badge ${item.selection ? "badge-success" : "status-review_pending"}`}>
                    {item.selection ? "可制作内容" : "待供应商定标"}
                  </span>
                </div>

                <div className="sourcing-case-metrics">
                  <div>
                    <small>当前成本模型</small>
                    <strong>{item.costModel ? `v${item.costModel.version}` : "—"}</strong>
                  </div>
                  <div>
                    <small>到岸成本</small>
                    <strong>{item.costModel ? money(item.costModel.assumptions.landedCostCents) : "—"}</strong>
                  </div>
                  <div>
                    <small>供应商报价</small>
                    <strong>{item.quoteCount} 家</strong>
                  </div>
                  <div>
                    <small>{item.selection ? "已选供应商" : "当前建议"}</small>
                    <strong>{item.selectedSupplierName ?? item.preferredSupplierName ?? "待定标"}</strong>
                  </div>
                </div>
              </div>

              <div className="sourcing-case-side">
                <div>
                  <span className="muted">商品状态</span>
                  <StatusBadge status={item.productCase.status} />
                </div>
                {item.selection ? (
                  <Link href={`/cases/${item.productCase.id}/content`} className="button primary">打开内容工作台 →</Link>
                ) : (
                  <Link href={`/cases/${item.productCase.id}/sourcing`} className="button primary">先完成供应商定标 →</Link>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
