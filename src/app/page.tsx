import Link from "next/link";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { buildAiProposalDigest, loadPendingAiProposals } from "@/lib/ai-proposals/digest";
import { listAISourcingBatches } from "@/lib/ai-sourcing-repository";
import { money, percent } from "@/lib/format";
import { getSiteOptions, listCasesForSite, listSourcingCases, listTerminatedCases } from "@/lib/repository";
import { TerminatedCasesPanel } from "@/components/terminated-cases-panel";
import { DashboardIntelBriefing, type InternalAlertItem } from "@/components/dashboard-intel-briefing";
import { DashboardPipelineKanban } from "@/components/dashboard-pipeline-kanban";
import { QueryNotices } from "@/components/ui";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import { formatFxRate } from "@/lib/currency";
import { getFxRatesSnapshot } from "@/lib/fx-rates";
import { getMarketIntelSnapshot } from "@/lib/market-intel";
import { listOperationsBatches } from "@/lib/operations-repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    market?: string;
    platform?: string;
    notice?: string;
    error?: string;
  }>;
};

export default async function DashboardPage({ searchParams }: PageProps) {
  const [query, options] = await Promise.all([searchParams, getSiteOptions()]);
  const siteScope = await resolvePersistedSiteScope(query.market, query.platform);

  const selectedMarket =
    options.markets.find((market) => market.code === siteScope.marketCode) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];
  const selectedPlatform =
    options.platforms.find((platform) => platform.code === siteScope.platformCode) ??
    options.platforms.find((platform) => platform.code === "amazon") ??
    options.platforms[0];

  if (!selectedMarket || !selectedPlatform) {
    throw new Error("缺少可用的国家或平台配置");
  }

  const [
    cases,
    batches,
    sourcingCases,
    provider,
    proposals,
    terminatedCases,
    competitorReports,
    marketIntel,
    fxSnapshot,
    opsBatches,
  ] = await Promise.all([
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
    getMarketIntelSnapshot().catch(() => ({
      items: [],
      updatedAt: null,
      isStale: true,
      sourcesChecked: 4,
      sourcesSucceeded: 0,
    })),
    getFxRatesSnapshot(),
    listOperationsBatches(5).catch(() => []),
  ]);

  const siteLabel = `${selectedMarket.name}站 · ${selectedPlatform.name}`;
  const siteQuery = `market=${encodeURIComponent(selectedMarket.code)}&platform=${encodeURIComponent(selectedPlatform.code)}`;
  const newResearchHref = `/discover?${siteQuery}&entry=ai`;
  const approvedCases = cases.filter((item) => item.status === "approved");
  const approvedCaseIds = new Set(approvedCases.map((item) => item.id));
  const siteSourcingCases = sourcingCases.filter((item) => approvedCaseIds.has(item.productCase.id));

  const batchSelectedCount = batches.reduce((sum, batch) => sum + batch.selectedCount, 0);
  const batchGoCount = batches.reduce((sum, batch) => sum + batch.goCount, 0);
  const pendingVerificationCount = Math.max(batchSelectedCount - batchGoCount, 0);
  const pendingQuoteCases = siteSourcingCases.filter((item) => item.quoteCount === 0 && !item.selection);
  const pendingAwardCases = siteSourcingCases.filter((item) => item.quoteCount > 0 && !item.selection);
  const contentReadyCases = siteSourcingCases.filter((item) => item.selection);
  const activeBatch = batches.find((batch) => batch.selectedCount > batch.goCount) ?? batches[0];
  const demoCount = approvedCases.filter((item) => item.is_demo).length;
  const siteTerminatedCases = terminatedCases.filter(
    (entry) => entry.caseItem.marketplace.toUpperCase() === selectedMarket.code.toUpperCase(),
  );
  const dashboardReturnPath = `/?${siteQuery}`;

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

  // 站内经营异动（100% 来自真实业务数据）
  const internalAlerts: InternalAlertItem[] = [];

  // 1. 利润低于 18% 门禁线的在办商品
  const lowMarginCases = casesWithMargin
    .filter((item) => (item.costModel?.results?.marginRate ?? 1) < 0.18)
    .sort((a, b) => (a.costModel?.results?.marginRate ?? 0) - (b.costModel?.results?.marginRate ?? 0));
  for (const item of lowMarginCases.slice(0, 2)) {
    const rate = item.costModel?.results?.marginRate ?? 0;
    internalAlerts.push({
      id: `margin-${item.id}`,
      tag: "利润破线",
      tone: rate < 0.1 ? "danger" : "warn",
      title: item.title,
      detail: `当前测算净利率 ${percent(rate)}，低于 18% GO 门禁线`,
      href: `/cases/${item.id}`,
      actionLabel: "调成本",
    });
  }

  // 2. 实盘账本 FBA 断货倒计时预警
  const siteOpsBatch = opsBatches.find(
    (b) => b.marketplace.toUpperCase() === selectedMarket.code.toUpperCase(),
  ) ?? opsBatches[0];
  if (siteOpsBatch) {
    const riskSku = siteOpsBatch.skus.find(
      (s) => s.stockoutRisk === "critical" || s.stockoutRisk === "warning",
    );
    if (riskSku) {
      internalAlerts.push({
        id: `stockout-${riskSku.id}`,
        tag: riskSku.stockoutRisk === "critical" ? "断货高危" : "库存预警",
        tone: riskSku.stockoutRisk === "critical" ? "danger" : "warn",
        title: `SKU ${riskSku.sku} 可售天数告急`,
        detail:
          riskSku.daysOfSupply !== null
            ? `预计仅够售 ${Math.round(riskSku.daysOfSupply)} 天（可售 ${riskSku.availableUnits ?? "—"} 件）`
            : `批次「${siteOpsBatch.label}」存在 ${siteOpsBatch.stockoutRiskCount} 个断货风险 SKU`,
        href: "/operations",
        actionLabel: "看账本",
      });
    }
  }

  // 3. 竞品研报最新异动（价格跳水 / 评论激增 / 待人工确认）
  const siteReports = competitorReports.filter(
    (r) => (r.marketCode || "US").toUpperCase() === selectedMarket.code.toUpperCase(),
  );
  const diffReport = siteReports.find((r) => r.snapshotDiff && Array.isArray(r.snapshotDiff.alerts) && r.snapshotDiff.alerts.length > 0);
  if (diffReport && diffReport.snapshotDiff) {
    internalAlerts.push({
      id: `comp-diff-${diffReport.id}`,
      tag: "竞品异动",
      tone: "info",
      title: diffReport.title,
      detail: diffReport.snapshotDiff.alerts[0],
      href: `/competitors?id=${encodeURIComponent(diffReport.id)}`,
      actionLabel: "看研报",
    });
  } else if (siteReports[0]) {
    const latestReport = siteReports[0];
    const p50 = latestReport.priceStats?.p50 ?? 0;
    internalAlerts.push({
      id: `comp-latest-${latestReport.id}`,
      tag: "竞品动态",
      tone: "info",
      title: latestReport.title,
      detail: `已收录 ${latestReport.competitors.length} 款竞品 · 价格中位 ${p50 > 0 ? `${(p50 / 100).toFixed(1)} ${latestReport.currency || selectedMarket.currency}` : "待采集"}`,
      href: `/competitors?id=${encodeURIComponent(latestReport.id)}`,
      actionLabel: "查看",
    });
  }

  // 当前站点币种汇率偏离官方基准 ≥ 1% 时，在外部情报栏顶部给出联动提示
  const siteFx = fxSnapshot.byCurrency[selectedMarket.currency.toUpperCase()];
  let fxNotice: { title: string; detail: string } | null = null;
  if (siteFx && siteFx.mode !== "default" && siteFx.defaultRateToRmb > 0) {
    const deltaPct = ((siteFx.rateToRmb - siteFx.defaultRateToRmb) / siteFx.defaultRateToRmb) * 100;
    if (Math.abs(deltaPct) >= 1) {
      const dir = deltaPct > 0 ? "上浮" : "回落";
      fxNotice = {
        title: `${siteFx.currency}/CNY 较基准${dir} ${Math.abs(deltaPct).toFixed(1)}%（当前 ¥${formatFxRate(siteFx.currency, siteFx.rateToRmb)}）`,
        detail: `${siteFx.source} · 建议复核 1688 采购上限与在办商品利润安全垫`,
      };
    }
  }

  const attentionTasks = [
    ...(proposals.total > 0 ? [{
      label: "待确认 AI 提案",
      value: proposals.total,
      detail: proposals.groups[0]?.reason ?? "模型产出等待人工确认，确认前不会写入业务表",
      href:
        proposals.groups[0]?.href && !proposals.groups[0].href.startsWith("/ai-inbox")
          ? proposals.groups[0].href
          : "/discover",
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

  const nowIso = new Date().toISOString();
  const totalAttentionCount = attentionTasks.reduce((sum, task) => sum + task.value, 0);
  const topTaskLabel = attentionTasks[0]?.label;
  const focusReport = !activeBatch ? (siteReports[0] ?? competitorReports[0] ?? null) : null;

  return (
    <div className="page dashboard-page">
      {/* 1. 一体化工作台主 Hero（左：行动指引 · 右：最近研报焦点 · 底：内嵌单行情报头条条） */}
      <section className="dashboard-hero-v2">
        <div className="hero-v2-main">
          <div className="hero-v2-left">
            {demoCount > 0 ? (
              <div className="hero-eyebrow-bar">
                <span className="hero-eyebrow-demo" title="当前工作区包含演示样板数据">
                  DEMO ({demoCount})
                </span>
              </div>
            ) : null}

            <h1 className="hero-v2-title">
              {totalAttentionCount > 0
                ? `今天有 ${totalAttentionCount} 项待办待推进`
                : `${siteLabel} 工作台`}
            </h1>

            <p className="hero-v2-desc">
              {totalAttentionCount > 0
                ? `优先处理「${topTaskLabel ?? "在办商品"}」，点击下方看板或右侧按钮可直接跳到对应步骤。`
                : "当前没有阻塞待办，可以从 3 步选品向导开启下一轮机会验证，或继续查看右侧最近研报。"}
            </p>

            <div className="hero-v2-actions">
              <Link href={`/discover?${siteQuery}`} className="button primary">
                开始选品（3 步向导）
              </Link>
              {attentionTasks[0] ? (
                <Link href={attentionTasks[0].href} className="button secondary">
                  优先处理：{attentionTasks[0].action}
                </Link>
              ) : null}
            </div>
          </div>

          <aside className="hero-focus-card" aria-label="当前研究">
          {activeBatch ? (
            <>
              <div className="hero-focus-head">
                <span className="hero-focus-kicker">继续当前 AI 研究</span>
              </div>
              <h2 className="hero-focus-title">{activeBatch.category}</h2>
              <p className="hero-focus-desc">{activeBatch.brief}</p>
              <div className="hero-focus-stats">
                <div className="hero-stat-cell">
                  <span>候选方向</span>
                  <strong>{activeBatch.hypothesisCount}</strong>
                </div>
                <div className="hero-stat-cell">
                  <span>验证中</span>
                  <strong>{activeBatch.selectedCount}</strong>
                </div>
                <div className="hero-stat-cell">
                  <span>通过 GO</span>
                  <strong>{activeBatch.goCount}</strong>
                </div>
              </div>
              <div className="hero-focus-footer">
                <Link href={`/ai-sourcing/${activeBatch.id}?tab=hypotheses`} className="button secondary fx-btn-sm">
                  继续验证 →
                </Link>
              </div>
            </>
          ) : focusReport ? (
            (() => {
              const p50 = focusReport.priceStats?.p50 ?? 0;
              const mathEv = focusReport.productIndex?.mathEvidence;
              const hhiVal = mathEv && mathEv.hhiBasis !== "insufficient" ? Math.round(mathEv.hhi) : null;
              return (
                <>
                  <div className="hero-focus-head">
                    <span className="hero-focus-kicker">最近竞品研报</span>
                    <span className="hero-focus-badge">
                      {(focusReport.marketCode || selectedMarket.code).toUpperCase()}
                    </span>
                  </div>
                  <h2 className="hero-focus-title" title={focusReport.title}>
                    {focusReport.title}
                  </h2>
                  <div className="hero-focus-stats">
                    <div className="hero-stat-cell">
                      <span>样本数</span>
                      <strong>{focusReport.competitors.length} 款</strong>
                    </div>
                    <div className="hero-stat-cell">
                      <span>价格中位 P50</span>
                      <strong>
                        {p50 > 0
                          ? `${(p50 / 100).toFixed(1)} ${focusReport.currency || selectedMarket.currency}`
                          : "待采集"}
                      </strong>
                    </div>
                    <div className="hero-stat-cell">
                      <span>垄断度 HHI</span>
                      <strong>{hhiVal !== null ? hhiVal : "—"}</strong>
                    </div>
                  </div>
                  <div className="hero-focus-footer">
                    <Link
                      href={`/competitors?id=${encodeURIComponent(focusReport.id)}`}
                      className="button secondary fx-btn-sm"
                    >
                      查看研报 →
                    </Link>
                    <Link href={newResearchHref} className="hero-focus-ghost-link">
                      新建 AI 研究
                    </Link>
                  </div>
                </>
              );
            })()
          ) : (
            <>
              <div className="hero-focus-head">
                <span className="hero-focus-kicker">最近研究</span>
              </div>
              <h2 className="hero-focus-title">从一轮研究开始</h2>
              <p className="hero-focus-desc">
                输入类目与约束条件，让 AI 拆出 5 个可验证的细分机会方向。
              </p>
              <div className="hero-focus-footer">
                <Link href={newResearchHref} className="button secondary fx-btn-sm">
                  填写研究条件 →
                </Link>
              </div>
            </>
          )}
        </aside>
        </div>

        <DashboardIntelBriefing
          marketCode={selectedMarket.code}
          initialNowIso={nowIso}
          initialIntel={marketIntel}
          internalAlerts={internalAlerts}
          fxNotice={fxNotice}
          embedded
        />
      </section>

      <QueryNotices notice={query.notice} error={query.error} />

      {/* 2. 紧凑 4 格 KPI 摘要条 */}
      <section className="dashboard-kpi-grid is-compact" aria-label="大盘测算潜力指标">
        <Link href="#pipeline-kanban" className="dashboard-kpi-card" title="点击直达业务推进大盘">
          <div className="kpi-meta">
            <span className="kpi-label">推进中商品</span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-value">{approvedCases.length}</strong>
            <span className="kpi-unit">款</span>
          </div>
          <div className="kpi-sub">
            {batchGoCount > 0 ? (
              <span><strong>{batchGoCount}</strong> 款待立项决策</span>
            ) : (
              <span>全部正常流转中</span>
            )}
          </div>
        </Link>

        <Link href={`/cases?${siteQuery}`} className="dashboard-kpi-card" title="点击查看商品测算详情与成本模型">
          <div className="kpi-meta">
            <span className="kpi-label">测算预期月毛利</span>
          </div>
          <div className="kpi-value-row">
            <strong className={`kpi-value ${totalMonthlyMarginCents < 0 ? "negative" : ""}`}>
              {totalMonthlyMarginCents > 0 ? money(totalMonthlyMarginCents) : "—"}
            </strong>
          </div>
          <div className="kpi-sub">
            <span>{approvedCases.length} 款在办品确定性测算汇总</span>
          </div>
        </Link>

        <Link
          href={`/cases?${siteQuery}`}
          className={`dashboard-kpi-card ${casesWithMargin.length && avgMarginRate < 0.18 ? "is-alert" : ""}`}
          title="点击核对低于 18% 门禁的薄利商品"
        >
          <div className="kpi-meta">
            <span className="kpi-label">平均测算净利率</span>
            {casesWithMargin.length && avgMarginRate < 0.18 ? (
              <span className="badge badge-warn">低于 18%</span>
            ) : null}
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
                  ? "达到 18% GO 门禁"
                  : `${lowMarginCases.length} 款低于 18% 门禁线`
                : "待建成本模型"}
            </span>
          </div>
        </Link>

        <Link href="#pipeline-kanban" className="dashboard-kpi-card" title="点击直达待办事项处理">
          <div className="kpi-meta">
            <span className="kpi-label">今日待办事项</span>
          </div>
          <div className="kpi-value-row">
            <strong className="kpi-value">{totalAttentionCount}</strong>
            <span className="kpi-unit">项</span>
          </div>
          <div className="kpi-sub">
            <span className="kpi-link">{topTaskLabel ? `优先：${topTaskLabel}` : "暂无阻塞待办"}</span>
          </div>
        </Link>
      </section>

      {/* 3. 主舞台：5 阶业务推进看板 */}
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

      {siteTerminatedCases.length > 0 ? (
        <section className="panel" aria-label="已终止商品归档">
          <TerminatedCasesPanel
            entries={siteTerminatedCases}
            returnPath={dashboardReturnPath}
          />
        </section>
      ) : null}

      <footer className="dashboard-model-status">
        <span>AI 模型</span>
        <strong>{provider.label}</strong>
        <span>{provider.model}</span>
        <span className={`badge ${provider.configured ? "badge-success" : "badge-neutral"}`}>
          {provider.provider === "template" ? "模板模式" : provider.configured ? "已配置" : "自动回退"}
        </span>
        <Link href="/settings">模型设置</Link>
      </footer>
    </div>
  );
}
