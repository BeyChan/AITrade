import Link from "next/link";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { compactNumber, money, percent } from "@/lib/format";
import { getDashboardStats, listCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [cases, stats] = await Promise.all([listCases(), getDashboardStats()]);
  const margins = cases.map((item) => item.costModel?.results.marginRate ?? 0);
  const averageMargin = margins.length ? margins.reduce((sum, value) => sum + value, 0) / margins.length : 0;
  const goCount = cases.filter((item) => item.recommendation === "GO").length;

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Opportunity workspace</div>
          <h1>先把一个商品机会<br />算清楚，再决定做不做。</h1>
          <p>
            候选品证据、单位经济模型、供应商定标和内容门禁集中在一个工作台。
            当前 P1.1 已把真实候选品、供应商和报价接入可追溯数据底座，加入 Amazon / Shopify / eBay 只读连接诊断，并跑通到多国家、多平台本地映射预检。
          </p>
        </div>
        <Link className="button primary" href="/data-sources">＋ 接入真实数据</Link>
      </section>

      <section className="metrics-grid" aria-label="核心指标">
        <article className="metric-card">
          <div className="metric-label">候选商品</div>
          <div className="metric-value">{stats.total}</div>
          <div className="metric-note">{stats.demo > 0 ? `其中 ${stats.demo} 个演示商品` : "全部来自真实导入"}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">待立项审批</div>
          <div className="metric-value">{stats.pending}</div>
          <div className="metric-note">需要在成本与证据确认后决策</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">建议 GO</div>
          <div className="metric-value">{goCount}</div>
          <div className="metric-note">净利润和压力测试共同满足门槛</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">平均净利率</div>
          <div className="metric-value">{percent(averageMargin)}</div>
          <div className="metric-note">按售价计算的预计净利率</div>
        </article>
      </section>

      {stats.demo > 0 ? (
        <div className="notice">
          <span className="badge demo-badge">DEMO</span>
          <span><strong>当前包含演示数据。</strong> 它们只用于验证系统和计算逻辑，不代表真实市场结论；导入自己的 CSV 后可直接替换。</span>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>商品机会</h2>
            <p>按机会分排序。机会分综合利润、需求、证据完整度和竞争强度，不替代人工判断。</p>
          </div>
          <Link href="/approvals" className="button secondary">查看审批中心</Link>
        </div>

        {cases.length === 0 ? (
          <div className="empty-state">
            <h3>还没有候选商品</h3>
            <p>从 CSV 导入 10–20 个真实候选品，系统会自动生成第一版成本模型。</p>
            <Link href="/import" className="button primary">开始导入</Link>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>机会分</th>
                  <th>单件净利</th>
                  <th>需求</th>
                  <th>建议</th>
                  <th>状态</th>
                  <th aria-label="查看详情" />
                </tr>
              </thead>
              <tbody>
                {cases.map((item) => {
                  const result = item.costModel?.results;
                  return (
                    <tr key={item.id}>
                      <td className="product-cell">
                        <Link href={`/cases/${item.id}`}>
                          <div className="product-title">
                            {item.title}
                            {item.is_demo ? <span className="badge demo-badge">演示</span> : null}
                          </div>
                          <div className="product-meta">
                            <span>{item.marketplace}</span>
                            <span>{item.category}</span>
                            <span>{item.asin}</span>
                          </div>
                        </Link>
                      </td>
                      <td>
                        <div className="score-wrap">
                          <span className="score-number">{item.opportunityScore}</span>
                          <span className="score-bar"><span style={{ width: `${item.opportunityScore}%` }} /></span>
                        </div>
                      </td>
                      <td>
                        <div className={`profit ${(result?.netProfitCents ?? 0) < 0 ? "negative" : ""}`}>
                          {result ? money(result.netProfitCents) : "—"}
                        </div>
                        <div className="subvalue">{result ? `${percent(result.marginRate)} 净利率` : "待建成本模型"}</div>
                      </td>
                      <td>
                        <div>{compactNumber(item.monthly_sales_estimate)} / 月</div>
                        <div className="subvalue">{compactNumber(item.review_count)} 条评论 · {item.rating ? `${item.rating}★` : "无评分"}</div>
                      </td>
                      <td><RecommendationBadge value={item.recommendation} /></td>
                      <td><StatusBadge status={item.status} /></td>
                      <td><Link href={`/cases/${item.id}`} className="arrow-link" aria-label={`查看 ${item.title}`}>→</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="notice" style={{ marginTop: 18, marginBottom: 0 }}>
        <span className="badge status-researching">NEXT</span>
        <span><strong>P1.1 已覆盖：</strong> 真实候选品/供应商/报价 CSV 导入、Keepa 与平台授权只读诊断、原始快照与运行审计、成本模型、人工立项和定标、多国家/多平台 Listing 映射预检。连接验证和内容批准都不等于平台上架，外部写连接仍未开放。</span>
      </div>
    </div>
  );
}
