import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampConfidence,
  detectDocumentType,
  getFieldDefinition,
  normalizeCurrency,
  normalizeFieldValue,
  parseModelExtraction,
  sourceLocator,
  validateNormalizedFieldValue,
  type FieldDefinition,
} from "./schema.ts";

function field(name: string, documentType: "competitor" | "supplier_quote" | "review_insight" = "competitor") {
  const definition = getFieldDefinition(documentType, name);
  assert.ok(definition, `${documentType}.${name} 字段定义应存在`);
  return definition;
}

test("模型输出只保留已定义字段，并钳制置信度", () => {
  const extraction = parseModelExtraction(JSON.stringify({
    documentType: "competitor",
    fields: {
      title: { value: "Pet Fountain", confidence: 1.8, sourceQuote: "Pet Fountain" },
      price: { value: 39.99, confidence: -0.2, sourceQuote: "39.99" },
      invented: { value: "not allowed", confidence: 0.99, sourceQuote: "not allowed" },
    },
    notes: "只抄录原文",
    warnings: ["来源不足"],
  }), "unknown");

  assert.equal(extraction.documentType, "competitor");
  assert.deepEqual(Object.keys(extraction.fields), ["title", "price"]);
  assert.equal(extraction.fields.title?.confidence, 1);
  assert.equal(extraction.fields.price?.confidence, 0);
  assert.match(extraction.warnings.join(" "), /未定义字段 invented/);
  assert.equal(extraction.notes, "只抄录原文");
});

test("模型输出非法类型时回退确定性文档类型", () => {
  const extraction = parseModelExtraction(JSON.stringify({
    documentType: "marketing_flyer",
    fields: {
      supplierName: { value: "Factory A", confidence: 0.95, sourceQuote: "Factory A" },
    },
  }), "supplier_quote");

  assert.equal(extraction.documentType, "supplier_quote");
  assert.equal(extraction.fields.supplierName?.value, "Factory A");
});

test("字段规范化覆盖金额、评分、整数、比例、URL、币种和日期", () => {
  assert.deepEqual(normalizeFieldValue(field("price"), "$39.99"), { value: 3999, error: "" });
  assert.deepEqual(normalizeFieldValue(field("rating"), "4.567"), { value: 4.57, error: "" });
  assert.deepEqual(normalizeFieldValue(field("reviewCount"), "1,280"), { value: 1280, error: "" });
  assert.deepEqual(normalizeFieldValue(field("dutyRate", "supplier_quote"), "8%"), { value: 0.08, error: "" });
  assert.deepEqual(normalizeFieldValue(field("dutyRate", "supplier_quote"), "0.08"), { value: 0.08, error: "" });
  assert.deepEqual(normalizeFieldValue(field("sourceUrl"), "example.com/item"), {
    value: "https://example.com/item",
    error: "",
  });
  assert.deepEqual(normalizeFieldValue(field("currency"), "rmb"), { value: "CNY", error: "" });
  assert.deepEqual(normalizeFieldValue(field("observedAt"), "2026-11-04T08:00:00Z"), {
    value: "2026-11-04T08:00:00.000Z",
    error: "",
  });
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("US"), "");
  assert.equal(clampConfidence(Number.NaN), 0);
});

test("非法金额、评分、整数和比例不会被规范化成可用值", () => {
  assert.match(normalizeFieldValue(field("price"), "0").error, /金额必须大于 0/);
  assert.match(normalizeFieldValue(field("price"), "-2").error, /金额必须大于 0/);
  assert.match(normalizeFieldValue(field("rating"), "5.1").error, /0 到 5/);
  assert.match(normalizeFieldValue(field("reviewCount"), "1.5").error, /大于 0 的整数/);
  assert.match(normalizeFieldValue(field("dutyRate", "supplier_quote"), "120%").error, /0 到 1/);
  assert.match(normalizeFieldValue(field("sourceUrl"), "javascript:alert(1)").error, /http\/https/);
  assert.match(normalizeFieldValue(field("currency"), "US").error, /3 位 ISO/);
});

test("已归一化金额校验不会再次乘以 100", () => {
  assert.deepEqual(validateNormalizedFieldValue(field("price"), 3999), { value: 3999, error: "" });
  assert.match(validateNormalizedFieldValue(field("price"), 39.99).error, /最小货币单位整数/);
  assert.deepEqual(validateNormalizedFieldValue(field("dutyRate", "supplier_quote"), 0.08), { value: 0.08, error: "" });
  assert.match(validateNormalizedFieldValue(field("dutyRate", "supplier_quote"), 8).error, /0 到 1/);
});

test("来源定位支持原文与空白折叠后的摘录", () => {
  const content = "标题：宠物饮水机\n价格：39.99 USD";
  assert.deepEqual(sourceLocator(content, "价格：39.99 USD"), {
    matched: true,
    start: 9,
    end: 21,
  });
  assert.equal(sourceLocator("标题：宠物   饮水机", "宠物 饮水机").matched, true);
  assert.equal(sourceLocator(content, "未出现的原文").matched, false);
  assert.equal(sourceLocator(content, " ").matched, false);
});

test("文档类型识别只根据明确表头信号返回已知类型", () => {
  assert.equal(detectDocumentType("supplier_name,unit_price,moq,lead_time_days"), "supplier_quote");
  assert.equal(detectDocumentType("asin,竞品价格,review_count,rating"), "competitor");
  assert.equal(detectDocumentType("差评,评论主题,sample_size,代表原文"), "review_insight");
  assert.equal(detectDocumentType("这是一段普通笔记"), "unknown");
  assert.equal(getFieldDefinition("unknown", "title"), undefined);
});

test("字段定义类型可用于后续校验", () => {
  const definition: FieldDefinition = field("title");
  assert.equal(definition.required, true);
  assert.equal(definition.rule, "text");
});
