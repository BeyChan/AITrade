import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canApplyValidatedFields,
  validateExtraction,
  type FieldCandidate,
  type ValidatedExtraction,
} from "./validator.ts";

const competitorContent = [
  "标题：宠物饮水机",
  "价格：39.99 USD",
  "币种：USD",
  "来源：https://example.com/item",
  "观察时间：2026-11-04T08:00:00Z",
].join("\n");

function completeCompetitorFields(): FieldCandidate[] {
  return [
    { fieldName: "title", rawValue: "宠物饮水机", confidence: 0.99, sourceQuote: "标题：宠物饮水机" },
    { fieldName: "price", rawValue: "39.99", confidence: 0.99, sourceQuote: "价格：39.99 USD" },
    { fieldName: "currency", rawValue: "USD", confidence: 0.99, sourceQuote: "币种：USD" },
    { fieldName: "sourceUrl", rawValue: "https://example.com/item", confidence: 0.99, sourceQuote: "https://example.com/item" },
    { fieldName: "observedAt", rawValue: "2026-11-04T08:00:00Z", confidence: 0.99, sourceQuote: "2026-11-04T08:00:00Z" },
  ];
}

function statusOf(result: ValidatedExtraction, fieldName: string) {
  return result.fields.find((field) => field.fieldName === fieldName)?.status;
}

test("高置信普通字段自动接受，完整证据无需人工确认", () => {
  const result = validateExtraction({
    documentType: "competitor",
    fields: completeCompetitorFields(),
    content: competitorContent,
    targetCurrency: "USD",
  });

  assert.equal(result.canApplyWithoutReview, true);
  assert.deepEqual(result.autoAcceptedFields.sort(), ["currency", "observedAt", "price", "sourceUrl", "title"]);
  assert.equal(canApplyValidatedFields(result.fields), true);
});

test("低置信字段进入人工审核", () => {
  const fields = completeCompetitorFields();
  const title = fields.find((field) => field.fieldName === "title");
  assert.ok(title);
  title.confidence = 0.89;

  const result = validateExtraction({
    documentType: "competitor",
    fields,
    content: competitorContent,
    targetCurrency: "USD",
  });

  assert.equal(statusOf(result, "title"), "needs_review");
  assert.match(result.fields.find((field) => field.fieldName === "title")?.validationMessage ?? "", /低于自动接受阈值 90%/);
  assert.equal(result.canApplyWithoutReview, false);
  assert.equal(canApplyValidatedFields(result.fields), false);
});

test("敏感字段即使高置信也必须人工确认", () => {
  const content = [
    "供应商名称：Factory A",
    "供应商平台：1688",
    "供应商主页：https://factory.example.com",
    "产品匹配：同款材质与结构",
    "采购单价：5.20 USD",
    "单件运费：1.10 USD",
    "关税率：8%",
    "币种：USD",
    "MOQ：500",
    "交期：25 天",
    "报价来源：https://factory.example.com/quote",
    "观察时间：2026-11-04T08:00:00Z",
  ].join("\n");
  const fields: FieldCandidate[] = [
    { fieldName: "supplierName", rawValue: "Factory A", confidence: 1, sourceQuote: "供应商名称：Factory A" },
    { fieldName: "supplierPlatform", rawValue: "1688", confidence: 1, sourceQuote: "供应商平台：1688" },
    { fieldName: "supplierUrl", rawValue: "https://factory.example.com", confidence: 1, sourceQuote: "https://factory.example.com" },
    { fieldName: "productMatch", rawValue: "同款材质与结构", confidence: 1, sourceQuote: "产品匹配：同款材质与结构" },
    { fieldName: "unitPrice", rawValue: "5.20", confidence: 1, sourceQuote: "采购单价：5.20 USD" },
    { fieldName: "freightPerUnit", rawValue: "1.10", confidence: 1, sourceQuote: "单件运费：1.10 USD" },
    { fieldName: "dutyRate", rawValue: "8%", confidence: 1, sourceQuote: "关税率：8%" },
    { fieldName: "currency", rawValue: "USD", confidence: 1, sourceQuote: "币种：USD" },
    { fieldName: "moq", rawValue: "500", confidence: 1, sourceQuote: "MOQ：500" },
    { fieldName: "leadTimeDays", rawValue: "25", confidence: 1, sourceQuote: "交期：25 天" },
    { fieldName: "quoteUrl", rawValue: "https://factory.example.com/quote", confidence: 1, sourceQuote: "https://factory.example.com/quote" },
    { fieldName: "observedAt", rawValue: "2026-11-04T08:00:00Z", confidence: 1, sourceQuote: "2026-11-04T08:00:00Z" },
  ];

  const result = validateExtraction({ documentType: "supplier_quote", fields, content, targetCurrency: "USD" });

  for (const fieldName of ["supplierName", "supplierUrl", "quoteUrl"]) {
    assert.equal(statusOf(result, fieldName), "needs_review", `${fieldName} 不应自动接受`);
    assert.match(result.fields.find((field) => field.fieldName === fieldName)?.validationMessage ?? "", /敏感字段必须人工确认/);
  }
  assert.equal(statusOf(result, "currency"), "auto_accepted");
  assert.equal(result.canApplyWithoutReview, false);
});

