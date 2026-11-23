import Link from "next/link";
import { CopyDraftButton } from "@/components/copy-draft-button";
import { ProposalMeta } from "@/components/ai-proposal-card";
import {
  SupplierCandidateComparison,
  SupplierCandidateImportForm,
  SupplierCaptureTools,
} from "@/components/supplier-candidate-workspace";
import {
  generateSupplierDraftAction,
  rejectSupplierCandidateAction,
  reviewSupplierDraftAction,
  selectHypothesisAction,
  shortlistSupplierCandidateAction,
} from "@/app/actions";
import type {
  AISelectionDecision,
  AISourcingHypothesisDetail,
  AISupplierCandidate,
} from "@/lib/ai-sourcing-repository";
import {
  SUPPLIER_DRAFT_TYPES,
  SUPPLIER_DRAFT_TYPE_LABELS,
} from "@/lib/ai-supplier-assistant/schema";
import type { SupplierDraft } from "@/lib/ai-supplier-assistant/repository";
import { moneyIn, percent, shortDate } from "@/lib/format";
import { buildSupplierLeads } from "@/lib/supplier-discovery";
import { type BatchType, dateInputValue } from "./helpers";
import { SupplierLeadQuickSearch } from "./supplier-lead-quick-search";

export function SupplierDiscoveryWorkspace({
  runId,
  hypothesis,
  supplierDrafts,
  supplierLeads,
  defaultQuery,
  autoReadClipboard,
}: {
  runId: string;
  hypothesis: AISourcingHypothesisDetail;
  supplierDrafts: SupplierDraft[];
  supplierLeads: ReturnType<typeof buildSupplierLeads>;
  defaultQuery: string;
  autoReadClipboard: boolean;
}) {
  if (!hypothesis.selectedForValidation) {
    return (
      <section className="ai-discovery-start">
        <div className="ai-discovery-start-copy">
          <span className="eyebrow">开始找供应商</span>
          <h3>开始找供应商</h3>
          <p>先确认负责人，再生成验证任务并启用 1688 采集、候选对比、人工核验和 RFQ 草稿。</p>
        </div>
        <form action={selectHypothesisAction} className="ai-discovery-start-form">
          <input type="hidden" name="runId" value={runId} />
          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
          <label>
            <span>负责人</span>
            <input name="actor" aria-label="找供应商负责人" placeholder="例如：采购小王" defaultValue="采购人员" maxLength={80} required />
          </label>
          <button type="submit" className="button primary">开始找供应商</button>
        </form>
        <div className="ai-discovery-start-safety">
          <span>用户点击才采集</span>
          <span>人工核验后入短名单</span>
          <span>不自动联系或发送</span>
        </div>
      </section>
    );
  }

  const latestRun = hypothesis.supplierDiscoveryRuns[0] ?? null;
  const activeCandidates = hypothesis.supplierCandidates.filter((candidate) => candidate.status !== "rejected");
  const rejectedCandidates = hypothesis.supplierCandidates.filter((candidate) => candidate.status === "rejected");
  const rankedCandidates = activeCandidates.slice(0, 10);
  const pinnedShortlist = activeCandidates.filter(
    (candidate) => candidate.status === "shortlisted" && !rankedCandidates.some((item) => item.id === candidate.id),
  );
  const candidates = [...pinnedShortlist, ...rankedCandidates];
  const shortlistedCount = hypothesis.supplierCandidates.filter((candidate) => candidate.status === "shortlisted").length;
  const hasRfqDraft = supplierDrafts.some((draft) => draft.draftType === "rfq");
  const discoverySteps = [
    {
      label: "搜索并采集 1688",
      detail: latestRun ? `最近采集 ${shortDate(latestRun.capturedAt)}` : "打开搜索结果页后点击采集",
      state: latestRun ? "done" : "active",
    },
    {
      label: "对比与人工核验",
      detail: shortlistedCount > 0 ? `已入短名单 ${shortlistedCount} 个` : "对比后核验供应商和产品",
      state: shortlistedCount > 0 ? "done" : latestRun ? "active" : "todo",
    },
    {
      label: "生成 RFQ 询价",
      detail: hasRfqDraft ? "已有内部草稿，待人工复制" : "短名单供应商可一键生成",
      state: hasRfqDraft ? "done" : shortlistedCount > 0 ? "active" : "todo",
    },
  ];
  return (
    <>
      <div className="ai-discovery-progress" aria-label="供应商发现流程">
        {discoverySteps.map((step, index) => (
          <div className={step.state} key={step.label}>
            <span>0{index + 1}</span>
            <div><strong>{step.label}</strong><small>{step.detail}</small></div>
          </div>
        ))}
      </div>

      {supplierLeads.length > 0 ? (
        <section className="ai-supplier-discovery" id={`supplier-discovery-${hypothesis.id}`}>
          <div className="ai-supplier-discovery-head">
            <div>
              <strong>① 快速找货源</strong>
              <span>点选搜索词，直接打开 1688 / Alibaba / Google 查工厂。</span>
            </div>
          </div>
          <SupplierLeadQuickSearch leads={supplierLeads} />
        </section>
      ) : null}

      <section className="ai-candidate-capture">
        <div className="ai-candidate-capture-head">
          <div>
            <span className="eyebrow">用户触发采集</span>
            <strong>② 采集 1688 当前页 · 自动生成 TOP 10</strong>
            <p>用户点击才采集，只处理当前可见商品卡；不后台抓取、不自动翻页、不登录，也不绕过验证码。</p>
          </div>
          <div className="ai-candidate-capture-badges">
            <span className="badge badge-neutral">{activeCandidates.length} 个待筛选</span>
            <span className="badge badge-success">{shortlistedCount} 个已核验</span>
            {rejectedCandidates.length > 0 ? <span className="badge badge-danger">{rejectedCandidates.length} 个已排除</span> : null}
          </div>
        </div>

        <SupplierCaptureTools runId={runId} hypothesisId={hypothesis.id} query={defaultQuery} />

        <div className="ai-manual-capture-head">
          <div><strong>方式三：手动粘贴或读取剪贴板</strong><span>书签自动复制后会优先尝试读取；浏览器询问剪贴板权限时请允许。</span></div>
        </div>

        <SupplierCandidateImportForm
          runId={runId}
          hypothesisId={hypothesis.id}
          defaultQuery={defaultQuery}
          autoReadClipboard={autoReadClipboard}
        />

        {latestRun ? (
          <div className="ai-candidate-run-summary">
            <div><span>最近采集</span><strong>{shortDate(latestRun.capturedAt)}</strong></div>
            <div><span>识别</span><strong>{latestRun.receivedCount}</strong></div>
            <div><span>去重</span><strong>{latestRun.duplicateCount}</strong></div>
            <div><span>TOP</span><strong>{latestRun.topCount}</strong></div>
            <div><span>触发方式</span><strong>用户触发</strong></div>
            {latestRun.warnings.length > 0 ? (
              <div className="ai-candidate-run-warnings">
                {latestRun.warnings.map((warning) => <span key={warning}>{warning}</span>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ai-candidate-review-head">
          <div>
            <strong>③ 对比并人工核验</strong>
            <span>先对比，再打开来源核验。只有勾选人工核验的候选才进入短名单，其他候选可排除。</span>
          </div>
          <span className="badge badge-neutral">TOP {Math.min(10, activeCandidates.length)}</span>
        </div>

        <SupplierCandidateComparison candidates={candidates} />

        {candidates.length > 0 ? (
          <div className="ai-candidate-grid">
            {candidates.map((candidate) => (
              <SupplierCandidateCard
                candidate={candidate}
                index={activeCandidates.findIndex((item) => item.id === candidate.id)}
                runId={runId}
                hypothesisId={hypothesis.id}
                key={candidate.id}
              />
            ))}
          </div>
        ) : (
          <div className="empty-inline">还没有候选。打开 1688 搜索结果页，用扩展或书签采集当前可见商品卡。</div>
        )}

        {rejectedCandidates.length > 0 ? (
          <details className="ai-rejected-candidates">
            <summary>
              <span>已排除 {rejectedCandidates.length} 个候选</span>
              <small>默认隐藏，保留记录以便复核</small>
            </summary>
            <div className="ai-rejected-candidate-list">
              {rejectedCandidates.map((candidate) => (
                <div key={candidate.id}>
                  <strong>{candidate.title}</strong>
                  <span>{candidate.supplierName} · {candidate.score} 分</span>
                  {candidate.offerUrl ? <a href={candidate.offerUrl} target="_blank" rel="noreferrer">查看来源</a> : null}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    </>
  );
}

export function SupplierCandidateCard({
  candidate,
  index,
  runId,
  hypothesisId,
}: {
  candidate: AISupplierCandidate;
  index: number;
  runId: string;
  hypothesisId: string;
}) {
  return (
    <article
      id={`candidate-${candidate.id}`}
      className={`ai-candidate-card ${candidate.status === "shortlisted" ? "shortlisted" : ""}`}
    >
      <div className="ai-candidate-card-head">
        <div>
          <span className="ai-candidate-rank">{index < 10 ? `TOP ${index + 1}` : "已入短名单"}</span>
          <h3>{candidate.title}</h3>
          <p>{candidate.supplierName} · {candidate.platform}</p>
        </div>
        <div className="ai-candidate-score">
          <strong>{candidate.score}</strong>
          <span>匹配分</span>
        </div>
      </div>

      <ProposalMeta
        generation={{ source: "manual" }}
        sourceQuote={candidate.sourceText}
        statusLabel={candidate.status === "shortlisted" ? "已人工核验" : "待人工核验"}
        targetLabel={candidate.supplierName}
      />

      <div className="ai-candidate-score-parts">
        {candidate.scoreParts.map((part) => (
          <div key={part.key} title={part.reason}>
            <span>{part.label}</span>
            <strong>{part.points}/{part.maxPoints}</strong>
          </div>
        ))}
      </div>

      <div className="ai-candidate-facts">
        <div><span>价格</span><strong>{candidate.priceCents ? moneyIn(candidate.currency, candidate.priceCents) : "待确认"}</strong></div>
        <div><span>MOQ</span><strong>{candidate.moq ?? "待确认"}</strong></div>
        <div><span>地区</span><strong>{candidate.location || "待确认"}</strong></div>
        <div><span>交期</span><strong>{candidate.leadTimeDays ? `${candidate.leadTimeDays} 天` : "待确认"}</strong></div>
      </div>

      {candidate.badges.length > 0 ? (
        <div className="ai-candidate-badges">
          {candidate.badges.map((badge) => <span key={badge}>{badge}</span>)}
        </div>
      ) : null}

      {candidate.riskNotes.length > 0 ? (
        <div className="ai-candidate-risks">
          <strong>待核验风险</strong>
          {candidate.riskNotes.map((note) => <span key={note}>{note}</span>)}
        </div>
      ) : null}

      <div className="ai-candidate-links">
        {candidate.offerUrl ? <a href={candidate.offerUrl} target="_blank" rel="noreferrer">打开商品</a> : null}
        {candidate.supplierUrl ? <a href={candidate.supplierUrl} target="_blank" rel="noreferrer">打开店铺</a> : null}
        <small>{shortDate(candidate.observedAt)} 采集</small>
      </div>

      {candidate.status === "shortlisted" ? (
        <div className="ai-candidate-shortlisted">
          <strong>✓ 已人工核验并加入短名单</strong>
          <span>{candidate.verifiedBy ?? "采购人员"} · {candidate.verifiedAt ? shortDate(candidate.verifiedAt) : "已记录"}</span>
          <small>RFQ 只会生成内部草稿；请核对内容后自行复制到沟通渠道，系统不会发送。</small>
          {candidate.shortlistId ? (
            <form action={generateSupplierDraftAction} className="ai-candidate-quick-rfq">
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="hypothesisId" value={hypothesisId} />
              <input type="hidden" name="draftType" value="rfq" />
              <input type="hidden" name="supplierShortlistId" value={candidate.shortlistId} />
              <input name="actor" aria-label="RFQ 草稿生成人" defaultValue="采购人员" maxLength={80} required />
              <button type="submit" className="button primary">生成 RFQ 草稿</button>
            </form>
          ) : null}
        </div>
      ) : (
        <>
          <form action={shortlistSupplierCandidateAction} className="ai-candidate-verify-form">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="candidateId" value={candidate.id} />
            <div className="field">
              <label>核验后的供应商名称</label>
              <input name="supplierName" defaultValue={candidate.supplierName} maxLength={180} required />
            </div>
            <div className="field">
              <label>人工核验人</label>
              <input name="actor" defaultValue="采购人员" maxLength={80} required />
            </div>
            <div className="field full">
              <label>产品匹配说明</label>
              <textarea name="productMatch" rows={2} maxLength={500} required placeholder="写明你已核对的材质、规格、结构、包装或差异" />
            </div>
            <label className="ai-candidate-verified-check full">
              <input type="checkbox" name="verified" value="true" required />
              <span>我已打开来源并人工核验供应商主体、产品一致性和公开信息</span>
            </label>
            <button className="button primary full" type="submit">已人工核验，加入短名单</button>
          </form>

          <details className="ai-candidate-reject">
            <summary>不匹配，排除该候选</summary>
            <form action={rejectSupplierCandidateAction}>
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="candidateId" value={candidate.id} />
              <div className="field">
                <label>排除原因</label>
                <input name="reason" maxLength={300} required placeholder="例如：材质不符 / MOQ 过高 / 无法核验主体" />
              </div>
              <div className="field">
                <label>操作人</label>
                <input name="actor" defaultValue="采购人员" maxLength={80} required />
              </div>
              <button type="submit" className="button danger">确认排除</button>
            </form>
          </details>
        </>
      )}
    </article>
  );
}

export function DecisionBadge({ decision }: { decision: AISelectionDecision | null }) {
  if (!decision) return <span className="badge badge-neutral">待建立门禁</span>;
  const className = decision.decision === "GO" ? "recommendation-go" : decision.decision === "NO-GO" ? "recommendation-no-go" : "recommendation-hold";
  return <span className={`badge ${className}`}>{decision.decision} · {decision.decisionScore} 分</span>;
}

export function DecisionPanel({
  decision,
  hypothesis,
  currency,
}: {
  decision: AISelectionDecision | null;
  hypothesis: AISourcingHypothesisDetail;
  currency: string;
}) {
  if (!decision) return <div className="action-warning">尚未生成确定性门禁，请先加入验证。</div>;
  return (
    <section className="ai-decision-panel">
      <div className="ai-decision-main">
        <div>
          <span className="eyebrow">确定性门禁</span>
          <h3>{decision.decision === "GO" ? "可以转入商品立项" : decision.decision === "NO-GO" ? "当前方向应停止" : "继续补证据或调整成本"}</h3>
          <p>{decision.blockers.length ? `还有 ${decision.blockers.length} 项未通过。系统不会用模型判断替代这些确定性门槛。` : "所有确定性门槛均已通过。"}</p>
        </div>
        <strong className={`ai-decision-grade ${decision.decision.toLowerCase()}`}>{decision.decision}</strong>
      </div>
      <div className="ai-decision-metrics">
        <div><span>最低到岸</span><strong>{decision.landedCostCents === null ? "—" : moneyIn(currency, decision.landedCostCents)}</strong></div>
        <div><span>首报价净利</span><strong>{decision.netProfitCents === null ? "—" : moneyIn(currency, decision.netProfitCents)}</strong></div>
        <div><span>净利率</span><strong>{decision.marginRate === null ? "—" : percent(decision.marginRate)}</strong></div>
        <div><span>首单现金</span><strong>{decision.firstOrderCashCents === null ? "—" : moneyIn(currency, decision.firstOrderCashCents)}</strong></div>
      </div>
      <details className="ai-gate-details">
        <summary>
          <span>查看 {decision.gates.filter((gate) => gate.passed).length} / {decision.gates.length} 项通过门禁</span>
          <span>展开明细</span>
        </summary>
        <div className="ai-gates">
          {decision.gates.map((gate) => (
            <div className={`ai-gate ${gate.passed ? "ai-gate-pass" : "ai-gate-fail"}`} key={gate.key}>
              <span className="ai-gate-status">{gate.passed ? "✓" : "×"}</span>
              <div><strong>{gate.label}</strong><small>要求 {gate.required}</small></div>
              <span>{gate.actual}</span>
            </div>
          ))}
        </div>
      </details>
      {decision.blockers.length ? (
        <div className="ai-blockers">
          <strong>当前阻断项</strong>
          <ul>{decision.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      ) : null}
      <div className="ai-decision-counts">
        <span>竞品 {hypothesis.counts.competitors}</span>
        <span>差评样本 {hypothesis.counts.reviewSamples}</span>
        <span>供应商 {hypothesis.counts.suppliers}</span>
        <span>报价 {hypothesis.counts.quotes}</span>
      </div>
    </section>
  );
}

export function QueryGroup({
  title,
  items,
  hrefFor,
  actionLabel,
}: {
  title: string;
  items: string[];
  hrefFor: (item: string) => string;
  actionLabel: string;
}) {
  return (
    <div className="ai-query-group">
      <strong>{title}</strong>
      {items.map((item) => (
        <a href={hrefFor(item)} target="_blank" rel="noreferrer" key={item}>
          <span>{item}</span>
          <small>{actionLabel}</small>
        </a>
      ))}
    </div>
  );
}

export function SupplierAssistantPanel({
  runId,
  hypothesis,
  drafts,
}: {
  runId: string;
  hypothesis: AISourcingHypothesisDetail;
  drafts: SupplierDraft[];
}) {
  const supplierByShortlistId = new Map(hypothesis.shortlist.map((item) => [item.id, item]));
  const today = dateInputValue(new Date());
  const defaultReminderDate = dateInputValue(new Date(Date.now() + 7 * 86_400_000));

  return (
    <section className="ai-supplier-assistant ai-record-block">
      <div className="ai-validation-summary-head">
        <div>
          <span className="eyebrow">供应商内部草稿</span>
          <h3>供应商内部草稿</h3>
          <p>AI 只润色主题和开场；缺失信息由确定性程序追加为问题。草稿仅供内部复核，系统不会发送。</p>
        </div>
        <span className="badge badge-success">内部草稿 · 未发送</span>
      </div>

      <form action={generateSupplierDraftAction} className="ai-draft-compose form-grid">
        <input type="hidden" name="runId" value={runId} />
        <input type="hidden" name="hypothesisId" value={hypothesis.id} />
        <div className="field">
          <label>草稿类型</label>
          <select name="draftType" defaultValue="rfq" required>
            {SUPPLIER_DRAFT_TYPES.map((type) => (
              <option value={type} key={type}>{SUPPLIER_DRAFT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>已录入供应商（追问/提醒必选）</label>
          <select name="supplierShortlistId" defaultValue="">
            <option value="">不指定供应商</option>
            {hypothesis.shortlist.map((supplier) => (
              <option value={supplier.id} key={supplier.id}>{supplier.supplierName} · {supplier.platform}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>报价提醒日期（仅到期提醒）</label>
          <input name="quoteValidUntil" type="date" min={today} defaultValue={defaultReminderDate} />
        </div>
        <div className="field">
          <label>生成人</label>
          <input name="actor" defaultValue="采购人员" maxLength={80} required />
        </div>
        <div className="field full ai-draft-actions">
          <span>生成后可复制到 1688、Alibaba、邮件或你已有的聊天工具；本系统没有发送入口。</span>
          <button className="button primary" type="submit">生成内部草稿</button>
        </div>
      </form>

      {drafts.length > 0 ? (
        <div className="ai-draft-list">
          {drafts.map((draft) => {
            const supplier = draft.supplierShortlistId
              ? supplierByShortlistId.get(draft.supplierShortlistId)
              : null;
            const gaps = draft.questions.map((question) => question.label);
            const copyText = `${draft.subject}\n\n${draft.body}`;
            return (
              <article className="ai-draft-card" key={draft.id}>
                <div className="ai-draft-card-head">
                  <div>
                    <strong>{SUPPLIER_DRAFT_TYPE_LABELS[draft.draftType]}</strong>
                    <span className={`badge ${draft.status === "reviewed" ? "badge-success" : "badge-neutral"}`}>
                      {draft.status === "reviewed" ? "已人工审阅" : "待人工审阅"}
                    </span>
                  </div>
                  <span className="badge status-review_pending">未发送</span>
                </div>

                <div className="ai-draft-meta">
                  <span>{supplier?.supplierName ?? "未指定供应商"}</span>
                  <span>{shortDate(draft.createdAt)} · {draft.createdBy}</span>
                </div>

                <ProposalMeta
                  generation={{
                    source: draft.generationMode === "model_polished" ? "model" : "template",
                    provider: draft.provider,
                    model: draft.model,
                  }}
                  statusLabel={draft.status === "reviewed" ? "已人工审阅" : "待人工审阅 · 未发送"}
                  targetLabel={supplier?.supplierName ?? "未指定供应商"}
                />

                <div className="ai-draft-subject">
                  <span>主题</span>
                  <strong>{draft.subject}</strong>
                </div>
                <pre className="ai-draft-body">{draft.body}</pre>

                {gaps.length > 0 ? (
                  <div className="ai-draft-gaps">
                    <span>确定性追问</span>
                    {gaps.map((gap, index) => <small key={`${gap}-${index}`}>{gap}</small>)}
                  </div>
                ) : null}

                <div className="ai-draft-foot">
                  <div>
                    <span className="badge badge-neutral">externalActions: none</span>
                    {draft.reviewedAt ? <small>{draft.reviewedBy} 于 {shortDate(draft.reviewedAt)} 审阅</small> : null}
                  </div>
                  <div className="button-row">
                    <CopyDraftButton text={copyText} />
                    {draft.status === "draft" ? (
                      <form action={reviewSupplierDraftAction} className="ai-draft-review">
                        <input type="hidden" name="runId" value={runId} />
                        <input type="hidden" name="draftId" value={draft.id} />
                        <input name="actor" aria-label="审阅人" defaultValue="采购人员" maxLength={80} required />
                        <button className="button secondary" type="submit">标记已审阅</button>
                      </form>
                    ) : null}
                  </div>
                </div>
                <small className="ai-draft-note">{draft.generationNote}</small>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="ai-draft-empty">还没有供应商草稿。先录入真实报价，再生成追问或到期提醒。</div>
      )}
    </section>
  );
}

