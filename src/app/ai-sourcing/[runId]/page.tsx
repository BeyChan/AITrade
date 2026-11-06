import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import { CopyDraftButton } from "@/components/copy-draft-button";
import { DetailTabCookie } from "@/components/detail-tab-cookie";
import { ProposalMeta } from "@/components/ai-proposal-card";
import { CostBackCalculator } from "@/components/cost-back-calculator";
import { HashOpenDetails } from "@/components/hash-open-details";
import {
  SupplierCandidateComparison,
  SupplierCandidateImportForm,
  SupplierCaptureTools,
} from "@/components/supplier-candidate-workspace";
import {
  confirmHypothesisPriceAction,
  generateSupplierDraftAction,
  promoteHypothesisAction,
  reviewSupplierDraftAction,
  recordAISupplierQuoteAction,
  recordCompetitorAction,
  recordOpportunityEvidenceAction,
  rejectSupplierCandidateAction,
  selectHypothesisAction,
  shortlistSupplierCandidateAction,
} from "@/app/actions";
import {
  getAISourcingBatch,
  getBatchSiteLabel,
  type AIOpportunityEvidence,
  type AISelectionDecision,
  type AISupplierCandidate,
  type AISourcingHypothesisDetail,
} from "@/lib/ai-sourcing-repository";
import {
  SUPPLIER_DRAFT_TYPES,
  SUPPLIER_DRAFT_TYPE_LABELS,
} from "@/lib/ai-supplier-assistant/schema";
import {
  listSupplierDraftsByRun,
  type SupplierDraft,
} from "@/lib/ai-supplier-assistant/repository";
import {
  listAiInboxTaskCountsByRun,
  type AiInboxHypothesisTaskCounts,
} from "@/lib/ai-inbox/repository";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import {
  buildSupplierLeads,
  supplier1688SearchUrl,
  supplierAlibabaSearchUrl,
  supplierGoogleSearchUrl,
} from "@/lib/supplier-discovery";

export const dynamic = "force-dynamic";

/** 详情页按步骤分区，避免一个长页面堆满所有操作。 */
const DETAIL_TABS = [
  { key: "overview", label: "概览", hint: "批次进展与机会方向" },
  { key: "hypotheses", label: "验证证据", hint: "补任务、录证据、核对竞品" },
  { key: "suppliers", label: "找供应商", hint: "采集、对比、人工核验" },
  { key: "quotes", label: "报价与 RFQ", hint: "真实报价、成本倒推、内部草稿" },
  { key: "decision", label: "门禁结论", hint: "确定性结论与转立项" },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]["key"];

function parseDetailTab(value: string | undefined): DetailTab {
  return DETAIL_TABS.find((tab) => tab.key === value)?.key ?? "overview";
}

type PageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{
    market?: string;
    platform?: string;
    notice?: string;
    error?: string;
    capture?: string;
    hypothesisId?: string;
    tab?: string;
  }>;
};

