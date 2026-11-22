import Link from "next/link";
import { CostBackCalculator } from "@/components/cost-back-calculator";
import { HashOpenDetails } from "@/components/hash-open-details";
import {
  promoteHypothesisAction,
  selectHypothesisAction,
  toggleValidationTaskAction,
} from "@/app/actions";
import type {
  AIOpportunityEvidence,
  AISourcingHypothesisDetail,
} from "@/lib/ai-sourcing-repository";
import type { SupplierDraft } from "@/lib/ai-supplier-assistant/repository";
import type { AiInboxHypothesisTaskCounts } from "@/lib/ai-inbox/repository";
import { isSyntheticCompetitorSource } from "@/lib/competitor-insights";
import { buildSupplierLeads } from "@/lib/supplier-discovery";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import {
  type BatchType,
  type DetailTab,
  evidenceTypeLabel,
  googleSearchUrl,
  marketplaceSearchUrl,
} from "./helpers";
import {
  DecisionBadge,
  DecisionPanel,
  QueryGroup,
  SupplierAssistantPanel,
  SupplierDiscoveryWorkspace,
} from "./supplier-workspace";
import {
  AutoCompetitorImportCard,
  CompetitorBenchmarkPanel,
  CompetitorEntryForm,
  ConfirmPriceForm,
  EvidenceEntryForms,
  SupplierQuoteEntryForm,
} from "./evidence-and-competitors";

