import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AI_PROPOSAL_KIND_LABELS,
  buildAiProposalDigest,
  normalizeProposalRows,
  type CandidateRow,
  type DraftRow,
  type EvidenceRow,
  type PendingAiProposal,
} from "./digest.ts";

const evidenceRow = (overrides: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id: "task-1",
  status: "needs_review",
  requested_by: "测试员",
  provider: "openai-compatible",
  model: "gpt-test",
  created_at: "2026-11-06T02:00:00.000Z",
  target_hypothesis_id: "hyp-1",
  hypothesis_concept: "便携宠物清洁刷",
  run_id: "run-1",
  file_name: "review.csv",
  unresolved_count: 3,
  error_message: null,
  ...overrides,
});

const draftRow = (overrides: Partial<DraftRow> = {}): DraftRow => ({
  id: "draft-1",
  draft_type: "rfq",
  subject: "询价：便携宠物清洁刷",
  missing_fields: ["spec", "moq", "quoteValidity"],
  generation_mode: "deterministic",
  provider: "template",
  model: "deterministic-v1",
  created_at: "2026-11-06T01:00:00.000Z",
  hypothesis_id: "hyp-1",
  hypothesis_concept: "便携宠物清洁刷",
  run_id: "run-1",
  ...overrides,
});

const candidateRow = (overrides: Partial<CandidateRow> = {}): CandidateRow => ({
  id: "cand-1",
  title: "工厂直供清洁刷",
  supplier_name: "义乌某厂",
  score: 82,
  created_at: "2026-11-06T00:30:00.000Z",
  hypothesis_id: "hyp-1",
  hypothesis_concept: "便携宠物清洁刷",
  run_id: "run-1",
  ...overrides,
});

const proposal = (overrides: Partial<PendingAiProposal> = {}): PendingAiProposal => ({
  id: "p-1",
  kind: "evidence_extraction",
  status: "needs_review",
  target: { entityType: "opportunity_hypothesis", entityId: "hyp-1" },
  title: "证据提取任务",
  reason: "待人工审核",
  generation: { source: "model", provider: "openai-compatible", model: "gpt-test" },
  hypothesisId: "hyp-1",
  hypothesisConcept: "便携宠物清洁刷",
  runId: "run-1",
  fallbackHref: "/ai-inbox?status=needs_review",
  createdAt: "2026-11-06T02:00:00.000Z",
  ...overrides,
});

test("empty input produces an empty digest without warnings leaking into counts", () => {
  const digest = buildAiProposalDigest([]);
  assert.equal(digest.total, 0);
  assert.deepEqual(digest.groups, []);
  assert.deepEqual(digest.byKind, {
    evidence_extraction: 0,
    supplier_draft: 0,
    supplier_candidate: 0,
  });
  assert.deepEqual(digest.warnings, []);
});

test("proposals on the same business object collapse into one todo with a business-object href", () => {
  const rows = normalizeProposalRows({
    evidence: [evidenceRow()],
    drafts: [draftRow()],
    candidates: [candidateRow(), candidateRow({ id: "cand-2", title: "另一家工厂" })],
  });
  const digest = buildAiProposalDigest(rows);

  assert.equal(digest.total, 4);
  assert.equal(digest.groups.length, 1);
  const group = digest.groups[0];
  assert.equal(group.title, "便携宠物清洁刷");
  assert.equal(group.count, 4);
  assert.deepEqual(group.kinds, ["evidence_extraction", "supplier_draft", "supplier_candidate"]);
  assert.match(group.summary, /证据提取 1 条/);
  assert.match(group.summary, /供应商候选 2 条/);
  assert.equal(group.href, "/ai-sourcing/run-1#hypothesis-hyp-1");
  assert.deepEqual(digest.byKind, {
    evidence_extraction: 1,
    supplier_draft: 1,
    supplier_candidate: 2,
  });
});

