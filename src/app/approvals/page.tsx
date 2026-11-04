import Link from "next/link";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { money, percent, shortDate } from "@/lib/format";
import { listCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const cases = await listCases();
  const pending = cases.filter((item) => item.status === "review_pending");
  const decided = cases.filter((item) => item.status === "approved" || item.status === "rejected");

  return (
    <div className="page">
      <section className="hero">
        <div>
          <div className="eyebrow">Decision center</div>
          <h1>审批中心</h1>
          <p>高风险动作必须由人决策。审批人、意见、成本版本和最终状态都会写入审计日志。</p>
        </div>
        <Link href="/" className="button secondary">← 返回商品机会</Link>
      </section>

      <section className="cards-grid" style={{ marginBottom: 22 }}>
        {pending.length === 0 ? (
          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h3>没有待审批事项</h3>
            <p className="muted">导入新的候选品后会生成“商品立项”审批单。</p>
          </div>
        ) : pending.map((item) => (
          <Link href={`/cases/${item.id}`} className="card" key={item.id}>
            <div className="evidence-top">
              <span className="badge status-review_pending">待立项</span>
              <RecommendationBadge value={item.recommendation} />
            </div>
            <h3 style={{ marginTop: 15 }}>{item.title}</h3>
            <p>{item.marketplace} · {item.category} · 机会分 {item.opportunityScore}</p>
            <div className="breakdown">
              <div className="breakdown-row"><span>预计单件净利</span><strong>{item.costModel ? money(item.costModel.results.netProfitCents) : "—"}</strong></div>
              <div className="breakdown-row"><span>预计净利率</span><strong>{item.costModel ? percent(item.costModel.results.marginRate) : "—"}</strong></div>
              <div className="breakdown-row"><span>最近更新</span><strong>{shortDate(item.updated_at)}</strong></div>
            </div>
          </Link>
        ))}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>最近决策</h2>
            <p>第一版只展示当前项目状态，后续会按审批单形成完整历史。</p>
          </div>
        </div>
        {decided.length === 0 ? (
          <div className="empty-state">还没有已完成的立项决策。</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>商品</th><th>结果</th><th>状态</th><th>更新时间</th><th /></tr>
              </thead>
              <tbody>
                {decided.map((item) => (
                  <tr key={item.id}>
                    <td className="product-cell"><div className="product-title">{item.title}</div><div className="product-meta">{item.asin} · {item.category}</div></td>
                    <td><RecommendationBadge value={item.recommendation} /></td>
                    <td><StatusBadge status={item.status} /></td>
                    <td className="muted">{shortDate(item.updated_at)}</td>
                    <td><Link href={`/cases/${item.id}`} className="arrow-link">→</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
