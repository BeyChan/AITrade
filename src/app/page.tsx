import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createAISourcingBatchAction } from "@/app/actions";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { CategoryRecommender } from "@/components/category-recommender";
import { GenerateResearchButton } from "@/components/generate-research-button";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { compactNumber, money, percent } from "@/lib/format";
import { getSiteOptions, listCasesForSite } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string; notice?: string; error?: string }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const [query, options] = await Promise.all([searchParams, getSiteOptions()]);
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

  const [cases, batches] = await Promise.all([
    listCasesForSite(selectedMarket.code, selectedPlatform.code),
    listAISourcingBatches(selectedMarket.code, selectedPlatform.code),
  ]);
  const provider = await getAIProviderStatus();
  const siteLabel = `${selectedMarket.name}站 · ${selectedPlatform.name}`;
  const hypothesisCount = batches.reduce((sum, batch) => sum + batch.hypothesisCount, 0);
  const selectedCount = batches.reduce((sum, batch) => sum + batch.selectedCount, 0);
  const goCount = batches.reduce((sum, batch) => sum + batch.goCount, 0);
  const demoCount = cases.filter((item) => item.is_demo).length;
  const researchRequestKey = randomUUID();

  return (
    <div className="page ai-sourcing-page">
      <section className="hero ai-sourcing-hero">
        <div className="hero-copy">
          <div className="eyebrow">AI sourcing · {siteLabel}</div>
          <h1>AI 选品工作台</h1>
          <p>
            输入品类和研究条件，系统生成 5 个候选方向；再录入真实竞品、差评、供应商报价与风险结论，
            按固定门槛得到 GO、HOLD 或 NO-GO。只有 GO 可以转商品立项。
          </p>
          <div className="button-row ai-hero-actions">
            <a href="#new-research" className="button primary">新建选品研究</a>
            <Link href="/ai-sourcing" className="button secondary">研究批次</Link>
            <Link href="/settings" className="button secondary">大模型设置</Link>
          </div>
        </div>
        <div className="ai-provider-card">
          <span className={`badge ${provider.configured ? "badge-success" : "badge-neutral"}`}>
            {provider.provider === "template" ? "无需 Key" : provider.configured ? "已配置" : "自动回退模板"}
          </span>
          <strong>{provider.label}</strong>
          <span>{provider.model}</span>
          <p>{provider.detail}</p>
          <Link href="/settings" className="text-link">配置模型与 API Key →</Link>
        </div>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <section className="metrics-grid ai-metrics" aria-label="AI 选品概览">
        <article className="metric-card">
          <div className="metric-label">机会方向</div>
          <div className="metric-value">{hypothesisCount}</div>
          <div className="metric-note">来自 {batches.length} 个当前站点研究批次</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已加入验证</div>
          <div className="metric-value">{selectedCount}</div>
          <div className="metric-note">正在补齐证据、供应商与报价</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">确定性 GO</div>
          <div className="metric-value">{goCount}</div>
          <div className="metric-note">证据、利润、风险与现金门禁全部通过</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已立项商品</div>
          <div className="metric-value">{cases.length}</div>
          <div className="metric-note">可继续供应商定标、内容和 Listing</div>
        </article>
      </section>

      <section className="panel" id="new-research">
        <div className="panel-header">
          <div>
            <div className="eyebrow">New research</div>
            <h2>为 {siteLabel} 新建选品研究</h2>
            <p>模型只负责拆分可验证方向，不填写销量、评论、供应商或报价。所有市场事实由你录入，并保留来源、观察时间和录入人。</p>
          </div>
          <span className="info-pill">{selectedMarket.currency} 口径</span>
        </div>
        <form action={createAISourcingBatchAction} className="form-grid ai-research-form">
          <input type="hidden" name="marketCode" value={selectedMarket.code} />
          <input type="hidden" name="platformCode" value={selectedPlatform.code} />
          <input type="hidden" name="requestKey" value={researchRequestKey} />
          <div className="ai-research-basics">
            <CategoryRecommender
              marketCode={selectedMarket.code}
              marketName={selectedMarket.name}
              platformCode={selectedPlatform.code}
              platformName={selectedPlatform.name}
            />
            <div className="field ai-research-actor">
              <label htmlFor="actor">创建人</label>
              <input id="actor" name="actor" placeholder="例如：老板 / 采购" defaultValue="运营人员" maxLength={80} />
            </div>
          </div>
          <div className="field full">
            <label htmlFor="brief">研究条件</label>
            <textarea
              id="brief"
              name="brief"
              placeholder="写清目标用户、使用场景、价格带、首单预算和硬性限制。例如：面向长毛猫狗家庭，优先轻小件，首单预算 1 万人民币以内。"
              required
              minLength={3}
              maxLength={1200}
              rows={5}
            />
          </div>
          {selectedMarket.currency !== "USD" ? (
            <>
              <div className="field">
                <label htmlFor="fxRateToUsd">汇率（1 USD = ? {selectedMarket.currency}）</label>
                <input id="fxRateToUsd" name="fxRateToUsd" type="number" min="0.000001" step="any" placeholder="例如：7.18" required />
              </div>
              <div className="field">
                <label htmlFor="fxSourceUrl">汇率来源 URL</label>
                <input id="fxSourceUrl" name="fxSourceUrl" type="url" placeholder="https://..." required />
              </div>
            </>
          ) : null}
          <div className="field full ai-form-footer">
            <p className="muted">默认模板模式不需要模型 Key。生成后请先筛选方向，再逐项录入真实竞品、差评、专利、物流、供应商和报价证据。</p>
            <GenerateResearchButton />
          </div>
        </form>
      </section>

      {demoCount > 0 ? (
        <div className="notice">
          <span className="badge demo-badge">DEMO</span>
          <span><strong>当前站点包含 {demoCount} 个演示商品。</strong> 它们只用于验证系统和计算逻辑，不代表真实市场结论；导入自己的 CSV 后可直接替换。</span>
        </div>
      ) : null}

      <section className="panel" id="opportunities">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Promoted products</div>
            <h2>{siteLabel}已立项商品</h2>
            <p>这里只展示已完成立项的商品。选品分综合利润、需求、证据完整度和竞争强度，仍需人工复核。</p>
          </div>
          <div className="button-row">
            <Link href={`/import?market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`} className="button secondary">导入候选品</Link>
            <Link href="/settings" className="button secondary">大模型设置</Link>
          </div>
        </div>

        {cases.length === 0 ? (
          <div className="empty-state">
            <h3>{siteLabel}还没有已立项商品</h3>
            <p>先在新研究中完成证据与报价验证；只有确定性 GO 才能转入商品立项。也可以导入已有候选品继续现有流程。</p>
            <div className="button-row" style={{ justifyContent: "center" }}>
              <a href="#new-research" className="button primary">新建选品研究</a>
              <Link href={`/import?market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`} className="button secondary">导入候选品</Link>
              <Link href="/data-sources" className="button secondary">接入真实数据</Link>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>商品</th>
                  <th>选品分</th>
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
    </div>
  );
}
