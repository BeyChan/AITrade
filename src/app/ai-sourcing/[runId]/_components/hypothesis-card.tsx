import Link from "next/link";
import { CompetitorMarketStage } from "@/components/stages/competitor-market-stage";
import { RiskApproveStage } from "@/components/stages/risk-approve-stage";
import { eliminateHypothesisAction, selectHypothesisAction } from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import type { CostSheet } from "@/lib/cost-sheets-repository";
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
  costSheet = null,
  costSheetIsLatest = false,
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
  costSheet?: CostSheet | null;
  costSheetIsLatest?: boolean;
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
    verifiedCompetitorCount: hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors,
    p50PriceCents: hypothesis.benchmark.price?.p50 ?? null,
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
        <span>点击右侧按钮一键开启；后续从竞品研报和成本核算单补齐确定性证据。</span>
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
              {costSheet ? (
                <span className={`badge mono ${costSheet.status === "confirmed" && costSheetIsLatest ? "badge-success" : "badge-neutral"}`}>
                  核算价 {moneyIn(costSheet.currency, costSheet.assumptions.salePriceCents)} · 净利 {percent(costSheet.results.marginRate)}
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
              <span>{costSheet ? "核算售价" : "竞品 P50"}</span>
              <strong>
                {costSheet
                  ? moneyIn(costSheet.currency, costSheet.assumptions.salePriceCents)
                  : hypothesis.benchmark.price?.p50
                    ? moneyIn(batch.currency, hypothesis.benchmark.price.p50)
                    : "待扫市场"}
              </strong>
              <small>{costSheet ? `核算单 V${costSheet.version}` : "参考价，不参与 GO"}</small>
            </div>
            <div>
              <span>核算净利率</span>
              <strong style={{ color: costSheet && costSheet.results.marginRate < 0.18 ? "var(--danger)" : undefined }}>
                {costSheet ? percent(costSheet.results.marginRate) : "尚未核算"}
              </strong>
              <small>{costSheet ? `V${costSheet.version} · ${costSheet.status === "confirmed" ? "已确认" : "草稿"}` : "请创建独立成本核算单"}</small>
            </div>
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

        {/* 02 成本核算：只读取绑定核算单，不在工作台里维护第二套价格口径 */}
        {tab === "profit" ? (
          costSheet ? (
            <section className="funnel-fast-card" id={`stage-profit-${hypothesis.id}`} aria-label="第 2 步 成本核算">
              <div className="funnel-fast-head">
                <div>
                  <span className="eyebrow">02 · 成本核算</span>
                  <h3>{costSheet.title} · V{costSheet.version}</h3>
                </div>
                <div className="button-row">
                  <span className={`badge ${costSheet.status === "confirmed" ? "badge-success" : "badge-neutral"}`}>
                    {costSheet.status === "confirmed" ? "已人工确认" : "草稿"}
                  </span>
                  <span className={`badge ${costSheetIsLatest ? "badge-success" : "badge-danger"}`}>
                    {costSheetIsLatest ? "最新版本" : "已有新版本"}
                  </span>
                </div>
              </div>

              <div className="funnel-fast-kpis">
                <span>核算售价 <strong>{moneyIn(costSheet.currency, costSheet.assumptions.salePriceCents)}</strong></span>
                <span>到岸成本 <strong>{moneyIn(costSheet.currency, costSheet.results.landedCostCents)}</strong></span>
                <span>净利润 <strong>{moneyIn(costSheet.currency, costSheet.results.netProfitCents)}</strong></span>
                <span>净利率 <strong style={{ color: costSheet.results.marginRate >= 0.18 ? undefined : "var(--danger)" }}>{percent(costSheet.results.marginRate)}</strong></span>
              </div>

              <div className="quote-facts" style={{ marginTop: 14 }}>
                <div><span>18% 门禁</span><strong style={{ color: costSheet.results.marginRate >= 0.18 ? "var(--success)" : "var(--danger)" }}>{costSheet.results.marginRate >= 0.18 ? "通过" : "未通过"}</strong></div>
                <div><span>压测净利</span><strong style={{ color: costSheet.results.stressProfitCents > 0 ? "var(--success)" : "var(--danger)" }}>{moneyIn(costSheet.currency, costSheet.results.stressProfitCents)}</strong></div>
                <div><span>压测净利率</span><strong>{percent(costSheet.results.stressMarginRate)}</strong></div>
                <div><span>确认时间</span><strong>{costSheet.confirmedAt ? shortDate(costSheet.confirmedAt) : "未确认"}</strong></div>
              </div>

              {costSheet.status !== "confirmed" || !costSheetIsLatest ? (
                <div className="notice warn" style={{ marginTop: 14 }}>
                  <strong>该版本不能支持正式 GO。</strong>
                  <span>{costSheet.status !== "confirmed" ? "请先人工确认核算单。" : "请切换到同组最新版本后再确认。"}</span>
                </div>
              ) : null}

              <div className="funnel-step-footer" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div className="button-row">
                  <Link
                    href={`/costing?id=${encodeURIComponent(costSheet.id)}&hypothesisId=${encodeURIComponent(hypothesis.id)}`}
                    className="button primary compact-button"
                  >
                    查看核算单
                  </Link>
                  <Link
                    href={`/costing?hypothesisId=${encodeURIComponent(hypothesis.id)}`}
                    className="button secondary compact-button"
                  >
                    更换核算单
                  </Link>
                  {costSheet.results.marginRate < 0.18 && !hypothesis.eliminatedAt ? (
                    <form action={eliminateHypothesisAction}>
                      <input type="hidden" name="runId" value={batch.id} />
                      <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                      <input type="hidden" name="reason" value="利润不足" />
                      <input type="hidden" name="note" value={`核算单 V${costSheet.version} 净利率 ${percent(costSheet.results.marginRate)}，低于 18% 门禁`} />
                      <button type="submit" className="button secondary compact-button">利润红灯 · 淘汰</button>
                    </form>
                  ) : null}
                </div>
                {nextTabHref && nextTabLabel ? (
                  <Link href={nextTabHref} className="button secondary compact-button">{nextTabLabel}</Link>
                ) : null}
              </div>
              <p className="help" style={{ marginBottom: 0 }}>正式 GO 还会校验竞品研报人工确认、报价、样品、专利、物流、MOQ 与现金占用。</p>
            </section>
          ) : (
            <section className="funnel-fast-card" id={`stage-profit-${hypothesis.id}`} aria-label="第 2 步 成本核算">
              <div className="funnel-fast-head">
                <div>
                  <span className="eyebrow">02 · 成本核算</span>
                  <h3>先绑定一张可追溯的核算单</h3>
                </div>
                <span className="badge badge-neutral">未绑定</span>
              </div>
              <p className="funnel-fast-summary">售价、采购、物流、平台费率和压测统一在成本核算功能里维护。工作台只读取已确认的最新增值版本，避免出现第二套成本口径。</p>
              <div className="funnel-step-footer" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <Link href={`/costing?hypothesisId=${encodeURIComponent(hypothesis.id)}`} className="button primary compact-button">
                  建立或绑定核算单 →
                </Link>
                {nextTabHref && nextTabLabel ? (
                  <Link href={nextTabHref} className="button secondary compact-button">{nextTabLabel}</Link>
                ) : null}
              </div>
            </section>
          )
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
