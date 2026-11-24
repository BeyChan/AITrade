import Link from "next/link";
import { attachComparisonReportAction, eliminateHypothesisAction } from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { moneyIn, shortDate } from "@/lib/format";
import type { FastScreenEvaluation, EliminationMatchAlert } from "@/lib/sourcing-funnel";

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

export function CompetitorMarketStage({
  runId,
  marketCode,
  platformCode,
  platformName,
  currency,
  searchUrl,
  hypothesis,
  recentReports,
  attachedReport,
  evalResult,
  eliminationAlerts,
}: {
  runId: string;
  marketCode: string;
  platformCode: string;
  platformName: string;
  currency: string;
  searchUrl: string;
  hypothesis: AISourcingHypothesisDetail;
  recentReports: CompetitorComparisonReport[];
  attachedReport: CompetitorComparisonReport | null;
  evalResult: FastScreenEvaluation;
  eliminationAlerts: EliminationMatchAlert[];
}) {
  const competitorParams = new URLSearchParams({
    market: marketCode,
    platform: platformCode,
    returnRunId: runId,
    returnHypothesisId: hypothesis.id,
    returnTab: "hypotheses",
  });
  if (attachedReport) competitorParams.set("id", attachedReport.id);

  return (
    <section className="funnel-fast-screen" aria-label="第 1 步 竞品研报">
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

      <div className="funnel-fast-card" id={`stage-market-${hypothesis.id}`}>
        <div className="funnel-fast-head">
          <div>
            <span className="eyebrow">01 · 竞品研报</span>
            <h3>价格带与市场竞争度</h3>
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
              {evalResult.p50PriceCents ? moneyIn(currency, evalResult.p50PriceCents) : "待扫"}
            </strong>
          </span>
          {evalResult.hhi !== null ? <span>HHI <strong>{evalResult.hhi}</strong></span> : null}
          {evalResult.medianReviews !== null ? (
            <span>中位评 <strong>{evalResult.medianReviews.toLocaleString()}</strong></span>
          ) : null}
        </div>

        <div className="funnel-fast-actions" style={{ flexWrap: "wrap", gap: "8px" }}>
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="button secondary compact-button"
          >
            去 {platformName} 抓 Top 20 ↗
          </a>
          <Link
            href={`/competitors?${competitorParams.toString()}`}
            className={`button ${attachedReport ? "ghost" : "primary"} compact-button`}
          >
            {attachedReport ? "查看已绑定研报" : "为当前候选补研报"}
          </Link>
        </div>

        {recentReports.length > 0 ? (
          <form action={attachComparisonReportAction} className="funnel-attach-form">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
            <select
              name="reportId"
              defaultValue={attachedReport?.id ?? recentReports[0]?.id ?? ""}
              aria-label="选择扩展扫描的竞品研报"
            >
              {recentReports.slice(0, 12).map((rep) => (
                <option key={rep.id} value={rep.id}>
                  {rep.title.slice(0, 32)} ({rep.competitors.length}款 · {shortDate(rep.createdAt)})
                </option>
              ))}
            </select>
            <button type="submit" className="button primary compact-button">
              一键导入研报数据
            </button>
          </form>
        ) : null}

        {evalResult.marketStatus === "fail" && !hypothesis.eliminatedAt && evalResult.suggestedEliminationReason ? (
          <form action={eliminateHypothesisAction} className="funnel-fast-actions">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
            <input type="hidden" name="reason" value={evalResult.suggestedEliminationReason} />
            <button type="submit" className="button secondary compact-button">
              市场红灯 · 一键淘汰（{evalResult.suggestedEliminationReason}）
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
