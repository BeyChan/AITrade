import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTED_PROPOSAL_STATUSES,
  MIN_AUTO_ACCEPT_CONFIDENCE,
  canTransitionProposalStatus,
  clampConfidence,
  countProposalStatuses,
  describeProposalGeneration,
  isAcceptedProposalStatus,
  isPendingProposalStatus,
  isRejectedProposalStatus,
  locateSource,
  normalizeByRule,
  normalizeCurrency,
  parseProposalFields,
  parseStructuredObject,
  validateStoredByRule,
  type ProposalFieldDefinition,
  type ProposalStatus,
} from "./contract.ts";

const def = (rule: ProposalFieldDefinition["rule"], extra: Partial<ProposalFieldDefinition> = {}): ProposalFieldDefinition => ({
  name: "value",
  label: "测试字段",
  rule,
  required: true,
  ...extra,
});

test("confidence is clamped to 0..1 and never leaks NaN", () => {
  assert.equal(clampConfidence(0.42), 0.42);
  assert.equal(clampConfidence(3), 1);
  assert.equal(clampConfidence(-2), 0);
  assert.equal(clampConfidence("not-a-number"), 0);
  assert.equal(clampConfidence(undefined), 0);
});

test("currency normalization accepts aliases and rejects anything else", () => {
  assert.equal(normalizeCurrency(" rmb "), "CNY");
  assert.equal(normalizeCurrency("usd"), "USD");
  assert.equal(normalizeCurrency("US"), "");
  assert.equal(normalizeCurrency("US1"), "");
});

test("source locator distinguishes exact hits from whitespace-collapsed ones", () => {
  assert.deepEqual(locateSource("价格 12.5 美元", "12.5"), { matched: true, start: 3, end: 7 });
  assert.deepEqual(locateSource("价格  12.5 美元", "价格 12.5"), {
    matched: true,
    start: 0,
    end: 7,
    collapsedWhitespace: true,
  });
  assert.deepEqual(locateSource("无相关内容", "12.5"), { matched: false, start: -1, end: -1 });
  assert.deepEqual(locateSource("任意内容", "  "), { matched: false, start: -1, end: -1 });
});

test("structured parsing tolerates fenced JSON and surrounding prose", () => {
  assert.deepEqual(parseStructuredObject('```json\n{"fields":{}}\n```'), { fields: {} });
  assert.deepEqual(parseStructuredObject('说明：{"fields":{"a":1}} 以上'), { fields: { a: 1 } });
  assert.throws(() => parseStructuredObject("[1,2,3]"), /JSON 对象/);
  assert.throws(() => parseStructuredObject("完全没有 JSON"), /JSON 对象/);
});

test("proposal parsing keeps only declared fields and reports unknown ones", () => {
  const result = parseProposalFields(
    {
      price: { value: "12.5", confidence: 2, sourceQuote: "  单价 12.5  " },
      currency: { value: "USD", confidence: "0.8" },
      hallucinated: { value: "x", confidence: 1 },
      priceText: "ignored",
    },
    [def("money_cents", { name: "price" }), def("currency", { name: "currency" })],
  );
  assert.deepEqual(result.fields.price, { value: "12.5", confidence: 1, sourceQuote: "单价 12.5" });
  assert.equal(result.fields.currency?.confidence, 0.8);
  assert.equal(result.fields.currency?.sourceQuote, "");
  assert.deepEqual(result.unknownFields, ["hallucinated", "priceText"]);
  assert.equal("hallucinated" in result.fields, false);
});

test("money is scaled to cents exactly once during normalization", () => {
  assert.equal(normalizeByRule(def("money_cents"), "$1,234.50").value, 123450);
  assert.match(normalizeByRule(def("money_cents"), "0").error, /大于 0/);
  assert.equal(normalizeByRule(def("money_cents", { allowZero: true }), "0").value, 0);
  assert.match(normalizeByRule(def("money_cents"), "10~20").error, /人工拆分/);
  assert.equal(validateStoredByRule(def("money_cents"), 123450).value, 123450);
  assert.match(validateStoredByRule(def("money_cents"), 12.5).error, /整数/);
});

