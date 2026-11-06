import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupplierQuoteAction, selectSupplierQuoteAction } from "@/app/actions";
import { StatusBadge } from "@/components/badges";
import { money, percent, shortDate } from "@/lib/format";
import { getSourcingDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function SourcingDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getSourcingDetail(id);
  if (!detail) notFound();

  const { productCase, costModel, quotes, scoredQuotes, selection, auditLogs } = detail;
  const selectedQuote = quotes.find((quote) => quote.id === selection?.quote_id) ?? null;
  const selectedScore = scoredQuotes.find((quote) => quote.id === selection?.quote_id) ?? null;
  const preferred = scoredQuotes.find((quote) => quote.isPreferred) ?? null;
  const canSource = productCase.status === "approved";
  const eligibleCount = scoredQuotes.filter((quote) => quote.isEligible).length;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/">AI 选品</Link> / <Link href={`/cases/${productCase.id}`}>{productCase.asin}</Link> / 供应商询价
      </div>

      <div className="title-row">
        <div>
          <h1>{productCase.title}</h1>
          <div className="title-meta">
            <StatusBadge status={productCase.status} />
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <span className="badge badge-neutral">{productCase.category}</span>
            <span className="muted">到岸成本 = 采购价 + 单件运费 + 关税</span>
          </div>
        </div>
        <div className="button-row">
          <Link href={`/cases/${productCase.id}`} className="button secondary">商品与成本详情</Link>
          <Link href="/sourcing" className="button ghost">返回询价看板</Link>
        </div>
      </div>

      {query.error ? (
        <div className="notice warn"><span className="badge badge-danger">ERROR</span><span>{query.error}</span></div>
      ) : null}
      {query.notice ? (
        <div className="notice"><span className="badge badge-success">DONE</span><span>{query.notice}</span></div>
      ) : null}
      {productCase.is_demo ? (
        <div className="notice">
          <span className="badge demo-badge">DEMO</span>
          <span>当前商品为演示数据。录入的供应商和报价仍应明确标注为测试数据，不得据此下单或对外报价。</span>
        </div>
      ) : null}
      {!canSource ? (
        <div className="notice warn"><span className="badge status-review_pending">LOCKED</span><span>只有状态为“已立项”的商品可以录入报价或定标。</span></div>
      ) : null}

      <section className="metrics-grid sourcing-summary-grid">
        <article className="metric-card">
          <div className="metric-label">当前到岸成本</div>
          <div className="metric-value">{costModel ? money(costModel.assumptions.landedCostCents) : "—"}</div>
          <div className="metric-note">{costModel ? `成本模型 v${costModel.version}` : "缺少成本模型"}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">有效报价</div>
          <div className="metric-value">{eligibleCount} / {quotes.length}</div>
          <div className="metric-note">压力盈利且质量分 ≥ 50</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">当前推荐到岸</div>
          <div className="metric-value">{preferred ? money(preferred.landedCostCents) : "—"}</div>
          <div className="metric-note">{preferred ? `综合分 ${preferred.score}` : "等待有效报价"}</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">定标状态</div>
          <div className="metric-value" style={{ fontSize: 22 }}>{selection ? "已人工选定" : "待人工决定"}</div>
          <div className="metric-note">{selection ? `成本已更新至 v${costModel?.version}` : "系统不会自动定标"}</div>
        </article>
      </section>

      {selection && selectedQuote ? (
        <section className="selection-result">
          <div>
            <div className="eyebrow" style={{ color: "var(--lime)" }}>已记录定标</div>
            <h2>{selectedQuote.supplier.name}</h2>
            <p>
              人工定标完成。报价到岸成本 {money(selectedScore?.landedCostCents ?? 0)} 已写入新的成本模型，
              预计单件净利 {costModel ? money(costModel.results.netProfitCents) : "—"}，
              压力情景净利 {costModel ? money(costModel.results.stressProfitCents) : "—"}。
            </p>
            {selection.exception_reason ? <p><strong>定标说明：</strong>{selection.exception_reason}</p> : null}
          </div>
          <div className="selection-result-meta">
            <span>定标人</span><strong>{selection.selected_by}</strong>
            <span>综合分</span><strong>{selectedScore?.score ?? "—"}</strong>
            <span>成本版本</span><strong>v{costModel?.version ?? "—"}</strong>
            <span>定标时间</span><strong>{shortDate(selection.created_at)}</strong>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-header">
          <div>
            <h2>报价对比</h2>
            <p>成本 45% · 质量 25% · 交期 15% · MOQ 10% · 商业条件 5%。系统推荐不等于最终定标。</p>
          </div>
          <span className="badge badge-neutral">{quotes.length} 家供应商</span>
        </div>

        {quotes.length === 0 ? (
          <div className="empty-state" style={{ padding: "42px 18px" }}>
            <h3>还没有供应商报价</h3>
            <p>在下方录入至少 1 家报价；建议用真实询价结果完成 3 家对比后再定标。</p>
          </div>
        ) : (
          <div className="quote-grid">
            {scoredQuotes.map((score, index) => {
              const quote = quotes.find((item) => item.id === score.id);
              if (!quote) return null;
              const isSelected = selection?.quote_id === quote.id;
              return (
                <article className={`quote-card ${score.isPreferred ? "preferred" : ""} ${isSelected ? "selected" : ""}`} key={quote.id}>
                  <div className="quote-card-top">
                    <div>
                      <div className="quote-rank">#{index + 1}</div>
                      <h3>{quote.supplier.name}</h3>
                      <div className="product-meta">
                        <span>{quote.supplier.platform}</span>
                        {quote.supplier.country ? <span>{quote.supplier.country}</span> : null}
                        {quote.supplier.contact ? <span>{quote.supplier.contact}</span> : null}
                      </div>
                    </div>
                    <div className="quote-score">
                      <strong>{score.score}</strong>
                      <span>综合分</span>
                    </div>
                  </div>

                  <div className="pill-list" style={{ marginBottom: 14 }}>
                    {isSelected ? <span className="badge badge-success">已选定</span> : null}
                    {score.isPreferred ? <span className="badge recommendation-go">系统推荐</span> : null}
                    <span className={`badge ${score.isEligible ? "badge-success" : "badge-danger"}`}>
                      {score.isEligible ? "可定标" : "未通过门槛"}
                    </span>
                  </div>

                  <div className="quote-cost-band">
                    <div><small>到岸成本</small><strong>{money(score.landedCostCents)}</strong></div>
                    <div><small>单件净利</small><strong>{money(score.economics.netProfitCents)}</strong></div>
                    <div><small>压力净利</small><strong className={score.economics.stressProfitCents <= 0 ? "negative" : ""}>{money(score.economics.stressProfitCents)}</strong></div>
                  </div>

                  <div className="quote-facts">
                    <div><span>采购价</span><strong>{money(quote.unit_price_cents)}</strong></div>
                    <div><span>单件运费</span><strong>{money(quote.freight_per_unit_cents)}</strong></div>
                    <div><span>关税</span><strong>{percent(Number(quote.duty_rate), 1)}</strong></div>
                    <div><span>MOQ</span><strong>{quote.moq.toLocaleString("zh-CN")}</strong></div>
                    <div><span>交期</span><strong>{quote.lead_time_days ?? "—"} 天</strong></div>
                    <div><span>样品费</span><strong>{money(quote.sample_fee_cents ?? 0)}</strong></div>
                    <div><span>贸易条款</span><strong>{quote.incoterm || "未填写"}</strong></div>
                    <div><span>付款条件</span><strong>{quote.payment_terms || "未填写"}</strong></div>
                  </div>

                  <div className="score-breakdown">
                    <ScoreBar label="成本" value={score.scoreBreakdown.cost} />
                    <ScoreBar label="质量" value={score.scoreBreakdown.quality} />
                    <ScoreBar label="交期" value={score.scoreBreakdown.leadTime} />
                    <ScoreBar label="MOQ" value={score.scoreBreakdown.moq} />
                    <ScoreBar label="商业条件" value={score.scoreBreakdown.commercial} />
                  </div>

                  <div className="risk-list">
                    <strong>风险与核验项</strong>
                    {score.risks.length ? score.risks.map((risk) => <span className="risk-chip" key={risk}>{risk}</span>) : <span className="risk-chip safe">未触发硬性风险提示</span>}
                    {!quote.certifications ? <span className="risk-chip">认证信息缺失</span> : <span className="risk-chip safe">{quote.certifications}</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="sourcing-bottom-grid">
        <div className="stack">
          {!selection ? (
            <details className="section entry-panel" open={quotes.length === 0 || Boolean(query.error)}>
              <summary>
                <span>
                  <strong>＋ 新增供应商报价</strong>
                  <small>录入真实询价结果；系统只计算和比较，不自动联系供应商。</small>
                </span>
                <span className="badge badge-neutral">人工录入</span>
              </summary>
              <form action={createSupplierQuoteAction} className="stack entry-form">
                <input type="hidden" name="caseId" value={productCase.id} />
                <div className="form-section-label">供应商信息</div>
                <div className="form-grid">
                  <div className="field"><label htmlFor="supplierName">供应商名称 *</label><input id="supplierName" name="supplierName" required placeholder="例如：宁波某日用品厂" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="supplierPlatform">来源平台</label><input id="supplierPlatform" name="supplierPlatform" placeholder="1688 / Alibaba / 展会 / 人工" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="country">国家或地区</label><input id="country" name="country" placeholder="CN" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="contact">联系人 / 联系方式</label><input id="contact" name="contact" placeholder="姓名、微信或邮箱" disabled={!canSource} /></div>
                  <div className="field full"><label htmlFor="supplierUrl">供应商链接</label><input id="supplierUrl" name="supplierUrl" type="url" placeholder="https://..." disabled={!canSource} /></div>
                  <div className="field full"><label htmlFor="supplierNotes">核验记录</label><textarea id="supplierNotes" name="supplierNotes" placeholder="工厂类型、验厂情况、样品照片、沟通结论等" disabled={!canSource} /></div>
                </div>

                <div className="form-section-label">报价与履约条件</div>
                <div className="form-grid">
                  <div className="field"><label htmlFor="unitPrice">采购单价 USD *</label><input id="unitPrice" name="unitPrice" inputMode="decimal" placeholder="4.80" required disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="freightPerUnit">单件运费 USD *</label><input id="freightPerUnit" name="freightPerUnit" inputMode="decimal" defaultValue="0" required disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="dutyRate">关税率 %</label><input id="dutyRate" name="dutyRate" inputMode="decimal" defaultValue="0" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="qualityScore">质量评分 0–100 *</label><input id="qualityScore" name="qualityScore" inputMode="numeric" defaultValue="60" required disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="moq">MOQ *</label><input id="moq" name="moq" inputMode="numeric" defaultValue="500" required disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="leadTimeDays">交期（天）*</label><input id="leadTimeDays" name="leadTimeDays" inputMode="numeric" defaultValue="30" required disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="sampleFee">样品费 USD</label><input id="sampleFee" name="sampleFee" inputMode="decimal" defaultValue="0" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="incoterm">贸易条款</label><input id="incoterm" name="incoterm" placeholder="FOB / EXW / DDP" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="paymentTerms">付款条件</label><input id="paymentTerms" name="paymentTerms" placeholder="30% 定金 / 70% 发货前" disabled={!canSource} /></div>
                  <div className="field"><label htmlFor="certifications">认证信息</label><input id="certifications" name="certifications" placeholder="CE, RoHS, FDA…" disabled={!canSource} /></div>
                  <div className="field full"><label htmlFor="actor">录入人</label><input id="actor" name="actor" defaultValue="采购人员" disabled={!canSource} /></div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="submit" disabled={!canSource}>保存报价并加入对比</button>
                  <span className="help">单价和运费均为单件 USD；关税率按“采购价 + 运费”计征。</span>
                </div>
              </form>
            </details>
          ) : null}

          <section className="section">
            <div className="section-header">
              <div>
                <h2>询价与定标审计</h2>
                <p>记录谁在何时录入了什么报价、为什么定标，以及成本模型从哪个版本更新。</p>
              </div>
            </div>
            <div className="timeline">
              {auditLogs.length ? auditLogs.map((log) => (
                <div className="timeline-item" key={log.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="timeline-title">{auditLabel(log.action)}</div>
                    <div className="timeline-meta">{log.actor} · {shortDate(log.created_at)} {auditSummary(log.action, log.details)}</div>
                  </div>
                </div>
              )) : <p className="muted">暂无审计记录。</p>}
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="action-card">
            <div className="eyebrow" style={{ color: "var(--lime)" }}>人工决策</div>
            <h2>{selection ? "定标已完成" : "人工选定供应商"}</h2>
            {selection && selectedQuote ? (
              <>
                <p>已选定 <strong>{selectedQuote.supplier.name}</strong>。报价到岸成本已写入成本模型 v{costModel?.version}。</p>
                <div className="selection-side-meta">
                  <span>定标人</span><strong>{selection.selected_by}</strong>
                  <span>综合分</span><strong>{selectedScore?.score ?? "—"}</strong>
                  <span>单件净利</span><strong>{costModel ? money(costModel.results.netProfitCents) : "—"}</strong>
                  <span>压力净利</span><strong>{costModel ? money(costModel.results.stressProfitCents) : "—"}</strong>
                </div>
                <div className="button-row" style={{ marginTop: 16 }}>
                  <Link href={`/cases/${productCase.id}/content`} className="button primary">进入内容工作台 →</Link>
                  <Link href={`/cases/${productCase.id}`} className="button ghost">查看成本模型</Link>
                </div>
              </>
            ) : (
              <>
                <p>系统推荐只是排序建议。确认后会创建新的成本模型版本，但不会自动下单、付款或联系供应商。</p>
                <form action={selectSupplierQuoteAction} className="stack">
                  <input type="hidden" name="caseId" value={productCase.id} />
                  <div className="field">
                    <label htmlFor="quoteId">选择报价</label>
                    <select id="quoteId" name="quoteId" required disabled={!canSource || eligibleCount === 0}>
                      <option value="">请选择通过门槛的报价</option>
                      {scoredQuotes.map((quote) => {
                        const supplier = quotes.find((item) => item.id === quote.id)?.supplier.name ?? "未知供应商";
                        return (
                          <option key={quote.id} value={quote.id} disabled={!quote.isEligible}>
                            {supplier} · {quote.score} 分 · {money(quote.landedCostCents)}
                            {quote.isEligible ? "" : " · 未通过门槛"}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reviewer">定标人</label>
                    <input id="reviewer" name="reviewer" required placeholder="输入姓名" disabled={!canSource} />
                  </div>
                  <div className="field">
                    <label htmlFor="exceptionReason">定标说明（少于 3 家有效报价时必填）</label>
                    <textarea
                      id="exceptionReason"
                      name="exceptionReason"
                      placeholder={eligibleCount < 3 ? `当前仅 ${eligibleCount} 家有效报价，必须说明例外原因` : "可选：记录定标依据或为何不选系统推荐方案"}
                      required={eligibleCount < 3}
                      disabled={!canSource}
                    />
                  </div>
                  {eligibleCount < 3 ? (
                    <div className="action-warning">当前仅有 {eligibleCount} 家有效报价。可继续定标，但必须记录例外原因。</div>
                  ) : null}
                  <button className="button primary" type="submit" disabled={!canSource || eligibleCount === 0}>
                    确认定标并回写成本
                  </button>
                </form>
              </>
            )}
          </section>

          <section className="section">
            <h3>评分口径</h3>
            <div className="breakdown">
              <div className="breakdown-row"><span>成本</span><strong>45%</strong></div>
              <div className="breakdown-row"><span>质量评分</span><strong>25%</strong></div>
              <div className="breakdown-row"><span>交期</span><strong>15%</strong></div>
              <div className="breakdown-row"><span>MOQ</span><strong>10%</strong></div>
              <div className="breakdown-row"><span>样品费与认证</span><strong>5%</strong></div>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
              入选门槛为压力情景净利 &gt; 0 且质量评分 ≥ 50。风险提示不会自动覆盖人工判断，但会进入定标审计。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mini-score">
      <span>{label}</span>
      <span className="mini-score-track"><span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>
      <strong>{value}</strong>
    </div>
  );
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "case.seeded": "创建演示商品",
    "case.imported": "导入候选品并生成成本模型",
    "cost_model.created": "保存新的成本模型版本",
    "case.approved": "确认商品立项",
    "case.rejected": "否决商品立项",
    "supplier.created": "创建供应商记录",
    "rfq.created": "创建询价记录",
    "quote.created": "录入供应商报价",
    "supplier.selected": "人工选定供应商并回写成本",
  };
  return labels[action] ?? action;
}

function auditSummary(action: string, details: Record<string, unknown>) {
  if (action === "supplier.created") return details.supplierName ? `· ${String(details.supplierName)}` : "";
  if (action === "quote.created") {
    const price = Number(details.unitPriceCents ?? 0) / 100;
    return price ? `· $${price.toFixed(2)}` : "";
  }
  if (action === "supplier.selected") {
    return details.supplierName ? `· ${String(details.supplierName)} · 成本 v${String(details.costModelVersion ?? "—")}` : "";
  }
  if (action === "cost_model.created" && details.version) return `· v${String(details.version)}`;
  return "";
}
