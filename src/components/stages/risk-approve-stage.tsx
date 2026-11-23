import Link from "next/link";
import { promoteHypothesisAction, saveHypothesisProfitCheckAction } from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";
import type { FastScreenEvaluation } from "@/lib/sourcing-funnel";

export function RiskApproveStage({
  runId,
  marketCode,
  hypothesis,
  evalResult,
}: {
  runId: string;
  marketCode: string;
  hypothesis: AISourcingHypothesisDetail;
  evalResult: FastScreenEvaluation;
}) {
  const decision = hypothesis.decision;
  const isGo = decision?.decision === "GO";
  const hasPrice = Boolean(
    hypothesis.confirmedPriceCents || hypothesis.recommendedPriceCents > 0,
  );

  return (
    <div className="stack">
      {/* 1. 商品合规红线属性勾选（统一归口到第 4 步，不再散落在前几步） */}
      <section className="funnel-fast-card" aria-label="商品合规属性红线">
        <div className="funnel-fast-head">
          <div>
            <span className="eyebrow">04 · 合规红线排查</span>
            <h3>勾选商品属性，快速排查 {marketCode} 站强制认证雷区</h3>
          </div>
          <span
            className={`badge ${
              evalResult.complianceStatus === "pass"
                ? "badge-success"
                : evalResult.complianceStatus === "fail"
                  ? "badge-danger"
                  : "status-review_pending"
            }`}
          >
            {evalResult.complianceStatus === "pass"
              ? "低风险"
              : evalResult.complianceStatus === "fail"
                ? "高危红线"
                : "需认证"}
          </span>
        </div>

        <p className="funnel-fast-summary">{evalResult.complianceSummary}</p>

        <form action={saveHypothesisProfitCheckAction} className="stack" style={{ marginTop: "10px" }}>
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
          <input type="hidden" name="returnTab" value="decision" />
          <input type="hidden" name="updateCompliance" value="1" />

          <div className="funnel-compliance-pills">
            {COMPLIANCE_ATTRIBUTE_OPTIONS.map((opt) => (
              <label key={opt.id} className="funnel-compliance-pill" title={opt.hint}>
                <input
                  type="checkbox"
                  name="complianceAttr"
                  value={opt.id}
                  defaultChecked={(hypothesis.complianceAttrs as ProductComplianceAttribute[]).includes(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          <div className="form-actions" style={{ justifyContent: "flex-start" }}>
            <button type="submit" className="button secondary compact-button">
              保存合规属性排查
            </button>
          </div>
        </form>
      </section>

      {/* 2. 全站唯一立项出口 */}
      <div className="ai-promotion-bar">
        <div>
          <strong>
            {isGo
              ? "全部门禁已通过，可以正式立项"
              : "门禁尚未全部通过（可补齐上方红项，或先建待验证案卷）"}
          </strong>
          <p>
            立项是选品验证与商品开发的唯一分界线；创建案卷后，报价、样品与成本数据会自动带入「我的商品」继续定标与上架。
          </p>
        </div>

        {hypothesis.productCaseId ? (
          <div className="button-row">
            <Link href={`/cases/${hypothesis.productCaseId}/sourcing`} className="button primary">
              进入商品开发（锁厂定标）→
            </Link>
            <Link href={`/cases/${hypothesis.productCaseId}`} className="button secondary">
              查看商品总览
            </Link>
          </div>
        ) : (
          <div className="button-row" style={{ flexWrap: "wrap", gap: "8px" }}>
            <form action={promoteHypothesisAction}>
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <input type="hidden" name="actor" value="运营人员" />
              <input type="hidden" name="mode" value="formal" />
              <button type="submit" className="button primary" disabled={!isGo}>
                正式立项（进入商品开发）
              </button>
            </form>

            {!isGo ? (
              <form action={promoteHypothesisAction}>
                <input type="hidden" name="runId" value={runId} />
                <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                <input type="hidden" name="actor" value="运营人员" />
                <input type="hidden" name="mode" value="provisional" />
                <button
                  type="submit"
                  className="button secondary"
                  disabled={!hasPrice || Boolean(hypothesis.eliminatedAt)}
                  title={
                    hasPrice
                      ? "尚未完成打样或门禁未全过时，可先建「待验证案卷」提前推进"
                      : "请先在第 2 步确认拟定售价"
                  }
                >
                  先建待验证案卷
                </button>
              </form>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
