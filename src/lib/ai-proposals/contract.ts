/**
 * AI 提案通用契约。
 *
 * 任何 AI 场景的输出都可以表达为「一条挂在某些业务对象上的提案」：
 * 带来源证据、置信度和生成方式，经过校验后由人工决定采纳或驳回，
 * 采纳后才允许写入业务表。本模块只提供类型、纯函数和状态守卫，
 * 不读库、不解析具体平台列名、不假设任何业务领域，也不产生 UI。
 *
 * 领域相关的字段清单（例如证据文档有哪些字段）由各场景自己定义，
 * 传入本模块的函数即可复用归一化、校验与解析规则。
 */

export type ProposalValue = string | number | boolean | null;

/** 提案从生成到落库的状态。`extracted` 表示刚提取、尚未判定。 */
export type ProposalStatus =
  | "extracted"
  | "auto_accepted"
  | "needs_review"
  | "accepted"
  | "rejected"
  | "missing";

export type ProposalRisk = "normal" | "sensitive";

/** 生成方式：用于回答「这条建议是模型给的、模板兜底的，还是人工补的」。 */
export type ProposalGeneration = {
  source: "model" | "template" | "manual";
  provider?: string;
  model?: string;
  promptVersion?: string;
  fallback?: boolean;
  providerError?: string;
};

export type SourceLocator = {
  matched: boolean;
  start: number;
  end: number;
  collapsedWhitespace?: boolean;
};

/** 提案出处，落在业务对象上时可随提案一起保存，便于事后复算。 */
export type ProposalProvenance = {
  sourceQuote: string;
  sourceType: "artifact" | "manual";
  locator: SourceLocator;
  generation: ProposalGeneration;
};

/** 模型给出的单个字段提案。值仍是原始形态，尚未按规则归一化。 */
export type ProposalField = {
  value: ProposalValue;
  confidence: number;
  sourceQuote: string;
};

/** 提案归属的业务对象。首页待办聚合据此跳回原对象，而不是另建 AI 页面。 */
export type ProposalTarget = {
  entityType: string;
  entityId: string;
  fieldName?: string;
};

export type ValueRule =
  | "money_cents"
  | "rating"
  | "integer"
  | "percent"
  | "url"
  | "datetime"
  | "currency"
  | "text";

export type ProposalFieldDefinition = {
  name: string;
  label: string;
  rule: ValueRule;
  required: boolean;
  sensitive?: boolean;
  allowZero?: boolean;
  maxLength?: number;
  help?: string;
};

export const PROPOSAL_STATUSES: readonly ProposalStatus[] = [
  "extracted",
  "auto_accepted",
  "needs_review",
  "accepted",
  "rejected",
  "missing",
];

export const ACCEPTED_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["auto_accepted", "accepted"];
export const PENDING_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["extracted", "needs_review", "missing"];
export const REJECTED_PROPOSAL_STATUSES: readonly ProposalStatus[] = ["rejected", "missing"];

/** 自动采纳的置信度下限。低于此值必须人工确认，由调用方决定是否启用。 */
export const MIN_AUTO_ACCEPT_CONFIDENCE = 0.9;

export function isAcceptedProposalStatus(status: ProposalStatus): boolean {
  return status === "auto_accepted" || status === "accepted";
}

export function isPendingProposalStatus(status: ProposalStatus): boolean {
  return status === "extracted" || status === "needs_review" || status === "missing";
}

export function isRejectedProposalStatus(status: ProposalStatus): boolean {
  return status === "rejected" || status === "missing";
}

export type ProposalDecision = "accept" | "reject" | "mark_missing";

/**
 * 审核状态转换守卫。终态不可回退，驳回/缺失只允许重新审核回到待审，
 * 已应用的业务数据不允许被再次改写。
 */
export function canTransitionProposalStatus(
  from: ProposalStatus,
  decision: ProposalDecision,
): boolean {
  if (decision === "accept") return !isAcceptedProposalStatus(from);
  if (decision === "reject") return from !== "rejected";
  return from !== "missing";
}

/** 把 provider 的返回结果归一成提案生成方式，供留痕复用。 */
export function describeProposalGeneration(result: {
  provider: string;
  model: string;
  fallback?: boolean;
  providerError?: string;
  promptVersion?: string;
}): ProposalGeneration {
  const fallback = Boolean(result.fallback);
  return {
    source: fallback || result.provider === "template" ? "template" : "model",
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion,
    fallback,
    providerError: result.providerError,
  };
}

