import Link from "next/link";
import { notFound } from "next/navigation";
import {
  applyAiInboxTaskAction,
  retryAiInboxTaskAction,
  reviewAiInboxFieldAction,
} from "@/app/actions";
import {
  DOCUMENT_TYPE_LABELS,
  getFieldDefinition,
} from "@/lib/ai-inbox/schema";
import {
  getAiInboxTask,
  type AiInboxField,
  type AiInboxModelCall,
  type AiInboxReviewActionRow,
  type AiInboxSourceKind,
  type AiInboxTaskDetail,
  type AiInboxTaskStatus,
} from "@/lib/ai-inbox/repository";
import type { AiFieldStatus } from "@/lib/ai-inbox/validator";
import { moneyIn, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{
    notice?: string;
    error?: string;
  }>;
};

const TASK_STATUS_LABELS: Record<AiInboxTaskStatus, string> = {
  queued: "等待处理",
  running: "提取中",
  needs_review: "待人工审核",
  ready: "可应用",
  applied: "已写入业务事实",
  failed: "提取失败",
};

const SOURCE_KIND_LABELS: Record<AiInboxSourceKind, string> = {
  paste: "粘贴文本",
  csv: "CSV",
  json: "JSON",
  text: "TXT",
  markdown: "Markdown",
};

const FIELD_STATUS_LABELS: Record<AiFieldStatus, string> = {
  extracted: "待校验",
  auto_accepted: "自动校验通过",
  needs_review: "待人工审核",
  accepted: "人工已确认",
  rejected: "已拒绝",
  missing: "缺少字段",
};

const REVIEW_ACTION_LABELS: Record<AiInboxReviewActionRow["action"], string> = {
  accept: "确认候选",
  correct: "手工修正",
  reject: "拒绝候选",
  retry: "重新提取",
  apply: "写入业务事实",
};

const MODEL_STATUS_LABELS: Record<AiInboxModelCall["status"], string> = {
  running: "调用中",
  completed: "已完成",
  failed: "失败",
  skipped: "未调用模型",
};