test("来源原文无法在 artifact 中定位时阻断自动接受", () => {
  const fields = completeCompetitorFields();
  const title = fields.find((field) => field.fieldName === "title");
  assert.ok(title);
  title.sourceQuote = "artifact 中不存在的标题";

  const result = validateExtraction({
    documentType: "competitor",
    fields,
    content: competitorContent,
    targetCurrency: "USD",
  });

  assert.equal(statusOf(result, "title"), "needs_review");
  assert.match(result.fields.find((field) => field.fieldName === "title")?.validationMessage ?? "", /无法在保存的 artifact 中定位/);
  assert.equal(canApplyValidatedFields(result.fields), false);
});

test("冲突候选全部保留，并要求人工裁决", () => {
  const content = `${competitorContent}\n另一标题：宠物饮水机 Pro`;
  const fields = [
    ...completeCompetitorFields(),
    { fieldName: "title", rawValue: "宠物饮水机 Pro", confidence: 0.99, sourceQuote: "另一标题：宠物饮水机 Pro" },
  ];

  const result = validateExtraction({
    documentType: "competitor",
    fields,
    content,
    targetCurrency: "USD",
  });
  const titleFields = result.fields.filter((field) => field.fieldName === "title");

  assert.equal(titleFields.length, 2);
  assert.ok(titleFields.every((field) => field.status === "needs_review"));
  assert.ok(titleFields.every((field) => /多个不一致的值/.test(field.validationMessage)));
  assert.equal(result.canApplyWithoutReview, false);
});

test("非法金额、币种、评分与目标币种不一致均会阻断", () => {
  const content = [
    "标题：宠物饮水机",
    "价格：abc",
    "币种：US",
    "评分：9",
    "来源：https://example.com/item",
    "观察时间：2026-11-04T08:00:00Z",
  ].join("\n");
  const fields = completeCompetitorFields();
  const byName = new Map(fields.map((field) => [field.fieldName, field]));
  assert.ok(byName.get("price"));
  assert.ok(byName.get("currency"));
  byName.get("price")!.rawValue = "abc";
  byName.get("price")!.sourceQuote = "价格：abc";
  byName.get("currency")!.rawValue = "US";
  byName.get("currency")!.sourceQuote = "币种：US";
  fields.push({ fieldName: "rating", rawValue: "9", confidence: 0.99, sourceQuote: "评分：9" });

  const result = validateExtraction({ documentType: "competitor", fields, content, targetCurrency: "USD" });
  assert.match(result.fields.find((field) => field.fieldName === "price")?.validationMessage ?? "", /不是有效数字/);
  assert.match(result.fields.find((field) => field.fieldName === "currency")?.validationMessage ?? "", /3 位 ISO/);
  assert.match(result.fields.find((field) => field.fieldName === "rating")?.validationMessage ?? "", /0 到 5/);
  assert.equal(result.canApplyWithoutReview, false);

  const validFields = completeCompetitorFields();
  const validCurrency = validFields.find((field) => field.fieldName === "currency");
  assert.ok(validCurrency);
  validCurrency.rawValue = "EUR";
  validCurrency.sourceQuote = "币种：USD";
  const mismatch = validateExtraction({
    documentType: "competitor",
    fields: validFields,
    content: competitorContent.replace("币种：USD", "币种：EUR"),
    targetCurrency: "USD",
  });
  assert.match(mismatch.fields.find((field) => field.fieldName === "currency")?.validationMessage ?? "", /与目标机会 USD 不一致/);
  assert.equal(mismatch.canApplyWithoutReview, false);
});

test("月销量下限大于上限时进入审核并阻断应用", () => {
  const content = `${competitorContent}\n月销量下限：2000\n月销量上限：1000`;
  const fields = [
    ...completeCompetitorFields(),
    { fieldName: "monthlySalesMin", rawValue: "2000", confidence: 0.99, sourceQuote: "月销量下限：2000" },
    { fieldName: "monthlySalesMax", rawValue: "1000", confidence: 0.99, sourceQuote: "月销量上限：1000" },
  ];

  const result = validateExtraction({ documentType: "competitor", fields, content, targetCurrency: "USD" });

  assert.equal(statusOf(result, "monthlySalesMin"), "needs_review");
  assert.equal(statusOf(result, "monthlySalesMax"), "needs_review");
  assert.ok(result.needsReviewFields.includes("monthlySalesMin"));
  assert.ok(result.needsReviewFields.includes("monthlySalesMax"));
  assert.equal(result.canApplyWithoutReview, false);
  assert.equal(canApplyValidatedFields(result.fields), false);
});

test("未定义字段被忽略，但保留告警", () => {
  const fields = [
    ...completeCompetitorFields(),
    { fieldName: "guaranteedProfit", rawValue: "99%", confidence: 1, sourceQuote: "guaranteedProfit" },
  ];

  const result = validateExtraction({ documentType: "competitor", fields, content: competitorContent, targetCurrency: "USD" });

  assert.equal(result.fields.some((field) => field.fieldName === "guaranteedProfit"), false);
  assert.ok(result.warnings.some((warning) => /未定义字段 guaranteedProfit/.test(warning)));
});
