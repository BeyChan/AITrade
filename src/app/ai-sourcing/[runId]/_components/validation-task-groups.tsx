import Link from "next/link";
import {
  eliminateHypothesisAction,
  recordOpportunityEvidenceAction,
  restoreHypothesisAction,
  toggleValidationTaskAction,
} from "@/app/actions";
import type { AISourcingHypothesisDetail } from "@/lib/ai-sourcing-repository";
import {
  ELIMINATION_REASONS,
  type EliminationReason,
} from "@/lib/sourcing-funnel";
import { shortDate } from "@/lib/format";

/**
 * 单步聚焦核验条：只展示属于当前 Tab 的核验项，绝不跨 Tab 堆叠 8 项任务。
 * - mode="market"   (02 验证证据): 竞品 Top 20 + 15 条差评 + 淘汰/下一步
 * - mode="decision" (05 门禁结论): 专利一键点选 + 物流一键点选 + 样品分状态
 */
export function ValidationTaskGroups({
  runId,
  marketCode,
  hypothesis,
  observedAt,
  mode,
  nextTabHref,
  nextTabLabel,
  suggestedEliminationReason,
}: {
  runId: string;
  marketCode: string;
  hypothesis: AISourcingHypothesisDetail;
  observedAt: string;
  mode: "market" | "decision";
  nextTabHref?: string;
  nextTabLabel?: string;
  suggestedEliminationReason?: EliminationReason | null;
}) {
  const isEliminated = Boolean(hypothesis.eliminatedAt);
  const patentKeyword = hypothesis.competitorQueries[0] || hypothesis.concept;
  const googlePatentUrl = `https://patents.google.com/?q=${encodeURIComponent(patentKeyword)}`;
  const byType = new Map(hypothesis.tasks.map((t) => [t.taskType, t]));

  const verifiedCompetitors = hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors;
  const samplePassCount = hypothesis.quotes.filter((q) => (q.sampleScore ?? 0) >= 80).length;

  const taskTypes =
    mode === "market"
      ? ["competitor_scan", "review_research"]
      : ["sample_order", "patent_check", "logistics_check"];

  const tasks = taskTypes
    .map((type) => byType.get(type))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <section className="ai-validation-summary">
      {isEliminated ? (
        <div className="funnel-eliminated-banner">
          <div>
            <span className="badge badge-danger">已淘汰 · {hypothesis.eliminationReason ?? "未注明"}</span>
            <strong>{hypothesis.eliminationNote || "已沉淀至团队避坑清单"}</strong>
            {hypothesis.eliminatedAt ? <small>{shortDate(hypothesis.eliminatedAt)}</small> : null}
          </div>
          <form action={restoreHypothesisAction}>
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
            <button type="submit" className="button secondary compact-button">恢复验证</button>
          </form>
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div className={`funnel-group is-active${doneCount === tasks.length ? " is-done" : ""}`}>
          <div className="funnel-group-head" style={{ cursor: "default" }}>
            <div className="funnel-group-title">
              <strong>{mode === "market" ? "本步证据进度" : "立项前风险核验（点选即落库）"}</strong>
              <span className="funnel-group-question">
                {mode === "market"
                  ? "达标后自动变绿，无需手勾"
                  : "查完专利与物流直接点结论，无需填表"}
              </span>
            </div>
            <span className={`badge ${doneCount === tasks.length ? "badge-success" : "badge-neutral"} mono`}>
              {doneCount}/{tasks.length}
            </span>
          </div>

          <div className="funnel-group-body">
            {tasks.map((task) => {
              const isDone = task.status === "done";
              const isReview = task.taskType === "review_research";
              const isPatent = task.taskType === "patent_check";
              const isLogistics = task.taskType === "logistics_check";
              const isCompetitor = task.taskType === "competitor_scan";
              const isSample = task.taskType === "sample_order";

              const progressText = isDone
                ? "已完成"
                : isCompetitor
                  ? `${verifiedCompetitors}/${task.targetCount}`
                  : isReview
                    ? `${hypothesis.counts.reviewSamples}/${task.targetCount}`
                    : isSample
                      ? `${samplePassCount}/${task.targetCount}`
                      : "待核验";

              return (
                <div key={task.id} className={`funnel-task-row${isDone ? " is-done" : ""}`}>
                  <span className={`funnel-dot${isDone ? " is-done" : ""}`} aria-hidden="true">
                    {isDone ? "✓" : "●"}
                  </span>
                  <span className="funnel-task-name">{task.title}</span>
                  <span className={`funnel-task-progress${isDone ? " is-done" : ""}`}>{progressText}</span>

                  <details className="funnel-info-tip">
                    <summary title="查看核验说明" aria-label="查看核验说明">ⓘ</summary>
                    <div className="funnel-info-popover">{task.description}</div>
                  </details>

                  <div className="funnel-task-actions">
                    {isCompetitor && !isDone ? (
                      <a href={`#fast-screen-market-${hypothesis.id}`} className="button secondary compact-button">
                        去导入 Top 20
                      </a>
                    ) : isReview && !isDone ? (
                      <details className="funnel-quick-pop" id={`entry-review-${hypothesis.id}`}>
                        <summary className="button secondary compact-button">+ 记差评</summary>
                        <form action={recordOpportunityEvidenceAction} className="funnel-quick-pop-body">
                          <input type="hidden" name="runId" value={runId} />
                          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                          <input type="hidden" name="evidenceType" value="review_insight" />
                          <input type="hidden" name="sourceType" value="review_page" />
                          <input type="hidden" name="observedAt" value={observedAt} />
                          <input type="hidden" name="actor" value="运营人员" />
                          <input type="hidden" name="sourceUrl" value="" />
                          <input name="title" required maxLength={160} placeholder="差评核心痛点（如：粘胶易脱落）" />
                          <input name="reviewSampleSize" type="number" min="1" defaultValue="15" required placeholder="样本条数" />
                          <input name="summary" required maxLength={400} placeholder="一句买家原话或改进点" />
                          <button type="submit" className="button primary compact-button">保存</button>
                        </form>
                      </details>
                    ) : isSample && !isDone ? (
                      <Link
                        href={`/ai-sourcing/${encodeURIComponent(runId)}?tab=quotes&hypothesisId=${encodeURIComponent(hypothesis.id)}#supplier-quote-${hypothesis.id}`}
                        className="button secondary compact-button"
                      >
                        去录样品分
                      </Link>
                    ) : isPatent && !isDone ? (
                      <div className="funnel-quick-btns" id={`entry-patent-${hypothesis.id}`}>
                        <a href={googlePatentUrl} target="_blank" rel="noreferrer" className="button ghost compact-button">
                          查专利 ↗
                        </a>
                        {(
                          [
                            { risk: "clear", label: "✓ 无风险", summary: `${marketCode} 专利初筛无明显阻断风险` },
                            { risk: "review", label: "需复核", summary: `${marketCode} 存在疑似相似外观，需进一步复核` },
                            { risk: "found", label: "有阻断", summary: `${marketCode} 检索发现明确专利侵权风险` },
                          ] as const
                        ).map((opt) => (
                          <form key={opt.risk} action={recordOpportunityEvidenceAction}>
                            <input type="hidden" name="runId" value={runId} />
                            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                            <input type="hidden" name="evidenceType" value="patent_check" />
                            <input type="hidden" name="sourceType" value="patent_search" />
                            <input type="hidden" name="observedAt" value={observedAt} />
                            <input type="hidden" name="actor" value="运营人员" />
                            <input type="hidden" name="title" value={`${marketCode} 专利核验`} />
                            <input type="hidden" name="sourceUrl" value={googlePatentUrl} />
                            <input type="hidden" name="summary" value={opt.summary} />
                            <input type="hidden" name="riskLevel" value={opt.risk} />
                            <button
                              type="submit"
                              className={`button compact-button ${opt.risk === "clear" ? "secondary" : "ghost"}`}
                            >
                              {opt.label}
                            </button>
                          </form>
                        ))}
                      </div>
                    ) : isLogistics && !isDone ? (
                      <div className="funnel-quick-btns" id={`entry-logistics-${hypothesis.id}`}>
                        {(
                          [
                            { risk: "clear", label: "✓ 可执行", summary: `${marketCode} 标准件体积重可控，物流可执行` },
                            { risk: "review", label: "需复核", summary: `${marketCode} 包装尺寸或头程待进一步确认` },
                            { risk: "found", label: "受限", summary: `${marketCode} 超重/抛货或危险品受限` },
                          ] as const
                        ).map((opt) => (
                          <form key={opt.risk} action={recordOpportunityEvidenceAction}>
                            <input type="hidden" name="runId" value={runId} />
                            <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                            <input type="hidden" name="evidenceType" value="logistics_check" />
                            <input type="hidden" name="sourceType" value="logistics_check" />
                            <input type="hidden" name="observedAt" value={observedAt} />
                            <input type="hidden" name="actor" value="运营人员" />
                            <input type="hidden" name="title" value={`${marketCode} 物流核验`} />
                            <input type="hidden" name="sourceUrl" value="" />
                            <input type="hidden" name="summary" value={opt.summary} />
                            <input type="hidden" name="riskLevel" value={opt.risk} />
                            <button
                              type="submit"
                              className={`button compact-button ${opt.risk === "clear" ? "secondary" : "ghost"}`}
                            >
                              {opt.label}
                            </button>
                          </form>
                        ))}
                      </div>
                    ) : null}

                    <details className="funnel-more-menu">
                      <summary aria-label="更多操作" title="更多操作">⋯</summary>
                      <div className="funnel-more-popover">
                        <form action={toggleValidationTaskAction}>
                          <input type="hidden" name="taskId" value={task.id} />
                          <input type="hidden" name="runId" value={runId} />
                          <input type="hidden" name="hypothesisId" value={hypothesis.id} />
                          <input type="hidden" name="status" value={isDone ? "todo" : "done"} />
                          <button type="submit" className="funnel-menu-item">
                            {isDone ? "撤销完成" : "手动标记完成"}
                          </button>
                        </form>
                      </div>
                    </details>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {!isEliminated ? (
        <div className="funnel-step-footer">
          <details className="funnel-eliminate-menu">
            <summary className="button ghost compact-button funnel-eliminate-trigger">
              淘汰这个方向 ▾
            </summary>
            <form action={eliminateHypothesisAction} className="funnel-eliminate-popover" style={{ left: 0, right: "auto" }}>
              <input type="hidden" name="runId" value={runId} />
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <div className="funnel-eliminate-title">选择淘汰原因（将存入团队避坑清单）</div>
              <div className="funnel-reason-grid">
                {ELIMINATION_REASONS.map((reason) => (
                  <label key={reason} className="funnel-reason-chip">
                    <input
                      type="radio"
                      name="reason"
                      value={reason}
                      defaultChecked={
                        suggestedEliminationReason
                          ? reason === suggestedEliminationReason
                          : reason === ELIMINATION_REASONS[0]
                      }
                      required
                    />
                    <span>{reason}</span>
                  </label>
                ))}
              </div>
              <input name="note" placeholder="补充一句复盘（选填）" maxLength={300} />
              <div className="funnel-eliminate-actions">
                <button type="submit" className="button primary compact-button">确认淘汰</button>
              </div>
            </form>
          </details>

          {nextTabHref && nextTabLabel ? (
            <Link href={nextTabHref} className="button primary compact-button">
              {nextTabLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
