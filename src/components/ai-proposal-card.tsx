import Link from "next/link";
import {
  clampConfidence,
  type ProposalGeneration,
} from "@/lib/ai-proposals/contract";
import { generationLabel } from "@/lib/ai-proposals/presentation";

export { generationLabel };

/**
 * 统一 AI 产出卡。所有 AI 产出（证据提取、供应商候选、RFQ 草稿、首页待办）
 * 都用同一套元信息：生成方式、置信度、原文出处、归属对象、人工确认边界。
 * 没有真实数据的字段一律不显示，绝不用占位值冒充置信度或引用。
 */

export function ProposalMeta({
  generation,
  confidence,
  sourceQuote,
  targetLabel,
  statusLabel,
}: {
  generation: ProposalGeneration;
  confidence?: number | null;
  sourceQuote?: string | null;
  targetLabel?: string;
  statusLabel?: string;
}) {
  const normalizedConfidence = confidence === undefined || confidence === null
    ? null
    : clampConfidence(confidence);
  const quote = sourceQuote?.trim();

  return (
    <div className="ai-proposal-meta">
      <span className="ai-proposal-chip">{generationLabel(generation)}</span>
      {normalizedConfidence !== null ? (
        <span className="ai-proposal-chip">置信度 {Math.round(normalizedConfidence * 100)}%</span>
      ) : null}
      {statusLabel ? <span className="ai-proposal-chip">{statusLabel}</span> : null}
      {targetLabel ? <span className="ai-proposal-chip">归属：{targetLabel}</span> : null}
      {quote ? (
        <span className="ai-proposal-quote" title={quote}>
          原文：{quote.length > 90 ? `${quote.slice(0, 90)}…` : quote}
        </span>
      ) : null}
    </div>
  );
}

export function ProposalCard({
  kindLabel,
  title,
  count,
  reason,
  summary,
  generation,
  confidence,
  sourceQuote,
  targetLabel,
  statusLabel,
  href,
  actionLabel = "去处理",
}: {
  kindLabel: string;
  title: string;
  count?: number;
  reason?: string;
  summary?: string;
  generation: ProposalGeneration;
  confidence?: number | null;
  sourceQuote?: string | null;
  targetLabel?: string;
  statusLabel?: string;
  href: string;
  actionLabel?: string;
}) {
  return (
    <article className="ai-proposal-card">
      <div className="ai-proposal-card-head">
        <div>
          <span className="ai-proposal-kind">{kindLabel}</span>
          <strong>{title}</strong>
        </div>
        {count && count > 0 ? <span className="badge badge-neutral">{count} 条</span> : null}
      </div>
      {reason ? <p className="ai-proposal-reason">{reason}</p> : null}
      {summary ? <p className="ai-proposal-summary">{summary}</p> : null}
      <ProposalMeta
        generation={generation}
        confidence={confidence}
        sourceQuote={sourceQuote}
        targetLabel={targetLabel}
        statusLabel={statusLabel}
      />
      <div className="ai-proposal-card-actions">
        <Link href={href} className="button secondary">{actionLabel} →</Link>
        <small>人工确认前不会写入业务表，系统不自动执行外部动作</small>
      </div>
    </article>
  );
}
