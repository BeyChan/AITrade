import { generateStructuredJSON } from "../ai-provider.ts";
import { loadAIProviderConfig } from "../app-settings.ts";
import {
  DOCUMENT_TYPE_LABELS,
  detectDocumentType,
  getFieldDefinitions,
  parseModelExtraction,
  type EvidenceDocumentType,
  type EvidenceExtraction,
  type FieldDefinition,
  type NormalizedFieldValue,
  type RawExtractedField,
} from "./schema.ts";

export type AiEvidenceSourceKind = "paste" | "csv" | "json" | "text" | "markdown";

export type ExtractEvidenceInput = {
  content: string;
  sourceKind: AiEvidenceSourceKind;
  fileName?: string | null;
  targetCurrency?: string;
};

export type ExtractionMode = "model" | "deterministic" | "deterministic_fallback";

export type ExtractionOutcome = {
  extraction: EvidenceExtraction | null;
  provider: string;
  model: string;
  mode: ExtractionMode;
  latencyMs: number;
  warnings: string[];
  error: string | null;
  skippedModel: boolean;
  inputChars: number;
};

const EXTRACTION_SCHEMA_PROMPT = `你是跨境电商证据结构化助手。你只做字段抄录、归一化和来源定位，不做投资、法律、认证或合规结论。

硬性规则：
1. 只输出 JSON，不输出 Markdown。
2. 只能提取输入原文中明确出现的事实。没有出现就省略该字段，禁止猜测、补全或估计。
3. 每个字段必须提供 sourceQuote，且 sourceQuote 必须是输入原文中的连续片段。
4. confidence 是“该字段可从来源原文直接核验”的置信度，范围 0 到 1；不要用市场可信度代替。
5. 不得输出“已认证”“无专利风险”“合规通过”等结论。认证、专利、合规材料只抄录原文。
6. 金额保留原币金额字符串；币种使用 3 位 ISO 代码。不要自行换算币种。
7. observedAt 只能抄录输入中的观察时间，不能使用当前时间。
8. 无法判断文档类型时 documentType 输出 unknown。

输出结构：
{
  "documentType": "competitor | supplier_quote | review_insight | unknown",
  "fields": {
    "字段名": {"value": "原文值，数字可用数字类型", "confidence": 0.0, "sourceQuote": "输入原文连续片段"}
  },
  "notes": "简短说明缺失或歧义，不写风险结论",
  "warnings": ["提取告警"]
}`;

export async function extractEvidence(input: ExtractEvidenceInput): Promise<ExtractionOutcome> {
  const startedAt = Date.now();
  const deterministic = extractDeterministicEvidence(input);
  const warnings = [...deterministic.warnings];
  let provider = "template";
  let model = "deterministic-v1";

  try {
    const config = await loadAIProviderConfig();
    provider = config.provider;
    model = config.model || "未配置模型";
    if (config.provider === "template") {
      return {
        extraction: deterministic.extraction,
        provider,
        model,
        mode: "deterministic",
        latencyMs: Date.now() - startedAt,
        warnings,
        error: null,
        skippedModel: true,
        inputChars: input.content.length,
      };
    }

    const result = await generateStructuredJSON({
      systemPrompt: EXTRACTION_SCHEMA_PROMPT,
      userPrompt: buildExtractionUserPrompt(input, deterministic.documentType),
      maxTokens: 3_000,
    });
    provider = result.provider;
    model = result.model;
    const extraction = parseModelExtraction(result.content, deterministic.documentType);
    if (extraction.documentType === "unknown") {
      warnings.push("模型未能识别证据类型，需要人工补充表头或选择类型");
    }
    return {
      extraction,
      provider,
      model,
      mode: "model",
      latencyMs: result.latencyMs,
      warnings: [...warnings, ...extraction.warnings],
      error: null,
      skippedModel: false,
      inputChars: input.content.length,
    };
  } catch (error) {
    const safeError = sanitizeExtractionError(error);
    if (deterministic.extraction && deterministic.extraction.documentType !== "unknown" && Object.keys(deterministic.extraction.fields).length > 0) {
      warnings.push(`模型提取失败，已保留确定性结构化解析结果：${safeError}`);
      return {
        extraction: deterministic.extraction,
        provider,
        model,
        mode: "deterministic_fallback",
        latencyMs: Date.now() - startedAt,
        warnings,
        error: safeError,
        skippedModel: provider === "template",
        inputChars: input.content.length,
      };
    }
    return {
      extraction: deterministic.extraction,
      provider,
      model,
      mode: "deterministic",
      latencyMs: Date.now() - startedAt,
      warnings,
      error: safeError,
      skippedModel: false,
      inputChars: input.content.length,
    };
  }
}

