import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { extractEvidence, type ExtractionOutcome } from "./extractor.ts";
import {
  getAiInboxTask,
  getAiInboxTargetContext,
  type AiInboxExtractionSummary,
  type AiInboxTaskDetail,
  type AiInboxTaskStatus,
} from "./repository.ts";
import { validateExtraction, type ValidatedExtraction } from "./validator.ts";

export type RunAiInboxTaskOptions = {
  actor?: string;
};

export async function runAiInboxTask(
  taskId: string,
  options: RunAiInboxTaskOptions = {},
): Promise<AiInboxTaskDetail> {
  const initial = await getAiInboxTask(taskId);
  if (!initial) throw new Error("AI 证据任务不存在");
  if (initial.task.status === "applied") return initial;
  if (initial.task.status === "running") throw new Error("AI 证据任务正在执行，请勿重复提交");

  const actor = normalizeActor(options.actor ?? initial.task.requestedBy);
  if (!initial.artifact) {
    return failTask(taskId, actor, "任务缺少原始证据 artifact，无法提取", initial.task.extractionSummary);
  }
  if (!initial.task.targetHypothesisId) {
    return failTask(taskId, actor, "目标机会已不存在，无法提取证据", initial.task.extractionSummary);
  }

  const context = await getAiInboxTargetContext(initial.task.targetHypothesisId);
  if (!context) {
    return failTask(taskId, actor, "目标机会不存在，无法提取证据", initial.task.extractionSummary);
  }
  if (!context.selectedForValidation) {
    return failTask(taskId, actor, "目标机会已不在验证阶段，不能继续写入 AI 证据", initial.task.extractionSummary);
  }

  const db = await getDb();
  await db.query(
    `UPDATE ai_tasks
     SET status = 'running', error_message = NULL, updated_at = NOW()
     WHERE id = $1 AND status <> 'applied'`,
    [taskId],
  );

  let outcome: ExtractionOutcome | null = null;
  let validated: ValidatedExtraction | null = null;
  let modelCallRecorded = false;
  try {
    outcome = await extractEvidence({
      content: initial.artifact.contentText,
      sourceKind: initial.task.sourceKind,
      fileName: initial.artifact.fileName,
      targetCurrency: context.currency,
    });

    await recordModelCall(taskId, initial.task.attempt, outcome);
    modelCallRecorded = true;

    if (!outcome.extraction || outcome.extraction.documentType === "unknown") {
      return failTask(
        taskId,
        actor,
        outcome.error || "未能识别证据类型。请补充明确字段表头，或改用文本/CSV/JSON/Markdown。",
        buildSummary(outcome, null),
      );
    }
    if (Object.keys(outcome.extraction.fields).length === 0) {
      return failTask(
        taskId,
        actor,
        outcome.error || "没有从原始证据中识别到可追溯字段",
        buildSummary(outcome, null),
      );
    }

    validated = validateExtraction({
      documentType: outcome.extraction.documentType,
      fields: outcome.extraction.fields,
      content: initial.artifact.contentText,
      targetCurrency: context.currency,
      warnings: [...outcome.warnings, ...outcome.extraction.warnings],
    });
  } catch (error) {
    const message = sanitizeAiInboxError(error);
    if (outcome && !modelCallRecorded) await recordModelCall(taskId, initial.task.attempt, outcome, message);
    return failTask(taskId, actor, message, outcome ? buildSummary(outcome, null) : initial.task.extractionSummary);
  }

  const summary = buildSummary(outcome, validated);
  const nextStatus: AiInboxTaskStatus = validated.canApplyWithoutReview ? "ready" : "needs_review";

  await db.transaction(async (tx) => {
    await tx.query("DELETE FROM ai_extracted_fields WHERE task_id = $1", [taskId]);
    for (const [index, field] of validated.fields.entries()) {
      const fieldId = randomUUID();
      await tx.query(
        `INSERT INTO ai_extracted_fields
          (id, task_id, document_type, field_name, field_label, raw_value, normalized_value,
           confidence, status, risk_level, validation_message, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
        [
          fieldId,
          taskId,
          validated.documentType,
          field.fieldName,
          field.fieldLabel,
          nullableText(field.rawValue),
          JSON.stringify(field.normalizedValue),
          field.confidence,
          field.status,
          field.riskLevel,
          field.validationMessage.slice(0, 1_500),
          field.position * 100 + index,
        ],
      );
      await tx.query(
        `INSERT INTO ai_field_sources
          (id, field_id, artifact_id, source_type, excerpt, locator)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          randomUUID(),
          fieldId,
          field.sourceType === "artifact" && field.sourceQuote ? initial.artifact?.id ?? null : null,
          field.sourceType,
          field.sourceQuote.slice(0, 2_000),
          JSON.stringify(field.locator),
        ],
      );
    }

    await tx.query(
      `UPDATE ai_tasks
       SET status = $2, provider = $3, model = $4, extraction_summary = $5::jsonb,
           error_message = $6, updated_at = NOW()
       WHERE id = $1 AND status <> 'applied'`,
      [
        taskId,
        nextStatus,
        outcome?.provider ?? initial.task.provider,
        outcome?.model ?? initial.task.model,
        JSON.stringify(summary),
        outcome?.error ? sanitizeAiInboxError(outcome.error) : null,
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_inbox.task_completed', 'ai_task', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        taskId,
        JSON.stringify({
          status: nextStatus,
          provider: outcome?.provider ?? initial.task.provider,
          model: outcome?.model ?? initial.task.model,
          mode: outcome?.mode ?? "unknown",
          documentType: validated.documentType,
          fieldCount: validated.fields.length,
          autoAcceptedCount: validated.autoAcceptedFields.length,
          needsReviewCount: validated.needsReviewFields.length,
          missingRequiredCount: validated.missingRequiredFields.length,
          warnings: summary.warnings,
          promptVersion: "ai-inbox-extraction-v1",
          schemaVersion: "ai-inbox-fields-v1",
          externalActions: "none",
        }),
      ],
    );
  });

  return requireTask(taskId);
}

