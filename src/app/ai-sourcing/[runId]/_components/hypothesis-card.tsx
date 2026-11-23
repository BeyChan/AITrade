import Link from "next/link";
import { CostBackCalculator } from "@/components/cost-back-calculator";
import { CompetitorMarketStage } from "@/components/stages/competitor-market-stage";
import { ProfitGateStage } from "@/components/stages/profit-gate-stage";
import { RiskApproveStage } from "@/components/stages/risk-approve-stage";
import { selectHypothesisAction } from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import type { SupplierDraft } from "@/lib/ai-supplier-assistant/repository";
import type { AiInboxHypothesisTaskCounts } from "@/lib/ai-inbox/repository";
import { isSyntheticCompetitorSource } from "@/lib/competitor-insights";
import {
  evaluateFastScreen,
  findEliminationMatches,
  type EliminatedHistoryRecord,
  type SourcingFunnelThresholds,
} from "@/lib/sourcing-funnel";
import type { ProductComplianceAttribute } from "@/lib/prelaunch-compliance";
import { buildSupplierLeads } from "@/lib/supplier-discovery";
import { compactNumber, moneyIn, percent, shortDate } from "@/lib/format";
import {
  type BatchType,
  type DetailTab,
  evidenceTypeLabel,
  marketplaceSearchUrl,
} from "./helpers";
import {
  DecisionBadge,
  DecisionPanel,
  SupplierAssistantPanel,
  SupplierDiscoveryWorkspace,
} from "./supplier-workspace";
import {
  AutoCompetitorImportCard,
  CompetitorBenchmarkPanel,
  SupplierQuoteEntryForm,
} from "./evidence-and-competitors";
import { ValidationTaskGroups } from "./validation-task-groups";