test("proposals without a business object stay separate and fall back to their own page", () => {
  const rows = normalizeProposalRows({
    evidence: [
      evidenceRow({ id: "task-a", target_hypothesis_id: null, hypothesis_concept: null, run_id: null, status: "failed" }),
      evidenceRow({ id: "task-b", target_hypothesis_id: null, hypothesis_concept: null, run_id: null, status: "ready" }),
    ],
  });
  const digest = buildAiProposalDigest(rows);

  assert.equal(digest.total, 2);
  assert.equal(digest.groups.length, 2);
  assert.equal(digest.groups[0].count, 1);
  assert.equal(digest.groups[0].href, "/ai-inbox?status=failed");
  assert.equal(digest.groups[1].href, "/ai-inbox?status=ready");
  // 失败任务排在可应用任务前面
  assert.match(digest.groups[0].reason, /失败/);
});

test("failed tasks sort first, and limit truncates groups but not the total", () => {
  const items = [
    proposal({ id: "ok-1", createdAt: "2026-11-06T09:00:00.000Z" }),
    proposal({ id: "ok-2", hypothesisId: "hyp-2", hypothesisConcept: "第二个机会", createdAt: "2026-11-06T08:00:00.000Z" }),
    proposal({ id: "ok-3", hypothesisId: "hyp-3", hypothesisConcept: "第三个机会", createdAt: "2026-11-06T07:00:00.000Z" }),
    proposal({ id: "bad", hypothesisId: "hyp-4", hypothesisConcept: "失败的机会", status: "failed", createdAt: "2026-11-05T01:00:00.000Z" }),
  ];
  const digest = buildAiProposalDigest(items, { limit: 2 });

  assert.equal(digest.total, 4);
  assert.equal(digest.groups.length, 2);
  assert.equal(digest.groups[0].title, "失败的机会");
  assert.match(digest.groups[1].title, /便携宠物清洁刷|第二个机会|第三个机会/);
});

test("warnings are passed through without changing proposal counts", () => {
  const digest = buildAiProposalDigest([proposal()], { warnings: ["供应商候选提案暂时不可用"] });
  assert.equal(digest.total, 1);
  assert.deepEqual(digest.warnings, ["供应商候选提案暂时不可用"]);
});

test("every normalized proposal explains why it needs a human and records how it was generated", () => {
  const rows = normalizeProposalRows({
    evidence: [evidenceRow()],
    drafts: [draftRow({ missing_fields: JSON.stringify(["spec", "moq"]) })],
    candidates: [candidateRow()],
  });

  assert.equal(rows.length, 3);
  for (const item of rows) {
    assert.ok(item.reason.length > 8, `${item.kind} 缺少理由`);
    assert.ok(item.fallbackHref.startsWith("/"));
    assert.ok(item.generation.source);
  }
  const [evidence, draft, candidate] = rows;
  assert.match(evidence.reason, /3 个字段未确认/);
  assert.match(evidence.reason, /生成方式：openai-compatible\/gpt-test/);
  assert.equal(evidence.generation.source, "model");
  assert.match(draft.reason, /确定性模板/);
  assert.match(draft.reason, /缺 2 项信息/);
  assert.match(draft.reason, /不会自动发送/);
  assert.equal(draft.generation.source, "template");
  assert.match(candidate.reason, /评分 82/);
  assert.match(candidate.reason, /不自动写入供应商表/);
  assert.equal(candidate.generation.source, "manual");
});

test("failed evidence keeps the error, and unknown draft types still get a readable label", () => {
  const rows = normalizeProposalRows({
    evidence: [evidenceRow({ status: "failed", error_message: "模型返回格式错误" })],
    drafts: [draftRow({ draft_type: "unknown_type", missing_fields: "not-json" })],
  });
  assert.match(rows[0].reason, /模型返回格式错误/);
  assert.match(rows[1].reason, /供应商草稿/);
  assert.doesNotMatch(rows[1].reason, /缺 \d+ 项/);
});

test("invalid dates do not break ordering", () => {
  const digest = buildAiProposalDigest([
    proposal({ id: "broken", createdAt: "not-a-date" }),
    proposal({ id: "valid", hypothesisId: "hyp-2", hypothesisConcept: "另一个机会", createdAt: "2026-11-06T01:00:00.000Z" }),
  ]);
  assert.equal(digest.total, 2);
  assert.equal(digest.groups.length, 2);
  assert.equal(digest.groups[0].title, "另一个机会");
});

test("kind labels cover every kind so the UI never renders an undefined label", () => {
  for (const kind of ["evidence_extraction", "supplier_draft", "supplier_candidate"] as const) {
    assert.ok(AI_PROPOSAL_KIND_LABELS[kind]);
  }
});
