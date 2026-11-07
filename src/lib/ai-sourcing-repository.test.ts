import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ai-sourcing-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_PROVIDER = "template";

const { getDb } = await import("./db.ts");
const {
  autoImportSiteCompetitors,
  confirmHypothesisPrice,
  createAISourcingBatch,
  deleteAISourcingBatch,
  getAISourcingBatch,
  listAISourcingBatches,
  loadCaseCompetitorBenchmark,
  recordCompetitorEvidence,
  recordOpportunityEvidence,
  recordSupplierCandidates,
  rejectSupplierCandidate,
  selectHypothesisForValidation,
  shortlistSupplierCandidate,
} = await import("./ai-sourcing-repository.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
});

test("deleting a research batch cascades research data but preserves promoted product cases", async () => {
  const db = await getDb();
  const created = await createAISourcingBatch({
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物清洁",
    brief: "验证可拆洗宠物梳子的真实需求与供应商报价",
    actor: "测试运营",
  });
  const batch = await getAISourcingBatch(created.runId);
  assert.ok(batch);
  assert.equal(batch.hypotheses.length, 5);
  assert.equal((await listAISourcingBatches()).length, 1);

  const hypothesisId = batch.hypotheses[0]?.id;
  assert.ok(hypothesisId);
  const caseId = randomUUID();
  const taskId = randomUUID();
  const evidenceId = randomUUID();

  await db.query(
    `INSERT INTO product_cases
      (id, asin, marketplace, category, title, competitor_price_cents, owner, evidence_score, is_demo)
     VALUES ($1, 'B0DELETEBATCH', 'US', '宠物清洁', '保留的已立项商品', 2999, '测试运营', 80, FALSE)`,
    [caseId],
  );
  await db.query(
    "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
    [caseId, hypothesisId],
  );
  await db.query(
    `INSERT INTO opportunity_evidence
      (id, hypothesis_id, evidence_type, source_type, source_url, title, summary, observed_at, created_by)
     VALUES ($1, $2, 'competitor_snapshot', 'manual_verified', 'https://example.com/evidence',
             '测试证据', '删除批次时应级联删除', NOW(), '测试运营')`,
    [evidenceId, hypothesisId],
  );
  await db.query(
    `INSERT INTO ai_tasks
      (id, task_type, status, source_kind, target_hypothesis_id, request_hash, requested_by)
     VALUES ($1, 'evidence_extraction', 'queued', 'paste', $2, $3, '测试运营')`,
    [taskId, hypothesisId, randomUUID()],
  );

  const deleted = await deleteAISourcingBatch(created.runId, "测试运营");
  assert.equal(deleted.deletedHypothesisCount, 5);
  assert.equal(deleted.preservedProductCaseCount, 1);
  assert.equal(await getAISourcingBatch(created.runId), null);
  assert.equal((await listAISourcingBatches()).length, 0);

  const retained = await db.query<{
    briefs: string;
    runs: string;
    hypotheses: string;
    evidence: string;
    tasks: string;
    product_cases: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM sourcing_briefs WHERE id = $1)::text AS briefs,
       (SELECT COUNT(*) FROM ai_sourcing_runs WHERE id = $2)::text AS runs,
       (SELECT COUNT(*) FROM opportunity_hypotheses WHERE id = $3)::text AS hypotheses,
       (SELECT COUNT(*) FROM opportunity_evidence WHERE id = $4)::text AS evidence,
       (SELECT COUNT(*) FROM ai_tasks WHERE id = $5 AND target_hypothesis_id IS NULL)::text AS tasks,
       (SELECT COUNT(*) FROM product_cases WHERE id = $6)::text AS product_cases`,
    [created.briefId, created.runId, hypothesisId, evidenceId, taskId, caseId],
  );
  assert.deepEqual(retained.rows[0], {
    briefs: "0",
    runs: "0",
    hypotheses: "0",
    evidence: "0",
    tasks: "1",
    product_cases: "1",
  });

  const audit = await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_logs
     WHERE action = 'ai_sourcing.batch_deleted' AND entity_id = $1`,
    [created.runId],
  );
  assert.equal(audit.rows[0]?.details.preservedProductCaseCount, 1);
  assert.equal(audit.rows[0]?.details.productCasesPreserved, true);

  await assert.rejects(
    () => deleteAISourcingBatch(created.runId, "测试运营"),
    /研究批次不存在或已被删除/,
  );
});