export function HypothesisCard({
  batch,
  hypothesis,
  supplierDrafts,
  observedAt,
  autoReadClipboard,
  tab,
  recentReports = [],
  funnelThresholds,
  eliminatedHistory = [],
  nextTabHref,
  nextTabLabel,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
  supplierDrafts: SupplierDraft[];
  aiInboxCounts?: AiInboxHypothesisTaskCounts | null;
  observedAt: string;
  defaultOpen?: boolean;
  autoReadClipboard: boolean;
  tab: DetailTab;
  recentReports?: CompetitorComparisonReport[];
  funnelThresholds?: SourcingFunnelThresholds;
  eliminatedHistory?: EliminatedHistoryRecord[];
  nextTabHref?: string;
  nextTabLabel?: string;
}) {
  const decision = hypothesis.decision;
  const attachedReport = hypothesis.comparisonReportId
    ? recentReports.find((r) => r.id === hypothesis.comparisonReportId) ?? null
    : null;
  const fastEval = evaluateFastScreen({
    marketCode: batch.marketCode,
    platformCode: batch.platformCode,
    currency: batch.currency,
    verifiedCompetitorCount: hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors,
    p50PriceCents: hypothesis.confirmedPriceCents ?? hypothesis.benchmark.price?.p50 ?? null,
    referenceFactoryCostRmb: hypothesis.referenceFactoryCostRmb,
    complianceAttrs: hypothesis.complianceAttrs as ProductComplianceAttribute[],
    conceptText: `${batch.category} ${hypothesis.concept}`,
    report: attachedReport,
    thresholds: funnelThresholds,
  });
  const eliminationAlerts = hypothesis.eliminatedAt
    ? []
    : findEliminationMatches(
        `${hypothesis.concept} ${hypothesis.competitorQueries.join(" ")}`,
        batch.category,
        eliminatedHistory,
        hypothesis.id,
      );

  const searchQuery = hypothesis.competitorQueries[0] || hypothesis.concept;
  const searchUrl = marketplaceSearchUrl(batch.platformCode, batch.marketCode, searchQuery);

  const notStartedNotice = (
    <div className="notice warn ai-tab-notice">
      <div>
        <strong>该历史方向尚未开启验证任务</strong>
        <span>点击右侧按钮一键开启（导入扫描或算利润也会自动开启）。</span>
      </div>
      <form action={selectHypothesisAction} className="button-row">
        <input type="hidden" name="runId" value={batch.id} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input type="hidden" name="actor" value="运营人员" />
        <button type="submit" className="button primary compact-button">一键开启</button>
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

  return (
    <section id={`hypothesis-${hypothesis.id}`} className="card ai-hypothesis-card funnel-active-workspace">
      <header className="ai-hypothesis-summary" style={{ cursor: "default" }}>
        <div className="ai-hypothesis-summary-main">
          <span className="ai-hypothesis-rank">0{hypothesis.position}</span>
          <div>
            <h2>{hypothesis.concept}</h2>
            <div className="ai-hypothesis-summary-meta">
              {hypothesis.eliminatedAt ? (
                <span className="badge badge-danger">已淘汰 · {hypothesis.eliminationReason ?? "已记录"}</span>
              ) : (
                <DecisionBadge decision={decision} />
              )}
              <span className="badge badge-neutral">
                证据 {decision?.evidenceCompleteness ?? 0}%
              </span>
              {hypothesis.confirmedPriceCents ? (
                <span className="badge badge-neutral mono">
                  售价 {moneyIn(batch.currency, hypothesis.confirmedPriceCents)}
                </span>
              ) : null}
              {hypothesis.productCaseId ? <span className="badge badge-success">已立项</span> : null}
            </div>
          </div>
        </div>
        <div className="ai-hypothesis-summary-side">
          <div className="ai-hypothesis-score">
            <strong>{hypothesis.priorityScore}</strong>
            <span>机会分</span>
          </div>
        </div>
      </header>

      <div className="ai-hypothesis-body">
        <details className="funnel-brief-details">
          <summary>
            <span>
              <strong>痛点假设：</strong>
              {hypothesis.painPoint}
            </span>
            <span className="muted">展开详情 ▾</span>
          </summary>
          <div className="ai-hypothesis-facts" style={{ marginTop: "10px" }}>
            <div><span>目标用户</span><strong>{hypothesis.targetUser}</strong></div>
            <div><span>核心痛点</span><strong>{hypothesis.painPoint}</strong></div>
            <div><span>差异化假设</span><strong>{hypothesis.differentiator}</strong></div>
          </div>
          <div className="ai-hypothesis-metrics" style={{ marginTop: "10px" }}>
            <div>
              <span>已确认售价</span>
              <strong>{hypothesis.confirmedPriceCents ? moneyIn(batch.currency, hypothesis.confirmedPriceCents) : "未确认"}</strong>
              <small>AI 建议 {hypothesis.recommendedPriceCents > 0 ? moneyIn(batch.currency, hypothesis.recommendedPriceCents) : "—"}</small>
            </div>
            <div><span>AI 假设净利率</span><strong>{percent(hypothesis.expectedMarginRate)}</strong></div>
            <div><span>AI 假设首单预算</span><strong>{moneyIn(batch.currency, hypothesis.firstOrderBudgetCents)}</strong></div>
            <div><span>证据完整度</span><strong>{decision?.evidenceCompleteness ?? 0}%</strong></div>
          </div>
        </details>

        {/* 01 竞品研报：只看价格带、竞争度与差评痛点 */}
        {tab === "hypotheses" ? (
          <>
            <CompetitorMarketStage
              runId={batch.id}
              platformName={batch.platformName}
              currency={batch.currency}
              searchUrl={searchUrl}
              hypothesis={hypothesis}
              recentReports={recentReports}
              attachedReport={attachedReport}
              evalResult={fastEval}
              eliminationAlerts={eliminationAlerts}
            />

            {hypothesis.selectedForValidation ? (
              <>
                <ValidationTaskGroups
                  runId={batch.id}
                  marketCode={batch.marketCode}
                  hypothesis={hypothesis}
                  observedAt={observedAt}
                  mode="market"
                  nextTabHref={nextTabHref}
                  nextTabLabel={nextTabLabel}
                  suggestedEliminationReason={fastEval.suggestedEliminationReason}
                />

                {hypothesis.competitors.length > 0 ? (
                  <CompetitorBenchmarkPanel batch={batch} hypothesis={hypothesis} />
                ) : null}

                {hypothesis.competitors.length > 0 ? (
                  <section className="ai-record-block ai-competitor-snapshot">
                    <div className="ai-validation-summary-head">
                      <div>
                        <span className="eyebrow">竞品快照</span>
                        <h3>
                          已核实 {hypothesis.competitors.filter((c) => !isSyntheticCompetitorSource(c.sourceType)).length} 款
                        </h3>
                      </div>
                      <span className="info-pill">共 {hypothesis.competitors.length} 条</span>
                    </div>
                    <div className="ai-competitor-grid">
                      {hypothesis.competitors.slice(0, 8).map((competitor) => (
                        <a href={competitor.sourceUrl} target="_blank" rel="noreferrer" className="ai-competitor-card" key={competitor.id}>
                          <div>
                            <strong>{competitor.title}</strong>
                            <span>{competitor.asin || "无 ASIN"} · {shortDate(competitor.observedAt)}</span>
                          </div>
                          <div>
                            <strong>{moneyIn(batch.currency, competitor.priceCents)}</strong>
                            <span>{competitor.rating ? `${competitor.rating}★` : "无评分"} · {compactNumber(competitor.reviewCount)} 评</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </section>
                ) : null}

                <div className="funnel-footer-drawers">
                  <details className="funnel-inline-collapse">
                    <summary>▸ 已录入证据（{hypothesis.evidence.length} 条）</summary>
                    <div className="funnel-inline-collapse-body">
                      {hypothesis.evidence.length === 0 ? (
                        <p className="muted" style={{ fontSize: "12px", margin: 0 }}>
                          暂无证据，先用上方「一键导入研报数据」写入 Top 20 扫描即可自动生成。
                        </p>
                      ) : (
                        <div className="evidence-list">
                          {hypothesis.evidence.slice(0, 8).map((item) => (
                            <div className="evidence-item" key={item.id}>
                              <div>
                                <strong>{item.title}</strong>
                                <span className="badge badge-neutral">{evidenceTypeLabel(item.evidenceType)}</span>
                              </div>
                              <p>{item.summary}</p>
                              <small>{shortDate(item.observedAt)} · <a href={item.sourceUrl} target="_blank" rel="noreferrer">查看来源</a></small>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>

                  <AutoCompetitorImportCard batch={batch} hypothesis={hypothesis} />
                </div>
              </>
            ) : (
              notStartedNotice
            )}
          </>
        ) : null}

        {/* 02 利润测算：专注 18% 硬门禁与倒推拿货上限 */}
        {tab === "profit" ? (
          <>
            <ProfitGateStage
              runId={batch.id}
              currency={batch.currency}
              hypothesis={hypothesis}
              evalResult={fastEval}
              nextTabHref={nextTabHref}
              nextTabLabel={nextTabLabel}
            />

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
              priceEntryHref={`#stage-profit-${hypothesis.id}`}
              quoteEntryHref={`/ai-sourcing/${encodeURIComponent(batch.id)}?tab=suppliers&hypothesisId=${encodeURIComponent(hypothesis.id)}#supplier-quote-${hypothesis.id}`}
              fxRateToUsd={batch.fxRateToUsd}
            />
          </>
        ) : null}

        {/* 03 找厂与打样：1688 选厂 + RFQ + 真实报价录入 + 样品分，一页打通 */}
        {tab === "suppliers" ? (
          <>
            <SupplierDiscoveryWorkspace
              runId={batch.id}
              hypothesis={hypothesis}
              supplierDrafts={supplierDrafts}
              supplierLeads={supplierLeads}
              defaultQuery={supplierLeads[0]?.query ?? hypothesis.concept}
              autoReadClipboard={autoReadClipboard}
            />

            {hypothesis.selectedForValidation ? (
              <>
                <SupplierQuoteEntryForm
                  hypothesisId={hypothesis.id}
                  runId={batch.id}
                  observedAt={observedAt}
                  currency={batch.currency}
                />

                {hypothesis.quotes.length > 0 ? (
                  <section className="ai-record-block">
                    <div className="ai-validation-summary-head">
                      <div>
                        <span className="eyebrow">已核验报价与样品分</span>
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
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <div id={`supplier-assistant-${hypothesis.id}`}>
                  <SupplierAssistantPanel
                    runId={batch.id}
                    hypothesis={hypothesis}
                    drafts={supplierDrafts}
                  />
                </div>
              </>
            ) : (
              notStartedNotice
            )}

            {nextTabHref && nextTabLabel ? (
              <div className="funnel-step-footer" style={{ justifyContent: "flex-end" }}>
                <Link href={nextTabHref} className="button primary compact-button">{nextTabLabel}</Link>
              </div>
            ) : null}
          </>
        ) : null}

        {/* 04 风险与立项：合规属性红线 + 专利物流核验 + 确定性门禁 + 全站唯一立项口 */}
        {tab === "decision" ? (
          hypothesis.selectedForValidation ? (
            <>
              <ValidationTaskGroups
                runId={batch.id}
                marketCode={batch.marketCode}
                hypothesis={hypothesis}
                observedAt={observedAt}
                mode="decision"
                suggestedEliminationReason={fastEval.suggestedEliminationReason}
              />

              <DecisionPanel decision={decision} hypothesis={hypothesis} currency={batch.currency} />

              <RiskApproveStage
                runId={batch.id}
                marketCode={batch.marketCode}
                hypothesis={hypothesis}
                evalResult={fastEval}
              />
            </>
          ) : (
            notStartedNotice
          )
        ) : null}
      </div>
    </section>
  );
}