export default async function AiInboxTaskPage({ params, searchParams }: PageProps) {
  const { taskId } = await params;
  const query = await searchParams;
  const detail = await getAiInboxTask(taskId);
  if (!detail) notFound();
  const { task, artifact, fields, decision } = detail;
  const summary = task.extractionSummary;
  const documentType = summary.documentType ?? fields[0]?.documentType ?? "unknown";
  const canApply = task.status === "ready";
  const canReview = task.status === "needs_review" || task.status === "ready";
  const sensitiveCount = fields.filter((field) => field.riskLevel === "sensitive").length;
  const unresolvedCount = fields.filter((field) => field.status === "needs_review" || field.status === "extracted" || field.status === "missing").length;
  const returnHref = task.targetRunId && task.targetHypothesisId
    ? `/ai-sourcing/${encodeURIComponent(task.targetRunId)}#hypothesis-${encodeURIComponent(task.targetHypothesisId)}`
    : "/ai-inbox";

  return (
    <div className="page ai-inbox-page ai-inbox-detail-page">
      <div className="ai-inbox-detail-breadcrumb">
        <Link href={returnHref}>
          {task.targetRunId ? `← 返回「${task.targetHypothesisConcept ?? "当前机会"}」验证` : "← 返回 AI 证据收件箱"}
        </Link>
        <span>任务 {task.id.slice(0, 8)}</span>
      </div>

      <div className="title-row ai-inbox-detail-title">
        <div>
          <div className="eyebrow">Evidence review</div>
          <h1>{task.targetHypothesisConcept ?? "目标机会已删除"}</h1>
          <p className="muted ai-inbox-subtitle">
            {DOCUMENT_TYPE_LABELS[documentType]} · {SOURCE_KIND_LABELS[task.sourceKind]} · {artifact?.fileName ?? `${artifact?.contentText.length ?? 0} 个字符`}
          </p>
        </div>
        <div className="ai-inbox-detail-title-meta">
          <span className={`badge ${taskStatusClass(task.status)}`}>{TASK_STATUS_LABELS[task.status]}</span>
          {sensitiveCount > 0 ? <span className="badge badge-danger">{sensitiveCount} 个敏感字段</span> : null}
          {task.targetRunId ? <Link className="button ghost" href={returnHref}>返回机会验证</Link> : null}
        </div>
      </div>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}
      {task.errorMessage ? <div className="notice warn"><strong>任务提示：</strong>{task.errorMessage}</div> : null}

      <div className="ai-inbox-detail-metrics">
        <div className="metric-card">
          <span className="metric-label">提取字段</span>
          <strong className="metric-value">{fields.length}</strong>
          <span className="metric-note">{summary.autoAcceptedCount ?? 0} 个通过确定性校验</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">待人工处理</span>
          <strong className="metric-value">{unresolvedCount}</strong>
          <span className="metric-note">冲突、缺失、敏感和低置信度</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">提取模式</span>
          <strong className="ai-inbox-mode-value">{modeLabel(summary.mode)}</strong>
          <span className="metric-note">{task.provider} / {task.model}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">尝试次数</span>
          <strong className="metric-value">{task.attempt}</strong>
          <span className="metric-note">最近更新 {shortDate(task.updatedAt)}</span>
        </div>
      </div>

      <div className="ai-inbox-detail-grid">
        <main className="ai-inbox-detail-main">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>字段审核</h2>
                <p>只有来源可定位、无冲突且币种一致的字段才能进入业务事实。手工修正会明确标记为人工来源。</p>
              </div>
              <span className="badge badge-neutral">审核人不可匿名</span>
            </div>

            {summary.warnings?.length ? (
              <div className="ai-inbox-warning-block">
                <strong>提取告警</strong>
                <ul>
                  {summary.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
                </ul>
              </div>
            ) : null}

            {fields.length === 0 ? (
              <div className="empty-state">
                <h3>没有可展示字段</h3>
                <p>请检查原始证据、模型调用记录，或在任务失败后重新提取。</p>
              </div>
            ) : (
              <div className="ai-field-list">
                {fields.map((field) => (
                  <FieldCard
                    key={field.id}
                    field={field}
                    task={task}
                    canReview={canReview}
                    targetCurrency={task.targetCurrency}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <details className="ai-inbox-artifact-panel">
              <summary>
                <span>
                  <strong>原始 Artifact</strong>
                  <small>{artifact?.fileName ?? "粘贴文本"} · SHA-256 {artifact?.contentHash.slice(0, 16) ?? "无"}</small>
                </span>
                <span className="info-pill">只读</span>
              </summary>
              {artifact ? (
                <>
                  <div className="ai-inbox-artifact-meta">
                    <span>类型：{artifact.artifactType === "file" ? "文件" : "粘贴"}</span>
                    <span>MIME：{artifact.mimeType ?? "未提供"}</span>
                    <span>保存时间：{shortDate(artifact.createdAt)}</span>
                  </div>
                  <pre className="ai-inbox-artifact-text">{artifact.contentText}</pre>
                </>
              ) : (
                <div className="empty-state"><p>原始 artifact 已不存在。</p></div>
              )}
            </details>
          </section>
        </main>

        <aside className="ai-inbox-detail-side">
          <ApplyPanel detail={detail} canApply={canApply} />

          <section className="panel ai-inbox-decision-card">
            <div className="panel-header">
              <div>
                <h2>确定性门禁</h2>
                <p>GO / HOLD / NO-GO 由规则计算，AI 无权修改。</p>
              </div>
            </div>
            {decision ? (
              <div className="ai-inbox-decision-body">
                <div className="ai-inbox-decision-head">
                  <span className={`badge recommendation-${decision.decision.toLowerCase()}`}>{decision.decision}</span>
                  <strong>{decision.decisionScore} 分</strong>
                </div>
                <div className="ai-inbox-decision-meter">
                  <span style={{ width: `${Math.max(0, Math.min(100, decision.evidenceCompleteness))}%` }} />
                </div>
                <p>证据完整度 {decision.evidenceCompleteness}% · 评估于 {shortDate(decision.evaluatedAt)}</p>
                {decision.blockers.length ? (
                  <details>
                    <summary>{decision.blockers.length} 个阻断项</summary>
                    <ul>{decision.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
                  </details>
                ) : <p className="ai-inbox-positive-note">当前没有门禁阻断项。</p>}
              </div>
            ) : (
              <div className="ai-inbox-decision-empty">
                <p>尚未生成门禁结果。应用已审核字段后会自动重新计算。</p>
              </div>
            )}
          </section>

          <section className="panel ai-inbox-review-trail">
            <div className="panel-header">
              <div>
                <h2>审核记录</h2>
                <p>最近 30 条字段确认、修正、拒绝和应用记录。</p>
              </div>
            </div>
            {detail.reviewActions.length ? (
              <div className="timeline">
                {detail.reviewActions.map((action) => <ReviewActionItem action={action} key={action.id} />)}
              </div>
            ) : (
              <div className="ai-inbox-empty-note">还没有人工审核记录。</div>
            )}
          </section>

          <section className="panel ai-inbox-model-trail">
            <div className="panel-header">
              <div>
                <h2>模型调用</h2>
                <p>记录调用状态、耗时和结构化输出摘要，不保存密钥。</p>
              </div>
            </div>
            {detail.modelCalls.length ? (
              <div className="ai-inbox-model-list">
                {detail.modelCalls.map((call) => <ModelCallItem call={call} key={call.id} />)}
              </div>
            ) : (
              <div className="ai-inbox-empty-note">还没有模型调用记录。</div>
            )}
          </section>

          <section className="section ai-inbox-guardrail">
            <div className="eyebrow">External actions disabled</div>
            <h3>没有外部发送按钮</h3>
            <p>本页不会联系供应商、发送邮件、发布 Listing、改价、采购或付款。应用动作只写本地业务表，并留下审计记录。</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function FieldCard({
  field,
  task,
  canReview,
  targetCurrency,
}: {
  field: AiInboxField;
  task: AiInboxTaskDetail["task"];
  canReview: boolean;
  targetCurrency: string | null;
}) {
  const definition = getFieldDefinition(field.documentType, field.fieldName);
  const sourceMatched = field.source?.locator?.matched === true;
  const manualSource = field.source?.sourceType === "manual";
  const canAccept = field.status !== "missing" && sourceMatched;
  const correctionDefault = editableValue(field);

  return (
    <article className={`ai-field-card${field.riskLevel === "sensitive" ? " sensitive" : ""}`}>
      <div className="ai-field-card-head">
        <div>
          <div className="ai-field-name">
            <h3>{field.fieldLabel}</h3>
            <code>{field.fieldName}</code>
          </div>
          <div className="ai-field-badges">
            <span className={`badge ${fieldStatusClass(field.status)}`}>{FIELD_STATUS_LABELS[field.status]}</span>
            {field.riskLevel === "sensitive" ? <span className="badge badge-danger">敏感字段 · 必须人工确认</span> : null}
            {definition?.required ? <span className="info-pill">必填</span> : <span className="info-pill">选填</span>}
          </div>
        </div>
        <div className="ai-field-confidence">
          <span>置信度</span>
          <strong>{Math.round(field.confidence * 100)}%</strong>
        </div>
      </div>

      <div className="ai-field-values">
        <div>
          <span>原始值</span>
          <strong>{field.rawValue || <em>未提取</em>}</strong>
        </div>
        <div>
          <span>规范化值</span>
          <strong>{formatFieldValue(field, targetCurrency)}</strong>
        </div>
      </div>

      {field.validationMessage ? <div className="ai-field-validation">{field.validationMessage}</div> : null}

      <div className={`ai-field-source${sourceMatched || manualSource ? "" : " blocked"}`}>
        <div className="ai-field-source-head">
          <span>来源定位</span>
          <span className={`badge ${sourceMatched || manualSource ? "badge-success" : "badge-danger"}`}>
            {manualSource ? "人工来源" : sourceMatched ? "已定位" : "无法定位"}
          </span>
        </div>
        {field.source?.excerpt ? (
          <blockquote>{field.source.excerpt}</blockquote>
        ) : (
          <p>没有来源摘录。该候选不能直接确认。</p>
        )}
        {sourceMatched ? (
          <small>
            字符范围 {String(field.source?.locator.start ?? "-")}–{String(field.source?.locator.end ?? "-")}
            {field.source?.locator.collapsedWhitespace ? " · 按折叠空白匹配" : ""}
          </small>
        ) : manualSource ? (
          <small>由审核人手工修正，不伪装成 AI 原文定位。</small>
        ) : (
          <small>来源摘录无法在已保存 artifact 中找到，确认按钮已禁用。</small>
        )}
      </div>

      {canReview ? (
        <form action={reviewAiInboxFieldAction} className="ai-field-review-form">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="fieldId" value={field.id} />
          <div className="ai-field-review-grid">
            <label>
              <span>审核人</span>
              <input name="actor" defaultValue={task.requestedBy} maxLength={80} required />
            </label>
            <label>
              <span>修正值</span>
              <input
                name="value"
                defaultValue={correctionDefault}
                placeholder={definition?.rule === "percent" ? "例如 8%" : "手工确认值"}
              />
            </label>
            <label className="full">
              <span>审核备注</span>
              <textarea name="notes" maxLength={1_000} placeholder="记录判断依据、缺失原因或冲突裁决" />
            </label>
          </div>
          <div className="ai-field-review-actions">
            {canAccept ? (
              <button className="button primary" type="submit" name="reviewAction" value="accept">
                确认为原始来源
              </button>
            ) : null}
            <button className="button secondary" type="submit" name="reviewAction" value="correct">
              {field.status === "missing" ? "手工补齐并确认" : "保存修正"}
            </button>
            <button className="button ghost" type="submit" name="reviewAction" value="reject">
              拒绝此候选
            </button>
          </div>
          <p className="help">“确认原始来源”会忽略上方修正值；“保存修正”会把来源明确标记为人工输入。拒绝必填字段后，任务仍无法应用。</p>
        </form>
      ) : null}
    </article>
  );
}

function ApplyPanel({ detail, canApply }: { detail: AiInboxTaskDetail; canApply: boolean }) {
  const { task } = detail;
  const returnHref = task.targetRunId && task.targetHypothesisId
    ? `/ai-sourcing/${encodeURIComponent(task.targetRunId)}#hypothesis-${encodeURIComponent(task.targetHypothesisId)}`
    : null;
  return (
    <section className={`panel ai-inbox-apply-card${canApply ? " ready" : ""}`}>
      <div className="panel-header">
        <div>
          <h2>{task.status === "applied" ? "已应用" : canApply ? "可以应用" : "应用前检查"}</h2>
          <p>
            {task.status === "applied"
              ? "字段已事务写入业务表，重复提交不会产生第二条记录。"
              : canApply
                ? "所有必填字段均已确认、来源可追溯且门禁无阻断。"
                : "仍需处理缺失、冲突、敏感、低置信度或来源无法定位的字段。"}
          </p>
        </div>
      </div>
      <div className="ai-inbox-apply-body">
        {task.status === "applied" ? (
          <>
            <dl className="ai-inbox-apply-facts">
              <div><dt>写入实体</dt><dd>{task.appliedEntityType ?? "-"}</dd></div>
              <div><dt>实体 ID</dt><dd><code>{task.appliedEntityId ?? "-"}</code></dd></div>
              <div><dt>操作人</dt><dd>{task.appliedBy ?? "-"}</dd></div>
              <div><dt>时间</dt><dd>{task.appliedAt ? shortDate(task.appliedAt) : "-"}</dd></div>
            </dl>
            {returnHref ? <Link className="button secondary" href={returnHref}>返回机会验证并查看门禁</Link> : null}
          </>
        ) : canApply ? (
          <form action={applyAiInboxTaskAction} className="ai-inbox-apply-form">
            <input type="hidden" name="taskId" value={task.id} />
            <label>
              <span>应用操作人</span>
              <input name="actor" defaultValue={task.requestedBy} maxLength={80} required />
            </label>
            <button className="button primary" type="submit">事务写入并重算门禁</button>
            <p className="help">不会发送邮件、联系供应商、发布商品、改价或付款。</p>
          </form>
        ) : (
          <div className="ai-inbox-apply-blocked">
            <strong>{task.status === "failed" ? "提取失败，不能应用" : task.status === "running" || task.status === "queued" ? "任务仍在处理中" : "审核尚未完成"}</strong>
            <p>请先处理任务中的所有待审核字段，再回到此处应用。</p>
          </div>
        )}

        {task.status !== "applied" && task.status !== "running" && task.status !== "queued" ? (
          <details className="ai-inbox-retry">
            <summary>重新提取原始证据</summary>
            <p>会重新生成字段并把任务退回审核；历史模型调用和审核记录仍保留。</p>
            <form action={retryAiInboxTaskAction} className="ai-inbox-inline-form">
              <input type="hidden" name="taskId" value={task.id} />
              <input name="actor" aria-label="重试操作人" defaultValue={task.requestedBy} maxLength={80} required />
              <button className="button ghost" type="submit">确认重新提取</button>
            </form>
          </details>
        ) : null}
      </div>
    </section>
  );
}

function ReviewActionItem({ action }: { action: AiInboxReviewActionRow }) {
  return (
    <div className="timeline-item">
      <span className="timeline-dot" />
      <div>
        <div className="timeline-title">{REVIEW_ACTION_LABELS[action.action]} · {action.actor}</div>
        <div className="timeline-meta">{shortDate(action.createdAt)}</div>
        {action.notes ? <p className="ai-inbox-review-notes">{action.notes}</p> : null}
        {action.previousValue !== null || action.newValue !== null ? (
          <details>
            <summary>查看值变更</summary>
            <pre>{JSON.stringify({ previous: action.previousValue, next: action.newValue }, null, 2)}</pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

function ModelCallItem({ call }: { call: AiInboxModelCall }) {
  return (
    <article className="ai-inbox-model-item">
      <div>
        <strong>尝试 {call.attempt} · {MODEL_STATUS_LABELS[call.status]}</strong>
        <span>{call.provider} / {call.model}</span>
      </div>
      <div className="product-meta">
        <span>{call.latencyMs} ms</span>
        <span>{call.inputChars.toLocaleString("zh-CN")} 字符</span>
        <span>{shortDate(call.createdAt)}</span>
      </div>
      {call.errorMessage ? <p className="ai-inbox-task-error">{call.errorMessage}</p> : null}
      {Object.keys(call.outputSummary).length ? (
        <details>
          <summary>结构化输出摘要</summary>
          <pre>{JSON.stringify(call.outputSummary, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

function editableValue(field: AiInboxField) {
  const value = field.normalizedValue;
  if (value === null || value === undefined) return "";
  const definition = getFieldDefinition(field.documentType, field.fieldName);
  if (!definition) return String(value);
  if (definition.rule === "money_cents" && typeof value === "number") return String(value / 100);
  if (definition.rule === "percent" && typeof value === "number") return `${value * 100}%`;
  return String(value);
}

function formatFieldValue(field: AiInboxField, currency: string | null) {
  const value = field.normalizedValue;
  if (value === null || value === undefined || value === "") return "缺失";
  const definition = getFieldDefinition(field.documentType, field.fieldName);
  if (!definition) return String(value);
  if (definition.rule === "money_cents" && typeof value === "number") {
    try {
      return moneyIn(currency || "USD", value);
    } catch {
      return `${(value / 100).toFixed(2)} ${currency ?? ""}`.trim();
    }
  }
  if (definition.rule === "percent" && typeof value === "number") return `${(value * 100).toFixed(2)}%`;
  if (definition.rule === "datetime" && typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp)
      : value;
  }
  return String(value);
}

function fieldStatusClass(status: AiFieldStatus) {
  if (status === "auto_accepted" || status === "accepted") return "badge-success";
  if (status === "rejected") return "badge-danger";
  if (status === "missing" || status === "needs_review" || status === "extracted") return "status-review_pending";
  return "badge-neutral";
}

function taskStatusClass(status: AiInboxTaskStatus) {
  if (status === "applied" || status === "ready") return "badge-success";
  if (status === "failed") return "badge-danger";
  if (status === "needs_review" || status === "running" || status === "queued") return "status-review_pending";
  return "badge-neutral";
}

function modeLabel(mode: string | undefined) {
  if (mode === "model") return "模型提取";
  if (mode === "deterministic") return "确定性解析";
  if (mode === "deterministic_fallback") return "降级解析";
  if (mode === "failed") return "提取失败";
  return "尚未提取";
}
