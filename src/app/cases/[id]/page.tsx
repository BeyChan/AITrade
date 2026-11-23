import Link from "next/link";
import { notFound } from "next/navigation";
import { approveNoGoExceptionAction, updateCostModelAction } from "@/app/actions";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { CaseCalibrationPanel } from "@/components/case-calibration-panel";
import { CaseStepper } from "@/components/case-stepper";
import { EconomicsSandbox } from "@/components/economics-sandbox";
import { LogisticsCashflowPanel } from "@/components/logistics-cashflow-panel";
import { OpportunityScoreHelp } from "@/components/opportunity-score-help";
import { PrelaunchCompliancePanel } from "@/components/prelaunch-compliance-panel";
import { PageHeader, QueryNotices } from "@/components/ui";
import { getCalibrationForCase } from "@/lib/calibration-repository";
import { deriveCaseWorkflowSnapshot } from "@/lib/case-stage";
import { getAppMode } from "@/lib/app-mode";
import { money, percent, shortDate } from "@/lib/format";
import { opportunityScore, recommendationFor } from "@/lib/economics";
import { getCaseDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
};

export default async function CaseDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [detail, calibrationCtx, appMode] = await Promise.all([
    getCaseDetail(id),
    getCalibrationForCase(id).catch(() => null),
    getAppMode(),
  ]);
  if (!detail) notFound();

  const {
    productCase,
    costModel,
    hasSupplierSelection,
    quoteCount,
    validQuoteCount,
    hasApprovedContent,
    approvedMainImageCount,
    hasFlatFileExported,
    hasMediaPackExported,
    hasNoGoException,
    noGoException,
    evidence,
    auditLogs,
  } = detail;
  const result = costModel?.results;
  const score = result
    ? opportunityScore(result, productCase.monthly_sales_estimate, productCase.review_count, productCase.evidence_score)
    : 0;
  const recommendation = result ? recommendationFor(result, score) : "HOLD";
  const workflow = deriveCaseWorkflowSnapshot({
    caseId: productCase.id,
    status: productCase.status,
    recommendation,
    hasNoGoException,
    hasCostModel: Boolean(costModel),
    quoteCount,
    validQuoteCount,
    hasSupplierSelection,
    approvedMainImageCount,
    hasApprovedContent,
    hasFlatFileExported,
    hasMediaPackExported,
  });

  const assumptions = costModel?.assumptions;
  const calibrationStatus = assumptions?.calibrationMeta?.status ?? "uncalibrated";
  const calibrationLabel =
    calibrationStatus === "calibrated"
      ? "实盘已校准"
      : calibrationStatus === "partial"
        ? "部分校准"
        : "待校准";
  const riskMessages: string[] = [];
  if (result && !result.isProfitable) riskMessages.push("基准情景不盈利");
  if (result && result.stressProfitCents <= 0) riskMessages.push("压力情景亏损");
  if (result && result.marginRate < 0.18) riskMessages.push("净利率低于 18% 硬门禁");
  if (productCase.evidence_score < 50) riskMessages.push("证据完整度不足");
  if (productCase.is_demo) riskMessages.push("当前为演示数据");

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "商品案卷", href: "/cases" },
          { label: productCase.asin },
        ]}
        eyebrow={`商品案卷 · 阶段 ${workflow.stepNumber}：${workflow.name}`}
        title={productCase.title}
        meta={
          <>
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <StatusBadge status={productCase.status} />
            <span className={`badge ${workflow.badge.className}`}>{workflow.name} · {workflow.subName}</span>
            <RecommendationBadge value={workflow.tradeGate} />
            <span className={`badge ${calibrationStatus === "calibrated" ? "badge-success" : calibrationStatus === "partial" ? "status-review_pending" : "badge-neutral"}`}>
              {calibrationLabel}
            </span>
            <span className="badge badge-neutral">{productCase.category}</span>
            <span className="muted">机会分 {score} · 负责人 {productCase.owner}</span>
            <OpportunityScoreHelp />
          </>
        }
        actions={
          <>
            {workflow.primaryAction.kind === "download" ? (
              <a href={workflow.primaryAction.href} className="button primary" download>
                {workflow.primaryAction.label}
              </a>
            ) : (
              <Link href={workflow.primaryAction.href} className="button primary">
                {workflow.primaryAction.label}
              </Link>
            )}
            <Link href={`/cases/${productCase.id}/report`} className="button secondary">决策战报</Link>
            <Link href="/ai-sourcing" className="button secondary">查看选品证据</Link>
            <details className="header-export-menu">
              <summary className="button secondary">更多 ▾</summary>
              <div className="header-export-popover">
                <Link href={`/studio?tab=image&caseId=${encodeURIComponent(productCase.id)}`}>去视觉工坊</Link>
                {workflow.permissions.canExportDeliveryPack ? (
                  <>
                    <a href={`/api/cases/${productCase.id}/flatfile`} download>导出 Flat File (TSV)</a>
                    <a href={`/api/cases/${productCase.id}/media-pack`} download>打包素材 ZIP</a>
                  </>
                ) : null}
                {productCase.url ? <a href={productCase.url} target="_blank" rel="noreferrer">打开原商品页 ↗</a> : null}
              </div>
            </details>
          </>
        }
      />

      <CaseStepper
        caseId={productCase.id}
        status={productCase.status}
        recommendation={recommendation}
        hasNoGoException={hasNoGoException}
        hasCostModel={Boolean(costModel)}
        quoteCount={quoteCount}
        validQuoteCount={validQuoteCount}
        hasSupplierSelection={hasSupplierSelection}
        approvedMainImageCount={approvedMainImageCount}
        hasApprovedContent={hasApprovedContent}
        hasFlatFileExported={hasFlatFileExported}
        hasMediaPackExported={hasMediaPackExported}
        allowDemoBypass={appMode === "sandbox" || productCase.is_demo}
      />

      <QueryNotices notice={query.notice} error={query.error} />

      {workflow.tradeGate === "NO-GO" ? (
        <div className="notice warn">
          <span className="badge recommendation-no-go">NO-GO</span>
          <span><strong>贸易门禁已拦截：</strong> {workflow.blocker}</span>
        </div>
      ) : riskMessages.length ? (
        <div className="notice warn">
          <span className="badge status-review_pending">RISK</span>
          <span><strong>需要关注：</strong> {riskMessages.join("；")}。</span>
        </div>
      ) : (
        <div className="notice">
          <span className="badge badge-success">CHECK</span>
          <span><strong>基础门槛通过：</strong> 基准与压力情景均为正，请按当前阶段推进实证报价与定标。</span>
        </div>
      )}

      <div className="detail-grid">
        <div className="stack">
          <section className="section">
            <div className="section-header">
              <div>
                <h2>单位经济模型</h2>
                <p>{costModel ? `版本 v${costModel.version} · 更新于 ${shortDate(costModel.created_at)}` : "尚未创建成本模型"}</p>
              </div>
              {result ? (
                <span className={`badge ${result.isProfitable ? "badge-success" : "badge-danger"}`}>
                  {result.isProfitable ? "基准盈利" : "基准亏损"}
                </span>
              ) : null}
            </div>

            {result && assumptions ? (
              <>
                <div className="metric-pairs" style={{ marginBottom: 20 }}>
                  <div className="metric-pair"><small>预计售价</small><strong>{money(assumptions.salePriceCents)}</strong></div>
                  <div className="metric-pair"><small>单件净利</small><strong>{money(result.netProfitCents)}</strong></div>
                  <div className="metric-pair"><small>净利率</small><strong>{percent(result.marginRate)}</strong></div>
                  <div className="metric-pair"><small>压力情景净利</small><strong>{money(result.stressProfitCents)}</strong></div>
                  <div className="metric-pair"><small>广告盈亏平衡点</small><strong>{percent(result.breakEvenAdRate)}</strong></div>
                  <div className="metric-pair"><small>投入产出比 ROI</small><strong>{percent(result.roiRate)}</strong></div>
                </div>

                <div className="breakdown">
                  <div className="breakdown-row"><span>扣除退货后的净收入</span><strong>{money(result.netRevenueCents)}</strong></div>
                  <div className="breakdown-row"><span>采购与落地成本</span><strong>−{money(result.landedCostCents)}</strong></div>
                  <div className="breakdown-row"><span>FBA / 履约费用</span><strong>−{money(result.fbaFeeCents)}</strong></div>
                  <div className="breakdown-row"><span>平台佣金</span><strong>−{money(result.referralFeeCents)}</strong></div>
                  <div className="breakdown-row"><span>广告成本</span><strong>−{money(result.adCostCents)}</strong></div>
                  <div className="breakdown-row"><span>退货损失</span><strong>−{money(result.returnLossCents)}</strong></div>
                  <div className="breakdown-row"><span>Coupon</span><strong>−{money(result.couponCents)}</strong></div>
                  <div className="breakdown-row"><span>仓储与其他</span><strong>−{money(result.storageCents + result.otherCostCents)}</strong></div>
                  <div className="breakdown-row"><span>预计单件净利</span><strong>{money(result.netProfitCents)}</strong></div>
                </div>
              </>
            ) : (
              <p className="muted">请先补充成本参数。</p>
            )}
          </section>

          {calibrationCtx ? (
            <CaseCalibrationPanel
              caseId={productCase.id}
              currency={productCase.currency || assumptions?.currency || "USD"}
              currentCalibrationStatus={calibrationStatus}
              currentCalibrationScope={assumptions?.calibrationMeta?.scope}
              suggestion={calibrationCtx.suggestion}
              preview={calibrationCtx.preview}
            />
          ) : null}

          {assumptions ? (
            <EconomicsSandbox
              assumptions={assumptions}
              monthlySalesEstimate={productCase.monthly_sales_estimate}
              reviewCount={productCase.review_count}
              evidenceScore={productCase.evidence_score}
              currency={productCase.currency || assumptions.currency || "USD"}
            />
          ) : null}

          {assumptions && result ? (
            <LogisticsCashflowPanel
              marketCode={productCase.marketplace || "US"}
              currency={productCase.currency || assumptions.currency || "USD"}
              salePriceCents={assumptions.salePriceCents}
              landedCostCents={assumptions.landedCostCents}
              steadyNetProfitCents={result.netProfitCents}
              monthlySalesEstimate={productCase.monthly_sales_estimate}
            />
          ) : null}

          <PrelaunchCompliancePanel
            marketCode={productCase.marketplace || "US"}
            productTitle={productCase.title}
            category={productCase.category}
          />

          <section id="cost-assumptions" className="section">
            <div className="section-header">
              <div>
                <h2>成本假设</h2>
                <p>修改参数会生成新版本，不会覆盖历史记录。金额单位为 {productCase.currency || "USD"}，比率为百分比。</p>
              </div>
            </div>
            <form action={updateCostModelAction} className="form-grid">
              <input type="hidden" name="caseId" value={productCase.id} />
              <div className="field"><label htmlFor="salePrice">售价</label><input id="salePrice" name="salePrice" type="number" min="0.01" step="0.01" defaultValue={assumptions ? (assumptions.salePriceCents / 100).toFixed(2) : "0"} required /></div>
              <div className="field"><label htmlFor="landedCost">采购与落地成本</label><input id="landedCost" name="landedCost" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.landedCostCents / 100).toFixed(2) : "0"} required /></div>
              <div className="field"><label htmlFor="fbaFee">FBA / 履约费</label><input id="fbaFee" name="fbaFee" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.fbaFeeCents / 100).toFixed(2) : "0"} required /></div>
              <div className="field"><label htmlFor="referralRate">平台佣金率 %</label><input id="referralRate" name="referralRate" type="number" min="0" max="100" step="0.1" defaultValue={assumptions ? (assumptions.referralRate * 100).toFixed(1) : "15"} required /></div>
              <div className="field"><label htmlFor="adRate">广告占比 %</label><input id="adRate" name="adRate" type="number" min="0" max="100" step="0.1" defaultValue={assumptions ? (assumptions.adRate * 100).toFixed(1) : "12"} required /></div>
              <div className="field"><label htmlFor="returnRate">退货率 %</label><input id="returnRate" name="returnRate" type="number" min="0" max="100" step="0.1" defaultValue={assumptions ? (assumptions.returnRate * 100).toFixed(1) : "5"} required /></div>
              <div className="field"><label htmlFor="returnProcessing">退货处理费</label><input id="returnProcessing" name="returnProcessing" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.returnProcessingCents / 100).toFixed(2) : "3.00"} required /></div>
              <div className="field"><label htmlFor="returnRecoveryRate">退货残值率 %</label><input id="returnRecoveryRate" name="returnRecoveryRate" type="number" min="0" max="100" step="0.1" defaultValue={assumptions ? (assumptions.returnRecoveryRate * 100).toFixed(1) : "30"} required /></div>
              <div className="field"><label htmlFor="coupon">Coupon 金额</label><input id="coupon" name="coupon" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.couponCents / 100).toFixed(2) : "0.00"} required /></div>
              <div className="field"><label htmlFor="storageCost">仓储费</label><input id="storageCost" name="storageCost" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.storageCents / 100).toFixed(2) : "0.45"} required /></div>
              <div className="field"><label htmlFor="otherCost">其他成本</label><input id="otherCost" name="otherCost" type="number" min="0" step="0.01" defaultValue={assumptions ? (assumptions.otherCostCents / 100).toFixed(2) : "0.50"} required /></div>
              <div className="field"><label htmlFor="actor">修改人</label><input id="actor" name="actor" type="text" defaultValue="运营人员" required /></div>
              <div className="field full"><button className="button secondary" type="submit">保存新成本版本并重新计算</button></div>
            </form>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>证据包</h2>
                <p>每条证据必须保留来源类型和置信度。当前版本暂不联网采集，导入商品的证据为空。</p>
              </div>
              <span className="badge badge-neutral">完整度 {productCase.evidence_score}%</span>
            </div>
            {evidence.length ? (
              <div className="evidence-list">
                {evidence.map((item) => (
                  <article className="evidence-item" key={item.id}>
                    <div className="evidence-top">
                      <strong>{item.title}</strong>
                      <div className="pill-list">
                        <span className="info-pill">{item.source_type === "demo" ? "演示证据" : item.source_type}</span>
                        <span className="info-pill">置信度 {percent(Number(item.confidence), 0)}</span>
                      </div>
                    </div>
                    <p>{item.summary}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding: "28px 16px" }}>
                <h3>暂无明细证据条目</h3>
                <p>
                  {productCase.evidence_score > 0
                    ? `当前 ${productCase.evidence_score}% 为立项导入时的基础完整度评分；如需进一步提升可信度，可通过 Chrome 扩展补采竞品评论与真实售价。`
                    : "可通过 Chrome 扩展补采竞品评论、关键词与真实售价，每条结论会绑定来源和抓取时间。"}
                </p>
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="section" aria-label="当前阶段上下文">
            <div className="section-header">
              <div>
                <div className="eyebrow">当前阶段上下文</div>
                <h2>阶段 {workflow.stepNumber} · {workflow.name}</h2>
              </div>
              <RecommendationBadge value={workflow.tradeGate} />
            </div>

            <div className="breakdown">
              <div className="breakdown-row">
                <span>案卷状态</span>
                <strong>{workflow.caseLifecycleLabel}</strong>
              </div>
              <div className="breakdown-row">
                <span>当前卡点</span>
                <strong style={{ textAlign: "right", maxWidth: "65%" }}>{workflow.blocker ?? "无卡点"}</strong>
              </div>
              <div className="breakdown-row">
                <span>真实报价数</span>
                <strong>{quoteCount > 0 ? `${quoteCount} 家（有效 ${validQuoteCount} 家）` : "0 家"}</strong>
              </div>
              <div className="breakdown-row">
                <span>人工定标</span>
                <strong>{hasSupplierSelection ? "已定标" : "未定标"}</strong>
              </div>
              <div className="breakdown-row">
                <span>内容终审</span>
                <strong>{hasApprovedContent ? "已通过终审" : "未终审"}</strong>
              </div>
              <div className="breakdown-row">
                <span>交付资料</span>
                <strong>{workflow.deliveryLabel}</strong>
              </div>
            </div>

            {noGoException ? (
              <div className="notice" style={{ marginTop: 12 }}>
                <span className="badge status-review_pending">例外依据</span>
                <span>
                  审批人：{noGoException.approver}；原因：{noGoException.reason}；风险：{noGoException.riskNote}
                </span>
              </div>
            ) : null}
          </section>

          {workflow.tradeGate === "NO-GO" ? (
            <section id="gate-exception" className="section">
              <div className="section-header">
                <div>
                  <h2>NO-GO 例外审批</h2>
                  <p>当前门禁为 NO-GO，普通报价与定标已停止。如因战略或渠道原因需例外推进，请填写风险说明并留存审计。</p>
                </div>
              </div>
              <form action={approveNoGoExceptionAction} className="stack">
                <input type="hidden" name="caseId" value={productCase.id} />
                <input type="hidden" name="returnPath" value={`/cases/${productCase.id}`} />
                <div className="field">
                  <label htmlFor="exceptionReason">例外原因 *</label>
                  <input id="exceptionReason" name="reason" type="text" placeholder="例：老厂可降本 25%，先拿样核价" required />
                </div>
                <div className="field">
                  <label htmlFor="exceptionRiskNote">风险说明与应对 *</label>
                  <textarea id="exceptionRiskNote" name="riskNote" placeholder="说明亏损边界与止损条件" required />
                </div>
                <div className="field">
                  <label htmlFor="exceptionApprover">审批人 *</label>
                  <input id="exceptionApprover" name="approver" type="text" placeholder="输入审批负责人姓名" required />
                </div>
                <button className="button secondary" type="submit">记录 NO-GO 例外审批并放行</button>
              </form>
            </section>
          ) : null}

          <section className="section">
            <div className="section-header">
              <div>
                <h2>审计时间线</h2>
                <p>只记录关键状态、例外审批、成本变化与交付导出。</p>
              </div>
            </div>
            <div className="timeline">
              {auditLogs.length ? auditLogs.map((log) => (
                <div className="timeline-item" key={log.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="timeline-title">{auditLabel(log.action)}</div>
                    <div className="timeline-meta">{log.actor} · {shortDate(log.created_at)}</div>
                  </div>
                </div>
              )) : <p className="muted">暂无审计记录。</p>}
            </div>
          </section>

          <section className="section">
            <h3>数据口径</h3>
            <p className="muted" style={{ fontSize: 12 }}>净收入 =（售价 − Coupon）×（1 − 退货率）。采购、FBA、佣金、广告、退货损失、仓储和其他成本均按订单单位计入。</p>
            <p className="muted" style={{ fontSize: 12 }}>压力情景：售价 −10%、采购成本 +20%、广告 +20%、退货率 +2 个百分点。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "case.seeded": "创建演示商品",
    "case.imported": "导入候选品并生成成本模型",
    "case.created_from_wizard": "通过选品向导创建案卷",
    "case.exception_created": "记录 NO-GO 例外审批",
    "case.media_pack_exported": "导出上架素材包 (ZIP)",
    "case.flat_file_exported": "导出 Flat File (TSV)",
    "case.flatfile_exported": "导出 Flat File (TSV)",
    "cost_model.created": "保存新的成本模型版本",
    "case.approved": "已进入正式推进（历史记录）",
    "case.rejected": "已归档历史商品记录",
  };
  return labels[action] ?? action;
}