test("percent accepts both 8% and 0.08, integers reject ranges and unknowns", () => {
  assert.equal(normalizeByRule(def("percent"), "8%").value, 0.08);
  assert.equal(normalizeByRule(def("percent"), "0.08").value, 0.08);
  assert.match(normalizeByRule(def("percent"), "120%").error, /0 到 1/);
  assert.equal(normalizeByRule(def("integer"), "24").value, 24);
  assert.match(normalizeByRule(def("integer"), "0").error, /大于 0/);
  assert.match(normalizeByRule(def("rating"), "5.5").error, /0 到 5/);
});

test("url and text rules reject unsafe or oversized values", () => {
  assert.equal(normalizeByRule(def("url"), "example.com/a").value, "https://example.com/a");
  assert.match(normalizeByRule(def("url"), "https://u:p@example.com").error, /URL/);
  assert.match(validateStoredByRule(def("url"), "ftp://example.com").error, /URL/);
  assert.equal(normalizeByRule(def("text", { maxLength: 5 }), "  a   b  ").value, "a b");
  assert.match(normalizeByRule(def("text", { maxLength: 2 }), "abcd").error, /超过/);
  assert.match(normalizeByRule(def("text"), "  ").error, /缺少必填字段/);
  assert.equal(normalizeByRule(def("text", { required: false }), "  ").error, "");
});

test("datetime normalizes to ISO and rejects unparsable input", () => {
  assert.equal(normalizeByRule(def("datetime"), "2026-10-29").value, "2026-10-29T00:00:00.000Z");
  assert.match(normalizeByRule(def("datetime"), "不是日期").error, /日期时间/);
});

test("status guards classify every proposal status without gaps", () => {
  const all: ProposalStatus[] = ["extracted", "auto_accepted", "needs_review", "accepted", "rejected", "missing"];
  for (const status of all) {
    const classified = [
      isAcceptedProposalStatus(status),
      isPendingProposalStatus(status),
      isRejectedProposalStatus(status),
    ].filter(Boolean).length;
    assert.ok(classified >= 1, `${status} 未被任何守卫分类`);
  }
  assert.deepEqual(
    all.filter(isAcceptedProposalStatus),
    ACCEPTED_PROPOSAL_STATUSES,
  );
  assert.equal(MIN_AUTO_ACCEPT_CONFIDENCE, 0.9);
});

test("accepted proposals are terminal and missing can be re-reviewed", () => {
  assert.equal(canTransitionProposalStatus("needs_review", "accept"), true);
  assert.equal(canTransitionProposalStatus("auto_accepted", "accept"), false);
  assert.equal(canTransitionProposalStatus("accepted", "accept"), false);
  assert.equal(canTransitionProposalStatus("accepted", "reject"), true);
  assert.equal(canTransitionProposalStatus("rejected", "reject"), false);
  assert.equal(canTransitionProposalStatus("missing", "mark_missing"), false);
  assert.equal(canTransitionProposalStatus("accepted", "mark_missing"), true);
});

test("generation provenance records template fallback without hiding provider errors", () => {
  assert.deepEqual(
    describeProposalGeneration({ provider: "ollama", model: "qwen2.5", fallback: true, providerError: "timeout" }),
    {
      source: "template",
      provider: "ollama",
      model: "qwen2.5",
      promptVersion: undefined,
      fallback: true,
      providerError: "timeout",
    },
  );
  assert.equal(describeProposalGeneration({ provider: "openai", model: "gpt-4o" }).source, "model");
  assert.equal(describeProposalGeneration({ provider: "template", model: "local" }).source, "template");
});

test("status counts are usable by an aggregator without embedding thresholds", () => {
  assert.deepEqual(
    countProposalStatuses([
      { status: "needs_review", required: true },
      { status: "auto_accepted", required: true },
      { status: "accepted", required: false },
      { status: "missing", required: true },
      { status: "rejected", required: false },
      { status: "extracted", required: false },
    ]),
    { pendingCount: 3, acceptedCount: 2, rejectedCount: 2, missingRequiredCount: 1 },
  );
});
