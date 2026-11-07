import Link from "next/link";
import { notFound } from "next/navigation";
import { updateCostModelAction } from "@/app/actions";
import { RecommendationBadge, StatusBadge } from "@/components/badges";
import { OpportunityScoreHelp } from "@/components/opportunity-score-help";
import { money, percent, shortDate } from "@/lib/format";
import { opportunityScore, recommendationFor } from "@/lib/economics";
import { getCaseDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function CaseDetailPage({ params }: PageProps) {
  const { id } = await params;
  const detail = await getCaseDetail(id);
  if (!detail) notFound();

  const { productCase, costModel, hasSupplierSelection, evidence, auditLogs } = detail;
  const result = costModel?.results;
  const score = result
    ? opportunityScore(result, productCase.monthly_sales_estimate, productCase.review_count, productCase.evidence_score)
    : 0;
  const recommendation = result ? recommendationFor(result, score) : "HOLD";
  const assumptions = costModel?.assumptions;
  const riskMessages: string[] = [];
  if (result && !result.isProfitable) riskMessages.push("基准情景不盈利");
  if (result && result.stressProfitCents <= 0) riskMessages.push("压力情景亏损");
  if (result && result.marginRate < 0.15) riskMessages.push("净利率低于 15%");
  if (productCase.evidence_score < 50) riskMessages.push("证据完整度不足");
  if (productCase.is_demo) riskMessages.push("当前为演示数据");

  return (
    <div className="page">
      <div className="breadcrumb"><Link href="/">AI 选品</Link> / {productCase.asin}</div>

      <div className="title-row">
        <div>
          <h1>{productCase.title}</h1>
          <div className="title-meta">
            <StatusBadge status={productCase.status} />
            <RecommendationBadge value={recommendation} />
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <span className="badge badge-neutral">{productCase.category}</span>
            <span className="muted">机会分 {score} · 负责人 {productCase.owner}</span>
            <OpportunityScoreHelp />
          </div>
        </div>
        <div className="button-row">
          <Link href={`/cases/${productCase.id}/report`} className="button secondary">🖨️ 评审报告/PDF</Link>
          <a href={`/api/cases/${productCase.id}/flatfile`} className="button secondary">📥 Flat File</a>
          {hasSupplierSelection ? <Link href={`/cases/${productCase.id}/content`} className="button primary">进入内容工作台 →</Link> : null}
          {hasSupplierSelection ? <Link href={`/cases/${productCase.id}/channels`} className="button secondary">上市矩阵 →</Link> : null}
          {productCase.status === "approved" ? <Link href={`/cases/${productCase.id}/sourcing`} className={`button ${hasSupplierSelection ? "ghost" : "primary"}`}>{hasSupplierSelection ? "查看供应商定标" : "进入供应商询价 →"}</Link> : null}
          {productCase.url ? <a className="button secondary" href={productCase.url} target="_blank" rel="noreferrer">打开商品页</a> : null}
        </div>
      </div>

      {riskMessages.length ? (
        <div className="notice warn">
          <span className="badge status-review_pending">RISK</span>
          <span><strong>立项前需要关注：</strong> {riskMessages.join("；")}。</span>
        </div>
      ) : (
        <div className="notice">
          <span className="badge badge-success">CHECK</span>
          <span><strong>基础门槛通过：</strong> 基准与压力情景均为正，仍需人工核验证据和供应商真实报价。</span>
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

          <section className="section">
            <div className="section-header">
              <div>
                <h2>成本假设</h2>
                <p>修改参数会生成新版本，不会覆盖历史记录。金额单位为 USD，比率为百分比。</p>
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
              <div className="empty-state" style={{ padding: "35px 15px" }}>
                <h3>尚未采集证据</h3>
                <p>下一阶段接入评论分析、关键词和竞品调研 Worker，每条结论会绑定来源和抓取时间。</p>
              </div>
            )}
          </section>
        </div>

        <aside className="stack">
          <section className="action-card">
            <div className="eyebrow" style={{ color: "var(--lime)" }}>下一步</div>
            <h2>下一步</h2>
            <p>候选品已直接进入立项，不再经过人工确认。先补齐真实证据和供应商报价，再根据确定性门禁决定是否继续备货。</p>
            <div className="button-row">
              <Link href={`/cases/${productCase.id}/sourcing`} className="button primary">进入供应商询价 →</Link>
              <Link href="/ai-sourcing" className="button secondary">查看选品证据</Link>
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>审计时间线</h2>
                <p>只记录关键状态和成本变化。</p>
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
    "cost_model.created": "保存新的成本模型版本",
    "case.approved": "已进入商品立项（历史记录）",
    "case.rejected": "已归档历史商品记录",
  };
  return labels[action] ?? action;
}
