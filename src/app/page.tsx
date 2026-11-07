import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createAISourcingBatchAction } from "@/app/actions";
import { CategoryRecommender } from "@/components/category-recommender";
import { GenerateResearchButton } from "@/components/generate-research-button";
import { OpportunityScoreHelp } from "@/components/opportunity-score-help";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getAppMode } from "@/lib/app-mode";
import { buildAiProposalDigest, loadPendingAiProposals } from "@/lib/ai-proposals/digest";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { money, percent, shortDate } from "@/lib/format";
import { getSiteOptions, listCasesForSite, listSourcingCases, listTerminatedCases } from "@/lib/repository";
import { TerminateCaseControl } from "@/components/case-lifecycle-controls";
import { TerminatedCasesPanel } from "@/components/terminated-cases-panel";
import { DashboardPipelineKanban } from "@/components/dashboard-pipeline-kanban";
import { getComparisonReports } from "@/lib/competitor-compare/storage";

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
  const [query, options, mode] = await Promise.all([searchParams, getSiteOptions(), getAppMode()]);
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

  const [cases, batches, sourcingCases, provider, proposals, terminatedCases, competitorReports] = await Promise.all([
    listCasesForSite(selectedMarket.code, selectedPlatform.code),
    listAISourcingBatches(selectedMarket.code, selectedPlatform.code),
    listSourcingCases(),
    getAIProviderStatus(),
    // AI 提案只是首页的补充信息；取数失败时降级为空，不阻塞工作台。
    loadPendingAiProposals({ limit: 4 }).catch(() =>
      buildAiProposalDigest([], { warnings: ["AI 提案暂时不可用"] }),
    ),
    listTerminatedCases(),
    getComparisonReports(),
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
  const siteTerminatedCases = terminatedCases.filter(
    (entry) => entry.caseItem.marketplace.toUpperCase() === selectedMarket.code.toUpperCase(),
  );
  const dashboardReturnPath = `/?${siteQuery}`;
  const researchRequestKey = randomUUID();

  // 宏观商业经营指标计算
  const casesWithMargin = approvedCases.filter((item) => item.costModel?.results?.marginRate != null);
  const avgMarginRate = casesWithMargin.length
    ? casesWithMargin.reduce((sum, item) => sum + (item.costModel?.results?.marginRate ?? 0), 0) / casesWithMargin.length
    : 0;

  const totalMonthlyMarginCents = approvedCases.reduce((sum, item) => {
    const profit = item.costModel?.results?.netProfitCents ?? 0;
    const sales = item.monthly_sales_estimate || 0;
    return sum + profit * sales;
  }, 0);

  const attentionTasks = [
    ...(proposals.total > 0 ? [{
      label: "待确认 AI 提案",
      value: proposals.total,
      detail: proposals.groups[0]?.reason ?? "模型产出等待人工确认，确认前不会写入业务表",
      href: proposals.groups[0]?.href ?? "/ai-inbox",
      action: "去确认",
      stage: "stage1" as const,
    }] : []),
    ...(proposals.byKind.supplier_draft > 0 ? [{
      label: "待审 RFQ 草稿",
      value: proposals.byKind.supplier_draft,
      detail: "内部草稿仅供人工复制，系统不会发送给供应商",
      href: activeBatch ? `/ai-sourcing/${activeBatch.id}?tab=quotes` : "/ai-sourcing",
      action: "审阅草稿",
      stage: "stage2" as const,
    }] : []),
    ...(batchGoCount > 0 ? [{
      label: "待决策门禁",
      value: batchGoCount,
      detail: "已有方向通过确定性门禁，等待人工决定是否立项",
      href: activeBatch ? `/ai-sourcing/${activeBatch.id}?tab=decision` : "/ai-sourcing",
      action: "查看结论",
      stage: "stage3" as const,
    }] : []),
    {
      label: "待补证据",
      value: pendingVerificationCount,
      detail: activeBatch ? `「${activeBatch.category}」还有方向未完成验证` : "从研究批次继续验证机会",
      href: activeBatch ? `/ai-sourcing/${activeBatch.id}?tab=hypotheses` : newResearchHref,
      action: "继续验证",
      stage: "stage1" as const,
    },
    {
      label: "待录入报价",
      value: pendingQuoteCases.length,
      detail: pendingQuoteCases[0]?.productCase.title ?? "已立项商品需要供应商报价",
      href: pendingQuoteCases[0]
        ? `/cases/${pendingQuoteCases[0].productCase.id}/sourcing`
        : "/sourcing",
      action: "录入报价",
      stage: "stage2" as const,
    },
    {
      label: "待对比定标",
      value: pendingAwardCases.length,
      detail: pendingAwardCases[0]?.productCase.title ?? "已有报价商品等待人工选择供应商",
      href: pendingAwardCases[0]
        ? `/cases/${pendingAwardCases[0].productCase.id}/sourcing`
        : "/sourcing",
      action: "对比定标",
      stage: "stage3" as const,
    },
    {
      label: "待制作内容",
      value: contentReadyCases.length,
      detail: contentReadyCases[0]?.productCase.title ?? "已定标商品可以开始制作内容",
      href: contentReadyCases[0]
        ? `/cases/${contentReadyCases[0].productCase.id}/content`
        : "/content",
      action: "制作内容",
      stage: "stage4" as const,
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
            {demoCount > 0 ? (
              <span className="dashboard-demo-badge" title="当前工作区包含演示样板数据">
                DEMO 样板 ({demoCount})
              </span>
            ) : null}
          </div>
          <h1>今天先处理什么</h1>
          <p>
            {attentionTasks.length > 0
              ? `今天有 ${attentionTasks.length} 类待办。按顺序处理，每一项都能直接跳到要操作的位置。`
              : "当前没有必须人工处理的事项，可以查看商品进度或发起新一轮选品研究。"}
          </p>
          <div className="dashboard-hero-actions">
            <Link href={newResearchHref} className="button primary">新建选品研究</Link>
            <Link href="#pipeline-kanban" className="button secondary">查看业务推进大盘</Link>
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
              <Link href={`/ai-sourcing/${activeBatch.id}?tab=hypotheses`} className="dashboard-text-link">继续验证 →</Link>
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

      {/* 宏观商业大盘 KPI 四联卡片（全卡可点击跳转至对应工作区） */}
      <section className="dashboard-kpi-grid" aria-label="大盘测算潜力指标">
        <Link href="#pipeline-kanban" className="dashboard-kpi-card" title="点击直达业务推进大盘">
          <div className="kpi-meta">
            <span className="kpi-label">推进中商品</span>
            <span className="kpi-tag tag-blue">Pipeline</span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-value">{approvedCases.length}</strong>
            <span className="kpi-unit">款</span>
          </div>
          <div className="kpi-sub">
            {batchGoCount > 0 ? (
              <span><strong>{batchGoCount}</strong> 款待立项决策 · 查看看板 ↓</span>
            ) : (
              <span>全部在办品正常流转中 · 查看看板 ↓</span>
            )}
          </div>
        </Link>

        <Link href="#opportunities" className="dashboard-kpi-card" title="点击查看商品测算详情与成本模型">
          <div className="kpi-meta">
            <span className="kpi-label">测算预期月毛利</span>
            <span className="kpi-tag tag-green">Projected</span>
          </div>
          <div className="kpi-value-row">
            <strong className={`kpi-value ${totalMonthlyMarginCents < 0 ? "negative" : ""}`}>
              {totalMonthlyMarginCents > 0 ? money(totalMonthlyMarginCents) : "—"}
            </strong>
          </div>
          <div className="kpi-sub">
            <span>基于各品月销预估与确定性成本 · 查看单品 ↓</span>
          </div>
        </Link>

        <Link href="#opportunities" className="dashboard-kpi-card" title="点击核对低于 18% 门禁的薄利商品">
          <div className="kpi-meta">
            <span className="kpi-label">平均测算净利率</span>
            <span className="kpi-tag tag-emerald">Margin</span>
          </div>
          <div className="kpi-value-row">
            <strong className={`kpi-value ${casesWithMargin.length && avgMarginRate < 0.18 ? "warn" : ""}`}>
              {casesWithMargin.length ? percent(avgMarginRate) : "—"}
            </strong>
          </div>
          <div className="kpi-sub">
            <span>
              {casesWithMargin.length
                ? avgMarginRate >= 0.18
                  ? "毛利结构健康 · 达到 18% GO 门禁"
                  : "部分低毛利品 · 低于 18% 门禁线"
                : "待建成本模型测算"}
            </span>
          </div>
        </Link>

        <Link href="#pipeline-kanban" className="dashboard-kpi-card" title="点击直达待办事项处理">
          <div className="kpi-meta">
            <span className="kpi-label">今日待办事项</span>
            <span className={`kpi-tag ${attentionTasks.length > 0 ? "tag-amber" : "tag-muted"}`}>
              {attentionTasks.length > 0 ? "Action Required" : "All Clear"}
            </span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-value">{attentionTasks.reduce((s, t) => s + t.value, 0)}</strong>
            <span className="kpi-unit">项</span>
          </div>
          <div className="kpi-sub">
            <span className="kpi-link">查看看板阶段分布与行动卡 ↓</span>
          </div>
        </Link>
      </section>

      <div id="pipeline-kanban">
        <DashboardPipelineKanban
          marketCode={selectedMarket.code}
          platformCode={selectedPlatform.code}
          currency={selectedMarket.currency}
          competitorReports={competitorReports}
          cases={cases}
          sourcingCases={sourcingCases}
          attentionTasks={attentionTasks}
          proposalsTotal={proposals.total}
        />
      </div>

      <section className="panel dashboard-recent" id="opportunities">
        <div className="panel-header">
          <div>
            <span className="dashboard-kicker">进行中的对象</span>
            <h2>商品进度</h2>
            <p>最近更新的 5 个商品，每项都标出当前阶段和下一步，点「继续」直接回到该步骤。</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <OpportunityScoreHelp />
            <Link href="/content" className="button ghost">查看全部商品</Link>
          </div>
        </div>

        {recentCases.length === 0 ? (
          <div className="empty-state dashboard-onboarding-empty">
            {mode === "live" ? (
              <div className="onboarding-guide">
                <div className="onboarding-header">
                  <span className="badge badge-success">真实生产模式</span>
                  <h3>{siteLabel} 暂无真实立项商品</h3>
                  <p>您已切入真实数据模式，当前彻底隔离演示样本。通过以下 3 步开始真实跨境业务流转：</p>
                </div>
                <div className="onboarding-steps">
                  <div className="onboarding-step-card">
                    <span className="step-num">1</span>
                    <strong>导入竞品与候选品</strong>
                    <p>上传已调研的 ASIN 竞品清单或线下整理的 CSV 选品数据表</p>
                    <Link href={importHref} className="button secondary">去导入数据 →</Link>
                  </div>
                  <div className="onboarding-step-card">
                    <span className="step-num">2</span>
                    <strong>发起 AI 选品研究</strong>
                    <p>针对具体类目输入门槛条件，生成 5 个经证伪推演的候选方向</p>
                    <Link href={newResearchHref} className="button primary">新建选品研究 →</Link>
                  </div>
                  <div className="onboarding-step-card">
                    <span className="step-num">3</span>
                    <strong>随时查看演示样板</strong>
                    <p>如需复习全生命周期流程，可在左下角侧边栏随时切回「演示模式」</p>
                    <Link href="/connections" className="button ghost">检查店铺连接 →</Link>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <h3>{siteLabel}还没有已立项商品</h3>
                <p>先完成一轮证据与报价验证；只有确定性 GO 才能转入商品立项。</p>
                <div className="dashboard-empty-actions">
                  <Link href={newResearchHref} className="button primary">新建选品研究</Link>
                  <Link href={importHref} className="button secondary">导入候选品</Link>
                </div>
              </>
            )}
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
                      <Link href={`/cases/${item.id}`} className="product-title-link">
                        {item.title}
                      </Link>
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
                    <span>当前阶段</span>
                    <span className={`badge ${nextStep.className}`}>{nextStep.label}</span>
                  </div>
                  <div className="dashboard-product-actions">
                    <Link href={nextStep.href} className="button secondary">继续 →</Link>
                    <TerminateCaseControl
                      caseId={item.id}
                      title={item.title}
                      returnPath={`${dashboardReturnPath}#opportunities`}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <TerminatedCasesPanel
          entries={siteTerminatedCases}
          returnPath={dashboardReturnPath}
        />
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
