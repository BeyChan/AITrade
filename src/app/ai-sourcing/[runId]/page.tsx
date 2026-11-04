import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import {
  confirmHypothesisPriceAction,
  promoteHypothesisAction,
  recordAISupplierQuoteAction,
  recordCompetitorAction,
  recordOpportunityEvidenceAction,
  selectHypothesisAction,
} from "@/app/actions";
import {
  getAISourcingBatch,
  getBatchSiteLabel,
  type AIOpportunityEvidence,
  type AISelectionDecision,
  type AISourcingHypothesisDetail,
} from "@/lib/ai-sourcing-repository";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import {
  buildSupplierLeads,
  supplier1688SearchUrl,
  supplierAlibabaSearchUrl,
  supplierGoogleSearchUrl,
} from "@/lib/supplier-discovery";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ market?: string; platform?: string; notice?: string; error?: string }>;
};

export default async function AISourcingDetailPage({ params, searchParams }: PageProps) {
  const [{ runId }, query] = await Promise.all([params, searchParams]);
  const batch = await getAISourcingBatch(runId);
  if (!batch) notFound();

  const siteLabel = getBatchSiteLabel(batch);
  const selectedCount = batch.hypotheses.filter((item) => item.selectedForValidation).length;
  const goCount = batch.hypotheses.filter((item) => item.decision?.decision === "GO").length;
  const completeness = batch.hypotheses.length
    ? Math.round(batch.hypotheses.reduce((sum, item) => sum + (item.decision?.evidenceCompleteness ?? 0), 0) / batch.hypotheses.length)
    : 0;
  const observedAt = dateTimeInputValue(new Date());

  return (
    <div className="page ai-sourcing-detail-page">
      <div className="breadcrumb">
        <Link href={`/?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}`}>AI 选品</Link> / 验证批次
      </div>

      <div className="title-row">
        <div>
          <div className="eyebrow">Evidence-first validation</div>
          <h1>{batch.category} · 选品验证</h1>
          <div className="title-meta">
            <span className="badge badge-neutral">{siteLabel}</span>
            <span className="badge badge-neutral">{batch.currency}</span>
            <span className="badge badge-success">{goCount} 个 GO</span>
            <span className="badge status-review_pending">{selectedCount} 个验证中</span>
          </div>
        </div>
        <div className="button-row">
          <Link href={`/?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}#research-history`} className="button secondary">返回研究列表</Link>
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

      <section className="ai-batch-overview">
        <div>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>Research brief</span>
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

      <div className="ai-hypothesis-list">
        {batch.hypotheses.map((hypothesis) => (
          <HypothesisCard
            key={hypothesis.id}
            batch={batch}
            hypothesis={hypothesis}
            observedAt={observedAt}
          />
        ))}
      </div>

      <section className="panel ai-guardrail-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">Guardrails</div>
            <h2>这套流程不会替你虚构事实</h2>
            <p>AI 仅生成假设；销量、评论、竞品、供应商、报价、专利和利润都必须有来源。系统不会自动联系供应商、下单、付款或发布 Listing。</p>
          </div>
          <span className="badge badge-success">externalActions: none</span>
        </div>
      </section>
    </div>
  );
}

type BatchType = NonNullable<Awaited<ReturnType<typeof getAISourcingBatch>>>;