export function HypothesisSummaryList({ batch }: { batch: BatchType }) {
  return (
    <section className="panel ai-hypothesis-summary-list">
      <div className="panel-header">
        <div>
          <div className="eyebrow">机会方向</div>
          <h2>{batch.hypotheses.length} 个待验证方向</h2>
          <p>选一个方向，按顺序补证据、找供应商，最后看门禁结论。</p>
        </div>
        <Link className="button secondary" href={`/ai-sourcing/${encodeURIComponent(batch.id)}?tab=hypotheses`}>
          从验证证据开始
        </Link>
      </div>
      <div className="ai-summary-rows">
        {batch.hypotheses.map((hypothesis) => {
          const href = `/ai-sourcing/${encodeURIComponent(batch.id)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesis.id)}#hypothesis-${encodeURIComponent(hypothesis.id)}`;
          return (
            <Link
              className="ai-summary-row"
              key={hypothesis.id}
              href={href}
              title={`点击进入「${hypothesis.concept}」验证详情`}
            >
              <span className="ai-hypothesis-rank">0{hypothesis.position}</span>
              <div className="ai-summary-main">
                <strong>{hypothesis.concept}</strong>
                <small>{hypothesis.targetUser} · 证据 {hypothesis.decision?.evidenceCompleteness ?? 0}%</small>
              </div>
              <DecisionBadge decision={hypothesis.decision} />
              <span className="button secondary">
                继续
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function HypothesisCard({
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
                  <span className="eyebrow">验证任务 · 商业核验清单</span>
                  <h3>{hypothesis.counts.completedTasks} / {hypothesis.counts.totalTasks} 项任务完成</h3>
                </div>
                <span className="info-pill">{hypothesis.counts.competitors} 竞品 · {hypothesis.counts.reviewSamples} 差评样本</span>
              </div>

              {/* 任务推进与完成指引 */}
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "8px",
                  background: "var(--green-soft)",
                  border: "1px solid #d4e8db",
                  marginBottom: "12px",
                  fontSize: "12px",
                  lineHeight: "1.6",
                }}
              >
                <div style={{ fontWeight: 700, color: "var(--green)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                  <span>💡</span>
                  <span>如何一步步完成这 8 项验证任务？</span>
                </div>
                <div style={{ color: "var(--ink)" }}>
                  <strong>① 单独勾选完成：</strong>线下或第三方已完成的核验（如已做样品实测、已查专利），点击任务右侧<strong>「标记完成」</strong>或左侧<strong>○</strong>即可单独完成。<br />
                  <strong>② 数据达标自动完成：</strong>在下方录入真实竞品（≥20项）、差评（≥50项）、供应商（≥10家）、真实报价（≥3份），系统检测达标后将自动点亮完成。<br />
                  <strong>③ 门禁联动：</strong>任务完成度与真实证据链共同决定 <strong>GO / HOLD 门禁</strong>，门禁达标后方可转入正式商品立项。
                </div>
              </div>

              <div className="ai-task-list">
                {hypothesis.tasks.map((task) => {
                  const isDone = task.status === "done";
                  const taskActionMap: Record<string, { href?: string; label?: string }> = {
                    competitor_scan: { href: `#competitor-entry-${hypothesis.id}`, label: "去录竞品" },
                    review_research: { href: `#entry-review-${hypothesis.id}`, label: "去录差评" },
                    supplier_shortlist: { href: `#supplier-discovery-${hypothesis.id}`, label: "去寻源" },
                    rfq_draft: { href: `#supplier-discovery-${hypothesis.id}`, label: "询盘草稿" },
                    quote_collection: { href: `#supplier-quote-${hypothesis.id}`, label: "去录报价" },
                    patent_check: { href: `#entry-patent-${hypothesis.id}`, label: "录入合规" },
                    logistics_check: { href: `#entry-logistics-${hypothesis.id}`, label: "录入物流" },
                  };
                  const quickAction = taskActionMap[task.taskType];

                  return (
                    <div
                      className={`ai-task ${isDone ? "done" : ""}`}
                      key={task.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "26px minmax(0, 1fr) auto",
                        gap: "10px",
                        alignItems: "center",
                        padding: "10px 12px",
                        border: isDone ? "1px solid var(--green)" : "1px solid var(--line)",
                        borderRadius: "10px",
                        background: isDone ? "var(--green-soft)" : "var(--paper)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <form action={toggleValidationTaskAction} style={{ margin: 0 }}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <input type="hidden" name="runId" value={batch.id} />
                        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                        <input type="hidden" name="status" value={isDone ? "todo" : "done"} />
                        <button
                          type="submit"
                          className="ai-task-check"
                          style={{
                            cursor: "pointer",
                            border: isDone ? "1.5px solid var(--green)" : "1.5px solid var(--line-strong)",
                            borderRadius: "50%",
                            width: "24px",
                            height: "24px",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: isDone ? "var(--green)" : "var(--surface-subtle)",
                            color: isDone ? "#ffffff" : "var(--muted)",
                            fontSize: "12px",
                            fontWeight: 700,
                            transition: "all 0.15s ease",
                          }}
                          title={isDone ? "已完成（点击单独取消完成）" : "点击单独标记为已完成"}
                        >
                          {isDone ? "✓" : "○"}
                        </button>
                      </form>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <strong style={{ fontSize: "12.5px", fontWeight: 600, color: isDone ? "var(--green)" : "var(--ink)" }}>
                            {task.title}
                          </strong>
                          {task.targetCount ? (
                            <span className="badge badge-neutral" style={{ fontSize: "12px", padding: "1px 6px" }}>
                              目标: {task.targetCount}
                            </span>
                          ) : null}
                          {isDone ? (
                            <span className="badge badge-success" style={{ fontSize: "12px", padding: "1px 6px" }}>
                              已达成
                            </span>
                          ) : null}
                        </div>
                        <p style={{ fontSize: "12px", margin: "3px 0 0", color: "var(--muted)", lineHeight: "1.45" }}>
                          {task.description}
                        </p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {quickAction?.href ? (
                          <a
                            href={quickAction.href}
                            className="button ghost"
                            style={{
                              fontSize: "12px",
                              padding: "4px 8px",
                              height: "auto",
                              whiteSpace: "nowrap",
                              color: "var(--muted)",
                            }}
                          >
                            {quickAction.label}
                          </a>
                        ) : null}
                        <form action={toggleValidationTaskAction} style={{ margin: 0 }}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="runId" value={batch.id} />
                          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                          <input type="hidden" name="status" value={isDone ? "todo" : "done"} />
                          <button
                            type="submit"
                            className={`button ${isDone ? "ghost" : "secondary"}`}
                            style={{
                              fontSize: "12px",
                              padding: "4px 10px",
                              height: "auto",
                              fontWeight: 600,
                              color: isDone ? "var(--green)" : "var(--ink)",
                              borderColor: isDone ? "var(--green)" : undefined,
                              background: isDone ? "rgba(40, 167, 69, 0.08)" : undefined,
                              whiteSpace: "nowrap",
                              cursor: "pointer",
                            }}
                            title={isDone ? "点击取消完成" : "点击单独标记为已完成"}
                          >
                            {isDone ? "✓ 已完成" : "标记完成"}
                          </button>
                        </form>
                      </div>
                    </div>
                  );
                })}
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
              <Link href="/competitors" className="button primary">
                竞品研报
              </Link>
              <Link href="/import" className="button secondary">
                批量导入 CSV
              </Link>
            </div>
          </section>

          <CompetitorBenchmarkPanel batch={batch} hypothesis={hypothesis} />

          <AutoCompetitorImportCard batch={batch} hypothesis={hypothesis} />

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
                  <span className="eyebrow">COMPETITOR EVIDENCE · 竞品证据</span>
                  <h3>
                    竞品快照（{hypothesis.competitors.filter((c) => !isSyntheticCompetitorSource(c.sourceType)).length} 条已核实
                    {hypothesis.competitors.some((c) => isSyntheticCompetitorSource(c.sourceType))
                      ? ` · ${hypothesis.competitors.filter((c) => isSyntheticCompetitorSource(c.sourceType)).length} 条待核实素材`
                      : ""}）
                  </h3>
                </div>
                <span className="info-pill">{hypothesis.competitors.length} 个</span>
              </div>
              {hypothesis.competitors.some((c) => isSyntheticCompetitorSource(c.sourceType)) ? (
                <div className="result-box warning" style={{ marginBottom: "12px", fontSize: "12px", lineHeight: "1.5" }} role="status">
                  <strong>标为「AI / 模板素材」的记录由系统生成，不是市场事实</strong>，不计入 GO 门禁的竞品数、差评样本与价格分位。请用下方「录入真实竞品」或浏览器采集扩展补录真实证据后再做决策。
                </div>
              ) : null}
              <div className="ai-competitor-grid">
                {hypothesis.competitors.slice(0, 10).map((competitor) => (
                  <a href={competitor.sourceUrl} target="_blank" rel="noreferrer" className="ai-competitor-card" key={competitor.id}>
                    <div>
                      <strong>{competitor.title}</strong>
                      <span>
                        {isSyntheticCompetitorSource(competitor.sourceType)
                          ? <span className="badge badge-neutral" style={{ marginRight: "6px" }}>AI / 模板素材 · 待核实</span>
                          : <span className="badge badge-success" style={{ marginRight: "6px" }}>已核实证据</span>}
                        {competitor.asin || "无 ASIN"} · {shortDate(competitor.observedAt)}
                      </span>
                    </div>
                    <div>
                      <strong>{moneyIn(batch.currency, competitor.priceCents)}</strong>
                      <span>{competitor.rating ? `${competitor.rating}★` : "无评分"} · {compactNumber(competitor.reviewCount)} 评论</span>
                    </div>
                  </a>
                ))}
              </div>
              {hypothesis.competitors.length > 10 ? (
                <p className="muted" style={{ marginTop: "10px", fontSize: "12px" }}>
                  仅展示最近 10 条，共 {hypothesis.competitors.length} 条；完整记录保存在数据库中。
                </p>
              ) : null}
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
                          <a href={quote.quoteUrl} target="_blank" rel="noreferrer" className="muted">查看报价来源</a>
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
                <Link href={`/cases/${hypothesis.productCaseId}/sourcing`} className="button primary">进入供应商定标</Link>
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

