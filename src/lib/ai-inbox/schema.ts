export type EvidenceDocumentType = "competitor" | "supplier_quote" | "review_insight" | "unknown";

export type NormalizedFieldValue = string | number | boolean | null;

export type RawExtractedField = {
  value: NormalizedFieldValue;
  confidence: number;
  sourceQuote: string;
};

export type EvidenceExtraction = {
  documentType: EvidenceDocumentType;
  fields: Record<string, RawExtractedField>;
  notes: string;
  warnings: string[];
};

export type NumericRule = "money_cents" | "rating" | "integer" | "percent" | "url" | "datetime" | "currency" | "text";

export type FieldDefinition = {
  name: string;
  label: string;
  rule: NumericRule;
  required: boolean;
  sensitive?: boolean;
  allowZero?: boolean;
  maxLength?: number;
  help: string;
};

export const DOCUMENT_TYPE_LABELS: Record<EvidenceDocumentType, string> = {
  competitor: "竞品快照",
  supplier_quote: "供应商报价",
  review_insight: "评论/风险证据",
  unknown: "待识别",
};

const commonObservedAt: FieldDefinition = {
  name: "observedAt",
  label: "观察时间",
  rule: "datetime",
  required: true,
  help: "必须来自证据本身或由审核人补充，不能使用提交时间冒充市场观察时间。",
};

const commonSourceUrl: FieldDefinition = {
  name: "sourceUrl",
  label: "来源 URL",
  rule: "url",
  required: true,
  help: "公开商品页、报价页或聊天记录导出地址。",
};

export const FIELD_DEFINITIONS: Record<Exclude<EvidenceDocumentType, "unknown">, FieldDefinition[]> = {
  competitor: [
    { name: "title", label: "竞品标题", rule: "text", required: true, maxLength: 240, help: "证据中可定位的商品标题。" },
    { name: "asin", label: "ASIN / 商品编号", rule: "text", required: false, maxLength: 40, help: "没有明确出现时留空，不自动生成。" },
    { name: "price", label: "竞品价格", rule: "money_cents", required: true, help: "按最小货币单位（分）保存。" },
    { name: "currency", label: "币种", rule: "currency", required: true, help: "必须与目标机会站点币种一致后才能应用。" },
    { name: "rating", label: "评分", rule: "rating", required: false, allowZero: true, help: "0 到 5；缺失不等于 0。" },
    { name: "reviewCount", label: "评论数", rule: "integer", required: false, allowZero: true, help: "缺失不等于 0。" },
    { name: "bsr", label: "BSR", rule: "integer", required: false, help: "只记录证据中明确出现的排名。" },
    { name: "monthlySalesMin", label: "月销量下限", rule: "integer", required: false, help: "无法确认时留空，不估算。" },
    { name: "monthlySalesMax", label: "月销量上限", rule: "integer", required: false, help: "无法确认时留空，不估算。" },
    { name: "sellerCount", label: "卖家数", rule: "integer", required: false, allowZero: true, help: "只记录明确数字。" },
    { name: "variationCount", label: "变体数", rule: "integer", required: false, allowZero: true, help: "只记录明确数字。" },
    commonSourceUrl,
    commonObservedAt,
  ],
  supplier_quote: [
    { name: "supplierName", label: "供应商名称", rule: "text", required: true, sensitive: true, maxLength: 180, help: "供应商主体必须人工核对。" },
    { name: "supplierPlatform", label: "供应商平台", rule: "text", required: true, maxLength: 60, help: "例如 1688、Alibaba、工厂直联。" },
    { name: "supplierUrl", label: "供应商主页", rule: "url", required: true, sensitive: true, help: "必须人工确认是目标供应商主体。" },
    { name: "contact", label: "联系方式", rule: "text", required: false, sensitive: true, maxLength: 180, help: "只记录已合法获得的联系方式。" },
    { name: "country", label: "国家/地区", rule: "text", required: false, maxLength: 60, help: "证据未明确时留空。" },
    { name: "productMatch", label: "产品匹配说明", rule: "text", required: true, maxLength: 500, help: "说明材质、规格、结构或包装差异。" },
    { name: "unitPrice", label: "采购单价", rule: "money_cents", required: true, help: "按最小货币单位（分）保存。" },
    { name: "freightPerUnit", label: "单件运费", rule: "money_cents", required: true, allowZero: true, help: "只有报价明确包含运费或为 0 时才能应用。" },
    { name: "dutyRate", label: "关税率", rule: "percent", required: true, allowZero: true, help: "支持 8% 或 0.08，保存为 0 到 1。" },
    { name: "currency", label: "币种", rule: "currency", required: true, help: "必须与目标机会站点币种一致后才能应用。" },
    { name: "moq", label: "MOQ", rule: "integer", required: true, help: "必须大于 0。" },
    { name: "leadTimeDays", label: "交期（天）", rule: "integer", required: true, help: "必须大于 0。" },
    { name: "sampleFee", label: "样品费", rule: "money_cents", required: false, allowZero: true, help: "缺失时不会自动写成 0。" },
    { name: "paymentTerms", label: "付款条件", rule: "text", required: false, maxLength: 200, help: "例如 30% 定金 / 70% 发货前。" },
    { name: "incoterm", label: "贸易条款", rule: "text", required: false, maxLength: 80, help: "例如 EXW、FOB、DDP。" },
    { name: "certifications", label: "认证与合规", rule: "text", required: false, sensitive: true, maxLength: 500, help: "认证、专利和合规声明永不自动通过。" },
    { name: "quoteUrl", label: "报价来源", rule: "url", required: true, sensitive: true, help: "聊天记录导出、报价单或产品报价页。" },
    commonObservedAt,
  ],
  review_insight: [
    { name: "title", label: "证据标题", rule: "text", required: true, sensitive: true, maxLength: 180, help: "概括证据主题，必须由审核人确认。" },
    { name: "summary", label: "证据摘要", rule: "text", required: true, sensitive: true, maxLength: 1500, help: "AI 概括可能遗漏语境，必须由审核人确认。" },
    commonSourceUrl,
    { name: "sampleSize", label: "样本数", rule: "integer", required: true, help: "评论样本数必须可追溯，不能用 1 冒充已抽样。" },
    { name: "representativeQuote", label: "代表原文", rule: "text", required: false, sensitive: true, maxLength: 500, help: "保留用户原话，不改成无法追溯的结论。" },
    commonObservedAt,
  ],
};

