import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySupplierPolish,
  buildDeterministicSupplierDraft,
  parseSupplierPolish,
  validateSupplierPolish,
  type SupplierDraftFactSnapshot,
} from "./schema.ts";

const facts: SupplierDraftFactSnapshot = {
  hypothesis: {
    id: "hypothesis-1",
    concept: "可拆洗宠物梳",
    category: "宠物用品",
    targetUser: "长毛犬猫家庭",
    painPoint: "毛发难清理",
    differentiator: "按压退毛结构",
    mainRisks: ["结构耐用性待验证"],
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
  },
  supplier: null,
  quote: null,
  quoteValidUntil: "2026-11-12",
};

test("RFQ 确定性模板包含全部首轮缺失信息问题", () => {
  const draft = buildDeterministicSupplierDraft({ draftType: "rfq", facts });
  assert.deepEqual(
    draft.missingFields.map((field) => field.field),
    [
      "specifications",
      "targetQuantity",
      "targetPrice",
      "certifications",
      "sample",
      "leadTime",
      "paymentTerms",
    ],
  );
  assert.equal(draft.missingFields.length, draft.questions.length);
  for (const question of draft.questions) {
    assert.ok(draft.body.includes(question.question));
  }
});

test("追问模板始终要求补充报价有效期", () => {
  const draft = buildDeterministicSupplierDraft({ draftType: "followup", facts });
  assert.ok(draft.missingFields.some((field) => field.field === "quoteValidity"));
  assert.match(draft.body, /请确认当前报价的有效期/);
});

test("到期提醒只使用调用方提供的内部日期", () => {
  const draft = buildDeterministicSupplierDraft({
    draftType: "expiry_reminder",
    facts: {
      ...facts,
      supplier: {
        id: "supplier-1",
        name: "示例工厂",
        platform: "1688",
        url: "https://example.com/supplier",
        country: "CN",
        productMatch: "可拆洗结构",
      },
      quote: {
        id: "quote-1",
        currency: "USD",
        unitPriceCents: 1299,
        freightPerUnitCents: 200,
        landedCostCents: 1499,
        moq: 100,
        leadTimeDays: 20,
        sampleFeeCents: 5000,
        certifications: "CE",
        paymentTerms: "30% deposit",
        incoterm: "FOB",
        observedAt: "2026-11-05T00:00:00.000Z",
      },
    },
  });
  assert.match(draft.introduction, /内部记录的提醒日期为 2026-11-12/);
  assert.match(draft.body, /2026-11-12/);
});

test("无效模型 JSON、Markdown、越权表述和新增数字都会拒绝", () => {
  const deterministic = buildDeterministicSupplierDraft({ draftType: "rfq", facts });
  assert.equal(parseSupplierPolish("{not-json"), null);
  assert.equal(validateSupplierPolish(null, deterministic, facts).ok, false);

  const markdown = validateSupplierPolish({
    subject: "询价：可拆洗宠物梳",
    introduction: "# 您好，希望获取报价。",
  }, deterministic, facts);
  assert.equal(markdown.ok, false);
  if (!markdown.ok) assert.match(markdown.error, /Markdown/);

  const claim = validateSupplierPolish({
    subject: "询价：可拆洗宠物梳",
    introduction: "您好，我们已认证该工厂，希望获取报价。",
  }, deterministic, facts);
  assert.equal(claim.ok, false);
  if (!claim.ok) assert.match(claim.error, /未经证实|越权/);

  const inventedNumber = validateSupplierPolish({
    subject: "询价：可拆洗宠物梳",
    introduction: "您好，希望向 999 家候选供应商询价。",
  }, deterministic, facts);
  assert.equal(inventedNumber.ok, false);
  if (!inventedNumber.ok) assert.match(inventedNumber.error, /999/);
});

test("模型无需复述缺失项，确定性问题仍会完整追加到最终草稿", () => {
  const deterministic = buildDeterministicSupplierDraft({ draftType: "rfq", facts });
  const validated = validateSupplierPolish({
    subject: "询价：可拆洗宠物梳",
    introduction: "您好，我们希望了解可拆洗宠物梳，并获取可核实的产品信息和报价。",
  }, deterministic, facts);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;

  const finalDraft = applySupplierPolish(deterministic, validated.value);
  assert.deepEqual(finalDraft.missingFields, deterministic.missingFields);
  for (const question of deterministic.questions) {
    assert.ok(finalDraft.body.includes(question.question));
  }
  assert.match(finalDraft.body, /请提供产品规格/);
});