export function clampConfidence(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

export function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (normalized === "RMB") return "CNY";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

/** 在原文中定位引用片段；空白折叠后命中会标记，避免误判为精确位置。 */
export function locateSource(content: string, excerpt: string): SourceLocator {
  if (!excerpt.trim()) return { matched: false, start: -1, end: -1 };
  const directStart = content.indexOf(excerpt);
  if (directStart >= 0) return { matched: true, start: directStart, end: directStart + excerpt.length };
  const collapsedContent = content.replace(/\s+/g, " ");
  const collapsedExcerpt = excerpt.replace(/\s+/g, " ");
  const collapsedStart = collapsedContent.indexOf(collapsedExcerpt);
  return collapsedStart >= 0
    ? { matched: true, start: collapsedStart, end: collapsedStart + collapsedExcerpt.length, collapsedWhitespace: true }
    : { matched: false, start: -1, end: -1 };
}

/** 兼容模型常见的 Markdown 代码块与前后噪声，只接受 JSON 对象。 */
export function parseStructuredObject(content: string): Record<string, unknown> {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
      if (isRecord(parsed)) return parsed;
    }
    throw new Error("模型输出不是有效 JSON 对象");
  }
}

/** 只保留已声明字段，未知字段单独返回，绝不静默扩大提案范围。 */
export function parseProposalFields(
  sourceFields: Record<string, unknown>,
  definitions: readonly ProposalFieldDefinition[],
): { fields: Record<string, ProposalField>; unknownFields: string[] } {
  const fields: Record<string, ProposalField> = {};
  for (const definition of definitions) {
    const raw = sourceFields[definition.name];
    if (!isRecord(raw)) continue;
    const sourceQuote = typeof raw.sourceQuote === "string" ? raw.sourceQuote.trim().slice(0, 1000) : "";
    fields[definition.name] = {
      value: scalarValue(raw.value),
      confidence: clampConfidence(raw.confidence),
      sourceQuote,
    };
  }
  const known = new Set(definitions.map((field) => field.name));
  const unknownFields = Object.keys(sourceFields).filter((name) => !known.has(name));
  return { fields, unknownFields };
}

/** 把原始标量归一化成标准形态。金额只在这一步乘以 100，之后不得重复缩放。 */
export function normalizeByRule(
  definition: ProposalFieldDefinition,
  value: ProposalValue,
): { value: ProposalValue; error: string } {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null, error: definition.required ? "缺少必填字段" : "" };
  }
  const text = String(value).trim();

  if (definition.rule === "text") {
    const normalized = text.replace(/\s+/g, " ");
    if (definition.maxLength && normalized.length > definition.maxLength) {
      return { value: null, error: `超过 ${definition.maxLength} 个字符` };
    }
    return { value: normalized, error: "" };
  }

  if (definition.rule === "url") {
    const normalized = normalizeUrl(text);
    return normalized
      ? { value: normalized, error: "" }
      : { value: null, error: "不是有效的 http/https URL" };
  }

  if (definition.rule === "datetime") {
    const timestamp = Date.parse(text);
    return Number.isFinite(timestamp)
      ? { value: new Date(timestamp).toISOString(), error: "" }
      : { value: null, error: "不是有效日期时间" };
  }

  if (definition.rule === "currency") {
    const currency = normalizeCurrency(text);
    return currency ? { value: currency, error: "" } : { value: null, error: "需要 3 位 ISO 币种代码" };
  }

  const numericText = text.replace(/[,$，\s]/g, "").replace(/^[$¥￥€£]/, "");
  if (/\d\s*[-~至]\s*\d/.test(text)) {
    return { value: null, error: "字段是区间或多个值，请人工拆分后再确认" };
  }
  const numeric = Number(numericText.replace(/%$/, ""));
  if (!Number.isFinite(numeric)) return { value: null, error: "不是有效数字" };

  if (definition.rule === "money_cents") {
    if (numeric < 0 || (!definition.allowZero && numeric === 0)) return { value: null, error: "金额必须大于 0" };
    return { value: Math.round(numeric * 100), error: "" };
  }
  if (definition.rule === "rating") {
    if (numeric < 0 || numeric > 5) return { value: null, error: "评分必须在 0 到 5 之间" };
    return { value: Math.round(numeric * 100) / 100, error: "" };
  }
  if (definition.rule === "integer") {
    if (!Number.isInteger(numeric) || numeric < 0 || (!definition.allowZero && numeric === 0)) {
      return { value: null, error: "需要大于 0 的整数" };
    }
    return { value: numeric, error: "" };
  }
  if (definition.rule === "percent") {
    const rate = text.includes("%") || numeric > 1 ? numeric / 100 : numeric;
    if (rate < 0 || rate > 1) return { value: null, error: "比例必须在 0 到 1 之间" };
    return { value: rate, error: "" };
  }
  return { value: null, error: "未知字段类型" };
}