function HypothesisCard({
  batch,
  hypothesis,
  observedAt,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
  observedAt: string;
}) {
  const decision = hypothesis.decision;
  const supplierByShortlistId = new Map(hypothesis.shortlist.map((item) => [item.id, item]));
  const supplierLeads = buildSupplierLeads({
    concept: hypothesis.concept,
    category: batch.category,
    targetUser: hypothesis.targetUser,
    supplierKeywords: hypothesis.supplierKeywords,
  });
  const externalEvidence = hypothesis.evidence.filter((item) => !["competitor_snapshot", "supplier_quote"].includes(item.evidenceType));

  return (
    <article className="card ai-hypothesis-card" id={`hypothesis-${hypothesis.id}`}>
      <div className="ai-hypothesis-head">
        <div>
          <div className="ai-hypothesis-rank">
            <span>0{hypothesis.position}</span>
            <span>研究优先级 {hypothesis.priorityScore}</span>
          </div>
          <h2>{hypothesis.concept}</h2>
          <div className="button-row">
            <DecisionBadge decision={decision} />
            {hypothesis.selectedForValidation ? <span className="badge badge-neutral">已加入验证</span> : <span className="badge badge-neutral">尚未加入验证</span>}
            {hypothesis.productCaseId ? <span className="badge badge-success">已转商品立项</span> : null}
          </div>
        </div>
        <div className="ai-priority-ring" style={{ "--score": `${hypothesis.priorityScore}%` } as CSSProperties}>
          <strong>{hypothesis.priorityScore}</strong>
          <span>机会分</span>
        </div>
      </div>

      <div className="ai-hypothesis-facts">
        <div><span>目标用户</span><strong>{hypothesis.targetUser}</strong></div>
        <div><span>核心痛点</span><strong>{hypothesis.painPoint}</strong></div>
        <div><span>差异化假设</span><strong>{hypothesis.differentiator}</strong></div>
      </div>

      <div className="ai-hypothesis-metrics">
        <div>
          <span>已确认售价</span>
          <strong>{hypothesis.confirmedPriceCents ? moneyIn(batch.currency, hypothesis.confirmedPriceCents) : "未确认"}</strong>
          <small>AI 假设价 {moneyIn(batch.currency, hypothesis.recommendedPriceCents)}（未验证，不参与门禁）</small>
        </div>
        <div><span>AI 假设净利率</span><strong>{percent(hypothesis.expectedMarginRate)}</strong></div>
        <div><span>AI 假设首单预算</span><strong>{moneyIn(batch.currency, hypothesis.firstOrderBudgetCents)}</strong></div>
        <div><span>证据完整度</span><strong>{decision?.evidenceCompleteness ?? 0}%</strong></div>
      </div>

      <section className="ai-supplier-discovery">
        <div className="ai-supplier-discovery-head">
          <div>
            <strong>供应商找货线索</strong>
            <span>每张卡对应一种搜索思路。搜索命中只是候选供应商，需要继续核对主体、产品匹配和报价。</span>
          </div>
          <span className="badge badge-neutral">5 组线索</span>
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
                <a href={supplier1688SearchUrl(lead.query)} target="_blank" rel="noreferrer">1688 ↗</a>
                <a href={supplierAlibabaSearchUrl(lead.query)} target="_blank" rel="noreferrer">Alibaba ↗</a>
                <a href={supplierGoogleSearchUrl(lead.query)} target="_blank" rel="noreferrer">Google 查工厂 ↗</a>
              </div>
            </article>
          ))}
        </div>
      </section>

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

      {!hypothesis.selectedForValidation ? (
        <div className="ai-next-step">
          <div>
            <strong>下一步：加入验证</strong>
            <p>加入后将生成 8 项验证任务；系统不会自动采集、联系供应商或下单。</p>
          </div>
          <form action={selectHypothesisAction} className="button-row">
            <input type="hidden" name="runId" value={batch.id} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
            <input name="actor" aria-label="加入验证的负责人" placeholder="负责人" defaultValue="运营人员" maxLength={80} required />
            <button type="submit" className="button primary">加入验证</button>
          </form>
        </div>
      ) : (
        <>
          <DecisionPanel decision={decision} hypothesis={hypothesis} currency={batch.currency} />

          <div className="ai-validation-grid">
            <section className="ai-validation-summary">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">Validation tasks</span>
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
                  <span className="eyebrow">Recorded evidence</span>
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
                  <span className="eyebrow">Competitor snapshots</span>
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

          {hypothesis.quotes.length > 0 ? (
            <section className="ai-record-block">
              <div className="ai-validation-summary-head">
                <div>
                  <span className="eyebrow">Verified quotes</span>
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
          <span className="eyebrow">Deterministic gate</span>
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
    <details className="entry-panel card ai-entry-panel">
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
    <details className="entry-panel card ai-entry-panel">
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
    <details className="entry-panel card ai-entry-panel">
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