export async function retryAiInboxTask(taskId: string, actorInput: string): Promise<AiInboxTaskDetail> {
  const actor = normalizeActor(actorInput);
  const detail = await getAiInboxTask(taskId);
  if (!detail) throw new Error("AI 证据任务不存在");
  if (detail.task.status === "applied") throw new Error("已应用的任务不能重试");
  if (detail.task.status === "running") throw new Error("任务正在执行，不能重试");

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE ai_tasks
       SET status = 'queued', attempt = attempt + 1, error_message = NULL, updated_at = NOW()
       WHERE id = $1`,
      [taskId],
    );
    await tx.query(
      `INSERT INTO ai_review_actions
        (id, task_id, field_id, action, previous_value, new_value, actor, notes)
       VALUES ($1, $2, NULL, 'retry', $3::jsonb, NULL, $4, $5)`,
      [
        randomUUID(),
        taskId,
        JSON.stringify({ attempt: detail.task.attempt, status: detail.task.status }),
        actor,
        "人工触发重试；原始 artifact 和模型调用历史保留",
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_inbox.task_retried', 'ai_task', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        taskId,
        JSON.stringify({
          previousAttempt: detail.task.attempt,
          previousStatus: detail.task.status,
          externalActions: "none",
        }),
      ],
    );
  });

  return runAiInboxTask(taskId, { actor });
}

function buildSummary(
  outcome: ExtractionOutcome | null,
  validated: ValidatedExtraction | null,
): AiInboxExtractionSummary {
  return {
    mode: outcome?.mode ?? "failed",
    documentType: validated?.documentType ?? outcome?.extraction?.documentType ?? "unknown",
    notes: outcome?.extraction?.notes?.slice(0, 500) ?? "",
    warnings: [...new Set([...(outcome?.warnings ?? []), ...(validated?.warnings ?? [])])].slice(0, 30),
    fieldCount: validated?.fields.length ?? Object.keys(outcome?.extraction?.fields ?? {}).length,
    autoAcceptedCount: validated?.autoAcceptedFields.length ?? 0,
    needsReviewCount: validated?.needsReviewFields.length ?? 0,
    missingRequiredCount: validated?.missingRequiredFields.length ?? 0,
    canApply: validated?.canApplyWithoutReview ?? false,
  };
}

async function recordModelCall(
  taskId: string,
  attempt: number,
  outcome: ExtractionOutcome,
  overrideError?: string,
) {
  const db = await getDb();
  const modelFailed = Boolean(outcome.error || overrideError) && !outcome.extraction;
  const status = outcome.skippedModel ? "skipped" : modelFailed ? "failed" : "completed";
  await db.query(
    `INSERT INTO ai_model_calls
      (id, task_id, attempt, provider, model, status, latency_ms, input_chars,
       output_summary, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      randomUUID(),
      taskId,
      attempt,
      outcome.provider.slice(0, 80),
      outcome.model.slice(0, 120),
      status,
      Math.max(0, Math.round(outcome.latencyMs)),
      outcome.inputChars,
      JSON.stringify({
        mode: outcome.mode,
        documentType: outcome.extraction?.documentType ?? "unknown",
        fieldCount: Object.keys(outcome.extraction?.fields ?? {}).length,
        warnings: outcome.warnings.slice(0, 20),
        promptVersion: "ai-inbox-extraction-v1",
        schemaVersion: "ai-inbox-fields-v1",
      }),
      (overrideError || outcome.error)?.slice(0, 1_500) ?? null,
    ],
  );
}

async function failTask(
  taskId: string,
  actor: string,
  error: string,
  summary: AiInboxExtractionSummary,
): Promise<AiInboxTaskDetail> {
  const db = await getDb();
  const safeError = sanitizeAiInboxError(error);
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE ai_tasks
       SET status = 'failed', error_message = $2, extraction_summary = $3::jsonb, updated_at = NOW()
       WHERE id = $1 AND status <> 'applied'`,
      [taskId, safeError, JSON.stringify({ ...summary, warnings: summary.warnings?.slice(0, 30), canApply: false })],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_inbox.task_failed', 'ai_task', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        taskId,
        JSON.stringify({ error: safeError, externalActions: "none" }),
      ],
    );
  });
  return requireTask(taskId);
}

async function requireTask(taskId: string) {
  const detail = await getAiInboxTask(taskId);
  if (!detail) throw new Error("AI 证据任务不存在");
  return detail;
}

function normalizeActor(value: string) {
  const actor = value.trim().slice(0, 80);
  if (!actor) throw new Error("必须填写操作人，不能匿名执行");
  return actor;
}

function nullableText(value: string) {
  const text = value.trim();
  return text ? text.slice(0, 4_000) : null;
}

export function sanitizeAiInboxError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [REDACTED]")
    .replace(/(api[_-]?key|token|secret)\s*[=:]\s*["']?[^"'\s,}]+/gi, "$1=[REDACTED]")
    .slice(0, 1_500);
}
