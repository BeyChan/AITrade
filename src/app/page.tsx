import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createAISourcingBatchAction } from "@/app/actions";
import { CategoryRecommender } from "@/components/category-recommender";
import { GenerateResearchButton } from "@/components/generate-research-button";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { buildAiProposalDigest, loadPendingAiProposals } from "@/lib/ai-proposals/digest";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { money, percent, shortDate } from "@/lib/format";
import { getSiteOptions, listCasesForSite, listSourcingCases } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    notice?: string;
    error?: string;
    new?: string;
  }>;
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

  const [cases, batches, sourcingCases, provider, proposals] = await Promise.all([
    listCasesForSite(selectedMarket.code, selectedPlatform.code),
    listAISourcingBatches(selectedMarket.code, selectedPlatform.code),
    listSourcingCases(),
    getAIProviderStatus(),
    // AI 提案只是首页的补充信息；取数失败时降级为空，不阻塞工作台。
    loadPendingAiProposals({ limit: 4 }).catch(() =>
      buildAiProposalDigest([], { warnings: ["AI 提案暂时不可用"] }),
    ),
  ]);

  const siteLabel = `${selectedMarket.name}站 · ${selectedPlatform.name}`;
  const siteQuery = `market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`;
  const newResearchHref = `/?${siteQuery}&new=1#new-research`;
  const importHref = `/import?${siteQuery}`;
  const approvedCases = cases.filter((item) => item.status === "approved");
  const approvedCaseIds = new Set(approvedCases.map((item) => item.id));
  const siteSourcingCases = sourcingCases.filter((item) => approvedCaseIds.has(item.productCase.id));
  const sourcingByCaseId = new Map(siteSourcingCases.map((item) => [item.productCase.id, item]));

  const batchSelectedCount = batches.reduce((sum, batch) => sum + batch.selectedCount, 0);
  const batchGoCount = batches.reduce((sum, batch) => sum + batch.goCount, 0);
  const pendingVerificationCount = Math.max(batchSelectedCount - batchGoCount, 0);
  const pendingQuoteCases = siteSourcingCases.filter((item) => item.quoteCount === 0 && !item.selection);
  const pendingAwardCases = siteSourcingCases.filter((item) => item.quoteCount > 0 && !item.selection);
  const contentReadyCases = siteSourcingCases.filter((item) => item.selection);
  const activeBatch = batches.find((batch) => batch.selectedCount > batch.goCount) ?? batches[0];
  const recentCases = [...approvedCases]
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime())
    .slice(0, 5);
  const demoCount = approvedCases.filter((item) => item.is_demo).length;
  const researchRequestKey = randomUUID();

  const attentionTasks = [
    {
      label: "待补证据",
      value: pendingVerificationCount,
      detail: activeBatch ? `「${activeBatch.category}」还有方向未完成验证` : "从研究批次继续验证机会",
      href: activeBatch ? `/ai-sourcing/${activeBatch.id}` : newResearchHref,
      action: "继续验证",
    },
    {
      label: "待录入报价",
      value: pendingQuoteCases.length,
      detail: pendingQuoteCases[0]?.productCase.title ?? "已立项商品需要供应商报价",
      href: pendingQuoteCases[0]
        ? `/cases/${pendingQuoteCases[0].productCase.id}/sourcing`
        : "/sourcing",
      action: "录入报价",
    },
    {
      label: "待对比定标",
      value: pendingAwardCases.length,
      detail: pendingAwardCases[0]?.productCase.title ?? "已有报价商品等待人工选择供应商",
      href: pendingAwardCases[0]
        ? `/cases/${pendingAwardCases[0].productCase.id}/sourcing`
        : "/sourcing",
      action: "对比定标",
    },
    {
      label: "待制作内容",
      value: contentReadyCases.length,
      detail: contentReadyCases[0]?.productCase.title ?? "已定标商品可以开始制作内容",
      href: contentReadyCases[0]
        ? `/cases/${contentReadyCases[0].productCase.id}/content`
        : "/content",
      action: "制作内容",
    },
  ].filter((task) => task.value > 0);

  return (
    <div className="page dashboard-page">
      <section className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <div className="dashboard-context">
            <span>当前工作区</span>
            <strong>{siteLabel}</strong>
            <small>{selectedMarket.currency}</small>
          </div>
          <h1>今天先处理什么</h1>
          <p>
            {attentionTasks.length > 0 || proposals.total > 0
              ? `当前有 ${attentionTasks.length} 类事项${proposals.total > 0 ? `、${proposals.total} 条 AI 提案待确认` : ""}。先补齐证据、报价和定标，再推进内容制作。`
              : "当前没有必须人工处理的事项，可以查看商品进度或发起新一轮选品研究。"}
          </p>
          <div className="dashboard-hero-actions">
            <Link href={newResearchHref} className="button primary">新建选品研究</Link>
            <Link href="/sourcing" className="button secondary">查看供应商询价</Link>
          </div>
        </div>

        <aside className="dashboard-focus-card" aria-label="当前研究">
          <span className="dashboard-kicker">{activeBatch ? "继续当前研究" : "最近研究"}</span>
          {activeBatch ? (
            <>
              <h2>{activeBatch.category}</h2>
              <p>{activeBatch.brief}</p>
              <div className="dashboard-focus-metrics">
                <span><strong>{activeBatch.hypothesisCount}</strong> 个方向</span>
                <span><strong>{activeBatch.selectedCount}</strong> 个验证中</span>
                <span><strong>{activeBatch.goCount}</strong> 个 GO</span>
              </div>
              <Link href={`/ai-sourcing/${activeBatch.id}`} className="dashboard-text-link">打开验证批次 →</Link>
            </>
          ) : (
            <>
              <h2>从一轮研究开始</h2>
              <p>输入一个类目和研究条件，生成 5 个可验证的候选方向。</p>
              <Link href={newResearchHref} className="dashboard-text-link">填写研究条件 →</Link>
            </>
          )}
        </aside>
      </section>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}

      <section className="dashboard-flow" aria-label="当前业务阶段">
        <Link href={activeBatch ? `/ai-sourcing/${activeBatch.id}` : "/ai-sourcing"} className="dashboard-flow-step">
          <span className="dashboard-step-number">01</span>
          <span className="dashboard-step-copy">
            <strong>选品验证</strong>
            <small>
              {pendingVerificationCount > 0
                ? `${pendingVerificationCount} 个方向待继续验证`
                : batches.length > 0
                  ? `${batches.length} 个研究批次`
                  : "生成并验证机会方向"}
            </small>
          </span>
          <span className="dashboard-step-arrow" aria-hidden="true">→</span>
        </Link>
        <Link href="/sourcing" className="dashboard-flow-step">
          <span className="dashboard-step-number">02</span>
          <span className="dashboard-step-copy">
            <strong>供应商询价</strong>
            <small>
              {pendingQuoteCases.length > 0
                ? `${pendingQuoteCases.length} 个商品待报价`
                : pendingAwardCases.length > 0
                  ? `${pendingAwardCases.length} 个商品待定标`
                  : "报价、比较与人工定标"}
            </small>
          </span>
          <span className="dashboard-step-arrow" aria-hidden="true">→</span>
        </Link>
        <Link href="/content" className="dashboard-flow-step">
          <span className="dashboard-step-number">03</span>
          <span className="dashboard-step-copy">
            <strong>内容与上架</strong>
            <small>
              {contentReadyCases.length > 0
                ? `${contentReadyCases.length} 个商品可制作内容`
                : "完成定标后解锁内容制作"}
            </small>
          </span>
          <span className="dashboard-step-arrow" aria-hidden="true">→</span>
        </Link>
        <Link href="/data-sources" className="dashboard-flow-step">
          <span className="dashboard-step-number">04</span>
          <span className="dashboard-step-copy">
            <strong>数据导入</strong>
            <small>{approvedCases.length} 个已立项商品 · CSV 与渠道数据</small>
          </span>
          <span className="dashboard-step-arrow" aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="dashboard-attention" aria-labelledby="attention-title">
        <div className="dashboard-section-head">
          <div>
            <span className="dashboard-kicker">下一步</span>
            <h2 id="attention-title">需要你处理</h2>
          </div>
          <p>系统只推进已满足确定性规则的事项，例外必须由你确认。</p>
        </div>

        {proposals.total > 0 ? (
          <div className="dashboard-proposal-stream">
            <div className="dashboard-proposal-head">
              <strong>{proposals.total} 条 AI 提案待确认</strong>
              <span>按业务对象汇总，点击回到原对象处理；确认前不写入业务表</span>
            </div>
            <div className="dashboard-proposal-list">
              {proposals.groups.map((group) => (
                <Link href={group.href} className="dashboard-proposal-item" key={group.key}>
                  <span className="dashboard-proposal-count">{group.count}</span>
                  <span className="dashboard-proposal-copy">
                    <strong>{group.title}</strong>
                    <small>{group.summary} · {group.reason}</small>
                  </span>
                  <span className="dashboard-proposal-arrow" aria-hidden="true">→</span>
                </Link>
              ))}
            </div>
            {proposals.warnings.length > 0 ? (
              <small className="dashboard-proposal-warning">{proposals.warnings.join("；")}</small>
            ) : null}
          </div>
        ) : null}

        {attentionTasks.length > 0 ? (
          <div className="dashboard-task-grid">
            {attentionTasks.map((task) => (
              <article className="dashboard-task-card" key={task.label}>
                <div className="dashboard-task-count">
                  <span>{task.label}</span>
                  <strong>{task.value}</strong>
                </div>
                <p>{task.detail}</p>
                <Link href={task.href} className="dashboard-text-link">{task.action} →</Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-task-empty">
            <span className="dashboard-check" aria-hidden="true">✓</span>
            <div>
              <strong>当前没有必须人工处理的事项</strong>
              <p>可以查看已立项商品，或发起一轮新的选品研究。</p>
            </div>
            <Link href={importHref} className="button secondary">导入候选品</Link>
          </div>
        )}
      </section>

      {demoCount > 0 ? (
        <div className="dashboard-demo-note">
          <span className="badge demo-badge">演示数据</span>
          <span>当前站点包含 {demoCount} 个演示商品，仅用于验证流程，不代表真实市场结论。</span>
        </div>
      ) : null}

      <section className="panel dashboard-recent" id="opportunities">
        <div className="panel-header">
          <div>
            <span className="dashboard-kicker">商品进度</span>
            <h2>最近商品</h2>
            <p>只显示最近更新的 5 个商品，继续处理时直接进入对应阶段。</p>
          </div>
          <Link href="/content" className="button ghost">查看全部商品</Link>
        </div>

        {recentCases.length === 0 ? (
          <div className="empty-state">
            <h3>{siteLabel}还没有已立项商品</h3>
            <p>先完成一轮证据与报价验证；只有确定性 GO 才能转入商品立项。</p>
            <div className="dashboard-empty-actions">
              <Link href={newResearchHref} className="button primary">新建选品研究</Link>
              <Link href={importHref} className="button secondary">导入候选品</Link>
            </div>
          </div>
        ) : (
          <div className="dashboard-product-list">
            {recentCases.map((item) => {
              const result = item.costModel?.results;
              const sourcingCase = sourcingByCaseId.get(item.id);
              const nextStep = !sourcingCase || sourcingCase.quoteCount === 0
                ? { label: "录入报价", className: "badge-neutral", href: `/cases/${item.id}/sourcing` }
                : !sourcingCase.selection
                  ? { label: "对比定标", className: "status-review_pending", href: `/cases/${item.id}/sourcing` }
                  : { label: "制作内容", className: "badge-success", href: `/cases/${item.id}/content` };

              return (
                <article className="dashboard-product-row" key={item.id}>
                  <div className="dashboard-product-main">
                    <div className="product-title">
                      {item.title}
                      {item.is_demo ? <span className="badge demo-badge">演示</span> : null}
                    </div>
                    <div className="product-meta">
                      <span>{item.marketplace}</span>
                      <span>{item.category}</span>
                      <span>更新 {shortDate(item.updated_at)}</span>
                    </div>
                  </div>
                  <div className="dashboard-product-metric">
                    <span>选品分</span>
                    <strong>{item.opportunityScore}</strong>
                  </div>
                  <div className="dashboard-product-metric">
                    <span>单件净利</span>
                    <strong className={(result?.netProfitCents ?? 0) < 0 ? "negative" : ""}>
                      {result ? money(result.netProfitCents) : "—"}
                    </strong>
                    <small>{result ? `${percent(result.marginRate)} 净利率` : "待建成本模型"}</small>
                  </div>
                  <div className="dashboard-product-next">
                    <span>下一步</span>
                    <span className={`badge ${nextStep.className}`}>{nextStep.label}</span>
                  </div>
                  <Link href={nextStep.href} className="button ghost">继续 →</Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel dashboard-research-drawer" id="new-research">
        <details open={query.new === "1"}>
          <summary className="dashboard-drawer-summary">
            <div>
              <span className="dashboard-kicker">新建研究</span>
              <strong>从类目和研究条件开始，生成 5 个候选方向</strong>
              <small>AI 只生成待验证假设，不虚构销量、评论、供应商或报价。</small>
            </div>
            <span className="dashboard-drawer-action">
              <span className="dashboard-drawer-open">展开填写</span>
              <span className="dashboard-drawer-close">收起</span>
              <span className="dashboard-drawer-plus" aria-hidden="true">+</span>
            </span>
          </summary>

          <div className="dashboard-research-body">
            <div className="dashboard-research-intro">
              <div>
                <h2>为 {siteLabel} 新建选品研究</h2>
                <p>先写清目标用户、使用场景、价格带和首单预算，再生成候选方向。</p>
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
                  placeholder="例如：面向长毛猫狗家庭，优先轻小件，首单预算 1 万人民币以内。"
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
                <p className="muted">生成后先筛方向，再录入真实竞品、差评、专利、物流、供应商和报价证据。</p>
                <GenerateResearchButton />
              </div>
            </form>
          </div>
        </details>
      </section>

      <footer className="dashboard-model-status">
        <span>AI 模型</span>
        <strong>{provider.label}</strong>
        <span>{provider.model}</span>
        <span className={`badge ${provider.configured ? "badge-success" : "badge-neutral"}`}>
          {provider.provider === "template" ? "模板模式" : provider.configured ? "已配置" : "自动回退"}
        </span>
        <Link href="/settings">模型设置 →</Link>
      </footer>
    </div>
  );
}
