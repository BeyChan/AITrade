import { randomUUID } from "node:crypto";
import { getDb } from "../db.ts";
import { refreshAISelectionDecision } from "../ai-sourcing-repository.ts";
import {
  getFieldDefinition,
  getFieldDefinitions,
  normalizeFieldValue,
  validateNormalizedFieldValue,
  type EvidenceDocumentType,
  type FieldDefinition,
  type NormalizedFieldValue,
} from "./schema.ts";
import {
  getAiInboxTask,
  type AiInboxField,
  type AiInboxTaskDetail,
} from "./repository.ts";
import type { AiFieldStatus } from "./validator.ts";
import { sanitizeAiInboxError } from "./worker.ts";

export type ReviewAiInboxFieldInput = {
  taskId: string;
  fieldId: string;
  action: "accept" | "correct" | "reject";
  actor: string;
  value?: NormalizedFieldValue;
  notes?: string;
};

export type ApplyAiInboxTaskInput = {
  taskId: string;
  actor: string;
};

type Queryable = {
  query<T>(query: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

type TaskLockRow = {
  id: string;
  status: "queued" | "running" | "needs_review" | "ready" | "applied" | "failed";
  target_hypothesis_id: string | null;
  applied_entity_type: string | null;
  applied_entity_id: string | null;
  applied_at: string | null;
  applied_by: string | null;
  error_message: string | null;
};

type StoredFieldRow = {
  id: string;
  task_id: string;
  document_type: EvidenceDocumentType;
  field_name: string;
  field_label: string;
  raw_value: string | null;
  normalized_value: NormalizedFieldValue;
  confidence: string | number;
  status: AiFieldStatus;
  risk_level: "normal" | "sensitive";
  validation_message: string;
  position: number;
  artifact_id: string | null;
  source_type: "artifact" | "manual" | null;
  excerpt: string | null;
  locator: Record<string, unknown> | null;
};

type FieldEvaluation = {
  documentType: EvidenceDocumentType;
  values: Record<string, NormalizedFieldValue>;
  fields: StoredFieldRow[];
  blockers: string[];
  minConfidence: number;
};

type TargetRow = {
  id: string;
  selected_for_validation: boolean;
  product_case_id: string | null;
  currency: string;
  concept: string;
};

type ApplyResult = {
  entityType: string;
  entityId: string;
};

const APPLICABLE_STATUSES = new Set(["needs_review", "ready"]);

export async function reviewAiInboxField(
  input: ReviewAiInboxFieldInput,
): Promise<AiInboxTaskDetail> {
  const actor = normalizeActor(input.actor);
  if (!["accept", "correct", "reject"].includes(input.action)) {
    throw new Error("审核动作必须是 accept、correct 或 reject");
  }
  if (!input.taskId.trim() || !input.fieldId.trim()) throw new Error("缺少任务或字段标识");

  const db = await getDb();
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, input.taskId);
    if (!task) throw new Error("AI 证据任务不存在");
    if (task.status === "applied") throw new Error("任务已应用，不能再修改字段");
    if (!APPLICABLE_STATUSES.has(task.status)) {
      throw new Error("任务尚未完成提取，或已失败；请先执行/重试提取");
    }

    const fields = await readTaskFields(tx, input.taskId);
    const field = fields.find((item) => item.id === input.fieldId);
    if (!field) throw new Error("字段不存在或不属于当前任务");
    const definition = getFieldDefinition(field.document_type, field.field_name);
    if (!definition) throw new Error("字段定义已失效，不能审核");

    const target = task.target_hypothesis_id
      ? await readTarget(tx, task.target_hypothesis_id)
      : null;
    const targetCurrency = target?.currency.toUpperCase() ?? null;

    if (input.action === "reject") {
      await tx.query(
        `UPDATE ai_extracted_fields
         SET status = 'rejected', validation_message = $2, updated_at = NOW()
         WHERE id = $1 AND task_id = $3`,
        [
          field.id,
          appendMessage("人工拒绝该候选值", input.notes),
          input.taskId,
        ],
      );
    } else if (input.action === "correct") {
      const normalized = normalizeFieldValue(definition, input.value ?? null);
      if (normalized.error) throw new Error(`${definition.label}：${normalized.error}`);
      assertCurrency(normalized.value, definition, targetCurrency);
      const note = sanitizeReviewNote(input.notes);
      await tx.query(
        `UPDATE ai_extracted_fields
         SET raw_value = $2, normalized_value = $3::jsonb, status = 'accepted',
             validation_message = $4, updated_at = NOW()
         WHERE id = $1 AND task_id = $5`,
        [
          field.id,
          normalized.value === null ? null : String(normalized.value),
          JSON.stringify(normalized.value),
          appendMessage("审核人手工修正并确认", note),
          input.taskId,
        ],
      );
      await tx.query(
        `INSERT INTO ai_field_sources
          (id, field_id, artifact_id, source_type, excerpt, locator)
         VALUES ($1, $2, NULL, 'manual', $3, $4::jsonb)
         ON CONFLICT (field_id) DO UPDATE SET
           artifact_id = NULL,
           source_type = 'manual',
           excerpt = EXCLUDED.excerpt,
           locator = EXCLUDED.locator`,
        [
          randomUUID(),
          field.id,
          note || "审核人手工修正，无自动原文定位",
          JSON.stringify({ manual: true }),
        ],
      );
    } else {
      assertAcceptableSource(field);
      const normalized = validateNormalizedFieldValue(definition, field.normalized_value);
      if (normalized.error) throw new Error(`${definition.label}：${normalized.error}`);
      assertCurrency(normalized.value, definition, targetCurrency);
      await tx.query(
        `UPDATE ai_extracted_fields
         SET status = 'accepted', validation_message = $2, updated_at = NOW()
         WHERE id = $1 AND task_id = $3`,
        [
          field.id,
          appendMessage(
            field.source_type === "manual" ? "人工已确认手工修正值" : "人工已确认原始来源",
            input.notes,
          ),
          input.taskId,
        ],
      );
    }

    const refreshed = await readTaskFields(tx, input.taskId);
    const evaluation = evaluateStoredFields(refreshed, targetCurrency);
    const nextStatus = evaluation.blockers.length === 0 ? "ready" : "needs_review";
    await tx.query(
      `UPDATE ai_tasks
       SET status = $2, error_message = NULL, updated_at = NOW()
       WHERE id = $1 AND status <> 'applied'`,
      [input.taskId, nextStatus],
    );
    await tx.query(
      `INSERT INTO ai_review_actions
        (id, task_id, field_id, action, previous_value, new_value, actor, notes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
      [
        randomUUID(),
        input.taskId,
        field.id,
        input.action,
        JSON.stringify({
          status: field.status,
          rawValue: field.raw_value,
          normalizedValue: field.normalized_value,
          sourceType: field.source_type,
        }),
        JSON.stringify({
          status: input.action === "reject" ? "rejected" : "accepted",
          value: input.action === "correct" ? input.value ?? null : field.normalized_value,
        }),
        actor,
        sanitizeReviewNote(input.notes),
      ],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_inbox.field_reviewed', 'ai_extracted_field', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        field.id,
        JSON.stringify({
          taskId: input.taskId,
          reviewAction: input.action,
          fieldName: field.field_name,
          resultingTaskStatus: nextStatus,
          externalActions: "none",
        }),
      ],
    );
  });

  return requireTask(input.taskId);
}

export async function applyAiInboxTask(
  input: ApplyAiInboxTaskInput,
): Promise<AiInboxTaskDetail> {
  const actor = normalizeActor(input.actor);
  if (!input.taskId.trim()) throw new Error("缺少任务标识");

  const db = await getDb();
  let result: ApplyResult | null = null;
  let alreadyApplied = false;
  let hypothesisId: string | null = null;

  try {
    await db.transaction(async (tx) => {
      const task = await lockTask(tx, input.taskId);
      if (!task) throw new Error("AI 证据任务不存在");
      if (task.status === "applied") {
        alreadyApplied = true;
        return;
      }
      if (!APPLICABLE_STATUSES.has(task.status)) {
        throw new Error("任务必须完成提取并进入待审核/可应用状态后才能应用");
      }
      if (!task.target_hypothesis_id) throw new Error("目标机会已不存在，不能应用证据");
      hypothesisId = task.target_hypothesis_id;
      const target = await readTarget(tx, hypothesisId, true);
      if (!target) throw new Error("目标机会不存在，不能应用证据");
      if (!target.selected_for_validation) throw new Error("目标机会已不在验证阶段，不能应用证据");
      if (target.product_case_id) throw new Error("目标机会已转为商品立项，不能继续写入验证证据");

      const fields = await readTaskFields(tx, input.taskId);
      if (fields.length === 0) throw new Error("任务没有可应用字段");
      const evaluation = evaluateStoredFields(fields, target.currency);
      if (evaluation.blockers.length > 0) {
        throw new Error(`不能应用：${evaluation.blockers.slice(0, 8).join("；")}`);
      }

      result = await writeBusinessFacts(tx, {
        taskId: input.taskId,
        hypothesisId,
        actor,
        fields,
        evaluation,
        target,
      });

      const updated = await tx.query<{ id: string }>(
        `UPDATE ai_tasks
         SET status = 'applied', applied_entity_type = $2, applied_entity_id = $3,
             applied_at = NOW(), applied_by = $4, error_message = NULL, updated_at = NOW()
         WHERE id = $1 AND status <> 'applied'
         RETURNING id`,
        [input.taskId, result.entityType, result.entityId, actor],
      );
      if (!updated.rows[0]) {
        throw new Error("任务状态已变化，请刷新后重试");
      }
      await tx.query(
        `INSERT INTO ai_review_actions
          (id, task_id, field_id, action, previous_value, new_value, actor, notes)
         VALUES ($1, $2, NULL, 'apply', NULL, $3::jsonb, $4, $5)`,
        [
          randomUUID(),
          input.taskId,
          JSON.stringify({ entityType: result.entityType, entityId: result.entityId }),
          actor,
          "审核完成后原子写入业务事实；不产生外部动作",
        ],
      );
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'ai_inbox.task_applied', 'ai_task', $3, $4::jsonb)`,
        [
          randomUUID(),
          actor,
          input.taskId,
          JSON.stringify({
            targetHypothesisId: hypothesisId,
            documentType: evaluation.documentType,
            appliedEntityType: result.entityType,
            appliedEntityId: result.entityId,
            externalActions: "none",
          }),
        ],
      );
    });
  } catch (error) {
    const safeError = sanitizeAiInboxError(error);
    await db.query(
      `UPDATE ai_tasks
       SET error_message = $2, updated_at = NOW()
       WHERE id = $1 AND status <> 'applied'`,
      [input.taskId, safeError],
    );
    throw new Error(safeError);
  }

  if (alreadyApplied || !result || !hypothesisId) return requireTask(input.taskId);

  try {
    await refreshAISelectionDecision(hypothesisId);
  } catch (error) {
    const safeError = sanitizeAiInboxError(error);
    await db.query(
      `UPDATE ai_tasks SET error_message = $2, updated_at = NOW() WHERE id = $1`,
      [input.taskId, `业务事实已应用，但确定性门禁重算失败：${safeError}`],
    );
    await db.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai_inbox.decision_refresh_failed', 'ai_task', $3, $4::jsonb)`,
      [
        randomUUID(),
        actor,
        input.taskId,
        JSON.stringify({ error: safeError, externalActions: "none" }),
      ],
    );
    throw new Error(`业务事实已应用，但确定性门禁重算失败：${safeError}`);
  }

  return requireTask(input.taskId);
}