export default async function AISourcingDetailPage({ params, searchParams }: PageProps) {
  const [{ runId }, query, cookieStore] = await Promise.all([params, searchParams, cookies()]);
  const [batch, supplierDrafts, aiInboxCounts] = await Promise.all([
    getAISourcingBatch(runId),
    listSupplierDraftsByRun(runId),
    listAiInboxTaskCountsByRun(runId),
  ]);
  if (!batch) notFound();

  const draftsByHypothesis = new Map<string, SupplierDraft[]>();
  for (const draft of supplierDrafts) {
    const existing = draftsByHypothesis.get(draft.hypothesisId) ?? [];
    existing.push(draft);
    draftsByHypothesis.set(draft.hypothesisId, existing);
  }

  const siteLabel = getBatchSiteLabel(batch);
  const selectedCount = batch.hypotheses.filter((item) => item.selectedForValidation).length;
  const goCount = batch.hypotheses.filter((item) => item.decision?.decision === "GO").length;
  const completeness = batch.hypotheses.length
    ? Math.round(batch.hypotheses.reduce((sum, item) => sum + (item.decision?.evidenceCompleteness ?? 0), 0) / batch.hypotheses.length)
    : 0;
  const observedAt = dateTimeInputValue(new Date());
  const requestedHypothesisId = batch.hypotheses.some((item) => item.id === query.hypothesisId)
    ? query.hypothesisId
    : undefined;
  const defaultHypothesisId =
    requestedHypothesisId ??
    batch.hypotheses.find((item) => item.decision?.decision === "GO")?.id ??
    batch.hypotheses.find((item) => item.selectedForValidation)?.id ??
    batch.hypotheses[0]?.id;
  const savedTab = cookieStore.get("aitrade_detail_tab")?.value;
  const activeTab = parseDetailTab(query.tab ?? savedTab);
  const activeTabMeta = DETAIL_TABS.find((tab) => tab.key === activeTab) ?? DETAIL_TABS[0];
  const tabHref = (key: DetailTab) => {
    const search = new URLSearchParams({ tab: key });
    if (requestedHypothesisId) search.set("hypothesisId", requestedHypothesisId);
    return `/ai-sourcing/${encodeURIComponent(runId)}?${search.toString()}`;
  };

  return (
    <div className="page ai-sourcing-detail-page">
      <DetailTabCookie tab={activeTab} />
      <div className="breadcrumb">
        <Link href="/">工作台</Link> / <Link href="/ai-sourcing">选品验证</Link> / 批次详情
      </div>

      <div className="title-row">
        <div>
          <div className="eyebrow">证据优先的选品验证</div>
          <h1>{batch.category} · 选品验证</h1>
          <div className="title-meta">
            <span className="badge badge-neutral">{siteLabel}</span>
            <span className="badge badge-neutral">{batch.currency}</span>
            <span className="badge badge-success">{goCount} 个 GO</span>
            <span className="badge status-review_pending">{selectedCount} 个验证中</span>
          </div>
        </div>
        <div className="button-row">
          <Link href="/ai-sourcing" className="button secondary">返回研究列表</Link>
          <Link href={`/?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}#opportunities`} className="button ghost">查看已立项商品</Link>
        </div>
      </div>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}
      {batch.templateFallback ? (
        <div className="notice warn">
          <strong>本批假设由内置模板生成：</strong>模型调用失败，已自动回退（{batch.providerError ?? "原因未记录"}）。这 5 个方向不是 {batch.provider} / {batch.model} 的输出。
        </div>
      ) : null}

      <nav className="ai-detail-tabs" aria-label="验证步骤">
        {DETAIL_TABS.map((tab, index) => (
          <Link
            key={tab.key}
            href={tabHref(tab.key)}
            className={`ai-detail-tab${activeTab === tab.key ? " active" : ""}`}
            aria-current={activeTab === tab.key ? "step" : undefined}
          >
            <span>0{index + 1}</span>
            <strong>{tab.label}</strong>
            <small>{tab.hint}</small>
          </Link>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <>
      <section className="ai-batch-overview">
        <div>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>研究简报</span>
          <h2>{batch.brief}</h2>
          <p>创建人 {batch.createdBy} · {shortDate(batch.createdAt)} · {batch.provider} / {batch.model}</p>
        </div>
        <div className="ai-batch-overview-side">
          <span>币种口径</span>
          <strong>{batch.currency}</strong>
          {batch.currency === "USD" ? (
            <small>USD 无需汇率换算</small>
          ) : batch.fxSourceUrl ? (
            <a href={batch.fxSourceUrl} target="_blank" rel="noreferrer">
              1 USD = {batch.fxRateToUsd ?? "—"} {batch.currency} · 查看汇率来源
            </a>
          ) : (
            <small>未记录汇率来源</small>
          )}
        </div>
      </section>

      <section className="metrics-grid ai-metrics" aria-label="批次验证概览">
        <article className="metric-card">
          <div className="metric-label">机会假设</div>
          <div className="metric-value">{batch.hypotheses.length}</div>
          <div className="metric-note">AI 只生成待验证方向</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已加入验证</div>
          <div className="metric-value">{selectedCount}</div>
          <div className="metric-note">加入后开放证据与报价录入</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">确定性 GO</div>
          <div className="metric-value">{goCount}</div>
          <div className="metric-note">证据、利润、风险、现金全部达标</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">平均证据完整度</div>
          <div className="metric-value">{completeness}%</div>
          <div className="metric-note">竞品、评论、供应商、报价、专利、样品</div>
        </article>
      </section>

      <div className="ai-workflow-strip" aria-label="选品验证流程">
        {[
          ["01", "AI 假设"],
          ["02", "真实证据"],
          ["03", "供应商报价"],
          ["04", "确定性门禁"],
          ["05", "GO 转立项"],
          ["06", "定标与内容"],
        ].map(([step, label], index) => (
          <div className={index === 0 ? "active" : ""} key={step}>
            <span>{step}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

          <HypothesisSummaryList batch={batch} />

      <section className="panel ai-guardrail-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">流程护栏</div>
            <h2>这套流程不会替你虚构事实</h2>
            <p>AI 仅生成假设；销量、评论、竞品、供应商、报价、专利和利润都必须有来源。系统不会自动联系供应商、下单、付款或发布 Listing。</p>
          </div>
          <span className="badge badge-success">externalActions: none</span>
        </div>
      </section>
        </>
      ) : (
        <>
          <div className="ai-tab-intro">
            <div>
              <span className="eyebrow">当前步骤</span>
              <strong>{activeTabMeta.label}</strong>
              <span>{activeTabMeta.hint}</span>
            </div>
            <Link href={tabHref("overview")} className="button ghost">返回概览</Link>
          </div>

      <div className="ai-hypothesis-list">
        {batch.hypotheses.map((hypothesis) => (
          <HypothesisCard
            key={hypothesis.id}
            batch={batch}
            hypothesis={hypothesis}
            tab={activeTab}
            supplierDrafts={draftsByHypothesis.get(hypothesis.id) ?? []}
            aiInboxCounts={aiInboxCounts.get(hypothesis.id) ?? null}
            observedAt={observedAt}
            defaultOpen={hypothesis.id === defaultHypothesisId}
            autoReadClipboard={query.capture === "clipboard" && query.hypothesisId === hypothesis.id}
          />
        ))}
      </div>

        </>
      )}
    </div>
  );
}

type BatchType = NonNullable<Awaited<ReturnType<typeof getAISourcingBatch>>>;

function HypothesisSummaryList({ batch }: { batch: BatchType }) {
  return (
    <section className="panel ai-hypothesis-summary-list">
      <div className="panel-header">
        <div>
          <div className="eyebrow">机会方向</div>
          <h2>{batch.hypotheses.length} 个待验证方向</h2>
          <p>选一个方向，按顺序补证据、找供应商，最后看门禁结论。</p>
        </div>
        <Link className="button secondary" href={`/ai-sourcing/${encodeURIComponent(batch.id)}?tab=hypotheses`}>
          从验证证据开始 →
        </Link>
      </div>
      <div className="ai-summary-rows">
        {batch.hypotheses.map((hypothesis) => (
          <div className="ai-summary-row" key={hypothesis.id}>
            <span className="ai-hypothesis-rank">0{hypothesis.position}</span>
            <div className="ai-summary-main">
              <strong>{hypothesis.concept}</strong>
              <small>{hypothesis.targetUser} · 证据 {hypothesis.decision?.evidenceCompleteness ?? 0}%</small>
            </div>
            <DecisionBadge decision={hypothesis.decision} />
            <Link
              className="button secondary"
              href={`/ai-sourcing/${encodeURIComponent(batch.id)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesis.id)}#hypothesis-${encodeURIComponent(hypothesis.id)}`}
            >
              继续 →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

function HypothesisCard({
  batch,
  hypothesis,
  supplierDrafts,
  aiInboxCounts,
  observedAt,
  defaultOpen,
  autoReadClipboard,
  tab,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
  supplierDrafts: SupplierDraft[];
  aiInboxCounts: AiInboxHypothesisTaskCounts | null;
  observedAt: string;
  defaultOpen: boolean;
  autoReadClipboard: boolean;
  tab: DetailTab;
}) {
  const decision = hypothesis.decision;
  const notStartedNotice = (
    <div className="notice warn ai-tab-notice">
      <div>
        <strong>这个方向还没加入验证</strong>
        <span>确认负责人后，系统立即开放当前方向的证据、竞品、报价和门禁录入。</span>
      </div>
      <form action={selectHypothesisAction} className="button-row">
        <input type="hidden" name="runId" value={batch.id} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input
          name="actor"
          aria-label="加入验证负责人"
          placeholder="负责人"
          defaultValue="运营人员"
          maxLength={80}
          required
        />
        <button type="submit" className="button primary">加入验证并开始</button>
      </form>
    </div>
  );
  const supplierByShortlistId = new Map(hypothesis.shortlist.map((item) => [item.id, item]));
  const supplierLeads = buildSupplierLeads({
    concept: hypothesis.concept,
    category: batch.category,
    targetUser: hypothesis.targetUser,
    supplierKeywords: hypothesis.supplierKeywords,
  });
  const externalEvidence = hypothesis.evidence.filter((item) => !["competitor_snapshot", "supplier_quote"].includes(item.evidenceType));

  return (
    <HashOpenDetails
      id={`hypothesis-${hypothesis.id}`}
      className="card ai-hypothesis-card"
      defaultOpen={defaultOpen}
    >
      <summary className="ai-hypothesis-summary">
        <div className="ai-hypothesis-summary-main">
          <span className="ai-hypothesis-rank">0{hypothesis.position}</span>
          <div>
            <h2>{hypothesis.concept}</h2>
            <div className="ai-hypothesis-summary-meta">
              <DecisionBadge decision={decision} />
              <span className="badge badge-neutral">
                {hypothesis.selectedForValidation ? "已加入验证" : "尚未加入验证"}
              </span>
              <span className="badge badge-neutral">
                证据 {decision?.evidenceCompleteness ?? 0}%
              </span>
              {hypothesis.productCaseId ? <span className="badge badge-success">已转商品立项</span> : null}
            </div>
          </div>
        </div>
        <div className="ai-hypothesis-summary-side">
          <div className="ai-hypothesis-score">
            <strong>{hypothesis.priorityScore}</strong>
            <span>机会分</span>
          </div>
          <span className="ai-hypothesis-chevron" aria-hidden="true">⌄</span>
        </div>
      </summary>

      <div className="ai-hypothesis-body">
        <div className="ai-hypothesis-facts">
          <div><span>目标用户</span><strong>{hypothesis.targetUser}</strong></div>
          <div><span>核心痛点</span><strong>{hypothesis.painPoint}</strong></div>
          <div><span>差异化假设</span><strong>{hypothesis.differentiator}</strong></div>
        </div>

        <div className="ai-hypothesis-metrics">
          <div>
            <span>已确认售价</span>
            <strong>{hypothesis.confirmedPriceCents ? moneyIn(batch.currency, hypothesis.confirmedPriceCents) : "未确认"}</strong>
            <small>AI 假设价 {hypothesis.recommendedPriceCents > 0 ? moneyIn(batch.currency, hypothesis.recommendedPriceCents) : "待补充"}（未验证，不参与门禁）</small>
          </div>
          <div><span>AI 假设净利率</span><strong>{percent(hypothesis.expectedMarginRate)}</strong></div>
          <div><span>AI 假设首单预算</span><strong>{moneyIn(batch.currency, hypothesis.firstOrderBudgetCents)}</strong></div>
          <div><span>证据完整度</span><strong>{decision?.evidenceCompleteness ?? 0}%</strong></div>
        </div>

      {tab === "suppliers" ? (
      <SupplierDiscoveryWorkspace
        runId={batch.id}
        hypothesis={hypothesis}
        supplierDrafts={supplierDrafts}
        supplierLeads={supplierLeads}
        defaultQuery={supplierLeads[0]?.query ?? hypothesis.concept}
        autoReadClipboard={autoReadClipboard}
      />
      ) : null}

      {tab === "hypotheses" ? (
        hypothesis.selectedForValidation ? (
          <>
      <div className="ai-query-grid ai-query-grid-two">
        <QueryGroup
          title={`${batch.platformName} · ${batch.marketCode} 竞品词`}
          items={hypothesis.competitorQueries}
          hrefFor={(item) => marketplaceSearchUrl(batch.platformCode, batch.marketCode, item)}
          actionLabel="搜平台"
        />
        <QueryGroup
          title="差评检索词"
          items={hypothesis.reviewQueries}
          hrefFor={(item) => googleSearchUrl(`${item} ${batch.marketCode}`)}
          actionLabel="搜公开评论"
        />
      </div>

      <div className="risk-list ai-risk-list">
        <strong>AI 标记风险</strong>
        {hypothesis.mainRisks.map((risk) => <span className="risk-chip" key={risk}>{risk}</span>)}
      </div>

          <div className="ai-validation-grid">
            <section className="ai-validation-summary">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">验证任务</span>
                  <h3>{hypothesis.counts.completedTasks} / {hypothesis.counts.totalTasks} 项任务完成</h3>
                </div>
                <span className="info-pill">{hypothesis.counts.competitors} 竞品 · {hypothesis.counts.reviewSamples} 差评样本</span>
              </div>
              <div className="ai-task-list">
                {hypothesis.tasks.map((task) => (
                  <div className={`ai-task ${task.status === "done" ? "done" : ""}`} key={task.id}>
                    <span className="ai-task-check">{task.status === "done" ? "✓" : "·"}</span>
                    <div>
                      <strong>{task.title}</strong>
                      <p>{task.description}</p>
                    </div>
                    <span className="badge badge-neutral">{task.status === "done" ? "完成" : `${task.targetCount} 项`}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="ai-recorded-evidence">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">已录入证据</span>
                  <h3>已录入证据</h3>
                </div>
                <span className="info-pill">{hypothesis.evidence.length} 条</span>
              </div>
              {hypothesis.evidence.length === 0 ? (
                <div className="empty-inline">还没有证据。先用下方表单记录你实际看到的竞品、差评、专利或物流信息。</div>
              ) : (
                <div className="evidence-list">
                  {hypothesis.evidence.slice(0, 8).map((item) => (
                    <div className="evidence-item" key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span className="badge badge-neutral">{evidenceTypeLabel(item.evidenceType)}</span>
                      </div>
                      <p>{item.summary}</p>
                      <small>{shortDate(item.observedAt)} · {item.createdBy} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></small>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className="ai-smart-intake-card">
            <div>
              <span className="eyebrow">AI 辅助录入</span>
              <h3>AI 智能录入</h3>
              <p>把竞品页面、评论、CSV 或供应商报价文本整理成可追溯字段。AI 只提取，人工确认后才写入当前机会。</p>
            </div>
            <div className="ai-smart-intake-actions">
              {aiInboxCounts?.pending ? <span className="badge status-review_pending">待审核 {aiInboxCounts.pending}</span> : null}
              {aiInboxCounts?.inProgress ? <span className="badge badge-neutral">提取中 {aiInboxCounts.inProgress}</span> : null}
              {aiInboxCounts?.failed ? <span className="badge badge-danger">失败 {aiInboxCounts.failed}</span> : null}
              <Link
                href={`/ai-inbox?targetHypothesisId=${encodeURIComponent(hypothesis.id)}`}
                className="button primary"
              >
                AI 智能录入
              </Link>
              {aiInboxCounts?.pending ? (
                <Link
                  href={`/ai-inbox?targetHypothesisId=${encodeURIComponent(hypothesis.id)}&status=needs_review`}
                  className="button secondary"
                >
                  继续审核
                </Link>
              ) : null}
            </div>
          </section>

          <CompetitorBenchmarkPanel batch={batch} hypothesis={hypothesis} />

          <div className="ai-entry-grid">
            <EvidenceEntryForms hypothesisId={hypothesis.id} runId={batch.id} observedAt={observedAt} />
            <ConfirmPriceForm hypothesisId={hypothesis.id} runId={batch.id} currency={batch.currency} />
            <CompetitorEntryForm hypothesisId={hypothesis.id} runId={batch.id} observedAt={observedAt} currency={batch.currency} />
            <SupplierQuoteEntryForm hypothesisId={hypothesis.id} runId={batch.id} observedAt={observedAt} currency={batch.currency} />
          </div>

          {hypothesis.competitors.length > 0 ? (
            <section className="ai-record-block">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">真实竞品快照</span>
                  <h3>真实竞品快照</h3>
                </div>
                <span className="info-pill">{hypothesis.competitors.length} 个</span>
              </div>
              <div className="ai-competitor-grid">
                {hypothesis.competitors.slice(0, 10).map((competitor) => (
                  <a href={competitor.sourceUrl} target="_blank" rel="noreferrer" className="ai-competitor-card" key={competitor.id}>
                    <div>
                      <strong>{competitor.title}</strong>
                      <span>{competitor.asin || "无 ASIN"} · {shortDate(competitor.observedAt)}</span>
                    </div>
                    <div>
                      <strong>{moneyIn(batch.currency, competitor.priceCents)}</strong>
                      <span>{competitor.rating ? `${competitor.rating}★` : "无评分"} · {compactNumber(competitor.reviewCount)} 评论</span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          </>
        ) : notStartedNotice
      ) : null}

      {tab === "quotes" ? (
        hypothesis.selectedForValidation ? (
          <>
          <CostBackCalculator
            platformCode={batch.platformCode}
            platformName={batch.platformName}
            currency={batch.currency}
            recommendedPriceCents={hypothesis.recommendedPriceCents}
            confirmedPriceCents={hypothesis.confirmedPriceCents}
            suggestedMarginRate={hypothesis.expectedMarginRate}
            quotes={hypothesis.quotes.map((quote) => ({
              ...quote,
              supplierName: supplierByShortlistId.get(quote.supplierShortlistId)?.supplierName,
            }))}
            priceEntryHref={`#confirm-price-${hypothesis.id}`}
            quoteEntryHref={`#supplier-quote-${hypothesis.id}`}
            fxRateToUsd={batch.fxRateToUsd}
          />

          <div className="ai-entry-grid">
            <ConfirmPriceForm hypothesisId={hypothesis.id} runId={batch.id} currency={batch.currency} />
            <SupplierQuoteEntryForm hypothesisId={hypothesis.id} runId={batch.id} observedAt={observedAt} currency={batch.currency} />
          </div>

          {hypothesis.quotes.length > 0 ? (
            <section className="ai-record-block">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">已核验报价</span>
                  <h3>真实供应商报价</h3>
                </div>
                <span className="info-pill">{hypothesis.quotes.length} 份 · 按到岸成本排序</span>
              </div>
              <div className="quote-grid ai-quote-grid">
                {hypothesis.quotes.map((quote, index) => {
                  const supplier = supplierByShortlistId.get(quote.supplierShortlistId);
                  return (
                    <article className={`quote-card${quote.id === decision?.bestQuoteId ? " preferred" : ""}`} key={quote.id}>
                      <div className="quote-card-top">
                        <div>
                          <span className="quote-rank">报价 #{index + 1}{quote.id === decision?.bestQuoteId ? " · 最低到岸" : ""}</span>
                          <h3>{supplier?.supplierName ?? "供应商"}</h3>
                          <a href={quote.quoteUrl} target="_blank" rel="noreferrer" className="muted">查看报价来源 ↗</a>
                        </div>
                        <div className="quote-score">
                          <strong>{quote.sampleScore ?? "—"}</strong>
                          <span>样品分</span>
                        </div>
                      </div>
                      <div className="quote-cost-band">
                        <div><span>采购</span><strong>{moneyIn(quote.currency, quote.unitPriceCents)}</strong></div>
                        <div><span>运费</span><strong>{moneyIn(quote.currency, quote.freightPerUnitCents)}</strong></div>
                        <div><span>到岸</span><strong>{moneyIn(quote.currency, quote.landedCostCents)}</strong></div>
                      </div>
                      <div className="quote-facts">
                        <div><span>MOQ</span><strong>{quote.moq}</strong></div>
                        <div><span>交期</span><strong>{quote.leadTimeDays} 天</strong></div>
                        <div><span>关税</span><strong>{percent(quote.dutyRate)}</strong></div>
                        <div><span>样品费</span><strong>{moneyIn(quote.currency, quote.sampleFeeCents)}</strong></div>
                        <div><span>贸易条款</span><strong>{quote.incoterm || "未填"}</strong></div>
                        <div><span>付款条件</span><strong>{quote.paymentTerms || "未填"}</strong></div>
                      </div>
                      <p className="muted ai-quote-match">产品匹配：{supplier?.productMatch || quote.certifications || "未记录"}</p>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <SupplierAssistantPanel
            runId={batch.id}
            hypothesis={hypothesis}
            drafts={supplierDrafts}
          />
          </>
        ) : notStartedNotice
      ) : null}

      {tab === "decision" ? (
        hypothesis.selectedForValidation ? (
          <>
          <DecisionPanel decision={decision} hypothesis={hypothesis} currency={batch.currency} />


          <div className="ai-promotion-bar">
            <div>
              <strong>{decision?.decision === "GO" ? "门禁已通过，可以转入商品立项" : "门禁尚未通过，不能转入商品立项"}</strong>
              <p>转立项后会直接进入供应商比价与人工定标、商品定义、主图检查和 Listing 工作流。</p>
            </div>
            {hypothesis.productCaseId ? (
              <div className="button-row">
                <Link href={`/cases/${hypothesis.productCaseId}`} className="button secondary">查看商品立项</Link>
                <Link href={`/cases/${hypothesis.productCaseId}/sourcing`} className="button primary">进入供应商定标 →</Link>
              </div>
            ) : (
              <form action={promoteHypothesisAction} className="button-row">
                <input type="hidden" name="runId" value={batch.id} />
                <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                <input name="actor" aria-label="转立项负责人" placeholder="负责人" defaultValue="运营人员" maxLength={80} required />
                <button type="submit" className="button primary" disabled={decision?.decision !== "GO"}>GO 转为商品立项</button>
              </form>
            )}
          </div>
          </>
        ) : notStartedNotice
      ) : null}
      </div>
    </HashOpenDetails>
  );
}

function SupplierDiscoveryWorkspace({
  runId,
  hypothesis,
  supplierDrafts,
  supplierLeads,
  defaultQuery,
  autoReadClipboard,
}: {
  runId: string;
  hypothesis: AISourcingHypothesisDetail;
  supplierDrafts: SupplierDraft[];
  supplierLeads: ReturnType<typeof buildSupplierLeads>;
  defaultQuery: string;
  autoReadClipboard: boolean;
}) {
  if (!hypothesis.selectedForValidation) {
    return (
      <section className="ai-discovery-start">
        <div className="ai-discovery-start-copy">
          <span className="eyebrow">开始找供应商</span>
          <h3>开始找供应商</h3>
          <p>先确认负责人，再生成验证任务并启用 1688 采集、候选对比、人工核验和 RFQ 草稿。</p>
        </div>
        <form action={selectHypothesisAction} className="ai-discovery-start-form">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
          <label>
            <span>负责人</span>
            <input name="actor" aria-label="找供应商负责人" placeholder="例如：采购小王" defaultValue="采购人员" maxLength={80} required />
          </label>
          <button type="submit" className="button primary">开始找供应商</button>
        </form>
        <div className="ai-discovery-start-safety">
          <span>用户点击才采集</span>
          <span>人工核验后入短名单</span>
          <span>不自动联系或发送</span>
        </div>
      </section>
    );
  }

  const latestRun = hypothesis.supplierDiscoveryRuns[0] ?? null;
  const activeCandidates = hypothesis.supplierCandidates.filter((candidate) => candidate.status !== "rejected");
  const rejectedCandidates = hypothesis.supplierCandidates.filter((candidate) => candidate.status === "rejected");
  const rankedCandidates = activeCandidates.slice(0, 10);
  const pinnedShortlist = activeCandidates.filter(
    (candidate) => candidate.status === "shortlisted" && !rankedCandidates.some((item) => item.id === candidate.id),
  );
  const candidates = [...pinnedShortlist, ...rankedCandidates];
  const shortlistedCount = hypothesis.supplierCandidates.filter((candidate) => candidate.status === "shortlisted").length;
  const hasRfqDraft = supplierDrafts.some((draft) => draft.draftType === "rfq");
  const discoverySteps = [
    { label: "选择方向", detail: hypothesis.concept, state: "done" },
    {
      label: "采集 1688",
      detail: latestRun ? `最近采集 ${shortDate(latestRun.capturedAt)}` : "打开搜索结果页后点击采集",
      state: latestRun ? "done" : "active",
    },
    {
      label: "人工核验",
      detail: shortlistedCount > 0 ? `已入短名单 ${shortlistedCount} 个` : "对比后核验供应商和产品",
      state: shortlistedCount > 0 ? "done" : latestRun ? "active" : "todo",
    },
    {
      label: "生成 RFQ",
      detail: hasRfqDraft ? "已有内部草稿，待人工复制" : "短名单供应商可一键生成",
      state: hasRfqDraft ? "done" : shortlistedCount > 0 ? "active" : "todo",
    },
  ];

  return (
    <>
      <div className="ai-discovery-progress" aria-label="供应商发现流程">
        {discoverySteps.map((step, index) => (
          <div className={step.state} key={step.label}>
            <span>0{index + 1}</span>
            <div><strong>{step.label}</strong><small>{step.detail}</small></div>
          </div>
        ))}
      </div>

      <section className="ai-supplier-discovery">
        <div className="ai-supplier-discovery-head">
          <div>
            <strong>① 选择搜索方向</strong>
            <span>先从一种搜索思路开始。搜索命中只是候选，后续仍需核对主体、产品匹配和报价。</span>
          </div>
          <span className="badge badge-neutral">{supplierLeads.length} 组线索</span>
        </div>
        <div className="ai-supplier-lead-grid">
          {supplierLeads.map((lead) => (
            <article className="ai-supplier-lead" key={lead.role}>
              <div className="ai-supplier-lead-copy">
                <span>{lead.role}</span>
                <strong>{lead.query}</strong>
                <p>{lead.note}</p>
              </div>
              <div className="ai-supplier-lead-links">
                <a href={supplier1688SearchUrl(lead.query)} target="_blank" rel="noreferrer">打开 1688 ↗</a>
                <a href={supplierAlibabaSearchUrl(lead.query)} target="_blank" rel="noreferrer">Alibaba ↗</a>
                <a href={supplierGoogleSearchUrl(lead.query)} target="_blank" rel="noreferrer">Google 查工厂 ↗</a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="ai-candidate-capture">
        <div className="ai-candidate-capture-head">
          <div>
            <span className="eyebrow">用户触发采集</span>
            <strong>② 采集 1688 当前页 · 自动生成 TOP 10</strong>
            <p>用户点击才采集，只处理当前可见商品卡；不后台抓取、不自动翻页、不登录，也不绕过验证码。</p>
          </div>
          <div className="ai-candidate-capture-badges">
            <span className="badge badge-neutral">{activeCandidates.length} 个待筛选</span>
            <span className="badge badge-success">{shortlistedCount} 个已核验</span>
            {rejectedCandidates.length > 0 ? <span className="badge badge-danger">{rejectedCandidates.length} 个已排除</span> : null}
          </div>
        </div>

        <SupplierCaptureTools runId={runId} hypothesisId={hypothesis.id} query={defaultQuery} />

        <div className="ai-manual-capture-head">
          <div><strong>方式三：手动粘贴或读取剪贴板</strong><span>书签自动复制后会优先尝试读取；浏览器询问剪贴板权限时请允许。</span></div>
        </div>

        <SupplierCandidateImportForm
          runId={runId}
          hypothesisId={hypothesis.id}
          defaultQuery={defaultQuery}
          autoReadClipboard={autoReadClipboard}
        />

        {latestRun ? (
          <div className="ai-candidate-run-summary">
            <div><span>最近采集</span><strong>{shortDate(latestRun.capturedAt)}</strong></div>
            <div><span>识别</span><strong>{latestRun.receivedCount}</strong></div>
            <div><span>去重</span><strong>{latestRun.duplicateCount}</strong></div>
            <div><span>TOP</span><strong>{latestRun.topCount}</strong></div>
            <div><span>触发方式</span><strong>用户触发</strong></div>
            {latestRun.warnings.length > 0 ? (
              <div className="ai-candidate-run-warnings">
                {latestRun.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ai-candidate-review-head">
          <div>
            <strong>③ 对比并人工核验</strong>
            <span>先对比，再打开来源核验。只有勾选人工核验的候选才进入短名单，其他候选可排除。</span>
          </div>
          <span className="badge badge-neutral">TOP {Math.min(10, activeCandidates.length)}</span>
        </div>

        <SupplierCandidateComparison candidates={candidates} />

        {candidates.length > 0 ? (
          <div className="ai-candidate-grid">
            {candidates.map((candidate) => (
              <SupplierCandidateCard
                candidate={candidate}
                index={activeCandidates.findIndex((item) => item.id === candidate.id)}
                runId={runId}
                hypothesisId={hypothesis.id}
                key={candidate.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-inline">还没有候选。打开 1688 搜索结果页，用扩展或书签采集当前可见商品卡。</div>
        )}

        {rejectedCandidates.length > 0 ? (
          <details className="ai-rejected-candidates">
            <summary>
              <span>已排除 {rejectedCandidates.length} 个候选</span>
              <small>默认隐藏，保留记录以便复核</small>
            </summary>
            <div className="ai-rejected-candidate-list">
              {rejectedCandidates.map((candidate) => (
                <div key={candidate.id}>
                  <strong>{candidate.title}</strong>
                  <span>{candidate.supplierName} · {candidate.score} 分</span>
                  {candidate.offerUrl ? <a href={candidate.offerUrl} target="_blank" rel="noreferrer">查看来源 ↗</a> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </>
  );
}

function SupplierCandidateCard({
  candidate,
  index,
  runId,
  hypothesisId,
}: {
  candidate: AISupplierCandidate;
  index: number;
  runId: string;
  hypothesisId: string;
}) {
  return (
    <article
      id={`candidate-${candidate.id}`}
      className={`ai-candidate-card ${candidate.status === "shortlisted" ? "shortlisted" : ""}`}
    >
      <div className="ai-candidate-card-head">
        <div>
          <span className="ai-candidate-rank">{index < 10 ? `TOP ${index + 1}` : "已入短名单"}</span>
          <h3>{candidate.title}</h3>
          <p>{candidate.supplierName} · {candidate.platform}</p>
        </div>
        <div className="ai-candidate-score">
          <strong>{candidate.score}</strong>
          <span>匹配分</span>
        </div>
      </div>

      <ProposalMeta
        generation={{ source: "manual" }}
        sourceQuote={candidate.sourceText}
        statusLabel={candidate.status === "shortlisted" ? "已人工核验" : "待人工核验"}
        targetLabel={candidate.supplierName}
      />

      <div className="ai-candidate-score-parts">
        {candidate.scoreParts.map((part) => (
          <div key={part.key} title={part.reason}>
            <span>{part.label}</span>
            <strong>{part.points}/{part.maxPoints}</strong>
          </div>
        ))}
      </div>

      <div className="ai-candidate-facts">
        <div><span>价格</span><strong>{candidate.priceCents ? moneyIn(candidate.currency, candidate.priceCents) : "待确认"}</strong></div>
        <div><span>MOQ</span><strong>{candidate.moq ?? "待确认"}</strong></div>
        <div><span>地区</span><strong>{candidate.location || "待确认"}</strong></div>
        <div><span>交期</span><strong>{candidate.leadTimeDays ? `${candidate.leadTimeDays} 天` : "待确认"}</strong></div>
      </div>

      {candidate.badges.length > 0 ? (
        <div className="ai-candidate-badges">
          {candidate.badges.map((badge) => <span key={badge}>{badge}</span>)}
        </div>
      ) : null}

      {candidate.riskNotes.length > 0 ? (
        <div className="ai-candidate-risks">
          <strong>待核验风险</strong>
          {candidate.riskNotes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}

      <div className="ai-candidate-links">
        {candidate.offerUrl ? <a href={candidate.offerUrl} target="_blank" rel="noreferrer">打开商品 ↗</a> : null}
        {candidate.supplierUrl ? <a href={candidate.supplierUrl} target="_blank" rel="noreferrer">打开店铺 ↗</a> : null}
        <small>{shortDate(candidate.observedAt)} 采集</small>
      </div>

      {candidate.status === "shortlisted" ? (
        <div className="ai-candidate-shortlisted">
          <strong>✓ 已人工核验并加入短名单</strong>
          <span>{candidate.verifiedBy ?? "采购人员"} · {candidate.verifiedAt ? shortDate(candidate.verifiedAt) : "已记录"}</span>
          <small>RFQ 只会生成内部草稿；请核对内容后自行复制到沟通渠道，系统不会发送。</small>
          {candidate.shortlistId ? (
            <form action={generateSupplierDraftAction} className="ai-candidate-quick-rfq">
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="hypothesisId" value={hypothesisId} />
              <input type="hidden" name="draftType" value="rfq" />
              <input type="hidden" name="supplierShortlistId" value={candidate.shortlistId} />
              <input name="actor" aria-label="RFQ 草稿生成人" defaultValue="采购人员" maxLength={80} required />
              <button type="submit" className="button primary">生成 RFQ 草稿</button>
            </form>
          ) : null}
        </div>
      ) : (
        <>
          <form action={shortlistSupplierCandidateAction} className="ai-candidate-verify-form">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="candidateId" value={candidate.id} />
            <div className="field">
              <label>核验后的供应商名称</label>
              <input name="supplierName" defaultValue={candidate.supplierName} maxLength={180} required />
            </div>
            <div className="field">
              <label>人工核验人</label>
              <input name="actor" defaultValue="采购人员" maxLength={80} required />
            </div>
            <div className="field full">
              <label>产品匹配说明</label>
              <textarea name="productMatch" rows={2} maxLength={500} required placeholder="写明你已核对的材质、规格、结构、包装或差异" />
            </div>
            <label className="ai-candidate-verified-check full">
              <input type="checkbox" name="verified" value="true" required />
              <span>我已打开来源并人工核验供应商主体、产品一致性和公开信息</span>
            </label>
            <button className="button primary full" type="submit">已人工核验，加入短名单</button>
          </form>

          <details className="ai-candidate-reject">
            <summary>不匹配，排除该候选</summary>
            <form action={rejectSupplierCandidateAction}>
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <div className="field">
                <label>排除原因</label>
                <input name="reason" maxLength={300} required placeholder="例如：材质不符 / MOQ 过高 / 无法核验主体" />
              </div>
              <div className="field">
                <label>操作人</label>
                <input name="actor" defaultValue="采购人员" maxLength={80} required />
              </div>
              <button type="submit" className="button danger">确认排除</button>
            </form>
          </details>
        </>
      )}
    </article>
  );
}

function DecisionBadge({ decision }: { decision: AISelectionDecision | null }) {
  if (!decision) return <span className="badge badge-neutral">待建立门禁</span>;
  const className = decision.decision === "GO" ? "recommendation-go" : decision.decision === "NO-GO" ? "recommendation-no-go" : "recommendation-hold";
  return <span className={`badge ${className}`}>{decision.decision} · {decision.decisionScore} 分</span>;
}

function DecisionPanel({
  decision,
  hypothesis,
  currency,
}: {
  decision: AISelectionDecision | null;
  hypothesis: AISourcingHypothesisDetail;
  currency: string;
}) {
  if (!decision) return <div className="action-warning">尚未生成确定性门禁，请先加入验证。</div>;
  return (
    <section className="ai-decision-panel">
      <div className="ai-decision-main">
        <div>
          <span className="eyebrow">确定性门禁</span>
          <h3>{decision.decision === "GO" ? "可以转入商品立项" : decision.decision === "NO-GO" ? "当前方向应停止" : "继续补证据或调整成本"}</h3>
          <p>{decision.blockers.length ? `还有 ${decision.blockers.length} 项未通过。系统不会用模型判断替代这些确定性门槛。` : "所有确定性门槛均已通过。"}</p>
        </div>
        <strong className={`ai-decision-grade ${decision.decision.toLowerCase()}`}>{decision.decision}</strong>
      </div>
      <div className="ai-decision-metrics">
        <div><span>最低到岸</span><strong>{decision.landedCostCents === null ? "—" : moneyIn(currency, decision.landedCostCents)}</strong></div>
        <div><span>首报价净利</span><strong>{decision.netProfitCents === null ? "—" : moneyIn(currency, decision.netProfitCents)}</strong></div>
        <div><span>净利率</span><strong>{decision.marginRate === null ? "—" : percent(decision.marginRate)}</strong></div>
        <div><span>首单现金</span><strong>{decision.firstOrderCashCents === null ? "—" : moneyIn(currency, decision.firstOrderCashCents)}</strong></div>
      </div>
      <details className="ai-gate-details">
        <summary>
          <span>查看 {decision.gates.filter((gate) => gate.passed).length} / {decision.gates.length} 项通过门禁</span>
          <span>展开明细</span>
        </summary>
        <div className="ai-gates">
          {decision.gates.map((gate) => (
            <div className={`ai-gate ${gate.passed ? "ai-gate-pass" : "ai-gate-fail"}`} key={gate.key}>
              <span className="ai-gate-status">{gate.passed ? "✓" : "×"}</span>
              <div><strong>{gate.label}</strong><small>要求 {gate.required}</small></div>
              <span>{gate.actual}</span>
            </div>
          ))}
        </div>
      </details>
      {decision.blockers.length ? (
        <div className="ai-blockers">
          <strong>当前阻断项</strong>
          <ul>{decision.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      ) : null}
      <div className="ai-decision-counts">
        <span>竞品 {hypothesis.counts.competitors}</span>
        <span>差评样本 {hypothesis.counts.reviewSamples}</span>
        <span>供应商 {hypothesis.counts.suppliers}</span>
        <span>报价 {hypothesis.counts.quotes}</span>
      </div>
    </section>
  );
}

function QueryGroup({
  title,
  items,
  hrefFor,
  actionLabel,
}: {
  title: string;
  items: string[];
  hrefFor: (item: string) => string;
  actionLabel: string;
}) {
  return (
    <div className="ai-query-group">
      <strong>{title}</strong>
      {items.map((item) => (
        <a href={hrefFor(item)} target="_blank" rel="noreferrer" key={item}>
          <span>{item}</span>
          <small>{actionLabel} ↗</small>
        </a>
      ))}
    </div>
  );
}

function SupplierAssistantPanel({
  runId,
  hypothesis,
  drafts,
}: {
  runId: string;
  hypothesis: AISourcingHypothesisDetail;
  drafts: SupplierDraft[];
}) {
  const supplierByShortlistId = new Map(hypothesis.shortlist.map((item) => [item.id, item]));
  const today = dateInputValue(new Date());
  const defaultReminderDate = dateInputValue(new Date(Date.now() + 7 * 86_400_000));

  return (
    <section className="ai-supplier-assistant ai-record-block">
      <div className="ai-validation-summary-head">
        <div>
          <span className="eyebrow">供应商内部草稿</span>
          <h3>供应商内部草稿</h3>
          <p>AI 只润色主题和开场；缺失信息由确定性程序追加为问题。草稿仅供内部复核，系统不会发送。</p>
        </div>
        <span className="badge badge-success">内部草稿 · 未发送</span>
      </div>

      <form action={generateSupplierDraftAction} className="ai-draft-compose form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <div className="field">
          <label>草稿类型</label>
          <select name="draftType" defaultValue="rfq" required>
            {SUPPLIER_DRAFT_TYPES.map((type) => (
              <option value={type} key={type}>{SUPPLIER_DRAFT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>已录入供应商（追问/提醒必选）</label>
          <select name="supplierShortlistId" defaultValue="">
            <option value="">不指定供应商</option>
            {hypothesis.shortlist.map((supplier) => (
              <option value={supplier.id} key={supplier.id}>{supplier.supplierName} · {supplier.platform}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>报价提醒日期（仅到期提醒）</label>
          <input name="quoteValidUntil" type="date" min={today} defaultValue={defaultReminderDate} />
        </div>
        <div className="field">
          <label>生成人</label>
          <input name="actor" defaultValue="采购人员" maxLength={80} required />
        </div>
        <div className="field full ai-draft-actions">
          <span>生成后可复制到 1688、Alibaba、邮件或你已有的聊天工具；本系统没有发送入口。</span>
          <button className="button primary" type="submit">生成内部草稿</button>
        </div>
      </form>

      {drafts.length > 0 ? (
        <div className="ai-draft-list">
          {drafts.map((draft) => {
            const supplier = draft.supplierShortlistId
              ? supplierByShortlistId.get(draft.supplierShortlistId)
              : null;
            const gaps = draft.questions.map((question) => question.label);
            const copyText = `${draft.subject}\n\n${draft.body}`;
            return (
              <article className="ai-draft-card" key={draft.id}>
                <div className="ai-draft-card-head">
                  <div>
                    <strong>{SUPPLIER_DRAFT_TYPE_LABELS[draft.draftType]}</strong>
                    <span className={`badge ${draft.status === "reviewed" ? "badge-success" : "badge-neutral"}`}>
                      {draft.status === "reviewed" ? "已人工审阅" : "待人工审阅"}
                    </span>
                  </div>
                  <span className="badge status-review_pending">未发送</span>
                </div>

                <div className="ai-draft-meta">
                  <span>{supplier?.supplierName ?? "未指定供应商"}</span>
                  <span>{shortDate(draft.createdAt)} · {draft.createdBy}</span>
                </div>

                <ProposalMeta
                  generation={{
                    source: draft.generationMode === "model_polished" ? "model" : "template",
                    provider: draft.provider,
                    model: draft.model,
                  }}
                  statusLabel={draft.status === "reviewed" ? "已人工审阅" : "待人工审阅 · 未发送"}
                  targetLabel={supplier?.supplierName ?? "未指定供应商"}
                />

                <div className="ai-draft-subject">
                  <span>主题</span>
                  <strong>{draft.subject}</strong>
                </div>
                <pre className="ai-draft-body">{draft.body}</pre>

                {gaps.length > 0 ? (
                  <div className="ai-draft-gaps">
                    <span>确定性追问</span>
                    {gaps.map((gap, index) => <small key={`${gap}-${index}`}>{gap}</small>)}
                  </div>
                ) : null}

                <div className="ai-draft-foot">
                  <div>
                    <span className="badge badge-neutral">externalActions: none</span>
                    {draft.reviewedAt ? <small>{draft.reviewedBy} 于 {shortDate(draft.reviewedAt)} 审阅</small> : null}
                  </div>
                  <div className="button-row">
                    <CopyDraftButton text={copyText} />
                    {draft.status === "draft" ? (
                      <form action={reviewSupplierDraftAction} className="ai-draft-review">
                        <input type="hidden" name="runId" value={runId} />
                        <input type="hidden" name="draftId" value={draft.id} />
                        <input name="actor" aria-label="审阅人" defaultValue="采购人员" maxLength={80} required />
                        <button className="button secondary" type="submit">标记已审阅</button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <small className="ai-draft-note">{draft.generationNote}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="ai-draft-empty">还没有供应商草稿。先录入真实报价，再生成追问或到期提醒。</div>
      )}
    </section>
  );
}

function EvidenceEntryForms({ hypothesisId, runId, observedAt }: { hypothesisId: string; runId: string; observedAt: string }) {
  return (
    <>
      <details className="entry-panel card ai-entry-panel">
        <summary><span><strong>录入差评证据</strong><small>样本数 + 原文摘录 + 来源链接</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="review_insight" />
          <input type="hidden" name="sourceType" value="review_page" />
          <EvidenceCommonFields title="差评主题" summary="归纳用户不满和可改进点" observedAt={observedAt} />
          <div className="field">
            <label>差评样本数</label>
            <input name="reviewSampleSize" type="number" min="1" required placeholder="例如：50" />
          </div>
          <div className="field full">
            <label>代表性原文</label>
            <textarea name="representativeQuote" rows={2} maxLength={500} placeholder="粘贴实际评论原文，不要改写事实" />
          </div>
          <div className="field full">
            <label>录入人</label>
            <input name="actor" defaultValue="运营人员" required maxLength={80} />
          </div>
          <button className="button primary" type="submit">记录差评证据</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel">
        <summary><span><strong>录入专利风险</strong><small>人工检索结果，不生成法律结论</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="patent_check" />
          <input type="hidden" name="sourceType" value="patent_search" />
          <EvidenceCommonFields title="专利检查结论" summary="记录检索范围、关键词和实际结论" observedAt={observedAt} />
          <RiskLevelField />
          <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
          <button className="button primary" type="submit">记录专利证据</button>
        </form>
      </details>

      <details className="entry-panel card ai-entry-panel">
        <summary><span><strong>录入物流风险</strong><small>包装、体积重、限制与退货</small></span><span>＋</span></summary>
        <form action={recordOpportunityEvidenceAction} className="entry-form form-grid">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesisId} />
          <input type="hidden" name="evidenceType" value="logistics_check" />
          <input type="hidden" name="sourceType" value="logistics_check" />
          <EvidenceCommonFields title="物流检查结论" summary="记录真实包装、重量、限制和可执行性" observedAt={observedAt} />
          <RiskLevelField />
          <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
          <button className="button primary" type="submit">记录物流证据</button>
        </form>
      </details>
    </>
  );
}

function EvidenceCommonFields({ title, summary, observedAt }: { title: string; summary: string; observedAt: string }) {
  return (
    <>
      <div className="field full"><label>证据标题</label><input name="title" required maxLength={240} placeholder={title} /></div>
      <div className="field full"><label>来源 URL</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
      <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
      <div className="field full"><label>证据摘要</label><textarea name="summary" rows={3} required maxLength={1500} placeholder={summary} /></div>
    </>
  );
}

function RiskLevelField() {
  return (
    <div className="field">
      <label>人工结论</label>
      <select name="riskLevel" defaultValue="review" required>
        <option value="clear">无明显风险 / 可执行</option>
        <option value="review">仍需复核</option>
        <option value="found">发现阻断风险</option>
      </select>
    </div>
  );
}

function CompetitorBenchmarkPanel({
  batch,
  hypothesis,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
}) {
  const { benchmark } = hypothesis;
  const { coverage, price, distribution, themes, contradictions } = benchmark;
  const hasAnyEvidence = coverage.competitorCount > 0 || hypothesis.reviewInsights.length > 0;
  const priceBandLabel: Record<string, string> = {
    below_p25: "低于 P25（低价切入）",
    p25_to_p50: "P25–P50（主流偏低）",
    p50_to_p75: "P50–P75（主流价格带）",
    p75_to_p90: "P75–P90（中高溢价带）",
    above_p90: "高于 P90（高溢价风险区）",
  };
  const fieldLabel: Record<string, string> = {
    differentiator: "痛点与差异化",
    price: "定价合理性",
    margin: "市场中位价毛利可行性",
  };
  const verdictMeta = {
    supported: { label: "证据支持", badge: "badge-success" },
    unverified: { label: "待验证", badge: "status-review_pending" },
    contradicted: { label: "存在冲突", badge: "badge-danger" },
  } as const;

  return (
    <section className="ai-record-block benchmark-panel" aria-label="竞品画像与假设证伪">
      <div className="ai-validation-summary-head">
        <div>
          <span className="eyebrow">确定性竞品分析 · 证据对标</span>
          <h3>竞品画像与假设证伪</h3>
        </div>
        <div className="button-row">
          <span className="info-pill">
            {benchmark.scope.marketCode} · {benchmark.scope.platformCode} · {benchmark.scope.currency}
          </span>
          <span className={`badge ${coverage.sufficient ? "badge-success" : "status-review_pending"}`}>
            {coverage.sufficient ? "样本充足 · 可用于对标" : "样本不足 · 结论仅供参考"}
          </span>
        </div>
      </div>

      <div className="benchmark-coverage-strip">
        <div className={coverage.dedupedCount < 20 ? "warn" : ""}>
          <span>去重竞品 / 总快照</span>
          <strong>{coverage.dedupedCount} / {coverage.competitorCount}</strong>
          <small>门禁要求 ≥ 20（按 ASIN / URL 去重）</small>
        </div>
        <div className={coverage.priceBandCount < 2 ? "warn" : ""}>
          <span>价格分层覆盖</span>
          <strong>{coverage.priceBandCount} 档</strong>
          <small>分位计算建议覆盖 ≥ 2 档价格带</small>
        </div>
        <div className={coverage.themeCount < 2 || coverage.reviewSampleCount < 50 ? "warn" : ""}>
          <span>差评主题 / 样本</span>
          <strong>{coverage.themeCount} 个 / {coverage.reviewSampleCount} 条</strong>
          <small>建议 ≥ 2 主题 · 门禁 ≥ 50 样本</small>
        </div>
        <div>
          <span>来源 URL 齐备率</span>
          <strong>{percent(coverage.withSourceUrlRate)}</strong>
          <small>100% 可回溯真实网页</small>
        </div>
        <div className={(coverage.freshnessDaysP50 ?? 0) > 180 ? "warn" : ""}>
          <span>证据新鲜度中位数</span>
          <strong>{coverage.freshnessDaysP50 === null ? "—" : `${coverage.freshnessDaysP50} 天前`}</strong>
          <small>{(coverage.freshnessDaysP50 ?? 0) > 180 ? "中位采集时间超过 180 天" : "在 180 天有效期内"}</small>
        </div>
      </div>

      {!hasAnyEvidence ? (
        <div className="empty-inline benchmark-empty">
          <span>当前尚未录入竞品快照或差评证据，暂无法生成价格带分位与假设证伪结论。</span>
          <a href={`#competitor-entry-${hypothesis.id}`} className="button secondary">去录入竞品快照 ↓</a>
        </div>
      ) : (
        <>
          <div className="benchmark-price-section">
            <div className="benchmark-price-head">
              <div>
                <strong>市场价格带分位（{batch.currency}）</strong>
                <span>
                  {price
                    ? hypothesis.confirmedPriceCents
                      ? `已确认售价 ${moneyIn(batch.currency, hypothesis.confirmedPriceCents)} · 位于 ${price.hypothesisPricePosition ? priceBandLabel[price.hypothesisPricePosition] : "—"}`
                      : `AI 建议价 ${moneyIn(batch.currency, hypothesis.recommendedPriceCents)}（未确认）· 位于 ${price.hypothesisPricePosition ? priceBandLabel[price.hypothesisPricePosition] : "—"}`
                    : "需录入有效竞品价格后计算分位"}
                </span>
              </div>
              {price ? (
                <a href={`#confirm-price-${hypothesis.id}`} className="button ghost">
                  参考 P50（{moneyIn(batch.currency, price.p50)}）去确认售价 ↓
                </a>
              ) : null}
            </div>

            {price ? (
              <div className="benchmark-percentile-grid">
                <div><span>Min 最低</span><strong>{moneyIn(batch.currency, price.min)}</strong></div>
                <div><span>P25</span><strong>{moneyIn(batch.currency, price.p25)}</strong></div>
                <div className="highlight"><span>P50 中位价</span><strong>{moneyIn(batch.currency, price.p50)}</strong></div>
                <div><span>P75</span><strong>{moneyIn(batch.currency, price.p75)}</strong></div>
                <div><span>P90</span><strong>{moneyIn(batch.currency, price.p90)}</strong></div>
                <div><span>Max 最高</span><strong>{moneyIn(batch.currency, price.max)}</strong></div>
              </div>
            ) : null}

            <div className="benchmark-distribution-row">
              <span>
                评分 P50：<strong>{distribution.ratingP50 !== null ? `${distribution.ratingP50}★` : "—"}</strong>
              </span>
              <span>
                评论数 P50：
                <strong>
                  {distribution.reviewCountP50 !== null
                    ? compactNumber(distribution.reviewCountP50)
                    : "—"}
                </strong>
              </span>
              <span>
                BSR P50：<strong>{distribution.bsrP50 !== null ? `#${compactNumber(distribution.bsrP50)}` : "未录入"}</strong>
              </span>
            </div>
          </div>

          <div className="benchmark-contradiction-list">
            <div className="benchmark-subhead">
              <strong>假设 vs 市场证据 · 3 行证伪矩阵</strong>
              <small>确定性交叉核对，只做风险揭示，不替代门禁</small>
            </div>
            {contradictions.map((row) => {
              const meta = verdictMeta[row.verdict];
              return (
                <article className={`benchmark-contradiction-row verdict-${row.verdict}`} key={row.field}>
                  <div className="benchmark-contradiction-claim">
                    <span className="eyebrow">{fieldLabel[row.field] ?? row.field}</span>
                    <strong>{row.assertion}</strong>
                  </div>
                  <div className="benchmark-contradiction-evidence">
                    <p>{row.note}</p>
                  </div>
                  <div className="benchmark-contradiction-verdict">
                    <span className={`badge ${meta.badge}`}>{meta.label}</span>
                  </div>
                </article>
              );
            })}
          </div>

          {themes.length > 0 ? (
            <div className="benchmark-themes">
              <div className="benchmark-subhead">
                <strong>高频差评主题（按权重与样本数排序）</strong>
                <small>点击来源可回溯原始评论页</small>
              </div>
              <div className="benchmark-theme-grid">
                {themes.slice(0, 4).map((theme) => (
                  <div className="benchmark-theme-card" key={theme.theme}>
                    <div className="benchmark-theme-top">
                      <strong>{theme.theme}</strong>
                      <span className="badge badge-neutral">{theme.sampleSize} 样本</span>
                    </div>
                    {theme.quote ? <p>“{theme.quote}”</p> : null}
                    {theme.sourceUrl ? (
                      <a href={theme.sourceUrl} target="_blank" rel="noreferrer">查看评论来源 ↗</a>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function CompetitorEntryForm({
  hypothesisId,
  runId,
  observedAt,
  currency,
}: {
  hypothesisId: string;
  runId: string;
  observedAt: string;
  currency: string;
}) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`competitor-entry-${hypothesisId}`}>
      <summary><span><strong>录入真实竞品</strong><small>链接、价格、评论数、评分与观察时间</small></span><span>＋</span></summary>
      <form action={recordCompetitorAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="field full"><label>竞品标题</label><input name="title" required maxLength={240} /></div>
        <div className="field full"><label>竞品 URL</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
        <div className="field"><label>ASIN / 商品 ID</label><input name="asin" maxLength={80} /></div>
        <div className="field"><label>价格（{currency}）</label><input name="price" type="number" min="0.01" step="0.01" required /></div>
        <div className="field"><label>评分</label><input name="rating" type="number" min="0" max="5" step="0.01" /></div>
        <div className="field"><label>评论数</label><input name="reviewCount" type="number" min="0" step="1" defaultValue="0" required /></div>
        <div className="field"><label>BSR</label><input name="bsr" type="number" min="1" step="1" /></div>
        <div className="field"><label>卖家数</label><input name="sellerCount" type="number" min="1" step="1" /></div>
        <div className="field"><label>变体数</label><input name="variationCount" type="number" min="1" step="1" /></div>
        <div className="field"><label>月销量下限（仅填平台可见值）</label><input name="monthlySalesMin" type="number" min="1" step="1" /></div>
        <div className="field"><label>月销量上限（仅填平台可见值）</label><input name="monthlySalesMax" type="number" min="1" step="1" /></div>
        <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
        <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录竞品快照</button>
      </form>
    </details>
  );
}

function ConfirmPriceForm({ hypothesisId, runId, currency }: { hypothesisId: string; runId: string; currency: string }) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`confirm-price-${hypothesisId}`}>
      <summary><span><strong>确认售价</strong><small>依据真实竞品价格带；利润门禁只使用这里的价格</small></span><span>＋</span></summary>
      <form action={confirmHypothesisPriceAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="field"><label>已确认售价（{currency}）</label><input name="price" type="number" min="0.01" step="0.01" required /></div>
        <div className="field full"><label>依据链接（竞品页、价格带记录等）</label><input name="sourceUrl" type="url" required placeholder="https://..." /></div>
        <div className="field full"><label>录入人</label><input name="actor" defaultValue="运营人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录已确认售价</button>
      </form>
    </details>
  );
}

function SupplierQuoteEntryForm({
  hypothesisId,
  runId,
  observedAt,
  currency,
}: {
  hypothesisId: string;
  runId: string;
  observedAt: string;
  currency: string;
}) {
  return (
    <details className="entry-panel card ai-entry-panel" id={`supplier-quote-${hypothesisId}`}>
      <summary><span><strong>录入供应商真实报价</strong><small>采购价、运费、关税、MOQ、交期、样品分</small></span><span>＋</span></summary>
      <form action={recordAISupplierQuoteAction} className="entry-form form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesisId} />
        <div className="form-section-label full">供应商身份</div>
        <div className="field"><label>供应商名称</label><input name="supplierName" required maxLength={180} /></div>
        <div className="field"><label>平台</label><input name="supplierPlatform" placeholder="1688 / Alibaba / 工厂直联" defaultValue="1688" maxLength={60} /></div>
        <div className="field"><label>供应商主页 URL</label><input name="supplierUrl" type="url" required /></div>
        <div className="field"><label>联系方式</label><input name="contact" maxLength={180} placeholder="仅记录你已获得的公开或合法联系方式" /></div>
        <div className="field"><label>国家 / 地区</label><input name="country" maxLength={60} /></div>
        <div className="field"><label>产品匹配说明</label><input name="productMatch" maxLength={500} placeholder="材质、规格、结构、包装差异" /></div>
        <div className="form-section-label full">报价与成本（{currency}）</div>
        <div className="field"><label>采购单价（{currency}）</label><input name="unitPrice" type="number" min="0.01" step="0.01" required /></div>
        <div className="field"><label>单件运费（{currency}）</label><input name="freightPerUnit" type="number" min="0" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>关税率 %</label><input name="dutyRate" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>MOQ</label><input name="moq" type="number" min="1" step="1" required /></div>
        <div className="field"><label>交期（天）</label><input name="leadTimeDays" type="number" min="1" step="1" required /></div>
        <div className="field"><label>样品评分（0–100）</label><input name="sampleScore" type="number" min="0" max="100" step="1" /></div>
        <div className="field"><label>样品费（{currency}）</label><input name="sampleFee" type="number" min="0" step="0.01" defaultValue="0" required /></div>
        <div className="field"><label>贸易条款</label><input name="incoterm" placeholder="FOB / EXW / DDP" maxLength={80} /></div>
        <div className="field"><label>付款条件</label><input name="paymentTerms" maxLength={200} placeholder="例如：30% 定金 / 70% 发货前" /></div>
        <div className="field full"><label>认证与合规</label><input name="certifications" maxLength={500} placeholder="只填供应商能提供证明的认证" /></div>
        <div className="field full"><label>报价来源 URL</label><input name="quoteUrl" type="url" required placeholder="聊天记录导出、报价单或产品链接" /></div>
        <div className="field"><label>观察时间</label><input name="observedAt" type="datetime-local" defaultValue={observedAt} required /></div>
        <div className="field"><label>录入人</label><input name="actor" defaultValue="采购人员" required maxLength={80} /></div>
        <button className="button primary" type="submit">记录真实报价并重算门禁</button>
      </form>
    </details>
  );
}

function evidenceTypeLabel(value: string) {
  const labels: Record<string, string> = {
    review_insight: "差评",
    patent_check: "专利",
    logistics_check: "物流",
    competitor_snapshot: "竞品",
    supplier_quote: "报价",
  };
  return labels[value] ?? value;
}

function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function dateTimeInputValue(date: Date) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function googleSearchUrl(query: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

function marketplaceSearchUrl(platformCode: string, marketCode: string, query: string) {
  const encoded = encodeURIComponent(query);
  if (platformCode === "amazon") {
    const domains: Record<string, string> = {
      US: "www.amazon.com",
      GB: "www.amazon.co.uk",
      DE: "www.amazon.de",
      JP: "www.amazon.co.jp",
      SG: "www.amazon.sg",
      MY: "www.amazon.com.my",
      AU: "www.amazon.com.au",
    };
    return `https://${domains[marketCode] ?? "www.amazon.com"}/s?k=${encoded}`;
  }
  if (platformCode === "ebay") {
    const domains: Record<string, string> = {
      US: "www.ebay.com",
      GB: "www.ebay.co.uk",
      DE: "www.ebay.de",
      AU: "www.ebay.com.au",
      SG: "www.ebay.com.sg",
      MY: "www.ebay.com.my",
    };
    return `https://${domains[marketCode] ?? "www.ebay.com"}/sch/i.html?_nkw=${encoded}`;
  }
  if (platformCode === "shopify") return googleSearchUrl(`site:myshopify.com ${query} ${marketCode}`);
  if (platformCode === "tiktok_shop") return googleSearchUrl(`site:shop.tiktok.com ${query} ${marketCode}`);
  return googleSearchUrl(`${query} ${marketCode}`);
}