test("the same research request key reuses one batch", async () => {
  const db = await getDb();
  const requestKey = randomUUID();
  const input = {
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物出行",
    brief: "验证可折叠宠物饮水杯的真实需求与供应商报价",
    actor: "测试运营",
    requestKey,
  };

  const first = await createAISourcingBatch(input);
  const second = await createAISourcingBatch({ ...input, category: "重复提交不应创建新批次" });

  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.runId, first.runId);
  assert.equal(second.briefId, first.briefId);
  assert.equal((await getAISourcingBatch(first.runId))?.hypotheses.length, 5);
  assert.equal((await listAISourcingBatches()).length, 1);

  const counts = await db.query<{ briefs: string; runs: string; audits: string }>(
    `SELECT
       (SELECT COUNT(*) FROM sourcing_briefs WHERE id = $1)::text AS briefs,
       (SELECT COUNT(*) FROM ai_sourcing_runs WHERE request_key = $2)::text AS runs,
       (SELECT COUNT(*) FROM audit_logs
        WHERE action = 'ai_sourcing.batch_created' AND entity_id = $3)::text AS audits`,
    [first.briefId, requestKey, first.runId],
  );
  assert.deepEqual(counts.rows[0], { briefs: "1", runs: "1", audits: "1" });
});

test("visible-page candidates stay outside supplier counts until manually verified", async () => {
  const db = await getDb();
  const created = await createAISourcingBatch({
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物饮水",
    brief: "验证静音宠物饮水机的供应商候选、人工核验和 RFQ 衔接",
    actor: "测试运营",
  });
  const initial = await getAISourcingBatch(created.runId);
  const hypothesisId = initial?.hypotheses[0]?.id;
  assert.ok(hypothesisId);
  await selectHypothesisForValidation(hypothesisId, "测试运营");

  const observedAt = new Date().toISOString();
  const items = Array.from({ length: 12 }, (_, index) => ({
    title: `静音宠物饮水机 跨境款 ${index + 1}`,
    supplierName: `深圳宠物电器工厂 ${index + 1}`,
    offerUrl: `https://detail.1688.com/offer/${900000 + index}.html`,
    supplierUrl: `https://shop${index + 1}.1688.com/`,
    price: 30 + index,
    moq: 2,
    location: "广东 深圳",
    badges: ["超级工厂", "48小时发货"],
    sourceText: `静音宠物饮水机 跨境款 ${index + 1} 超级工厂 48小时发货`,
  }));
  const payload = JSON.stringify({
    source: "1688_visible_page",
    pageUrl: "https://s.1688.com/selloffer/offer_search.htm?keywords=pet-water",
    capturedAt: observedAt,
    candidates: items,
  });

  const recorded = await recordSupplierCandidates({
    hypothesisId,
    query: "静音宠物饮水机",
    payload,
    actor: "测试采购",
  });
  assert.equal(recorded.receivedCount, 12);
  assert.equal(recorded.parsedCount, 10);
  assert.equal(recorded.newCount, 10);
  assert.equal(recorded.topCount, 10);

  const beforeVerification = await getAISourcingBatch(created.runId);
  const hypothesisBefore = beforeVerification?.hypotheses.find((item) => item.id === hypothesisId);
  assert.ok(hypothesisBefore);
  assert.equal(hypothesisBefore.counts.supplierCandidates, 10);
  assert.equal(hypothesisBefore.counts.suppliers, 0);
  assert.equal(hypothesisBefore.shortlist.length, 0);
  assert.equal(hypothesisBefore.supplierDiscoveryRuns.length, 1);

  const candidate = hypothesisBefore.supplierCandidates[0];
  assert.ok(candidate);
  await assert.rejects(
    () => shortlistSupplierCandidate({
      candidateId: candidate.id,
      supplierName: candidate.supplierName,
      productMatch: "材质和规格已核对",
      actor: "测试采购",
      verified: false,
    }),
    /请先确认已经人工核验/,
  );

  const shortlisted = await shortlistSupplierCandidate({
    candidateId: candidate.id,
    supplierName: `${candidate.supplierName}（已核验）`,
    productMatch: "已核对材质、规格、包装和产品链接",
    actor: "测试采购",
    verified: true,
  });
  const afterVerification = await getAISourcingBatch(created.runId);
  const hypothesisAfter = afterVerification?.hypotheses.find((item) => item.id === hypothesisId);
  assert.ok(hypothesisAfter);
  assert.equal(hypothesisAfter.counts.suppliers, 1);
  assert.equal(hypothesisAfter.counts.supplierCandidates, 10);
  const verifiedCandidate = hypothesisAfter.supplierCandidates.find((item) => item.id === candidate.id);
  assert.equal(verifiedCandidate?.status, "shortlisted");
  assert.equal(verifiedCandidate?.shortlistId, shortlisted.shortlistId);
  assert.equal(verifiedCandidate?.verifiedBy, "测试采购");

  const shortlistRow = await db.query<{ source_type: string; product_match: string }>(
    "SELECT source_type, product_match FROM supplier_shortlists WHERE id = $1",
    [shortlisted.shortlistId],
  );
  assert.deepEqual(shortlistRow.rows[0], {
    source_type: "visible_page_manual_verification",
    product_match: "已核对材质、规格、包装和产品链接",
  });
  const audits = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM audit_logs
     WHERE action IN ('ai_sourcing.supplier_candidates_recorded', 'ai_sourcing.supplier_candidate_shortlisted')
       AND (entity_id = $1 OR entity_id = $2)`,
    [hypothesisId, candidate.id],
  );
  assert.equal(audits.rows[0]?.count, "2");
  await assert.rejects(
    () => shortlistSupplierCandidate({
      candidateId: candidate.id,
      supplierName: candidate.supplierName,
      productMatch: "重复加入",
      actor: "测试采购",
      verified: true,
    }),
    /已加入短名单/,
  );

  const rejectedCandidate = hypothesisAfter.supplierCandidates.find((item) => item.status === "candidate");
  assert.ok(rejectedCandidate);
  await assert.rejects(
    () => rejectSupplierCandidate({
      candidateId: candidate.id,
      actor: "测试采购",
      reason: "已加入短名单后不能排除",
    }),
    /已加入短名单/,
  );
  const rejected = await rejectSupplierCandidate({
    candidateId: rejectedCandidate.id,
    actor: "测试采购",
    reason: "MOQ 与首单预算不匹配",
  });
  assert.equal(rejected.candidateId, rejectedCandidate.id);
  const afterRejection = await getAISourcingBatch(created.runId);
  const rejectedState = afterRejection?.hypotheses
    .find((item) => item.id === hypothesisId)
    ?.supplierCandidates.find((item) => item.id === rejectedCandidate.id);
  assert.equal(rejectedState?.status, "rejected");
  const rejectionAudit = await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_logs
     WHERE action = 'ai_sourcing.supplier_candidate_rejected' AND entity_id = $1`,
    [rejectedCandidate.id],
  );
  assert.equal(rejectionAudit.rows[0]?.details.reason, "MOQ 与首单预算不匹配");

  const repeated = await recordSupplierCandidates({
    hypothesisId,
    query: "静音宠物饮水机",
    payload,
    actor: "测试采购",
  });
  assert.equal(repeated.newCount, 0);
  assert.equal(repeated.skippedExistingCount, 10);
  assert.equal(repeated.duplicateCount, 10);
  const finalBatch = await getAISourcingBatch(created.runId);
  const finalHypothesis = finalBatch?.hypotheses.find((item) => item.id === hypothesisId);
  assert.equal(finalHypothesis?.supplierCandidates.length, 10);
  assert.equal(finalHypothesis?.supplierDiscoveryRuns.length, 2);
});