export function extractDeterministicEvidence(input: Pick<ExtractEvidenceInput, "content" | "sourceKind" | "fileName">) {
  const content = input.content.trim();
  if (!content) throw new Error("证据内容不能为空");

  const warnings: string[] = [];
  let fields: Record<string, RawExtractedField> = {};
  let documentType = detectDocumentType(content);

  if (input.sourceKind === "json" || content.startsWith("{") || content.startsWith("[")) {
    const parsed = parseStructuredJson(content);
    if (parsed) {
      documentType = parsed.documentType ?? detectDocumentType(content);
      fields = parsed.fields;
      warnings.push(...parsed.warnings);
    }
  } else {
    const table = parseDelimitedTable(content);
    if (table) {
      documentType = detectDocumentType(`${table.headers.join(" ")}\n${content}`) || documentType;
      fields = tableToFields(table.headers, table.rows[0] ?? [], content, documentType);
    } else {
      const keyValue = parseKeyValueText(content, documentType);
      fields = keyValue.fields;
      if (keyValue.detectedType !== "unknown") documentType = keyValue.detectedType;
    }
  }

  if (documentType === "unknown") {
    warnings.push("未能从表头或字段识别证据类型；目前仅支持竞品、供应商报价、评论/风险证据");
  }
  if (Object.keys(fields).length === 0) {
    warnings.push("没有识别到已支持的结构化字段。可粘贴 CSV/JSON，或使用“字段: 值”格式。");
  }

  return {
    documentType,
    extraction: {
      documentType,
      fields,
      notes: "",
      warnings: [...new Set(warnings)],
    } satisfies EvidenceExtraction,
    warnings: [...new Set(warnings)],
  };
}

function buildExtractionUserPrompt(input: ExtractEvidenceInput, fallbackType: EvidenceDocumentType) {
  const allDefinitions = (["competitor", "supplier_quote", "review_insight"] as const)
    .map((type) => {
      const fields = getFieldDefinitions(type).map(formatDefinition).join("\n");
      return `## ${DOCUMENT_TYPE_LABELS[type]} (${type})\n${fields}`;
    })
    .join("\n\n");
  return `目标机会币种：${input.targetCurrency || "未提供"}\n初步识别类型：${fallbackType}\n文件名：${input.fileName || "未提供"}\n\n可用字段 Schema（只能使用其中字段）：\n${allDefinitions}\n\n待提取原文：\n<<<EVIDENCE_START\n${input.content}\nEVIDENCE_END>>>`;
}

function formatDefinition(definition: FieldDefinition) {
  const flags = [
    definition.required ? "必填" : "可选",
    definition.sensitive ? "敏感必审" : "",
    definition.allowZero ? "允许0" : "",
  ].filter(Boolean).join("，");
  return `- ${definition.name}（${definition.label}，${definition.rule}，${flags}）：${definition.help}`;
}

function parseStructuredJson(content: string): {
  documentType: EvidenceDocumentType | null;
  fields: Record<string, RawExtractedField>;
  warnings: string[];
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const warnings: string[] = [];
  const rawFields = isRecord(parsed.fields) ? parsed.fields : parsed;
  const requestedType = String(parsed.documentType ?? "").trim().toLowerCase().replaceAll("-", "_");
  const documentType: EvidenceDocumentType | null = requestedType === "competitor"
    || requestedType === "supplier_quote"
    || requestedType === "review_insight"
    || requestedType === "unknown"
    ? requestedType
    : null;
  const detected = documentType ?? detectDocumentType(Object.keys(rawFields).join(" "));
  if (detected === "unknown") return { documentType: detected, fields: {}, warnings };

  const definitions = new Map(getFieldDefinitions(detected).map((definition) => [definition.name, definition]));
  const fields: Record<string, RawExtractedField> = {};
  for (const [rawName, rawValue] of Object.entries(rawFields)) {
    const fieldName = canonicalFieldName(rawName, detected);
    const definition = fieldName ? definitions.get(fieldName) : undefined;
    if (!definition) {
      warnings.push(`JSON 字段 ${rawName} 不在 ${detected} Schema 中，已忽略`);
      continue;
    }
    const wrapper = isRecord(rawValue) ? rawValue : null;
    const value = wrapper ? scalarValue(wrapper.value) : scalarValue(rawValue);
    if (value === null || String(value).trim() === "") continue;
    const sourceQuote = wrapper && typeof wrapper.sourceQuote === "string"
      ? wrapper.sourceQuote.trim()
      : findValueInContent(content, value);
    if (!sourceQuote) warnings.push(`字段 ${fieldName} 的值未能定位到原文，等待人工补充来源`);
    fields[fieldName] = {
      value,
      confidence: wrapper ? clampConfidence(wrapper.confidence, 0.98) : 0.98,
      sourceQuote,
    };
  }
  return { documentType: detected, fields, warnings };
}

function parseDelimitedTable(content: string) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(",") ? "," : "";
  if (!delimiter) return null;
  const headers = parseDelimitedLine(lines[0], delimiter);
  if (headers.length < 2) return null;
  const rows = lines.slice(1, 50).map((line) => parseDelimitedLine(line, delimiter));
  return { headers, rows };
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function tableToFields(
  headers: string[],
  row: string[],
  content: string,
  documentType: EvidenceDocumentType,
) {
  if (documentType === "unknown") return {};
  const fields: Record<string, RawExtractedField> = {};
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    const fieldName = canonicalFieldName(header, documentType);
    if (!fieldName || seen.has(fieldName)) return;
    const value = row[index]?.trim();
    if (!value) return;
    seen.add(fieldName);
    fields[fieldName] = {
      value,
      confidence: 0.99,
      sourceQuote: value,
    };
  });
  return fields;
}