export function evaluateStoredFields(
  fields: StoredFieldRow[],
  targetCurrency: string | null,
): FieldEvaluation {
  const blockers: string[] = [];
  const values: Record<string, NormalizedFieldValue> = {};
  const documentTypes = new Set(fields.map((field) => field.document_type));
  if (documentTypes.size !== 1) blockers.push("任务包含多种证据类型，不能合并应用");
  const documentType = fields[0]?.document_type ?? "unknown";
  if (documentType === "unknown") blockers.push("证据类型尚未识别");

  const grouped = new Map<string, StoredFieldRow[]>();
  for (const field of fields) {
    const group = grouped.get(field.field_name) ?? [];
    group.push(field);
    grouped.set(field.field_name, group);
  }

  let minConfidence = 1;
  for (const [fieldName, candidates] of grouped) {
    const definition = getFieldDefinition(documentType, fieldName);
    if (!definition) continue;

    const pending = candidates.filter((field) => field.status === "needs_review" || field.status === "extracted");
    if (pending.length > 0) blockers.push(`${definition.label} 尚未完成人工审核`);

    const accepted = candidates.filter(
      (field) => field.status === "auto_accepted" || field.status === "accepted",
    );
    if (accepted.length === 0) {
      if (definition.required) blockers.push(`${definition.label} 缺少已确认值`);
      continue;
    }

    const distinct = new Set(accepted.map((field) => JSON.stringify(field.normalized_value)));
    if (distinct.size > 1) {
      blockers.push(`${definition.label} 存在多个已接受但不同的值`);
      continue;
    }

    const selected = accepted[0];
    if (!selected) continue;
    const normalized = validateNormalizedFieldValue(definition, selected.normalized_value);
    if (normalized.error) {
      blockers.push(`${definition.label}：${normalized.error}`);
      continue;
    }
    if (definition.rule === "currency" && targetCurrency && normalized.value !== targetCurrency.toUpperCase()) {
      blockers.push(`${definition.label}必须与目标机会币种 ${targetCurrency.toUpperCase()} 一致`);
      continue;
    }
    if (selected.source_type !== "manual" && selected.source_type !== "artifact") {
      blockers.push(`${definition.label} 缺少来源记录`);
      continue;
    }
    if (selected.source_type === "artifact" && selected.locator?.matched !== true) {
      blockers.push(`${definition.label} 的来源原文无法定位`);
      continue;
    }
    values[fieldName] = normalized.value;
    minConfidence = Math.min(minConfidence, Number(selected.confidence));
  }

  for (const definition of getDefinitions(documentType)) {
    if (definition.required && !(definition.name in values)) {
      const existing = grouped.get(definition.name);
      if (!existing) blockers.push(`${definition.label} 缺少已确认值`);
    }
  }

  const monthlyMin = values.monthlySalesMin;
  const monthlyMax = values.monthlySalesMax;
  if (typeof monthlyMin === "number" && typeof monthlyMax === "number" && monthlyMin > monthlyMax) {
    blockers.push("月销量下限不能大于上限");
  }

  return {
    documentType,
    values,
    fields,
    blockers: [...new Set(blockers)],
    minConfidence: Number.isFinite(minConfidence) ? minConfidence : 0,
  };
}