test("competitor benchmark hydrates review insights, advises on >P90 price, and resolves case benchmark ok/none/ambiguous", async () => {
  const db = await getDb();
  const created = await createAISourcingBatch({
    marketCode: "US",
    platformCode: "amazon",
    category: "宠物清洁",
    brief: "验证宠物饮水器的竞品价格带与差评缺口传承",
    actor: "测试运营",
  });
  const batch = await getAISourcingBatch(created.runId);
  const h1 = batch?.hypotheses[0]?.id;
  const h2 = batch?.hypotheses[1]?.id;
  assert.ok(h1 && h2);
  await selectHypothesisForValidation(h1, "测试运营");

  const nowIso = new Date().toISOString();
  for (let i = 0; i < 6; i += 1) {
    await recordCompetitorEvidence({
      hypothesisId: h1,
      asin: `B0BENCH0${i}`,
      title: `Pet Water Fountain ${i + 1}`,
      sourceUrl: `https://www.amazon.com/dp/B0BENCH0${i}`,
      priceCents: 1800 + i * 200,
      rating: 4.1,
      reviewCount: 150 + i * 20,
      observedAt: nowIso,
      actor: "测试运营",
    });
  }
  await recordOpportunityEvidence({
    hypothesisId: h1,
    evidenceType: "review_insight",
    sourceType: "review_page",
    sourceUrl: "https://www.amazon.com/product-reviews/B0BENCH00",
    title: "水泵夜间噪音偏大且拆洗繁琐",
    summary: "用户反馈夜间噪音明显",
    observedAt: nowIso,
    reviewSampleSize: 40,
    representativeQuote: "Pump gets loud at night and has too many tiny crevices to clean.",
    sentiment: "negative",
    actor: "测试运营",
  });

  const confirmed = await confirmHypothesisPrice({
    hypothesisId: h1,
    priceCents: 3999,
    sourceUrl: "https://www.amazon.com/dp/B0BENCH05",
    actor: "测试运营",
  });
  assert.ok(confirmed.priceAdvisory?.includes("P90"));

  const hydratedBatch = await getAISourcingBatch(created.runId);
  const hydratedH1 = hydratedBatch?.hypotheses.find((item) => item.id === h1);
  assert.ok(hydratedH1);
  assert.equal(hydratedH1.reviewInsights.length, 1);
  assert.equal(hydratedH1.benchmark.coverage.dedupedCount, 6);
  assert.equal(hydratedH1.benchmark.themes[0]?.sampleSize, 40);

  const unlinkedCaseId = randomUUID();
  await db.query(
    `INSERT INTO product_cases
      (id, asin, marketplace, category, title, competitor_price_cents, owner, evidence_score, is_demo)
     VALUES ($1, 'B0UNLINKED', 'US', '宠物清洁', '无关联商品', 2499, '测试运营', 75, FALSE)`,
    [unlinkedCaseId],
  );
  const noneResult = await loadCaseCompetitorBenchmark(unlinkedCaseId);
  assert.equal(noneResult.status, "none");

  const linkedCaseId = randomUUID();
  await db.query(
    `INSERT INTO product_cases
      (id, asin, marketplace, category, title, competitor_price_cents, owner, evidence_score, source_code, source_record_id, is_demo)
     VALUES ($1, 'B0LINKED01', 'US', '宠物清洁', '关联商品', 2499, '测试运营', 82, 'ai_sourcing', $2, FALSE)`,
    [linkedCaseId, h1],
  );
  await db.query(
    "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
    [linkedCaseId, h1],
  );
  const okResult = await loadCaseCompetitorBenchmark(linkedCaseId);
  assert.equal(okResult.status, "ok");
  assert.ok(okResult.benchmark);
  assert.equal(okResult.benchmark.scope.hypothesisId, h1);
  assert.equal(okResult.benchmark.coverage.dedupedCount, 6);

  await db.query(
    "UPDATE opportunity_hypotheses SET product_case_id = $1 WHERE id = $2",
    [linkedCaseId, h2],
  );
  const ambiguousResult = await loadCaseCompetitorBenchmark(linkedCaseId);
  assert.equal(ambiguousResult.status, "ambiguous");

  const resolvedResult = await loadCaseCompetitorBenchmark(linkedCaseId, h1);
  assert.equal(resolvedResult.status, "ok");
});