function parseKeyValueText(content: string, detectedType: EvidenceDocumentType) {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let documentType = detectedType;
  const raw: Array<[string, string, string]> = [];
  for (const line of lines) {
    const match = line.match(/^([^:：=|]{1,60})\s*[:：=|]\s*(.+)$/);
    if (!match) continue;
    raw.push([match[1].trim(), match[2].trim(), line]);
  }
  if (documentType === "unknown") {
    documentType = detectDocumentType(raw.map(([key]) => key).join("\n"));
  }
  if (documentType === "unknown") return { fields: {}, detectedType: documentType };

  const fields: Record<string, RawExtractedField> = {};
  for (const [key, value, sourceQuote] of raw) {
    const fieldName = canonicalFieldName(key, documentType);
    if (!fieldName || fields[fieldName]) continue;
    fields[fieldName] = { value, confidence: 0.95, sourceQuote };
  }
  return { fields, detectedType: documentType };
}

const FIELD_ALIASES: Record<string, string[]> = {
  title: ["title", "标题", "商品标题", "竞品标题", "证据标题", "主题", "theme"],
  asin: ["asin", "商品编号", "productid", "product_id"],
  price: ["price", "competitorprice", "competitor_price", "竞品价格", "售价", "价格"],
  currency: ["currency", "币种", "货币"],
  rating: ["rating", "评分", "星级"],
  reviewCount: ["reviewcount", "review_count", "评论数"],
  bsr: ["bsr", "bestsellerrank", "best_seller_rank", "排名"],
  monthlySalesMin: ["monthlysalesmin", "monthly_sales_min", "月销量下限", "最低月销量"],
  monthlySalesMax: ["monthlysalesmax", "monthly_sales_max", "月销量上限", "最高月销量"],
  sellerCount: ["sellercount", "seller_count", "卖家数"],
  variationCount: ["variationcount", "variation_count", "变体数"],
  sourceUrl: ["sourceurl", "source_url", "url", "链接", "来源链接", "商品链接", "来源url"],
  observedAt: ["observedat", "observed_at", "观察时间", "采集时间", "抓取时间"],
  supplierName: ["suppliername", "supplier_name", "供应商名称", "供应商"],
  supplierPlatform: ["supplierplatform", "supplier_platform", "供应商平台", "平台"],
  supplierUrl: ["supplierurl", "supplier_url", "供应商主页", "供应商链接"],
  contact: ["contact", "联系方式", "联系人"],
  country: ["country", "国家", "国家地区", "地区"],
  productMatch: ["productmatch", "product_match", "产品匹配说明", "匹配说明"],
  unitPrice: ["unitprice", "unit_price", "采购单价", "单价"],
  freightPerUnit: ["freightperunit", "freight_per_unit", "单件运费", "运费"],
  dutyRate: ["dutyrate", "duty_rate", "关税率", "税率"],
  moq: ["moq", "起订量", "最小起订量"],
  leadTimeDays: ["leadtimedays", "lead_time_days", "交期", "交期天数"],
  sampleFee: ["samplefee", "sample_fee", "样品费"],
  paymentTerms: ["paymentterms", "payment_terms", "付款条件", "付款方式"],
  incoterm: ["incoterm", "贸易条款"],
  certifications: ["certifications", "certification", "认证", "认证合规", "资质"],
  quoteUrl: ["quoteurl", "quote_url", "报价来源", "报价链接"],
  summary: ["summary", "摘要", "证据摘要", "总结"],
  sampleSize: ["samplesize", "sample_size", "样本数", "样本量"],
  representativeQuote: ["representativequote", "representative_quote", "代表原文", "用户原话"],
};

function canonicalFieldName(raw: string, documentType: EvidenceDocumentType) {
  const alias = normalizeAlias(raw);
  const definitions = new Set(getFieldDefinitions(documentType).map((field) => field.name));
  for (const [fieldName, aliases] of Object.entries(FIELD_ALIASES)) {
    if (!definitions.has(fieldName)) continue;
    if (aliases.some((candidate) => normalizeAlias(candidate) === alias)) return fieldName;
  }
  return "";
}

function normalizeAlias(value: string) {
  return value.toLowerCase().replace(/[\s_\-./()（）]/g, "");
}

function findValueInContent(content: string, value: NormalizedFieldValue) {
  const text = String(value).trim();
  if (!text) return "";
  const index = content.indexOf(text);
  return index >= 0 ? text : "";
}

function scalarValue(value: unknown): NormalizedFieldValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function clampConfidence(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeExtractionError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]")
    .slice(0, 300);
}
