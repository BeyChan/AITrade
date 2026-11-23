import Link from "next/link";
import { eliminateHypothesisAction, saveHypothesisProfitCheckAction } from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import { moneyIn } from "@/lib/format";
import type { FastScreenEvaluation } from "@/lib/sourcing-funnel";

function statusToneClass(status: "pass" | "hold" | "fail" | "pending") {
  if (status === "pass") return "badge-success";
  if (status === "fail") return "badge-danger";
  if (status === "hold") return "status-review_pending";
  return "badge-neutral";
}

function statusLabel(status: "pass" | "hold" | "fail" | "pending") {
  if (status === "pass") return "通过 ≥18%";
  if (status === "fail") return "低于 18% 红灯";
  if (status === "hold") return "HOLD";
  return "待测算";
}

export function ProfitGateStage({
  runId,
  currency,
  hypothesis,
  evalResult,
  nextTabHref,
  nextTabLabel,
}: {
  runId: string;
  currency: string;
  hypothesis: AISourcingHypothesisDetail;
  evalResult: FastScreenEvaluation;
  nextTabHref?: string;
  nextTabLabel?: string;
}) {
  return (
    <section className="funnel-fast-card" id={`stage-profit-${hypothesis.id}`} aria-label="第 2 步 利润测算">
      <div className="funnel-fast-head">
        <div>
          <span className="eyebrow">02 · 利润测算</span>
          <h3>18% 毛利硬门禁与拿货上限</h3>
        </div>
        <span className={`badge ${statusToneClass(evalResult.profitStatus)}`}>
          {statusLabel(evalResult.profitStatus)}
        </span>
      </div>

      <p className="funnel-fast-summary">{evalResult.profitSummary}</p>

      <div className="funnel-fast-kpis">
        <span>
          拟定售价{" "}
          <strong>
            {evalResult.p50PriceCents ? moneyIn(currency, evalResult.p50PriceCents) : "未设定"}
          </strong>
        </span>
        <span>
          1688 参考拿货价{" "}
          <strong>
            {hypothesis.referenceFactoryCostRmb ? `¥${hypothesis.referenceFactoryCostRmb}` : "未填"}
          </strong>
        </span>
        {evalResult.maxFactoryRmb ? (
          <span>
            18% 拿货上限{" "}
            <strong>≤ ¥{evalResult.maxFactoryRmb}</strong>
          </span>
        ) : null}
      </div>

      <form action={saveHypothesisProfitCheckAction} className="stack" style={{ marginTop: "12px" }}>
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <input type="hidden" name="returnTab" value="profit" />

        <div className="form-grid">
          <div className="field">
            <label htmlFor={`confirmedPrice-${hypothesis.id}`}>拟定售价（{currency}，默认取竞品 P50）</label>
            <input
              id={`confirmedPrice-${hypothesis.id}`}
              name="confirmedPrice"
              type="number"
              min="0.01"
              step="0.01"
              defaultValue={
                evalResult.p50PriceCents ? (evalResult.p50PriceCents / 100).toFixed(2) : ""
              }
              placeholder="例如：32.99"
            />
          </div>

          <div className="field">
            <label htmlFor={`refCost-${hypothesis.id}`}>1688 参考拿货价（RMB ¥）</label>
            <input
              id={`refCost-${hypothesis.id}`}
              name="referenceFactoryCostRmb"
              type="number"
              min="0.1"
              step="0.1"
              defaultValue={hypothesis.referenceFactoryCostRmb ?? ""}
              placeholder={
                evalResult.maxFactoryRmb
                  ? `建议 ≤ ¥${evalResult.maxFactoryRmb}`
                  : "例如：28"
              }
            />
          </div>
        </div>

        <div className="funnel-step-footer" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
          <div className="button-row">
            <button type="submit" className="button primary compact-button">
              保存并重算 18% 门禁
            </button>
            {evalResult.profitStatus === "fail" && !hypothesis.eliminatedAt && evalResult.suggestedEliminationReason ? (
              <button
                type="submit"
                formAction={eliminateHypothesisAction}
                name="reason"
                value={evalResult.suggestedEliminationReason}
                className="button secondary compact-button"
              >
                利润红灯 · 一键淘汰
              </button>
            ) : null}
          </div>

          {nextTabHref && nextTabLabel ? (
            <Link href={nextTabHref} className="button secondary compact-button">
              {nextTabLabel}
            </Link>
          ) : null}
        </div>
      </form>
    </section>
  );
}
