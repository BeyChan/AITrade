import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ai-supplier-assistant-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_PROVIDER = "template";

const { getDb } = await import("../db.ts");
const {
  createAISourcingBatch,
  getAISourcingBatch,
  recordAISupplierQuote,
  selectHypothesisForValidation,
} = await import("../ai-sourcing-repository.ts");
const {
  createSupplierDraft,
  listSupplierDraftsByRun,
  reviewSupplierDraft,
} = await import("./repository.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("P2.1 供应商草稿支持幂等生成、人工审阅和严格外发边界", async () => {
  const db = await getDb();
  const created = await createAISourcingBatch({
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物清洁",
    brief: "验证可拆洗宠物梳的真实供应商信息与报价",
    actor: "测试运营",
  });
  const batch = await getAISourcingBatch(created.runId);
  assert.ok(batch);
  const hypothesis = batch.hypotheses[0];
  assert.ok(hypothesis);
  await selectHypothesisForValidation(hypothesis.id, "测试采购");

  await assert.rejects(
    () => createSupplierDraft({
      hypothesisId: hypothesis.id,
      draftType: "followup",
      actor: "测试采购",
    }),
    /请选择已录入的供应商/,
  );
  await assert.rejects(
    () => createSupplierDraft({
      hypothesisId: hypothesis.id,
      draftType: "expiry_reminder",
      quoteValidUntil: dateOffset(7),
      actor: "测试采购",
    }),
    /请选择已录入的供应商/,
  );

  const before = await db.query<{ evidence: string; quotes: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM opportunity_evidence WHERE hypothesis_id = $1) AS evidence,
       (SELECT COUNT(*)::text FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) AS quotes`,
    [hypothesis.id],
  );

  const first = await createSupplierDraft({
    hypothesisId: hypothesis.id,
    draftType: "rfq",
    actor: "测试采购",
  });
  assert.equal(first.reused, false);
  assert.equal(first.draft.status, "draft");
  assert.equal(first.draft.generationMode, "deterministic");
  assert.equal(first.draft.generationNote.includes("确定性模板"), true);
  assert.equal(first.draft.missingFields.length, 7);
  assert.equal(first.draft.questions.length, 7);
  assert.match(first.draft.body, /请提供产品规格/);
  assert.equal("sentAt" in first.draft, false);

  const repeated = await createSupplierDraft({
    hypothesisId: hypothesis.id,
    draftType: "rfq",
    actor: "测试采购",
  });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.draft.id, first.draft.id);

  const afterRfq = await db.query<{ evidence: string; quotes: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM opportunity_evidence WHERE hypothesis_id = $1) AS evidence,
       (SELECT COUNT(*)::text FROM sourcing_supplier_quotes WHERE hypothesis_id = $1) AS quotes`,
    [hypothesis.id],
  );
  assert.deepEqual(afterRfq.rows[0], before.rows[0]);

  const reviewed = await reviewSupplierDraft({ draftId: first.draft.id, actor: "测试复核员" });
  assert.equal(reviewed.changed, true);
  assert.equal(reviewed.draft.status, "reviewed");
  assert.equal(reviewed.draft.reviewedBy, "测试复核员");
  const repeatedReview = await reviewSupplierDraft({ draftId: first.draft.id, actor: "其他复核员" });
  assert.equal(repeatedReview.changed, false);
  assert.equal(repeatedReview.draft.status, "reviewed");
  assert.equal(repeatedReview.draft.reviewedBy, "测试复核员");

  await recordAISupplierQuote({
    hypothesisId: hypothesis.id,
    supplierName: "测试工厂",
    supplierPlatform: "1688",
    supplierUrl: "https://example.com/supplier",
    contact: "公开联系入口",
    country: "CN",
    productMatch: "可拆洗结构与目标产品匹配",
    unitPriceCents: 1299,
    freightPerUnitCents: 200,
    dutyRate: 0.08,
    moq: 100,
    leadTimeDays: 20,
    sampleScore: 82,
    sampleFeeCents: 5000,
    certifications: "CE",
    paymentTerms: "30% 定金 / 70% 发货前",
    incoterm: "FOB",
    quoteUrl: "https://example.com/quote",
    observedAt: new Date().toISOString(),
    actor: "测试采购",
  });
  const refreshed = await getAISourcingBatch(created.runId);
  const supplier = refreshed?.hypotheses.find((item) => item.id === hypothesis.id)?.shortlist[0];
  assert.ok(supplier);

  const manualSupplierId = randomUUID();
  await db.query(
    `INSERT INTO supplier_shortlists
      (id, hypothesis_id, supplier_name, platform, supplier_url, product_match, observed_at, created_by)
     VALUES ($1, $2, '无报价供应商', '1688', 'https://example.com/no-quote', '', NOW(), '测试采购')`,
    [manualSupplierId, hypothesis.id],
  );
  await assert.rejects(
    () => createSupplierDraft({
      hypothesisId: hypothesis.id,
      draftType: "expiry_reminder",
      supplierShortlistId: manualSupplierId,
      quoteValidUntil: dateOffset(7),
      actor: "测试采购",
    }),
    /请先录入该供应商的真实报价/,
  );

  const followup = await createSupplierDraft({
    hypothesisId: hypothesis.id,
    draftType: "followup",
    supplierShortlistId: supplier.id,
    actor: "测试采购",
  });
  assert.ok(followup.draft.missingFields.some((field) => field.field === "quoteValidity"));

  await assert.rejects(
    () => createSupplierDraft({
      hypothesisId: hypothesis.id,
      draftType: "expiry_reminder",
      supplierShortlistId: supplier.id,
      quoteValidUntil: "2999-02-31",
      actor: "测试采购",
    }),
    /提醒日期无效/,
  );
  await assert.rejects(
    () => createSupplierDraft({
      hypothesisId: hypothesis.id,
      draftType: "expiry_reminder",
      supplierShortlistId: supplier.id,
      quoteValidUntil: dateOffset(-1),
      actor: "测试采购",
    }),
    /今天或未来日期/,
  );

  const reminderDate = dateOffset(14);
  const reminder = await createSupplierDraft({
    hypothesisId: hypothesis.id,
    draftType: "expiry_reminder",
    supplierShortlistId: supplier.id,
    quoteValidUntil: reminderDate,
    actor: "测试采购",
  });
  assert.match(reminder.draft.body, new RegExp(reminderDate));

  const listed = await listSupplierDraftsByRun(created.runId);
  assert.equal(listed.length, 3);
  assert.ok(listed.every((draft) => ["draft", "reviewed"].includes(draft.status)));

  const audits = await db.query<{ action: string; details: Record<string, unknown> }>(
    `SELECT action, details FROM audit_logs
     WHERE entity_type = 'ai_supplier_draft' AND entity_id = $1
     ORDER BY created_at`,
    [first.draft.id],
  );
  assert.equal(audits.rows.length, 2);
  assert.ok(audits.rows.every((row) => row.details.externalActions === "none"));
  assert.ok(audits.rows.every((row) => row.details.sent === false));

  const sentColumns = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'ai_supplier_drafts'
       AND column_name IN ('sent', 'sent_at', 'sent_status')`,
  );
  assert.equal(sentColumns.rows.length, 0);
  await assert.rejects(
    () => db.query("UPDATE ai_supplier_drafts SET status = 'sent' WHERE id = $1", [first.draft.id]),
    /check constraint|violates/i,
  );
});