async function writeBusinessFacts(
  tx: Queryable,
  input: {
    taskId: string;
    hypothesisId: string;
    actor: string;
    fields: StoredFieldRow[];
    evaluation: FieldEvaluation;
    target: TargetRow;
  },
): Promise<ApplyResult> {
  const { values, documentType, minConfidence } = input.evaluation;
  const rawSnapshot = JSON.stringify({
    aiTaskId: input.taskId,
    documentType,
    extractedValues: values,
    confidence: minConfidence,
    appliedBy: input.actor,
    externalActions: "none",
  });
  const observedAt = requiredText(values, "observedAt");

  if (documentType === "competitor") {
    const evidenceId = randomUUID();
    const snapshotId = randomUUID();
    const title = requiredText(values, "title");
    const sourceUrl = requiredText(values, "sourceUrl");
    const priceCents = requiredNumber(values, "price");
    const currency = requiredText(values, "currency");
    assertTargetCurrency(currency, input.target.currency);
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at,
         raw_snapshot, confidence, created_by)
       VALUES ($1, $2, 'competitor_snapshot', 'marketplace', $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        evidenceId,
        input.hypothesisId,
        sourceUrl,
        title,
        `AI 提取并经人工审核的竞品快照：${title}`.slice(0, 1_500),
        observedAt,
        rawSnapshot,
        clampConfidence(minConfidence),
        input.actor,
      ],
    );
    await tx.query(
      `INSERT INTO competitor_snapshots
        (id, hypothesis_id, evidence_id, asin, title, source_url, price_cents, rating, review_count,
         bsr, monthly_sales_min, monthly_sales_max, seller_count, variation_count, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        snapshotId,
        input.hypothesisId,
        evidenceId,
        optionalText(values.asin),
        title,
        sourceUrl,
        priceCents,
        optionalNumber(values.rating),
        optionalNumber(values.reviewCount) ?? 0,
        optionalNumber(values.bsr),
        optionalNumber(values.monthlySalesMin),
        optionalNumber(values.monthlySalesMax),
        optionalNumber(values.sellerCount),
        optionalNumber(values.variationCount),
        observedAt,
      ],
    );
    return { entityType: "competitor_snapshot", entityId: snapshotId };
  }

  if (documentType === "supplier_quote") {
    const evidenceId = randomUUID();
    const shortlistId = randomUUID();
    const quoteId = randomUUID();
    const supplierName = requiredText(values, "supplierName");
    const supplierPlatform = requiredText(values, "supplierPlatform");
    const supplierUrl = requiredText(values, "supplierUrl");
    const quoteUrl = requiredText(values, "quoteUrl");
    const unitPriceCents = requiredNumber(values, "unitPrice");
    const freightPerUnitCents = optionalNumber(values.freightPerUnit) ?? 0;
    const dutyRate = optionalNumber(values.dutyRate) ?? 0;
    const landedCostCents = unitPriceCents + freightPerUnitCents
      + Math.round((unitPriceCents + freightPerUnitCents) * dutyRate);
    const currency = requiredText(values, "currency");
    const moq = requiredNumber(values, "moq");
    const leadTimeDays = requiredNumber(values, "leadTimeDays");
    const sampleFeeCents = optionalNumber(values.sampleFee) ?? 0;
    assertTargetCurrency(currency, input.target.currency);

    await tx.query(
      `INSERT INTO supplier_shortlists
        (id, hypothesis_id, supplier_name, platform, supplier_url, contact, country,
         product_match, source_type, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai_reviewed', $9, $10)`,
      [
        shortlistId,
        input.hypothesisId,
        supplierName,
        supplierPlatform,
        supplierUrl,
        optionalText(values.contact),
        optionalText(values.country),
        requiredText(values, "productMatch"),
        observedAt,
        input.actor,
      ],
    );
    await tx.query(
      `INSERT INTO sourcing_supplier_quotes
        (id, hypothesis_id, supplier_shortlist_id, unit_price_cents, freight_per_unit_cents,
         duty_rate, landed_cost_cents, currency, moq, lead_time_days, sample_score,
         sample_fee_cents, certifications, payment_terms, incoterm, quote_url, observed_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL, $11, $12, $13, $14, $15, $16, $17)`,
      [
        quoteId,
        input.hypothesisId,
        shortlistId,
        unitPriceCents,
        freightPerUnitCents,
        dutyRate,
        landedCostCents,
        currency,
        moq,
        leadTimeDays,
        sampleFeeCents,
        optionalText(values.certifications) ?? "",
        optionalText(values.paymentTerms) ?? "",
        optionalText(values.incoterm) ?? "",
        quoteUrl,
        observedAt,
        input.actor,
      ],
    );
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at,
         raw_snapshot, confidence, created_by)
       VALUES ($1, $2, 'supplier_quote', 'supplier', $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        evidenceId,
        input.hypothesisId,
        quoteUrl,
        `${supplierName} 已审核报价`,
        `含税到岸 ${(landedCostCents / 100).toFixed(2)} ${currency}；MOQ ${moq}；交期 ${leadTimeDays} 天`,
        observedAt,
        rawSnapshot,
        clampConfidence(minConfidence),
        input.actor,
      ],
    );
    return { entityType: "supplier_quote", entityId: quoteId };
  }

  if (documentType === "review_insight") {
    const evidenceId = randomUUID();
    const insightId = randomUUID();
    const title = requiredText(values, "title");
    const sourceUrl = requiredText(values, "sourceUrl");
    const summary = requiredText(values, "summary");
    const sampleSize = requiredNumber(values, "sampleSize");
    const representativeQuote = optionalText(values.representativeQuote) ?? "";
    await tx.query(
      `INSERT INTO opportunity_evidence
        (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at,
         raw_snapshot, confidence, created_by)
       VALUES ($1, $2, 'review_insight', 'review_export', $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        evidenceId,
        input.hypothesisId,
        sourceUrl,
        title,
        summary,
        observedAt,
        rawSnapshot,
        clampConfidence(minConfidence),
        input.actor,
      ],
    );
    await tx.query(
      `INSERT INTO review_insights
        (id, hypothesis_id, evidence_id, theme, sentiment, sample_size, representative_quote)
       VALUES ($1, $2, $3, $4, 'negative', $5, $6)`,
      [insightId, input.hypothesisId, evidenceId, title, sampleSize, representativeQuote],
    );
    return { entityType: "review_insight", entityId: insightId };
  }

  throw new Error("不支持的证据类型");
}

async function lockTask(db: Queryable, taskId: string) {
  const result = await db.query<TaskLockRow>(
    `SELECT id, status, target_hypothesis_id, applied_entity_type, applied_entity_id,
            applied_at, applied_by, error_message
     FROM ai_tasks WHERE id = $1 FOR UPDATE`,
    [taskId],
  );
  return result.rows[0] ?? null;
}

async function readTarget(db: Queryable, hypothesisId: string, lock = false) {
  const result = await db.query<TargetRow>(
    `SELECT h.id, h.concept, h.selected_for_validation, h.product_case_id, b.currency
     FROM opportunity_hypotheses h
     JOIN ai_sourcing_runs r ON r.id = h.run_id
     JOIN sourcing_briefs b ON b.id = r.brief_id
     WHERE h.id = $1${lock ? " FOR UPDATE OF h" : ""}`,
    [hypothesisId],
  );
  return result.rows[0] ?? null;
}

async function readTaskFields(db: Queryable, taskId: string) {
  const result = await db.query<StoredFieldRow>(
    `SELECT f.id, f.task_id, f.document_type, f.field_name, f.field_label, f.raw_value,
            f.normalized_value, f.confidence, f.status, f.risk_level, f.validation_message,
            f.position, s.artifact_id, s.source_type, s.excerpt, s.locator
     FROM ai_extracted_fields f
     LEFT JOIN ai_field_sources s ON s.field_id = f.id
     WHERE f.task_id = $1
     ORDER BY f.position, f.created_at`,
    [taskId],
  );
  return result.rows;
}

function assertAcceptableSource(field: StoredFieldRow) {
  if (field.source_type !== "artifact" && field.source_type !== "manual") {
    throw new Error("字段缺少来源记录，不能接受");
  }
  if (!field.excerpt?.trim()) throw new Error("字段缺少来源摘录，不能接受");
  if (field.source_type === "artifact" && field.locator?.matched !== true) {
    throw new Error("来源原文无法在 artifact 中定位，不能接受");
  }
}

function assertCurrency(
  value: NormalizedFieldValue,
  definition: FieldDefinition,
  targetCurrency: string | null,
) {
  if (definition.rule !== "currency" || !targetCurrency) return;
  if (value !== targetCurrency.toUpperCase()) {
    throw new Error(`${definition.label}必须与目标机会币种 ${targetCurrency.toUpperCase()} 一致`);
  }
}

function assertTargetCurrency(currency: string, targetCurrency: string) {
  if (currency.toUpperCase() !== targetCurrency.toUpperCase()) {
    throw new Error(`报价币种 ${currency} 与目标机会币种 ${targetCurrency} 不一致`);
  }
}

function getDefinitions(documentType: EvidenceDocumentType) {
  return getFieldDefinitions(documentType);
}

function requiredText(values: Record<string, NormalizedFieldValue>, key: string) {
  const value = optionalText(values[key]);
  if (!value) throw new Error(`已审核字段 ${key} 缺少有效值`);
  return value;
}

function optionalText(value: NormalizedFieldValue | undefined) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function requiredNumber(values: Record<string, NormalizedFieldValue>, key: string) {
  const value = optionalNumber(values[key]);
  if (value === null) throw new Error(`已审核字段 ${key} 缺少有效数字`);
  return value;
}

function optionalNumber(value: NormalizedFieldValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeActor(value: string) {
  const actor = value.trim().slice(0, 80);
  if (!actor) throw new Error("必须填写操作人，不能匿名审核或应用");
  return actor;
}

function sanitizeReviewNote(value: string | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
}

function appendMessage(current: string, note: string | undefined) {
  const clean = sanitizeReviewNote(note);
  return clean ? `${current}；${clean}`.slice(0, 1_500) : current.slice(0, 1_500);
}

function clampConfidence(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

async function requireTask(taskId: string) {
  const detail = await getAiInboxTask(taskId);
  if (!detail) throw new Error("AI 证据任务不存在");
  return detail;
}
