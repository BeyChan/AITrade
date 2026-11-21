import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupplierQuoteAction, selectSupplierQuoteAction } from "@/app/actions";
import { StatusBadge } from "@/components/badges";
import { CaseStepper } from "@/components/case-stepper";
import { money, shortDate } from "@/lib/format";
import { getSourcingDetail, listSupplierDirectory } from "@/lib/repository";
import { SupplierMatrixPk } from "@/components/supplier-matrix-pk";
import { QuoteSmartPaste } from "@/components/quote-smart-paste";
import { SourcingPracticalTools } from "@/components/sourcing-practical-tools";
import { PageHeader, QueryNotices } from "@/components/ui";
import { getDb } from "@/lib/db";
import type { SampleLogRecord, SampleLogStatus } from "@/app/api/cases/[id]/samples/route";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function SourcingDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, query, directoryData] = await Promise.all([
    params,
    searchParams,
    listSupplierDirectory().catch(() => ({ suppliers: [] })),
  ]);
  const detail = await getSourcingDetail(id);
  if (!detail) notFound();

  const initialSamples: SampleLogRecord[] = await getDb()
    .then((db) =>
      db.query<Record<string, unknown>>(
        `SELECT * FROM sourcing_sample_logs WHERE case_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
    )
    .then((res) =>
      res.rows.map((r) => ({
        id: String(r.id),
        caseId: String(r.case_id),
        supplierName: String(r.supplier_name ?? ""),
        sampleCostCny: Number(r.sample_cost_cny ?? 0),
        shippingCostCny: Number(r.shipping_cost_cny ?? 0),
        trackingNo: String(r.tracking_no ?? ""),
        status: (String(r.status || "ordered") as SampleLogStatus),
        qualityRating: r.quality_rating != null ? Number(r.quality_rating) : null,
        pros: String(r.pros ?? ""),
        defects: String(r.defects ?? ""),
        notes: String(r.notes ?? ""),
        createdBy: String(r.created_by ?? "管理员"),
        createdAt: String(r.created_at ?? ""),
        updatedAt: String(r.updated_at ?? ""),
      })),
    )
    .catch(() => []);

  const directorySuppliers = directoryData.suppliers || [];
  const { productCase, costModel, quotes, scoredQuotes, selection, auditLogs } = detail;
  const selectedQuote = quotes.find((quote) => quote.id === selection?.quote_id) ?? null;
  const selectedScore = scoredQuotes.find((quote) => quote.id === selection?.quote_id) ?? null;
  const preferred = scoredQuotes.find((quote) => quote.isPreferred) ?? null;
  const canSource = productCase.status !== "archived" && productCase.status !== "rejected";
  const eligibleCount = scoredQuotes.filter((quote) => quote.isEligible).length;

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "商品案卷", href: "/cases" },
          { label: productCase.asin, href: `/cases/${productCase.id}` },
          { label: "供应商询价" },
        ]}
        eyebrow="供应商询价与定标"
        title={productCase.title}
        meta={
          <>
            <StatusBadge status={productCase.status} />
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <span className="badge badge-neutral">{productCase.category}</span>
            <span className="muted">到岸成本 = 采购价 + 单件运费 + 关税</span>
          </>
        }
        actions={
          <>
            <Link href={`/cases/${productCase.id}`} className="button secondary">商品与成本详情</Link>
            <Link href="/sourcing" className="button ghost">返回询价看板</Link>
          </>
        }
      />

      <CaseStepper
        caseId={productCase.id}
        hasCostModel={Boolean(costModel)}
        hasSupplierSelection={Boolean(selection)}
        hasApprovedContent={Boolean(selection)}
        selectedSupplierName={selectedQuote?.supplier.name ?? null}
        status={productCase.status}
      />

      <QueryNotices notice={query.notice} error={query.error} />
      {!canSource ? (
        <div className="notice warn"><span className="badge status-review_pending">ARCHIVED</span><span>当前商品已归档或终止，如需继续询价请先恢复状态。</span></div>
      ) : null}

      <SourcingPracticalTools caseId={productCase.id} initialSamples={initialSamples} />

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

      <SupplierMatrixPk
        caseId={productCase.id}
        marketplace={productCase.marketplace}
        currency={productCase.marketplace === "AU" ? "AUD" : "USD"}
        quotes={quotes}
        scoredQuotes={scoredQuotes}
        selectedQuoteId={selection?.quote_id ?? null}
        canSource={canSource}
        onSelectAction={selectSupplierQuoteAction}
        onCreate1688Action={createSupplierQuoteAction}
      />

      <div className="sourcing-bottom-grid">
        <div className="stack">
          {!selection ? (
            <details className="section entry-panel" open={Boolean(query.error)}>
              <summary>
                <span>
                  <strong>高级录入：报价单截图识别 / 完整外币条款（FOB · 关税 · 认证）</strong>
                  <small>如需用微信/1688 报价截图自动识别，或补充关税、贸易条款、认证与付款条件，可展开此处录入；快捷 RMB 报价直接用上方矩阵即可。</small>
                </span>
                <span className="badge badge-neutral">截图识别 & 完整条款</span>
              </summary>
              <form action={createSupplierQuoteAction} className="stack entry-form">
                <input type="hidden" name="caseId" value={productCase.id} />
                <QuoteSmartPaste disabled={!canSource} />
                <div className="form-section-label">供应商信息</div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="supplierName">
                      供应商名称 * {directorySuppliers.length > 0 ? <small style={{ color: "var(--green)", fontWeight: 500 }}>（已关联企业资产库，支持快速检索）</small> : null}
                    </label>
                    <input
                      id="supplierName"
                      name="supplierName"
                      list="existing-suppliers"
                      required
                      placeholder="输入或从资产库选择，如：宁波某日用品厂"
                      disabled={!canSource}
                      autoComplete="off"
                    />
                    <datalist id="existing-suppliers">
                      {directorySuppliers.map((s) => (
                        <option key={s.id} value={s.name}>
                          {s.platform || "1688"} · 历史合作 {s.quoteCount} 次 {s.selectionCount > 0 ? "· 曾中标" : ""}
                        </option>
                      ))}
                    </datalist>
                  </div>
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
                  <Link href={`/cases/${productCase.id}/content`} className="button primary">进入内容工作台</Link>
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
