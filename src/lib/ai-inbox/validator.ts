import {
  clampConfidence,
  getFieldDefinitions,
  normalizeFieldValue,
  sourceLocator,
  validateNormalizedFieldValue,
  type EvidenceDocumentType,
  type EvidenceExtraction,
  type NormalizedFieldValue,
  type RawExtractedField,
  type FieldDefinition,
} from "./schema.ts";

export type AiFieldStatus =
  | "extracted"
  | "auto_accepted"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "missing";

export type AiFieldRiskLevel = "normal" | "sensitive";

export type FieldCandidate = {
  fieldName: string;
  rawValue: NormalizedFieldValue;
  confidence: number;
  sourceQuote: string;
  sourceType?: "artifact" | "manual";
};

export type ValidatedField = {
  fieldName: string;
  fieldLabel: string;
  definition: FieldDefinition;
  rawValue: string;
  normalizedValue: NormalizedFieldValue;
  confidence: number;
  status: AiFieldStatus;
  riskLevel: AiFieldRiskLevel;
  validationMessage: string;
  position: number;
  sourceQuote: string;
  sourceType: "artifact" | "manual";
  locator: {
    matched: boolean;
    start: number;
    end: number;
    collapsedWhitespace?: boolean;
  };
};

export type ValidatedExtraction = {
  documentType: EvidenceDocumentType;
  fields: ValidatedField[];
  warnings: string[];
  missingRequiredFields: string[];
  needsReviewFields: string[];
  autoAcceptedFields: string[];
  canApplyWithoutReview: boolean;
};

export type ValidateExtractionInput = {
  documentType: EvidenceDocumentType;
  fields: FieldCandidate[] | Record<string, RawExtractedField>;
  content: string;
  targetCurrency?: string;
  warnings?: string[];
};

const MIN_AUTO_ACCEPT_CONFIDENCE = 0.9;

export function extractionFieldsToCandidates(
  extraction: Pick<EvidenceExtraction, "fields">,
): FieldCandidate[] {
  return Object.entries(extraction.fields).map(([fieldName, field]) => ({
    fieldName,
    rawValue: field.value,
    confidence: field.confidence,
    sourceQuote: field.sourceQuote,
    sourceType: "artifact",
  }));
}

