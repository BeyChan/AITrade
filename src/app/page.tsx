import Link from "next/link";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { SiteScopeSwitcher } from "@/components/site-scope-switcher";
import { compactNumber, money, percent } from "@/lib/format";
import { getDashboardStats, getSiteOptions, listCasesForSite } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const [query, options, stats] = await Promise.all([searchParams, getSiteOptions(), getDashboardStats()]);
  const requestedMarket = query.market?.trim().toUpperCase();
  const requestedPlatform = query.platform?.trim().toLowerCase();
  const selectedMarket =
    options.markets.find((market) => market.code === requestedMarket) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];
  const selectedPlatform =
    options.platforms.find((platform) => platform.code === requestedPlatform) ??
    options.platforms.find((platform) => platform.code === "amazon") ??
    options.platforms[0];

  if (!selectedMarket || !selectedPlatform) {
    throw new Error("缺少可用的国家或平台配置");
  }

  const cases = await listCasesForSite(selectedMarket.code, selectedPlatform.code);
  const margins = cases.flatMap((item) => (item.costModel ? [item.costModel.results.marginRate] : []));
  const averageMargin = margins.length ? margins.reduce((sum, value) => sum + value, 0) / margins.length : 0;
  const goCount = cases.filter((item) => item.recommendation === "GO").length;
  const pendingCount = cases.filter((item) => item.pendingApprovalId !== null).length;
  const demoCount = cases.filter((item) => item.is_demo).length;
  const siteLabel = `${selectedMarket.name}站 · ${selectedPlatform.name}`;
  const siteHref = `/?market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}#opportunities`;
  const marketOptions = options.markets.map(({ code, name, currency }) => ({ code, name, currency }));
  const platformOptions = options.platforms.map(({ code, name }) => ({ code, name }));

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Opportunity workspace</div>
          <h1>选对国家站点，<br />再判断商品机会。</h1>
          <p>
            候选品证据、单位经济模型、供应商定标和内容门禁集中在一个工作台。
            在右上角切换国家与平台站点，机会列表、利润指标和后续 Listing 工作流都会从同一个站点上下文开始。
          </p>
        </div>
        <SiteScopeSwitcher
          markets={marketOptions}
          platforms={platformOptions}
          selectedMarket={selectedMarket.code}
          selectedPlatform={selectedPlatform.code}
        />
      </section>

      <section className="metrics-grid" aria-label="核心指标">
        <article className="metric-card">
          <div className="metric-label">候选商品</div>
          <div className="metric-value">{cases.length}</div>
          <div className="metric-note">当前站点范围{stats.total > cases.length ? ` · 工作台共 ${stats.total} 个` : ""}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">待立项审批</div>
          <div className="metric-value">{pendingCount}</div>
          <div className="metric-note">仅统计当前站点{siteLabel}的机会</div>
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

      {demoCount > 0 ? (
        <div className="notice">
          <span className="badge demo-badge">DEMO</span>
          <span><strong>当前站点包含 {demoCount} 个演示机会。</strong> 它们只用于验证系统和计算逻辑，不代表真实市场结论；导入自己的 CSV 后可直接替换。</span>
        </div>
      ) : null}

      <section className="panel" id="opportunities">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Current site opportunities</div>
            <h2>{siteLabel}的商品机会</h2>
            <p>只展示当前国家站点相关机会。机会分综合利润、需求、证据完整度和竞争强度，不替代人工判断。</p>
          </div>
          <div className="button-row">
            <Link href={`/import?market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`} className="button secondary">导入该站点候选品</Link>
            <Link href="/approvals" className="button secondary">查看审批中心</Link>
          </div>
        </div>

        {cases.length === 0 ? (
          <div className="empty-state">
            <h3>{siteLabel}还没有候选商品</h3>
            <p>可导入该站点的候选品；如果商品已在其他站点立项，也可进入商品详情，在渠道矩阵中新增当前国家 × 平台目标。</p>
            <div className="button-row" style={{ justifyContent: "center" }}>
              <Link href={`/import?market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`} className="button primary">导入候选品</Link>
              <Link href="/data-sources" className="button secondary">接入真实数据</Link>
            </div>
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
        <span className="badge status-researching">SCOPE</span>
        <span><strong>当前站点：{siteLabel}。</strong> 站点选择只改变工作范围，不代表平台已经授权或允许发布；连接检查、内容批准和内部发布队列都不等于平台已上架。 <Link className="text-link" href={siteHref}>固定此站点链接 →</Link></span>
      </div>
    </div>
  );
}