export function getFieldDefinitions(documentType: EvidenceDocumentType): FieldDefinition[] {
  return documentType === "unknown" ? [] : FIELD_DEFINITIONS[documentType];
}

export function getFieldDefinition(documentType: EvidenceDocumentType, fieldName: string) {
  return getFieldDefinitions(documentType).find((field) => field.name === fieldName);
}

export function detectDocumentType(text: string): EvidenceDocumentType {
  const lower = text.toLowerCase();
  const supplierSignals = ["supplier_name", "suppliername", "供应商名称", "unit_price", "采购单价", "moq", "起订量", "lead_time_days", "交期"];
  const competitorSignals = ["asin", "competitor_price", "竞品价格", "review_count", "评论数", "rating", "评分", "bsr"];
  const reviewSignals = ["review_insight", "差评", "评论主题", "代表原文", "sample_size", "样本数", "representative_quote"];
  const counts = {
    supplier_quote: supplierSignals.filter((signal) => lower.includes(signal)).length,
    competitor: competitorSignals.filter((signal) => lower.includes(signal)).length,
    review_insight: reviewSignals.filter((signal) => lower.includes(signal)).length,
  };
  const best = (Object.entries(counts) as Array<[Exclude<EvidenceDocumentType, "unknown">, number]>)
    .sort((left, right) => right[1] - left[1])[0];
  return best && best[1] > 0 ? best[0] : "unknown";
}

export function parseModelExtraction(
  content: string,
  fallbackDocumentType: EvidenceDocumentType,
): EvidenceExtraction {
  const parsed = parseJsonObject(content);
  const requestedType = String(parsed.documentType ?? "").trim().toLowerCase().replaceAll("-", "_");
  const documentType: EvidenceDocumentType = requestedType === "competitor" || requestedType === "supplier_quote" || requestedType === "review_insight"
    ? requestedType
    : fallbackDocumentType;
  const definitions = getFieldDefinitions(documentType);
  const sourceFields = isRecord(parsed.fields) ? parsed.fields : {};
  const fields: Record<string, RawExtractedField> = {};
  const warnings: string[] = [];

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
  for (const name of Object.keys(sourceFields)) {
    if (!known.has(name)) warnings.push(`模型返回了未定义字段 ${name}，已忽略`);
  }
  if (documentType === "unknown") warnings.push("模型未能确认证据类型，需要人工选择或补充表头");

  return {
    documentType,
    fields,
    notes: typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 500) : "",
    warnings,
  };
}

export function normalizeFieldValue(
  definition: FieldDefinition,
  value: NormalizedFieldValue,
): { value: NormalizedFieldValue; error: string } {
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

/**
 * Validates a value that is already stored in canonical form. Unlike
 * normalizeFieldValue, this must never scale monetary values again.
 */
export function validateNormalizedFieldValue(
  definition: FieldDefinition,
  value: NormalizedFieldValue,
): { value: NormalizedFieldValue; error: string } {
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

export function sourceLocator(content: string, excerpt: string) {
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

export function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "RMB") return "CNY";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "";
}

export function clampConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function scalarValue(value: unknown): NormalizedFieldValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function parseJsonObject(content: string): Record<string, unknown> {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
