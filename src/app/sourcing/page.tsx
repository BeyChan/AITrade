import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import { money, percent, shortDate } from "@/lib/format";
import { listSourcingCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function SourcingPage() {
  const cases = await listSourcingCases();
  const sourcing = cases.filter((item) => item.quoteCount > 0 && !item.selection).length;
  const comparisonReady = cases.filter((item) => !item.selection && item.eligibleCount >= 3).length;
  const selected = cases.filter((item) => item.selection).length;

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Supplier sourcing</div>
          <h1>供应商询价</h1>
          <p>已立项商品进入供应商报价阶段。系统统一计算到岸成本和综合分，推荐方案只作为建议；最终定标、定样、下单和付款必须由人确认。</p>
        </div>
        <Link href="/approvals" className="button secondary">查看立项审批</Link>
      </section>

      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-label">已立项商品</div>
          <div className="metric-value">{cases.length}</div>
          <div className="metric-note">可以进入供应商询价的项目</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">询价进行中</div>
          <div className="metric-value">{sourcing}</div>
          <div className="metric-note">已有报价但尚未定标</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">达到三家对比建议</div>
          <div className="metric-value">{comparisonReady}</div>
          <div className="metric-note">少于三家仍可人工定标并说明原因</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已选定供应商</div>
          <div className="metric-value">{selected}</div>
          <div className="metric-note">成本模型已由报价回写</div>
        </article>
      </section>

      <div className="notice">
        <span className="badge badge-success">RULE</span>
        <span><strong>有效报价：</strong>压力情景盈利且质量评分 ≥ 50。建议至少比较 3 家；少于 3 家仍可定标，但必须记录例外原因。</span>
      </div>

      {cases.length === 0 ? (
        <section className="panel">
          <div className="empty-state">
            <h3>还没有已立项商品</h3>
            <p>先在商品机会中完成人工立项，项目才会进入供应商询价。</p>
            <Link href="/approvals" className="button primary">前往审批中心</Link>
          </div>
        </section>
      ) : (
        <section className="sourcing-list">
          {cases.map((item) => {
            const stage = sourcingStage(item.quoteCount, item.eligibleCount, Boolean(item.selection));
            const preferred = item.scoredQuotes.find((quote) => quote.isPreferred);
            return (
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
                        <span>立项更新 {shortDate(item.productCase.updated_at)}</span>
                      </div>
                    </div>
                    <span className={`badge ${stage.className}`}>{stage.label}</span>
                  </div>

                  <div className="sourcing-case-metrics">
                    <div><small>当前模型到岸成本</small><strong>{item.costModel ? money(item.costModel.assumptions.landedCostCents) : "—"}</strong></div>
                    <div><small>已录入报价</small><strong>{item.quoteCount} 家</strong></div>
                    <div><small>有效报价</small><strong>{item.eligibleCount} / 3</strong></div>
                    <div>
                      <small>{item.selection ? "已选定供应商" : "系统推荐"}</small>
                      <strong>{item.selectedSupplierName ?? item.preferredSupplierName ?? "待录入报价"}</strong>
                      {preferred && !item.selection ? <span>{preferred.score} 分 · {money(preferred.landedCostCents)} 到岸</span> : null}
                    </div>
                  </div>
                </div>

                <div className="sourcing-case-side">
                  <div>
                    <span className="muted">当前状态</span>
                    <StatusBadge status={item.productCase.status} />
                  </div>
                  <Link href={`/cases/${item.productCase.id}/sourcing`} className="button primary">
                    {item.selection ? "查看定标结果" : item.quoteCount ? "继续比较报价" : "录入供应商报价"} →
                  </Link>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <div className="notice" style={{ marginTop: 18, marginBottom: 0 }}>
        <span className="badge status-researching">BOUNDARY</span>
        <span><strong>P1.1 边界：</strong>本页只管理询价和人工定标，不会联系供应商、签合同、下单或付款。定标后可进入内容工作台和上市矩阵；平台只读连接可在连接中心验证，但样品、质检、真实发布和外部写动作仍未实现。</span>
      </div>
    </div>
  );
}

function sourcingStage(quoteCount: number, eligibleCount: number, selected: boolean) {
  if (selected) return { label: "已定标", className: "badge-success" };
  if (eligibleCount >= 3) return { label: "可进入定标", className: "badge-success" };
  if (quoteCount === 0) return { label: "待发起询价", className: "badge-neutral" };
  if (eligibleCount < 3) return { label: `有效报价 ${eligibleCount}/3`, className: "status-review_pending" };
  return { label: "评估中", className: "status-researching" };
}