test("autoImportSiteCompetitors imports batch competitors and review insights based on site and query", async () => {
  const created = await createAISourcingBatch({
    marketCode: "DE",
    platformCode: "amazon",
    category: "宠物清洁",
    brief: "验证德国站宠物饮水机竞品",
    actor: "测试运营",
  });
  const batch = await getAISourcingBatch(created.runId);
  const hypothesisId = batch?.hypotheses[0]?.id;
  assert.ok(hypothesisId);

  const outcome = await autoImportSiteCompetitors({
    hypothesisId,
    query: "Katzenbrunnen Edelstahl",
    targetCount: 20,
    includeReviews: true,
    actor: "测试运营",
  });

  assert.equal(outcome.marketCode, "DE");
  assert.equal(outcome.currency, "EUR");
  assert.equal(outcome.insertedCompetitors, 20);
  assert.ok(outcome.insertedReviews >= 2);

  const updatedBatch = await getAISourcingBatch(created.runId);
  const h = updatedBatch?.hypotheses.find((item) => item.id === hypothesisId);
  assert.ok(h);
  assert.equal(h.competitors.length, 20);
  assert.ok(h.reviewInsights.length >= 2);
  // AI / 模板批量导入的是待核实素材：入库可查，但不得进入竞品画像、价格分位与 GO 门禁
  assert.ok(h.competitors.every((c) => c.sourceType === "ai_site_auto_import"));
  assert.equal(h.benchmark.coverage.dedupedCount, 0);
  assert.equal(h.benchmark.excludedSyntheticCount, 20);
  assert.equal(h.benchmark.price, null);
  assert.equal(h.benchmark.scope.marketCode, "DE");
  assert.equal(h.benchmark.scope.currency, "EUR");
  assert.ok(h.competitors.every((c) => c.sourceUrl.includes("amazon.de")));
  const competitorGate = outcome.decision.gates.find((gate) => gate.key === "competitors");
  assert.equal(competitorGate?.passed, false);
  assert.equal(competitorGate?.actual, "0");

  // Repeated import with duplicate ASINs/URLs skips existing without error
  const second = await autoImportSiteCompetitors({
    hypothesisId,
    query: "Katzenbrunnen Edelstahl",
    targetCount: 20,
    actor: "测试运营",
  });
  assert.equal(second.insertedCompetitors, 0);
  assert.equal(second.skippedDuplicateCompetitors, 20);
});
