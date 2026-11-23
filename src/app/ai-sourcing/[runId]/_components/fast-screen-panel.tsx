import {
  attachComparisonReportAction,
  eliminateHypothesisAction,
  saveHypothesisProfitCheckAction,
} from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { moneyIn, shortDate } from "@/lib/format";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";
import {
  evaluateFastScreen,
  type EliminationMatchAlert,
  type SourcingFunnelThresholds,
} from "@/lib/sourcing-funnel";
import { type BatchType, marketplaceSearchUrl } from "./helpers";

function statusToneClass(status: "pass" | "hold" | "fail" | "pending") {
  if (status === "pass") return "badge-success";
  if (status === "fail") return "badge-danger";
  if (status === "hold") return "status-review_pending";
  return "badge-neutral";
}

function statusLabel(status: "pass" | "hold" | "fail" | "pending") {
  if (status === "pass") return "通过";
  if (status === "fail") return "红灯";
  if (status === "hold") return "HOLD";
  return "待检";
}

export function FastScreenPanel({
  batch,
  hypothesis,
  recentReports,
  thresholds,
  eliminationAlerts,
}: {
  batch: BatchType;
  hypothesis: AISourcingHypothesisDetail;
  recentReports: CompetitorComparisonReport[];
  thresholds: SourcingFunnelThresholds;
  eliminationAlerts: EliminationMatchAlert[];
}) {
  const attachedReport = hypothesis.comparisonReportId
    ? recentReports.find((r) => r.id === hypothesis.comparisonReportId) ?? null
    : null;
  const verifiedCount = hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors;
  const searchQuery = hypothesis.competitorQueries[0] || hypothesis.concept;
  const searchUrl = marketplaceSearchUrl(batch.platformCode, batch.marketCode, searchQuery);

  const evalResult = evaluateFastScreen({
    marketCode: batch.marketCode,
    platformCode: batch.platformCode,
    currency: batch.currency,
    verifiedCompetitorCount: verifiedCount,
    p50PriceCents: hypothesis.confirmedPriceCents ?? hypothesis.benchmark.price?.p50 ?? null,
    referenceFactoryCostRmb: hypothesis.referenceFactoryCostRmb,
    complianceAttrs: hypothesis.complianceAttrs as ProductComplianceAttribute[],
    conceptText: `${batch.category} ${hypothesis.concept}`,
    report: attachedReport,
    thresholds,
  });

  const hasRedLight =
    evalResult.marketStatus === "fail" ||
    evalResult.profitStatus === "fail" ||
    evalResult.complianceStatus === "fail";

  return (
    <section className="funnel-fast-screen" aria-label="先淘汰后取证快筛区">
      {eliminationAlerts.length > 0 ? (
        <div className="notice warn funnel-history-alert" role="status">
          <strong>避坑提醒：历史曾淘汰过相似方向</strong>
          <div className="funnel-history-alert-list">
            {eliminationAlerts.map(({ record }) => (
              <span key={record.id}>
                「{record.concept}」于 {shortDate(record.eliminatedAt)} 因 <strong>{record.eliminationReason}</strong> 淘汰
                {record.eliminationNote ? `（${record.eliminationNote}）` : ""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="funnel-fast-grid">
        {/* ① 扫市场 */}
        <div className="funnel-fast-card" id={`fast-screen-market-${hypothesis.id}`}>
          <div className="funnel-fast-head">
            <div>
              <span className="eyebrow">扫市场</span>
              <h3>挤得进去吗？</h3>
            </div>
            <span className={`badge ${statusToneClass(evalResult.marketStatus)}`}>
              {statusLabel(evalResult.marketStatus)}
            </span>
          </div>

          <p className="funnel-fast-summary">{evalResult.marketSummary}</p>

          <div className="funnel-fast-kpis">
            <span>竞品 <strong>{evalResult.competitorCount}/20</strong></span>
            <span>
              中位价{" "}
              <strong>
                {evalResult.p50PriceCents ? moneyIn(batch.currency, evalResult.p50PriceCents) : "待扫"}
              </strong>
            </span>
            {evalResult.hhi !== null ? <span>HHI <strong>{evalResult.hhi}</strong></span> : null}
            {evalResult.medianReviews !== null ? (
              <span>中位评 <strong>{evalResult.medianReviews.toLocaleString()}</strong></span>
            ) : null}
          </div>

          <div className="funnel-fast-actions">
            <a
              href={searchUrl}
              target="_blank"
              rel="noreferrer"
              className="button secondary compact-button"
            >
              去 {batch.platformName} 抓 Top 20 ↗
            </a>
          </div>

          {recentReports.length > 0 ? (
            <form action={attachComparisonReportAction} className="funnel-attach-form">
              <input type="hidden" name="runId" value={batch.id} />
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <select
                name="reportId"
                defaultValue={attachedReport?.id ?? recentReports[0]?.id ?? ""}
                aria-label="选择扩展扫描的竞品研报"
              >
                {recentReports.slice(0, 12).map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.title.slice(0, 28)} ({rep.competitors.length}款 · {shortDate(rep.createdAt)})
                  </option>
                ))}
              </select>
              <button type="submit" className="button primary compact-button">
                一键导入
              </button>
            </form>
          ) : null}
        </div>

        {/* ② 算利润（默认只露 1 个输入框） */}
        <div className="funnel-fast-card" id={`fast-screen-profit-${hypothesis.id}`}>
          <div className="funnel-fast-head">
            <div>
              <span className="eyebrow">算利润</span>
              <h3>能赚钱吗？</h3>
            </div>
            <div className="button-row" style={{ gap: "6px" }}>
              <span className={`badge ${statusToneClass(evalResult.profitStatus)}`}>
                利润 {statusLabel(evalResult.profitStatus)}
              </span>
              {evalResult.complianceStatus !== "pass" ? (
                <span className={`badge ${statusToneClass(evalResult.complianceStatus)}`}>
                  合规 {statusLabel(evalResult.complianceStatus)}
                </span>
              ) : null}
            </div>
          </div>

          <p className="funnel-fast-summary">{evalResult.profitSummary}</p>
          {evalResult.complianceStatus !== "pass" ? (
            <p className="funnel-fast-warn">{evalResult.complianceSummary}</p>
          ) : null}

          <form action={saveHypothesisProfitCheckAction} className="funnel-profit-form">
            <input type="hidden" name="runId" value={batch.id} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />

            {/* 核心只留 1 个数字框 + 1 个按钮 */}
            <div className="funnel-profit-single-row">
              <input
                name="referenceFactoryCostRmb"
                type="number"
                min="0.1"
                step="0.1"
                aria-label="1688 参考价（人民币）"
                defaultValue={hypothesis.referenceFactoryCostRmb ?? ""}
                placeholder={
                  evalResult.maxFactoryRmb
                    ? `填 1688 参考价 ¥（18% 上限 ≤ ¥${evalResult.maxFactoryRmb}）`
                    : "填 1688 参考价 ¥（例如：28）"
                }
              />
              <button type="submit" className="button primary compact-button">
                算利润
              </button>
            </div>

            {/* 合规 7 项 + 自定义售价收进一行折叠条 */}
            <details className="funnel-inline-collapse">
              <summary>
                ▸ 合规排查（{hypothesis.complianceAttrs.length > 0 ? `已勾 ${hypothesis.complianceAttrs.length} 项` : "无高危项"}）· 调整参考售价
              </summary>
              <div className="funnel-inline-collapse-body">
                <label className="funnel-mini-field">
                  <span>参考售价（{batch.currency}，默认取扫描 P50）</span>
                  <input
                    name="confirmedPrice"
                    type="number"
                    min="0.01"
                    step="0.01"
                    defaultValue={
                      evalResult.p50PriceCents ? (evalResult.p50PriceCents / 100).toFixed(2) : ""
                    }
                    placeholder="扫市场后自动带入 P50"
                  />
                </label>
                <div className="funnel-compliance-pills">
                  {COMPLIANCE_ATTRIBUTE_OPTIONS.map((opt) => (
                    <label key={opt.id} className="funnel-compliance-pill" title={opt.hint}>
                      <input
                        type="checkbox"
                        name="complianceAttr"
                        value={opt.id}
                        defaultChecked={hypothesis.complianceAttrs.includes(opt.id)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          </form>

          {hasRedLight && !hypothesis.eliminatedAt && evalResult.suggestedEliminationReason ? (
            <form action={eliminateHypothesisAction} className="funnel-fast-actions">
              <input type="hidden" name="runId" value={batch.id} />
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <input type="hidden" name="reason" value={evalResult.suggestedEliminationReason} />
              <button type="submit" className="button secondary compact-button">
                红灯一键淘汰（{evalResult.suggestedEliminationReason}）
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </section>
  );
}
