/**
 * 首页「待确认 AI 提案」聚合。
 *
 * 设计约束（对应三层结构里的 L2）：
 * - 不新增页面、不新增表、不写库；只读现有业务表里已经存在的 AI 产出。
 * - 每条提案都挂在业务对象上，href 直接跳回该对象，而不是跳到某个 AI 中心页。
 * - 每条都带生成方式（模型 / 模板兜底）和「为什么需要人工处理」的理由。
 * - 任一来源查询失败不阻塞首页，降级为空并留下 warning。
 *
 * 领域加载与纯计算分离：loadPendingAiProposals() 只读库，
 * buildAiProposalDigest() 是可以在无数据库环境下测试的纯函数。
 */

import { getDb } from "../db.ts";
import type { ProposalGeneration, ProposalTarget } from "./contract.ts";

export type AiProposalKind = "evidence_extraction" | "supplier_draft" | "supplier_candidate";

export const AI_PROPOSAL_KIND_LABELS: Record<AiProposalKind, string> = {
  evidence_extraction: "证据提取",
  supplier_draft: "供应商草稿",
  supplier_candidate: "供应商候选",
};

/** 归一化后的单条待处理 AI 提案，尚未按业务对象合并。 */
export type PendingAiProposal = {
  id: string;
  kind: AiProposalKind;
  status: string;
  target: ProposalTarget;
  /** 业务对象标题：机会概念、文件名或草稿主题，用于首页显示。 */
  title: string;
  /** 这条为什么需要人工处理，必须能回答「为什么给我这条」。 */
  reason: string;
  generation: ProposalGeneration;
  hypothesisId: string | null;
  hypothesisConcept: string | null;
  runId: string | null;
  /** 无业务对象归属时的兜底落点（证据收件箱）。 */
  fallbackHref: string;
  createdAt: string;
};

/** 同一个业务对象下的待确认提案合成一条首页待办。 */
export type AiProposalGroup = {
  key: string;
  title: string;
  count: number;
  kinds: AiProposalKind[];
  /** 「证据提取 2 条 · 供应商候选 3 条」这类汇总说明。 */
  summary: string;
  /** 组内最紧急一条的理由，作为首页可见的解释。 */
  reason: string;
  href: string;
  latestAt: string;
  urgency: number;
};

export type AiProposalDigest = {
  total: number;
  groups: AiProposalGroup[];
  byKind: Record<AiProposalKind, number>;
  warnings: string[];
};

/** 越小越紧急。只用于排序展示，不是业务阈值，也不触发任何动作。 */
const KIND_URGENCY: Record<AiProposalKind, number> = {
  evidence_extraction: 0,
  supplier_draft: 1,
  supplier_candidate: 2,
};

const STATUS_URGENCY: Record<string, number> = {
  failed: 0,
  needs_review: 1,
  ready: 2,
  draft: 3,
  candidate: 4,
};