/** 校验已入库的标准值，绝不再次缩放金额。 */
export function validateStoredByRule(
  definition: ProposalFieldDefinition,
  value: ProposalValue,
): { value: ProposalValue; error: string } {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null, error: definition.required ? "缺少必填字段" : "" };
  }

  if (definition.rule === "text") {
    if (typeof value !== "string") return { value: null, error: "字段需要文本值" };
    const text = value.trim().replace(/\s+/g, " ");
    if (!text && definition.required) return { value: null, error: "缺少必填字段" };
    if (definition.maxLength && text.length > definition.maxLength) {
      return { value: null, error: `超过 ${definition.maxLength} 个字符` };
    }
    return { value: text, error: "" };
  }

  if (definition.rule === "url") {
    if (typeof value !== "string") return { value: null, error: "不是有效的 http/https URL" };
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { value: null, error: "不是有效的 http/https URL" };
      }
      if (url.username || url.password) return { value: null, error: "URL 不能包含内嵌凭证" };
      return { value: url.toString(), error: "" };
    } catch {
      return { value: null, error: "不是有效的 http/https URL" };
    }
  }

  if (definition.rule === "datetime") {
    if (typeof value !== "string") return { value: null, error: "不是有效日期时间" };
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp)
      ? { value: new Date(timestamp).toISOString(), error: "" }
      : { value: null, error: "不是有效日期时间" };
  }

  if (definition.rule === "currency") {
    if (typeof value !== "string") return { value: null, error: "需要 3 位 ISO 币种代码" };
    const currency = normalizeCurrency(value);
    return currency ? { value: currency, error: "" } : { value: null, error: "需要 3 位 ISO 币种代码" };
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: null, error: "不是有效数字" };
  }
  if (definition.rule === "money_cents") {
    if (!Number.isInteger(value) || value < 0 || (!definition.allowZero && value === 0)) {
      return { value: null, error: "金额必须是最小货币单位整数且大于 0" };
    }
    return { value, error: "" };
  }
  if (definition.rule === "rating") {
    if (value < 0 || value > 5) return { value: null, error: "评分必须在 0 到 5 之间" };
    return { value, error: "" };
  }
  if (definition.rule === "integer") {
    if (!Number.isInteger(value) || value < 0 || (!definition.allowZero && value === 0)) {
      return { value: null, error: "需要大于 0 的整数" };
    }
    return { value, error: "" };
  }
  if (definition.rule === "percent") {
    if (value < 0 || value > 1) return { value: null, error: "比例必须在 0 到 1 之间" };
    return { value, error: "" };
  }
  return { value: null, error: "未知字段类型" };
}

/** 首页待办聚合需要的最小统计，不含任何 UI 或阈值决策。 */
export function countProposalStatuses(
  fields: readonly { status: ProposalStatus; required?: boolean }[],
): { pendingCount: number; acceptedCount: number; rejectedCount: number; missingRequiredCount: number } {
  return {
    pendingCount: fields.filter((field) => isPendingProposalStatus(field.status)).length,
    acceptedCount: fields.filter((field) => isAcceptedProposalStatus(field.status)).length,
    rejectedCount: fields.filter((field) => isRejectedProposalStatus(field.status)).length,
    missingRequiredCount: fields.filter(
      (field) => field.required && (field.status === "missing" || field.status === "rejected"),
    ).length,
  };
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function scalarValue(value: unknown): ProposalValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