export function validateExtraction(input: ValidateExtractionInput): ValidatedExtraction {
  if (input.documentType === "unknown") {
    throw new Error("证据类型尚未识别，请补充明确表头或选择证据类型后再处理");
  }

  const definitions = getFieldDefinitions(input.documentType);
  const candidates = Array.isArray(input.fields)
    ? input.fields
    : extractionFieldsToCandidates({ fields: input.fields });
  const warnings = [...(input.warnings ?? [])];
  const byName = new Map<string, FieldCandidate[]>();

  for (const candidate of candidates) {
    if (!definitions.some((definition) => definition.name === candidate.fieldName)) {
      warnings.push(`未定义字段 ${candidate.fieldName} 已忽略`);
      continue;
    }
    const current = byName.get(candidate.fieldName) ?? [];
    current.push(candidate);
    byName.set(candidate.fieldName, current);
  }

  const fields: ValidatedField[] = [];
  definitions.forEach((definition, position) => {
    const candidateGroup = byName.get(definition.name) ?? [];
    if (candidateGroup.length === 0) {
      if (definition.required) {
        fields.push(missingField(definition, position));
      }
      return;
    }

    const normalizedCandidates = candidateGroup.map((candidate) => {
      const normalized = normalizeFieldValue(definition, candidate.rawValue);
      return {
        candidate,
        normalized,
        locator: sourceLocator(input.content, candidate.sourceQuote),
      };
    });
    const distinctValues = new Set(
      normalizedCandidates
        .filter((item) => !item.normalized.error && item.normalized.value !== null)
        .map((item) => JSON.stringify(item.normalized.value)),
    );
    const hasConflict = distinctValues.size > 1;

    for (const item of normalizedCandidates) {
      const { candidate, normalized, locator } = item;
      const confidence = clampConfidence(candidate.confidence);
      const riskLevel: AiFieldRiskLevel = definition.sensitive ? "sensitive" : "normal";
      let status: AiFieldStatus = "needs_review";
      const messages: string[] = [];

      if (normalized.error) {
        messages.push(normalized.error);
      }
      if (!candidate.sourceQuote.trim()) {
        messages.push("缺少可定位的来源原文");
      } else if (!locator.matched) {
        messages.push("来源原文无法在保存的 artifact 中定位");
      }
      if (hasConflict) {
        messages.push("同一字段出现多个不一致的值，需要人工确认");
      }
      if (definition.rule === "currency" && input.targetCurrency) {
        const targetCurrency = input.targetCurrency.trim().toUpperCase();
        if (normalized.value !== targetCurrency) {
          messages.push(`币种 ${String(normalized.value ?? "未知")} 与目标机会 ${targetCurrency} 不一致`);
        }
      }

      const isBlocked = Boolean(
        normalized.error
        || hasConflict
        || !locator.matched
        || messages.some((message) => message.includes("币种")),
      );

      if (!isBlocked && !definition.sensitive && confidence >= MIN_AUTO_ACCEPT_CONFIDENCE) {
        status = "auto_accepted";
      } else {
        status = "needs_review";
        if (!isBlocked && definition.sensitive) messages.push("敏感字段必须人工确认");
        if (!isBlocked && confidence < MIN_AUTO_ACCEPT_CONFIDENCE) {
          messages.push(`置信度 ${percent(confidence)}，低于自动接受阈值 90%`);
        }
      }

      fields.push({
        fieldName: definition.name,
        fieldLabel: definition.label,
        definition,
        rawValue: scalarToText(candidate.rawValue),
        normalizedValue: normalized.value,
        confidence,
        status,
        riskLevel,
        validationMessage: messages.join("；"),
        position,
        sourceQuote: candidate.sourceQuote.trim(),
        sourceType: candidate.sourceType ?? "artifact",
        locator,
      });
    }
  });

  const minValue = fields.find((field) => field.fieldName === "monthlySalesMin" && typeof field.normalizedValue === "number")?.normalizedValue;
  const maxValue = fields.find((field) => field.fieldName === "monthlySalesMax" && typeof field.normalizedValue === "number")?.normalizedValue;
  if (typeof minValue === "number" && typeof maxValue === "number" && minValue > maxValue) {
    for (const field of fields.filter((item) => item.fieldName === "monthlySalesMin" || item.fieldName === "monthlySalesMax")) {
      field.status = "needs_review";
      field.validationMessage = appendMessage(field.validationMessage, "月销量下限不能大于上限");
    }
  }

  // Summary arrays must be computed after cross-field checks so a demoted
  // auto-accepted field cannot leave canApplyWithoutReview=true behind.
  const missingRequiredFields = fields
    .filter((field) => field.definition.required && field.status === "missing")
    .map((field) => field.fieldName);
  const needsReviewFields = fields
    .filter((field) => field.status === "needs_review" || field.status === "missing")
    .map((field) => field.fieldName);
  const autoAcceptedFields = fields
    .filter((field) => field.status === "auto_accepted")
    .map((field) => field.fieldName);

  return {
    documentType: input.documentType,
    fields,
    warnings,
    missingRequiredFields,
    needsReviewFields,
    autoAcceptedFields,
    canApplyWithoutReview: missingRequiredFields.length === 0 && needsReviewFields.length === 0,
  };
}

export function validateStoredField(
  definition: FieldDefinition,
  rawValue: NormalizedFieldValue,
  targetCurrency?: string,
) {
  const normalized = validateNormalizedFieldValue(definition, rawValue);
  const messages: string[] = [];
  if (normalized.error) messages.push(normalized.error);
  if (definition.rule === "currency" && targetCurrency && normalized.value !== targetCurrency.toUpperCase()) {
    messages.push(`币种必须与目标机会 ${targetCurrency.toUpperCase()} 一致`);
  }
  return {
    ...normalized,
    valid: !normalized.error && messages.length === 0,
    message: messages.join("；"),
  };
}

export function canApplyValidatedFields(fields: ValidatedField[]) {
  const required = fields.filter((field) => field.definition.required);
  const requiredReady = required.every(
    (field) => field.status === "auto_accepted" || field.status === "accepted",
  );
  const rejectedRequired = required.some((field) => field.status === "rejected" || field.status === "missing");
  const pendingOptional = fields.some(
    (field) => field.status === "needs_review" || field.status === "extracted" || field.status === "missing",
  );
  const invalidAccepted = fields.some(
    (field) => (field.status === "auto_accepted" || field.status === "accepted")
      && (!field.locator.matched || field.validationMessage.includes("币种")),
  );
  return requiredReady && !rejectedRequired && !pendingOptional && !invalidAccepted;
}

function missingField(definition: FieldDefinition, position: number): ValidatedField {
  return {
    fieldName: definition.name,
    fieldLabel: definition.label,
    definition,
    rawValue: "",
    normalizedValue: null,
    confidence: 0,
    status: "missing",
    riskLevel: definition.sensitive ? "sensitive" : "normal",
    validationMessage: "缺少必填字段",
    position,
    sourceQuote: "",
    sourceType: "manual",
    locator: { matched: false, start: -1, end: -1 },
  };
}

function scalarToText(value: NormalizedFieldValue) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function appendMessage(current: string, next: string) {
  return current ? `${current}；${next}` : next;
}
