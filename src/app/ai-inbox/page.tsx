import Link from "next/link";
import {
  createAiInboxTaskAction,
  retryAiInboxTaskAction,
} from "@/app/actions";
import {
  DOCUMENT_TYPE_LABELS,
  type EvidenceDocumentType,
} from "@/lib/ai-inbox/schema";
import {
  getAiInboxTargetContext,
  listAiInboxHypotheses,
  listAiInboxTasks,
  type AiInboxSourceKind,
  type AiInboxTaskStatus,
  type AiInboxTaskSummary,
} from "@/lib/ai-inbox/repository";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    sourceKind?: string;
    targetHypothesisId?: string;
    notice?: string;
    error?: string;
  }>;
};

const TASK_STATUS_LABELS: Record<AiInboxTaskStatus, string> = {
  queued: "等待处理",
  running: "提取中",
  needs_review: "待人工审核",
  ready: "可应用",
  applied: "已写入",
  failed: "失败",
};

const SOURCE_KIND_LABELS: Record<AiInboxSourceKind, string> = {
  paste: "粘贴文本",
  csv: "CSV",
  json: "JSON",
  text: "TXT",
  markdown: "Markdown",
};

export default async function AiInboxPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const status = isTaskStatus(query.status) ? query.status : "all";
  const sourceKind = isSourceKind(query.sourceKind) ? query.sourceKind : "all";
  const requestedTargetId = query.targetHypothesisId?.trim() || null;
  const target = requestedTargetId ? await getAiInboxTargetContext(requestedTargetId) : null;
  const [allTasks, hypotheses] = await Promise.all([
    listAiInboxTasks({ limit: 100, targetHypothesisId: target?.id }),
    listAiInboxHypotheses(),
  ]);
  const tasks = allTasks.filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (sourceKind !== "all" && task.sourceKind !== sourceKind) return false;
    return true;
  });

  const pendingCount = allTasks.filter((task) =>
    task.status === "needs_review" || task.status === "ready"
  ).length;
  const appliedCount = allTasks.filter((task) => task.status === "applied").length;
  const failedCount = allTasks.filter((task) => task.status === "failed").length;
  const returnHref = target
    ? `/ai-sourcing/${encodeURIComponent(target.runId)}#hypothesis-${encodeURIComponent(target.id)}`
    : null;

  return (
    <div className="page ai-inbox-page">
      {target ? (
        <div className="ai-inbox-context-bar">
          <Link href={returnHref ?? "/ai-inbox"}>← 返回「{target.concept}」验证</Link>
          <span>{target.marketCode} / {target.platformCode} · {target.currency}</span>
        </div>
      ) : null}
      <div className="title-row">
        <div>
          <div className="eyebrow">{target ? "Opportunity evidence" : "Evidence review queue"}</div>
          <h1>{target ? "AI 智能录入" : "AI 证据收件箱"}</h1>
          <p className="muted ai-inbox-subtitle">
            {target
              ? `为「${target.concept}」整理竞品、评论或供应商报价。AI 只提取候选字段，人工确认后才写入当前机会。`
              : "把竞品、供应商报价和评论证据整理成可追溯字段。AI 只负责提取，人工确认后才写入业务事实。"}
          </p>
        </div>
        {returnHref ? (
          <Link href={returnHref} className="button secondary">返回机会验证</Link>
        ) : (
          <span className="badge badge-neutral">仅本机 / 内部工作台</span>
        )}
      </div>

      {query.notice ? <div className="notice"><strong>已完成：</strong>{query.notice}</div> : null}
      {query.error ? <div className="notice warn"><strong>未完成：</strong>{query.error}</div> : null}
      {requestedTargetId && !target ? (
        <div className="notice warn"><strong>目标机会不可用：</strong>该机会可能已删除或已转商品立项，当前展示全部证据任务。</div>
      ) : null}

      <div className="metrics-grid ai-inbox-metrics">
        <div className="metric-card">
          <span className="metric-label">{target ? "当前机会任务" : "当前筛选"}</span>
          <strong className="metric-value">{tasks.length}</strong>
          <span className="metric-note">最多展示最近 100 个任务</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">待审核 / 可应用</span>
          <strong className="metric-value">{pendingCount}</strong>
          <span className="metric-note">应用前必须完成字段审核</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">已写入业务事实</span>
          <strong className="metric-value">{appliedCount}</strong>
          <span className="metric-note">写入后重新计算确定性门禁</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">提取失败</span>
          <strong className="metric-value">{failedCount}</strong>
          <span className="metric-note">保留原始 artifact，可人工重试</span>
        </div>
      </div>

      <div className="ai-inbox-layout">
        <section className="panel ai-inbox-create">
          <div className="panel-header">
            <div>
              <h2>提交新证据</h2>
              <p>支持粘贴或上传文本、CSV、JSON、Markdown；单个文件不超过 300 KB。</p>
            </div>
          </div>
          <form action={createAiInboxTaskAction} className="stack ai-inbox-form">
            {target ? (
              <div className="ai-inbox-target-card">
                <div>
                  <span>写入目标机会</span>
                  <strong>{target.concept}</strong>
                  <small>{target.marketCode} / {target.platformCode} · {target.currency}</small>
                </div>
                <input type="hidden" name="targetHypothesisId" value={target.id} />
                <Link href="/ai-inbox">切换机会</Link>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="targetHypothesisId">写入目标机会</label>
                <select
                  id="targetHypothesisId"
                  name="targetHypothesisId"
                  required
                  disabled={hypotheses.length === 0}
                  defaultValue=""
                >
                  <option value="" disabled>选择已加入验证的机会</option>
                  {hypotheses.map((hypothesis) => (
                    <option key={hypothesis.id} value={hypothesis.id}>
                      {hypothesis.concept} · {hypothesis.category} · {hypothesis.marketName}/{hypothesis.platformName} · {hypothesis.currency}
                    </option>
                  ))}
                </select>
                <span className="help">只能写入仍处于验证阶段、尚未转为商品立项的机会。</span>
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="sourceKind">文本类型</label>
                <select id="sourceKind" name="sourceKind" defaultValue="paste">
                  {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="actor">操作人</label>
                <input id="actor" name="actor" placeholder="例如：运营负责人" maxLength={80} required />
              </div>
            </div>

            <div className="field">
              <label htmlFor="content">粘贴证据原文</label>
              <textarea
                id="content"
                name="content"
                className="tall-textarea"
                maxLength={250_000}
                placeholder={"例如：\n竞品标题: ...\n价格: 39.99\n币种: USD\n来源URL: https://...\n观察时间: 2026-11-05T10:00:00+08:00"}
              />
              <span className="help">上传文件时以文件内容为准；系统会保存原始 artifact 和内容哈希。</span>
            </div>

            <div className="dropzone ai-inbox-dropzone">
              <label htmlFor="evidenceFile">或上传证据文件</label>
              <input
                id="evidenceFile"
                name="evidenceFile"
                type="file"
                accept=".txt,.csv,.json,.md,.markdown,text/plain,text/csv,application/json,text/markdown"
              />
              <p>当前版本不支持图片和 PDF OCR，也不会自动访问外部链接。</p>
            </div>

            {hypotheses.length === 0 ? (
              <div className="notice warn">
                <strong>还没有可写入的机会：</strong>
                请先在 <Link href="/">AI 选品</Link> 中把机会加入验证。
              </div>
            ) : null}

            <button className="button primary" type="submit" disabled={!target && hypotheses.length === 0}>
              保存原始证据并开始提取
            </button>
          </form>
        </section>

        <aside className="stack">
          <section className="source-guardrail-card ai-inbox-guardrail">
            <div className="eyebrow">安全边界</div>
            <h3>AI 不替你做商业决策</h3>
            <ul className="guardrail-list">
              <li>AI 只提取可定位的事实，不生成认证、专利、销量或无风险结论。</li>
              <li>来源缺失、原文无法定位、字段冲突和币种不一致都会阻止应用。</li>
              <li>供应商主体、认证、联系方式和评论摘要等敏感字段永不自动通过。</li>
              <li>GO / HOLD / NO-GO 始终由确定性门禁计算，AI 无权修改。</li>
              <li>当前没有登录鉴权，请只在本机或受控内部工作台使用。</li>
              <li>没有自动联系供应商、发邮件、发布 Listing、改价或付款动作。</li>
            </ul>
          </section>
          <section className="section ai-inbox-ledger-note">
            <div className="eyebrow">审计留痕</div>
            <h3>每次都留下记录</h3>
            <p>原始文本、内容哈希、模型调用、字段来源、人工审核和应用动作都会保留，便于追查“这个数字从哪里来”。</p>
          </section>
        </aside>
      </div>

      <section className="panel ai-inbox-list">
        <div className="panel-header ai-inbox-list-head">
          <div>
            <h2>证据任务</h2>
            <p>按时间倒序展示；失败任务保留原证据，可重试提取。</p>
          </div>
          <form method="get" action="/ai-inbox" className="ai-inbox-filter">
            {target ? <input type="hidden" name="targetHypothesisId" value={target.id} /> : null}
            <select name="status" defaultValue={status} aria-label="筛选任务状态">
              <option value="all">全部状态</option>
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
            <select name="sourceKind" defaultValue={sourceKind} aria-label="筛选证据类型">
              <option value="all">全部输入类型</option>
              {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
                <option value={value} key={value}>{label}</option>
              ))}
            </select>
            <button className="button secondary" type="submit">筛选</button>
          </form>
        </div>

        {tasks.length === 0 ? (
          <div className="empty-state">
            <h3>当前筛选下没有任务</h3>
            <p>提交一段真实的竞品快照、供应商报价或评论证据即可开始。</p>
          </div>
        ) : (
          <div className="ai-inbox-task-list">
            {tasks.map((task) => (
              <article className="ai-inbox-task-card" key={task.id}>
                <div className="ai-inbox-task-main">
                  <div className="ai-inbox-task-title">
                    <Link href={`/ai-inbox/${encodeURIComponent(task.id)}`}>{task.targetHypothesisConcept ?? "机会已删除"}</Link>
                    <span className={`badge ${taskStatusClass(task.status)}`}>{TASK_STATUS_LABELS[task.status]}</span>
                    <span className="info-pill">{SOURCE_KIND_LABELS[task.sourceKind]}</span>
                  </div>
                  <div className="product-meta">
                    <span>{task.fileName ?? `${task.inputChars.toLocaleString("zh-CN")} 字符`}</span>
                    <span>{DOCUMENT_TYPE_LABELS[documentTypeOf(task)]}</span>
                    <span>{task.fieldCount} 个字段</span>
                    {task.unresolvedCount > 0 ? <span>{task.unresolvedCount} 个待处理</span> : null}
                    <span>{task.requestedBy}</span>
                    <span>{shortDate(task.createdAt)}</span>
                  </div>
                  {task.errorMessage ? <p className="ai-inbox-task-error">{task.errorMessage}</p> : null}
                </div>
                <div className="ai-inbox-task-actions">
                  <Link className="button secondary" href={`/ai-inbox/${encodeURIComponent(task.id)}`}>
                    {task.status === "needs_review" ? "去审核" : "查看详情"}
                  </Link>
                  {task.status === "failed" ? (
                    <form action={retryAiInboxTaskAction} className="ai-inbox-inline-form">
                      <input type="hidden" name="taskId" value={task.id} />
                      <input name="actor" aria-label="重试操作人" placeholder="操作人" defaultValue={task.requestedBy} maxLength={80} required />
                      <button className="button ghost" type="submit">重试</button>
                    </form>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function isTaskStatus(value: string | undefined): value is AiInboxTaskStatus {
  return value === "queued"
    || value === "running"
    || value === "needs_review"
    || value === "ready"
    || value === "applied"
    || value === "failed";
}

function isSourceKind(value: string | undefined): value is AiInboxSourceKind {
  return value === "paste"
    || value === "csv"
    || value === "json"
    || value === "text"
    || value === "markdown";
}

function documentTypeOf(task: AiInboxTaskSummary): EvidenceDocumentType {
  return task.extractionSummary.documentType ?? "unknown";
}

function taskStatusClass(status: AiInboxTaskStatus) {
  if (status === "applied" || status === "ready") return "badge-success";
  if (status === "failed") return "badge-danger";
  if (status === "needs_review" || status === "running" || status === "queued") return "status-review_pending";
  return "badge-neutral";
}