function urgencyOf(item: PendingAiProposal): number {
  return (STATUS_URGENCY[item.status] ?? 9) * 10 + KIND_URGENCY[item.kind];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asText(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value === null || value === undefined ? "" : String(value);
}

function asCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function generationOf(input: {
  provider?: string | null;
  model?: string | null;
  fallback?: boolean;
  mode?: string | null;
}): ProposalGeneration {
  const provider = asText(input.provider) || "template";
  const model = asText(input.model) || "deterministic-v1";
  const fallback = Boolean(input.fallback) || provider === "template" || input.mode === "deterministic";
  return {
    source: fallback ? "template" : "model",
    provider,
    model,
    fallback,
  };
}

function businessObjectHref(item: PendingAiProposal): string {
  if (item.hypothesisId && item.runId) {
    return `/ai-sourcing/${encodeURIComponent(item.runId)}#hypothesis-${encodeURIComponent(item.hypothesisId)}`;
  }
  return item.fallbackHref;
}

/**
 * 把散落的 AI 产出汇成首页待办流。纯函数，不读库、不产生 UI。
 * 同一业务对象只出现一条，但保留各类型计数与最紧急的理由。
 */
export function buildAiProposalDigest(
  items: readonly PendingAiProposal[],
  options: { limit?: number; warnings?: readonly string[] } = {},
): AiProposalDigest {
  const limit = Math.max(1, Math.round(options.limit ?? 4));
  const byKind: Record<AiProposalKind, number> = {
    evidence_extraction: 0,
    supplier_draft: 0,
    supplier_candidate: 0,
  };
  const buckets = new Map<string, PendingAiProposal[]>();

  for (const item of items) {
    byKind[item.kind] += 1;
    // 有业务对象归属的按对象合并；没有归属的各自成条，避免错误地把无关任务聚在一起。
    const key = item.hypothesisId ? `hypothesis:${item.hypothesisId}` : `proposal:${item.id}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const groups: AiProposalGroup[] = [...buckets.entries()].map(([key, bucket]) => {
    const sorted = [...bucket].sort(
      (left, right) => urgencyOf(left) - urgencyOf(right) || timestamp(right.createdAt) - timestamp(left.createdAt),
    );
    const kinds = [...new Set(sorted.map((item) => item.kind))];
    const counts = new Map<AiProposalKind, number>();
    for (const item of sorted) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    const primary = sorted[0];
    return {
      key,
      title: primary.hypothesisConcept?.trim() || primary.title || "未命名业务对象",
      count: sorted.length,
      kinds,
      summary: kinds
        .map((kind) => `${AI_PROPOSAL_KIND_LABELS[kind]} ${counts.get(kind) ?? 0} 条`)
        .join(" · "),
      reason: primary.reason,
      href: businessObjectHref(primary),
      latestAt: sorted.reduce((latest, item) => (timestamp(item.createdAt) > timestamp(latest) ? item.createdAt : latest), sorted[0].createdAt),
      urgency: urgencyOf(primary),
    };
  });

  groups.sort((left, right) => left.urgency - right.urgency || timestamp(right.latestAt) - timestamp(left.latestAt));
  return {
    total: items.length,
    groups: groups.slice(0, limit),
    byKind,
    warnings: [...(options.warnings ?? [])],
  };
}

export type EvidenceRow = {
  id: string;
  status: string;
  requested_by: string;
  provider: string | null;
  model: string | null;
  created_at: unknown;
  target_hypothesis_id: string | null;
  hypothesis_concept: string | null;
  run_id: string | null;
  file_name: string | null;
  unresolved_count: unknown;
  error_message: string | null;
};

export type DraftRow = {
  id: string;
  draft_type: string;
  subject: string;
  missing_fields: unknown;
  generation_mode: string | null;
  provider: string | null;
  model: string | null;
  created_at: unknown;
  hypothesis_id: string;
  hypothesis_concept: string | null;
  run_id: string | null;
};

export type CandidateRow = {
  id: string;
  title: string;
  supplier_name: string;
  score: number | string;
  created_at: unknown;
  hypothesis_id: string;
  hypothesis_concept: string | null;
  run_id: string | null;
};

const DRAFT_TYPE_LABELS: Record<string, string> = {
  rfq: "询价草稿",
  followup: "追问草稿",
  expiry_reminder: "到期提醒",
};

function jsonArrayLength(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function toEvidenceProposal(row: EvidenceRow): PendingAiProposal {
  const unresolved = asCount(row.unresolved_count);
  const reason =
    row.status === "failed"
      ? `证据提取失败，需要重新处理${row.error_message ? `：${row.error_message.slice(0, 80)}` : ""}`
      : row.status === "ready"
        ? "字段已校验通过，等待人工确认后才写入业务表"
        : `证据字段待人工审核${unresolved > 0 ? `，还有 ${unresolved} 个字段未确认` : ""}`;
  const generation = generationOf({ provider: row.provider, model: row.model });
  return {
    id: row.id,
    kind: "evidence_extraction",
    status: row.status,
    target: {
      entityType: row.target_hypothesis_id ? "opportunity_hypothesis" : "ai_task",
      entityId: row.target_hypothesis_id ?? row.id,
    },
    title: row.file_name?.trim() || row.hypothesis_concept?.trim() || "证据提取任务",
    reason: `${reason}；生成方式：${generation.source === "template" ? "模板兜底" : `${generation.provider}/${generation.model}`}`,
    generation,
    hypothesisId: row.target_hypothesis_id,
    hypothesisConcept: row.hypothesis_concept,
    runId: row.run_id,
    fallbackHref: `/ai-inbox?status=${encodeURIComponent(row.status)}`,
    createdAt: asText(row.created_at),
  };
}

function toDraftProposal(row: DraftRow): PendingAiProposal {
  const missing = jsonArrayLength(row.missing_fields);
  const label = DRAFT_TYPE_LABELS[row.draft_type] ?? "供应商草稿";
  const generation = generationOf({
    provider: row.provider,
    model: row.model,
    mode: row.generation_mode,
  });
  return {
    id: row.id,
    kind: "supplier_draft",
    status: "draft",
    target: { entityType: "supplier_draft", entityId: row.id },
    title: row.subject?.trim() || label,
    reason: `${label}由${row.generation_mode === "deterministic" ? "确定性模板" : "模型润色"}生成，待人工复核${missing > 0 ? `；缺 ${missing} 项信息待追问` : ""}；系统不会自动发送`,
    generation,
    hypothesisId: row.hypothesis_id,
    hypothesisConcept: row.hypothesis_concept,
    runId: row.run_id,
    fallbackHref: "/ai-sourcing",
    createdAt: asText(row.created_at),
  };
}

function toCandidateProposal(row: CandidateRow): PendingAiProposal {
  const score = asCount(row.score);
  return {
    id: row.id,
    kind: "supplier_candidate",
    status: "candidate",
    target: { entityType: "supplier_candidate", entityId: row.id },
    title: row.title?.trim() || row.supplier_name?.trim() || "供应商候选",
    reason: `可见页采集的候选，评分 ${score}，待人工核对来源后才能加入短名单；不自动写入供应商表`,
    generation: { source: "manual", provider: "visible-page-capture", model: "deterministic-v1" },
    hypothesisId: row.hypothesis_id,
    hypothesisConcept: row.hypothesis_concept,
    runId: row.run_id,
    fallbackHref: "/ai-sourcing",
    createdAt: asText(row.created_at),
  };
}

/** 把三个来源的原始行归一成统一提案；纯函数，便于在无数据库环境下验证文案与落点。 */
export function normalizeProposalRows(rows: {
  evidence?: readonly EvidenceRow[];
  drafts?: readonly DraftRow[];
  candidates?: readonly CandidateRow[];
}): PendingAiProposal[] {
  return [
    ...(rows.evidence ?? []).map(toEvidenceProposal),
    ...(rows.drafts ?? []).map(toDraftProposal),
    ...(rows.candidates ?? []).map(toCandidateProposal),
  ];
}

/**
 * 只读加载当前需要人工确认的 AI 产出。三个来源相互独立，任一失败不影响其余，
 * 也不让首页因为 AI 数据不可用而整页报错。
 */
export async function loadPendingAiProposals(
  options: { limit?: number; perSourceLimit?: number } = {},
): Promise<AiProposalDigest> {
  const db = await getDb();
  const perSourceLimit = Math.min(100, Math.max(1, Math.round(options.perSourceLimit ?? 50)));
  const warnings: string[] = [];

  const [evidence, drafts, candidates] = await Promise.allSettled([
    db.query<EvidenceRow>(
      `SELECT t.id, t.status, t.requested_by, t.provider, t.model, t.created_at,
              t.target_hypothesis_id, h.concept AS hypothesis_concept, r.id AS run_id,
              t.error_message, a.file_name,
              (SELECT COUNT(*) FROM ai_extracted_fields f
                WHERE f.task_id = t.id AND f.status IN ('extracted', 'needs_review', 'missing')) AS unresolved_count
       FROM ai_tasks t
       LEFT JOIN opportunity_hypotheses h ON h.id = t.target_hypothesis_id
       LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
       LEFT JOIN LATERAL (
         SELECT file_name FROM ai_task_artifacts WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
       ) a ON TRUE
       WHERE t.status IN ('needs_review', 'ready', 'failed')
       ORDER BY t.created_at DESC
       LIMIT $1`,
      [perSourceLimit],
    ),
    db.query<DraftRow>(
      `SELECT d.id, d.draft_type, d.subject, d.missing_fields, d.generation_mode,
              d.provider, d.model, d.created_at, d.hypothesis_id,
              h.concept AS hypothesis_concept, r.id AS run_id
       FROM ai_supplier_drafts d
       JOIN opportunity_hypotheses h ON h.id = d.hypothesis_id
       LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
       WHERE d.status = 'draft'
       ORDER BY d.created_at DESC
       LIMIT $1`,
      [perSourceLimit],
    ),
    db.query<CandidateRow>(
      `SELECT c.id, c.title, c.supplier_name, c.score, c.created_at, c.hypothesis_id,
              h.concept AS hypothesis_concept, r.id AS run_id
       FROM supplier_candidates c
       JOIN opportunity_hypotheses h ON h.id = c.hypothesis_id
       LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
       WHERE c.status = 'candidate'
       ORDER BY c.score DESC, c.created_at DESC
       LIMIT $1`,
      [perSourceLimit],
    ),
  ]);

  const evidenceRows = evidence.status === "fulfilled" ? evidence.value.rows : [];
  const draftRows = drafts.status === "fulfilled" ? drafts.value.rows : [];
  const candidateRows = candidates.status === "fulfilled" ? candidates.value.rows : [];
  if (evidence.status === "rejected") warnings.push("证据提取提案暂时不可用");
  if (drafts.status === "rejected") warnings.push("供应商草稿提案暂时不可用");
  if (candidates.status === "rejected") warnings.push("供应商候选提案暂时不可用");

  const items = normalizeProposalRows({
    evidence: evidenceRows,
    drafts: draftRows,
    candidates: candidateRows,
  });

  return buildAiProposalDigest(items, { limit: options.limit, warnings });
}
