import { createHash, randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import type { EvidenceDocumentType, NormalizedFieldValue } from "./schema.ts";
import type { AiFieldRiskLevel, AiFieldStatus } from "./validator.ts";

export type AiInboxSourceKind = "paste" | "csv" | "json" | "text" | "markdown";
export type AiInboxTaskStatus = "queued" | "running" | "needs_review" | "ready" | "applied" | "failed";
export type AiInboxReviewAction = "accept" | "correct" | "reject" | "retry" | "apply";
export type AiInboxModelCallStatus = "running" | "completed" | "failed" | "skipped";

export type AiInboxExtractionSummary = {
  mode?: string;
  documentType?: EvidenceDocumentType;
  notes?: string;
  warnings?: string[];
  fieldCount?: number;
  autoAcceptedCount?: number;
  needsReviewCount?: number;
  missingRequiredCount?: number;
  canApply?: boolean;
};

export type AiInboxTask = {
  id: string;
  taskType: "evidence_extraction";
  status: AiInboxTaskStatus;
  sourceKind: AiInboxSourceKind;
  targetRunId: string | null;
  targetHypothesisId: string | null;
  targetHypothesisConcept: string | null;
  targetCurrency: string | null;
  requestedBy: string;
  provider: string;
  model: string;
  attempt: number;
  extractionSummary: AiInboxExtractionSummary;
  errorMessage: string | null;
  appliedEntityType: string | null;
  appliedEntityId: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiInboxTaskSummary = AiInboxTask & {
  fileName: string | null;
  inputChars: number;
  fieldCount: number;
  unresolvedCount: number;
};

export type AiInboxArtifact = {
  id: string;
  taskId: string;
  artifactType: "paste" | "file";
  fileName: string | null;
  mimeType: string | null;
  contentText: string;
  contentHash: string;
  sourceUrl: string | null;
  observedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AiInboxField = {
  id: string;
  taskId: string;
  documentType: EvidenceDocumentType;
  fieldName: string;
  fieldLabel: string;
  rawValue: string | null;
  normalizedValue: NormalizedFieldValue;
  confidence: number;
  status: AiFieldStatus;
  riskLevel: AiFieldRiskLevel;
  validationMessage: string;
  position: number;
  source: {
    artifactId: string | null;
    sourceType: "artifact" | "manual";
    excerpt: string;
    locator: Record<string, unknown>;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type AiInboxReviewActionRow = {
  id: string;
  fieldId: string | null;
  action: AiInboxReviewAction;
  previousValue: unknown;
  newValue: unknown;
  actor: string;
  notes: string;
  createdAt: string;
};

export type AiInboxModelCall = {
  id: string;
  attempt: number;
  provider: string;
  model: string;
  status: AiInboxModelCallStatus;
  latencyMs: number;
  inputChars: number;
  outputSummary: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
};

export type AiInboxDecision = {
  decision: "GO" | "HOLD" | "NO-GO";
  decisionScore: number;
  evidenceCompleteness: number;
  blockers: string[];
  evaluatedAt: string;
};

export type AiInboxTaskDetail = {
  task: AiInboxTask;
  artifact: AiInboxArtifact | null;
  fields: AiInboxField[];
  reviewActions: AiInboxReviewActionRow[];
  modelCalls: AiInboxModelCall[];
  decision: AiInboxDecision | null;
};

export type AiInboxHypothesisOption = {
  id: string;
  runId: string;
  concept: string;
  category: string;
  marketName: string;
  platformName: string;
  currency: string;
  decision: "GO" | "HOLD" | "NO-GO" | null;
};

export type CreateAiInboxTaskInput = {
  content: string;
  sourceKind: AiInboxSourceKind;
  fileName?: string | null;
  mimeType?: string | null;
  targetHypothesisId: string;
  requestedBy: string;
};

type TaskRow = {
  id: string;
  task_type: "evidence_extraction";
  status: AiInboxTaskStatus;
  source_kind: AiInboxSourceKind;
  target_run_id: string | null;
  target_hypothesis_id: string | null;
  target_hypothesis_concept: string | null;
  target_currency: string | null;
  requested_by: string;
  provider: string;
  model: string;
  attempt: number;
  extraction_summary: AiInboxExtractionSummary;
  error_message: string | null;
  applied_entity_type: string | null;
  applied_entity_id: string | null;
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
  updated_at: string;
};

type TaskListRow = TaskRow & {
  file_name: string | null;
  input_chars: string | number;
  field_count: string | number;
  unresolved_count: string | number;
};

type ArtifactRow = {
  id: string;
  task_id: string;
  artifact_type: "paste" | "file";
  file_name: string | null;
  mime_type: string | null;
  content_text: string;
  content_hash: string;
  source_url: string | null;
  observed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type FieldRow = {
  id: string;
  task_id: string;
  document_type: EvidenceDocumentType;
  field_name: string;
  field_label: string;
  raw_value: string | null;
  normalized_value: NormalizedFieldValue;
  confidence: string | number;
  status: AiFieldStatus;
  risk_level: AiFieldRiskLevel;
  validation_message: string;
  position: number;
  created_at: string;
  updated_at: string;
  artifact_id: string | null;
  source_type: "artifact" | "manual" | null;
  excerpt: string | null;
  locator: Record<string, unknown> | null;
};

const MAX_CONTENT_CHARS = 250_000;
const MAX_FILE_NAME_CHARS = 180;

export async function createAiInboxTask(input: CreateAiInboxTaskInput) {
  const content = normalizeContent(input.content);
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const requestedBy = requireActor(input.requestedBy);
  const targetHypothesisId = input.targetHypothesisId.trim();
  if (!targetHypothesisId) throw new Error("请选择要写入的目标机会");

  const hypothesis = await getTargetHypothesis(targetHypothesisId);
  if (!hypothesis) throw new Error("目标机会不存在");
  if (!hypothesis.selectedForValidation) throw new Error("请先把目标机会加入验证，再提交 AI 证据");

  const db = await getDb();
  const requestHash = createHash("sha256")
    .update(JSON.stringify(["ai-inbox-v1", sourceKind, targetHypothesisId, content]))
    .digest("hex");
  const contentHash = createHash("sha256").update(content).digest("hex");
  const existing = await db.query<{ id: string }>("SELECT id FROM ai_tasks WHERE request_hash = $1", [requestHash]);
  if (existing.rows[0]?.id) return getAiInboxTask(existing.rows[0].id);

  const taskId = randomUUID();
  const artifactId = randomUUID();
  const fileName = input.fileName?.trim().slice(0, MAX_FILE_NAME_CHARS) || null;
  const mimeType = input.mimeType?.trim().slice(0, 120) || null;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO ai_tasks
        (id, task_type, status, source_kind, target_hypothesis_id, request_hash, requested_by)
       VALUES ($1, 'evidence_extraction', 'queued', $2, $3, $4, $5)
       ON CONFLICT (request_hash) DO NOTHING`,
      [taskId, sourceKind, targetHypothesisId, requestHash, requestedBy],
    );
    const inserted = await tx.query<{ id: string }>("SELECT id FROM ai_tasks WHERE request_hash = $1", [requestHash]);
    const effectiveTaskId = inserted.rows[0]?.id ?? taskId;
    await tx.query(
      `INSERT INTO ai_task_artifacts
        (id, task_id, artifact_type, file_name, mime_type, content_text, content_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (task_id, content_hash) DO NOTHING`,
      [
        artifactId,
        effectiveTaskId,
        fileName ? "file" : "paste",
        fileName,
        mimeType,
        content,
        contentHash,
        JSON.stringify({ sourceKind, contentChars: content.length }),
      ],
    );
    if (effectiveTaskId === taskId) {
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'ai_inbox.task_created', 'ai_task', $3, $4::jsonb)`,
        [
          randomUUID(),
          requestedBy,
          taskId,
          JSON.stringify({
            sourceKind,
            fileName,
            contentHash,
            contentChars: content.length,
            targetHypothesisId,
            externalActions: "none",
          }),
        ],
      );
    }
  });

  const task = await getAiInboxTask(taskId);
  if (!task) throw new Error("AI 证据任务创建失败");
  return task;
}

export async function listAiInboxTasks(input: {
  status?: AiInboxTaskStatus | "all";
  sourceKind?: AiInboxSourceKind | "all";
  targetHypothesisId?: string;
  limit?: number;
} = {}): Promise<AiInboxTaskSummary[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (input.status && input.status !== "all") {
    params.push(normalizeTaskStatus(input.status));
    conditions.push(`t.status = $${params.length}`);
  }
  if (input.sourceKind && input.sourceKind !== "all") {
    params.push(normalizeSourceKind(input.sourceKind));
    conditions.push(`t.source_kind = $${params.length}`);
  }
  const targetHypothesisId = input.targetHypothesisId?.trim();
  if (targetHypothesisId) {
    params.push(targetHypothesisId);
    conditions.push(`t.target_hypothesis_id = $${params.length}`);
  }
  const limit = Math.min(100, Math.max(1, Math.round(input.limit ?? 50)));
  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query<TaskListRow>(
    `SELECT t.*, r.id AS target_run_id, h.concept AS target_hypothesis_concept, b.currency AS target_currency,
            a.file_name, a.content_chars AS input_chars,
            (SELECT COUNT(*) FROM ai_extracted_fields f WHERE f.task_id = t.id) AS field_count,
            (SELECT COUNT(*) FROM ai_extracted_fields f
              WHERE f.task_id = t.id AND f.status IN ('extracted', 'needs_review', 'missing')) AS unresolved_count
     FROM ai_tasks t
     LEFT JOIN opportunity_hypotheses h ON h.id = t.target_hypothesis_id
     LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
     LEFT JOIN sourcing_briefs b ON b.id = r.brief_id
     LEFT JOIN LATERAL (
       SELECT file_name, COALESCE(metadata->>'contentChars', char_length(content_text)::text) AS content_chars
       FROM ai_task_artifacts WHERE task_id = t.id ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     ${where}
     ORDER BY t.created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return result.rows.map((row) => ({
    ...mapTask(row),
    fileName: row.file_name,
    inputChars: Number(row.input_chars ?? 0),
    fieldCount: Number(row.field_count ?? 0),
    unresolvedCount: Number(row.unresolved_count ?? 0),
  }));
}

export async function getAiInboxTask(taskId: string): Promise<AiInboxTaskDetail | null> {
  const db = await getDb();
  const taskResult = await db.query<TaskRow>(
    `SELECT t.*, r.id AS target_run_id, h.concept AS target_hypothesis_concept, b.currency AS target_currency
     FROM ai_tasks t
     LEFT JOIN opportunity_hypotheses h ON h.id = t.target_hypothesis_id
     LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
     LEFT JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE t.id = $1`,
    [taskId],
  );
  const taskRow = taskResult.rows[0];
  if (!taskRow) return null;

  const [artifactResult, fieldResult, actionResult, callResult, decisionResult] = await Promise.all([
    db.query<ArtifactRow>(
      "SELECT * FROM ai_task_artifacts WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1",
      [taskId],
    ),
    db.query<FieldRow>(
      `SELECT f.*, s.artifact_id, s.source_type, s.excerpt, s.locator
       FROM ai_extracted_fields f
       LEFT JOIN ai_field_sources s ON s.field_id = f.id
       WHERE f.task_id = $1
       ORDER BY f.position, f.created_at`,
      [taskId],
    ),
    db.query<{
      id: string;
      field_id: string | null;
      action: AiInboxReviewAction;
      previous_value: unknown;
      new_value: unknown;
      actor: string;
      notes: string;
      created_at: string;
    }>(
      "SELECT * FROM ai_review_actions WHERE task_id = $1 ORDER BY created_at DESC LIMIT 30",
      [taskId],
    ),
    db.query<{
      id: string;
      attempt: number;
      provider: string;
      model: string;
      status: AiInboxModelCallStatus;
      latency_ms: number;
      input_chars: number;
      output_summary: Record<string, unknown>;
      error_message: string | null;
      created_at: string;
    }>(
      "SELECT * FROM ai_model_calls WHERE task_id = $1 ORDER BY created_at DESC LIMIT 20",
      [taskId],
    ),
    taskRow.target_hypothesis_id
      ? db.query<{
          decision: "GO" | "HOLD" | "NO-GO";
          decision_score: number;
          evidence_completeness: number;
          blockers: string[];
          evaluated_at: string;
        }>(
          `SELECT decision, decision_score, evidence_completeness, blockers, evaluated_at
           FROM selection_decisions WHERE hypothesis_id = $1`,
          [taskRow.target_hypothesis_id],
        )
      : Promise.resolve({ rows: [] as Array<{
          decision: "GO" | "HOLD" | "NO-GO";
          decision_score: number;
          evidence_completeness: number;
          blockers: string[];
          evaluated_at: string;
        }> }),
  ]);

  const artifactRow = artifactResult.rows[0];
  const decisionRow = decisionResult.rows[0];
  return {
    task: mapTask(taskRow),
    artifact: artifactRow ? mapArtifact(artifactRow) : null,
    fields: fieldResult.rows.map(mapField),
    reviewActions: actionResult.rows.map((row) => ({
      id: row.id,
      fieldId: row.field_id,
      action: row.action,
      previousValue: row.previous_value,
      newValue: row.new_value,
      actor: row.actor,
      notes: row.notes,
      createdAt: row.created_at,
    })),
    modelCalls: callResult.rows.map((row) => ({
      id: row.id,
      attempt: row.attempt,
      provider: row.provider,
      model: row.model,
      status: row.status,
      latencyMs: row.latency_ms,
      inputChars: row.input_chars,
      outputSummary: row.output_summary ?? {},
      errorMessage: row.error_message,
      createdAt: row.created_at,
    })),
    decision: decisionRow
      ? {
          decision: decisionRow.decision,
          decisionScore: decisionRow.decision_score,
          evidenceCompleteness: decisionRow.evidence_completeness,
          blockers: Array.isArray(decisionRow.blockers) ? decisionRow.blockers : [],
          evaluatedAt: decisionRow.evaluated_at,
        }
      : null,
  };
}

export async function listAiInboxHypotheses(): Promise<AiInboxHypothesisOption[]> {
  const db = await getDb();
  const result = await db.query<{
    id: string;
    run_id: string;
    concept: string;
    category: string;
    market_name: string;
    platform_name: string;
    currency: string;
    decision: "GO" | "HOLD" | "NO-GO" | null;
  }>(
    `SELECT h.id, r.id AS run_id, h.concept, b.category, m.name AS market_name, p.name AS platform_name, b.currency,
            d.decision
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     JOIN markets m ON m.code = b.market_code
     JOIN platforms p ON p.code = b.platform_code
     LEFT JOIN selection_decisions d ON d.hypothesis_id = h.id
     WHERE h.selected_for_validation = TRUE
       AND h.product_case_id IS NULL
     ORDER BY h.selected_for_validation DESC, h.created_at DESC
     LIMIT 200`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    runId: row.run_id,
    concept: row.concept,
    category: row.category,
    marketName: row.market_name,
    platformName: row.platform_name,
    currency: row.currency,
    decision: row.decision,
  }));
}

export type AiInboxHypothesisTaskCounts = {
  total: number;
  pending: number;
  inProgress: number;
  failed: number;
  applied: number;
};

export async function listAiInboxTaskCountsByRun(runId: string) {
  const db = await getDb();
  const result = await db.query<{
    hypothesis_id: string;
    total: string | number;
    pending: string | number;
    in_progress: string | number;
    failed: string | number;
    applied: string | number;
  }>(
    `SELECT t.target_hypothesis_id AS hypothesis_id,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.status IN ('needs_review', 'ready')) AS pending,
            COUNT(*) FILTER (WHERE t.status IN ('queued', 'running')) AS in_progress,
            COUNT(*) FILTER (WHERE t.status = 'failed') AS failed,
            COUNT(*) FILTER (WHERE t.status = 'applied') AS applied
     FROM ai_tasks t
     JOIN opportunity_hypotheses h ON h.id = t.target_hypothesis_id
     WHERE h.run_id = $1
     GROUP BY t.target_hypothesis_id`,
    [runId],
  );

  return new Map<string, AiInboxHypothesisTaskCounts>(
    result.rows.map((row) => [
      row.hypothesis_id,
      {
        total: Number(row.total),
        pending: Number(row.pending),
        inProgress: Number(row.in_progress),
        failed: Number(row.failed),
        applied: Number(row.applied),
      },
    ]),
  );
}

export async function getAiInboxTaskTarget(taskId: string) {
  const db = await getDb();
  const result = await db.query<{
    task_id: string;
    hypothesis_id: string | null;
    run_id: string | null;
    concept: string | null;
  }>(
    `SELECT t.id AS task_id, t.target_hypothesis_id AS hypothesis_id,
            r.id AS run_id, h.concept
     FROM ai_tasks t
     LEFT JOIN opportunity_hypotheses h ON h.id = t.target_hypothesis_id
     LEFT JOIN ai_sourcing_runs r ON r.id = h.run_id
     WHERE t.id = $1`,
    [taskId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    taskId: row.task_id,
    hypothesisId: row.hypothesis_id,
    runId: row.run_id,
    concept: row.concept,
  };
}

export async function getAiInboxTargetContext(hypothesisId: string) {
  return getTargetHypothesis(hypothesisId);
}

export function normalizeSourceKind(value: string): AiInboxSourceKind {
  if (value === "paste" || value === "csv" || value === "json" || value === "text" || value === "markdown") {
    return value;
  }
  throw new Error("证据来源类型必须是 paste、csv、json、text 或 markdown");
}

export function inferSourceKind(fileName: string, fallback: AiInboxSourceKind = "paste"): AiInboxSourceKind {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "csv" || extension === "tsv") return "csv";
  if (extension === "json") return "json";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (extension === "txt") return "text";
  if (extension === "pdf" || ["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(extension)) {
    throw new Error("当前版本只支持文本、CSV、JSON 和 Markdown，不支持图片或 PDF");
  }
  return fallback;
}

function normalizeContent(value: string) {
  const content = value.trim();
  if (!content) throw new Error("证据内容不能为空");
  if (content.length > MAX_CONTENT_CHARS) throw new Error(`证据内容不能超过 ${MAX_CONTENT_CHARS} 个字符`);
  return content;
}

function requireActor(value: string) {
  const actor = value.trim().slice(0, 80);
  if (!actor) throw new Error("必须填写操作人，不能匿名写入");
  return actor;
}

async function getTargetHypothesis(hypothesisId: string) {
  const db = await getDb();
  const result = await db.query<{
    id: string;
    run_id: string;
    concept: string;
    selected_for_validation: boolean;
    product_case_id: string | null;
    currency: string;
    market_code: string;
    platform_code: string;
  }>(
    `SELECT h.id, r.id AS run_id, h.concept, h.selected_for_validation, h.product_case_id,
            b.currency, b.market_code, b.platform_code
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.id = $1`,
    [hypothesisId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runId: row.run_id,
    concept: row.concept,
    selectedForValidation: row.selected_for_validation,
    productCaseId: row.product_case_id,
    currency: row.currency,
    marketCode: row.market_code,
    platformCode: row.platform_code,
  };
}

function normalizeTaskStatus(value: string): AiInboxTaskStatus {
  if (["queued", "running", "needs_review", "ready", "applied", "failed"].includes(value)) {
    return value as AiInboxTaskStatus;
  }
  throw new Error("未知任务状态");
}

function mapTask(row: TaskRow): AiInboxTask {
  return {
    id: row.id,
    taskType: row.task_type,
    status: row.status,
    sourceKind: row.source_kind,
    targetRunId: row.target_run_id,
    targetHypothesisId: row.target_hypothesis_id,
    targetHypothesisConcept: row.target_hypothesis_concept,
    targetCurrency: row.target_currency,
    requestedBy: row.requested_by,
    provider: row.provider,
    model: row.model,
    attempt: row.attempt,
    extractionSummary: row.extraction_summary ?? {},
    errorMessage: row.error_message,
    appliedEntityType: row.applied_entity_type,
    appliedEntityId: row.applied_entity_id,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtifact(row: ArtifactRow): AiInboxArtifact {
  return {
    id: row.id,
    taskId: row.task_id,
    artifactType: row.artifact_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    contentText: row.content_text,
    contentHash: row.content_hash,
    sourceUrl: row.source_url,
    observedAt: row.observed_at,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapField(row: FieldRow): AiInboxField {
  return {
    id: row.id,
    taskId: row.task_id,
    documentType: row.document_type,
    fieldName: row.field_name,
    fieldLabel: row.field_label,
    rawValue: row.raw_value,
    normalizedValue: row.normalized_value,
    confidence: Number(row.confidence),
    status: row.status,
    riskLevel: row.risk_level,
    validationMessage: row.validation_message,
    position: row.position,
    source: row.source_type
      ? {
          artifactId: row.artifact_id,
          sourceType: row.source_type,
          excerpt: row.excerpt ?? "",
          locator: row.locator ?? {},
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
