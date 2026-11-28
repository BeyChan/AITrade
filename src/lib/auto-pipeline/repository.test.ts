import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-auto-pipeline-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getDb } = await import("../db.ts");
const { runAutoSourcingPipeline } = await import("./orchestrator.ts");
const {
  adoptAutoCandidatesToKanban,
  deleteAutoCandidates,
  deleteAutoPipelineRun,
  eliminateAutoCandidatesToBlacklist,
  listAutoCandidates,
  listAutoPipelineRuns,
  promoteAutoCandidateToCase,
  renameAutoPipelineRun,
  unadoptAutoCandidate,
  unpromoteAutoCandidate,
  upsertPlatformConfig,
} = await import("./repository.ts");
const { listEliminatedHypotheses } = await import("../ai-sourcing-repository.ts");
const { loadFunnelThresholds } = await import("../app-settings.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("auto-pipeline retains per-batch snapshots, supports rename/delete, and preserves promoted cases", async () => {
  const db = await getDb();

  // 第 1 批：2 个商品（其中 B0SHARED01 会在第 2 批重复出现，B0ELIM0001 会因低价被淘汰）
  const run1 = await runAutoSourcingPipeline({
    platformCode: "amazon",
    marketCode: "US",
    sourceType: "csv",
    sourceLabel: "batch-1-mops.csv",
    seeds: [
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0SHARED01",
        title: "Steam Mop Model A",
        brand: "BrandA",
        category: "Home",
        currency: "USD",
        priceCents: 6999,
        monthlySalesEstimate: 800,
        reviewCount: 45,
        rating: 4.5,
      },
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0ELIM0001",
        title: "Cheap Sponge Refill",
        brand: "BrandB",
        category: "Home",
        currency: "USD",
        priceCents: 399,
        monthlySalesEstimate: 100,
        reviewCount: 1200,
        rating: 3.8,
      },
    ],
  });

  // 第 2 批：B0SHARED01 价格更新 + 新商品 B0ONLYRUN2
  const run2 = await runAutoSourcingPipeline({
    platformCode: "amazon",
    marketCode: "US",
    sourceType: "csv",
    sourceLabel: "batch-2-mops.csv",
    seeds: [
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0SHARED01",
        title: "Steam Mop Model A Updated",
        brand: "BrandA",
        category: "Home",
        currency: "USD",
        priceCents: 7999,
        monthlySalesEstimate: 950,
        reviewCount: 60,
        rating: 4.6,
      },
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0ONLYRUN2",
        title: "Spin Mop Bucket System",
        brand: "BrandC",
        category: "Home",
        currency: "USD",
        priceCents: 5499,
        monthlySalesEstimate: 600,
        reviewCount: 80,
        rating: 4.4,
      },
    ],
  });

  // 1. 每批各自保留独立快照
  const run1List = await listAutoCandidates({ platformCode: "amazon", marketCode: "US", runId: run1.run.id });
  const run2List = await listAutoCandidates({ platformCode: "amazon", marketCode: "US", runId: run2.run.id });
  const poolList = await listAutoCandidates({ platformCode: "amazon", marketCode: "US" });

  assert.equal(run1List.length, 2);
  assert.equal(run2List.length, 2);
  assert.equal(poolList.length, 3);
  assert.equal(run1List.find((c) => c.externalId === "B0SHARED01")?.priceCents, 6999);
  assert.equal(run2List.find((c) => c.externalId === "B0SHARED01")?.priceCents, 7999);
  assert.equal(poolList.find((c) => c.externalId === "B0SHARED01")?.priceCents, 7999);

  // 2. 从第 2 批快照推进正式案卷，状态同步到第 1 批快照和汇总池
  const sharedRun2Snap = run2List.find((c) => c.externalId === "B0SHARED01");
  assert.ok(sharedRun2Snap);
  const promoted = await promoteAutoCandidateToCase(sharedRun2Snap.id);
  assert.ok(promoted.caseId);

  const run1AfterPromote = await listAutoCandidates({ runId: run1.run.id });
  assert.equal(
    run1AfterPromote.find((c) => c.externalId === "B0SHARED01")?.promotedCaseId,
    promoted.caseId,
  );

  // 3. 重命名第 1 批
  const renamed = await renameAutoPipelineRun(run1.run.id, "蒸汽拖把-首轮");
  assert.equal(renamed.sourceLabel, "蒸汽拖把-首轮");

  // 4. 删除第 2 批：B0ONLYRUN2 应被移除，B0SHARED01 回迁到第 1 批快照且正式案卷不受影响
  const delRunRes = await deleteAutoPipelineRun(run2.run.id);
  assert.equal(delRunRes.deletedRunId, run2.run.id);
  assert.equal(delRunRes.deletedCandidates, 2);

  const runsAfterDel = await listAutoPipelineRuns({ platformCode: "amazon", marketCode: "US" });
  assert.equal(runsAfterDel.length, 1);
  assert.equal(runsAfterDel[0]?.id, run1.run.id);

  const poolAfterDelRun2 = await listAutoCandidates({ platformCode: "amazon", marketCode: "US" });
  assert.equal(poolAfterDelRun2.length, 2);
  assert.equal(poolAfterDelRun2.find((c) => c.externalId === "B0ONLYRUN2"), undefined);
  assert.equal(poolAfterDelRun2.find((c) => c.externalId === "B0SHARED01")?.priceCents, 6999);

  const caseCheck = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE id = $1`,
    [promoted.caseId],
  );
  assert.equal(caseCheck.rows.length, 1);

  // 5. 一键清理第 1 批里的 ELIMINATED
  const cleanupRes = await deleteAutoCandidates({
    runId: run1.run.id,
    grade: "ELIMINATED",
  });
  assert.equal(cleanupRes.deletedCount, 1);

  const run1AfterCleanup = await listAutoCandidates({ runId: run1.run.id });
  assert.equal(run1AfterCleanup.length, 1);
  assert.equal(run1AfterCleanup[0]?.externalId, "B0SHARED01");

  const runsAfterCleanup = await listAutoPipelineRuns({ platformCode: "amazon", marketCode: "US" });
  assert.equal(runsAfterCleanup[0]?.totalSeeds, 1);
  assert.equal(runsAfterCleanup[0]?.eliminatedCount, 0);

  // 6. 取消推进刚创建的空白案卷：解除关联并自动删除空案卷
  const sharedRun1Snap = run1AfterCleanup[0];
  assert.ok(sharedRun1Snap);
  const unpromoted = await unpromoteAutoCandidate(sharedRun1Snap.id);
  assert.equal(unpromoted.caseId, promoted.caseId);
  assert.equal(unpromoted.caseDeleted, true);

  const run1AfterUnpromote = await listAutoCandidates({ runId: run1.run.id });
  assert.equal(run1AfterUnpromote[0]?.promotedCaseId, null);

  const caseCheckAfterUnpromote = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE id = $1`,
    [promoted.caseId],
  );
  assert.equal(caseCheckAfterUnpromote.rows.length, 0);
});

test("auto-pipeline supports adopting candidates to Kanban, eliminating to unified blacklist, and syncing rules", async () => {
  const run = await runAutoSourcingPipeline({
    platformCode: "amazon",
    marketCode: "US",
    sourceType: "csv",
    sourceLabel: "triage-bridge-test.csv",
    seeds: [
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0ADOPT001",
        title: "Collapsible Silicone Camping Kettle",
        brand: "TrailCraft",
        category: "Sports & Outdoors",
        currency: "USD",
        priceCents: 3899,
        monthlySalesEstimate: 650,
        reviewCount: 72,
        rating: 4.5,
      },
      {
        platformCode: "amazon",
        marketCode: "US",
        externalId: "B0BLACK001",
        title: "Patented Heated Pet Bowl",
        brand: "MegaPet",
        category: "Pet Supplies",
        currency: "USD",
        priceCents: 4599,
        monthlySalesEstimate: 500,
        reviewCount: 95,
        rating: 4.3,
      },
    ],
  });

  const list = await listAutoCandidates({ runId: run.run.id });
  const toAdopt = list.find((c) => c.externalId === "B0ADOPT001");
  const toEliminate = list.find((c) => c.externalId === "B0BLACK001");
  assert.ok(toAdopt && toEliminate);

  // 1. 采纳进推进看板（幂等）
  const firstAdopt = await adoptAutoCandidatesToKanban({ candidateIds: [toAdopt.id] });
  assert.equal(firstAdopt.adoptedCount, 1);
  assert.equal(firstAdopt.reusedCount, 0);
  assert.ok(firstAdopt.items[0]?.runId);
  assert.ok(firstAdopt.items[0]?.hypothesisId);

  const secondAdopt = await adoptAutoCandidatesToKanban({ candidateIds: [toAdopt.id] });
  assert.equal(secondAdopt.adoptedCount, 0);
  assert.equal(secondAdopt.reusedCount, 1);
  assert.equal(secondAdopt.items[0]?.hypothesisId, firstAdopt.items[0]?.hypothesisId);

  const refreshed = await listAutoCandidates({ runId: run.run.id });
  assert.equal(
    refreshed.find((c) => c.externalId === "B0ADOPT001")?.adoptedHypothesisId,
    firstAdopt.items[0]?.hypothesisId,
  );

  // 1b. 取消采纳空白看板候选 → 解除关联并自动清理空白候选
  const unadopted = await unadoptAutoCandidate(toAdopt.id);
  assert.equal(unadopted.hypothesisId, firstAdopt.items[0]?.hypothesisId);
  assert.equal(unadopted.hypothesisDeleted, true);
  const afterUnadopt = await listAutoCandidates({ runId: run.run.id });
  assert.equal(afterUnadopt.find((c) => c.externalId === "B0ADOPT001")?.adoptedHypothesisId, null);

  // 2. 淘汰入统一避坑库，且能被 listEliminatedHypotheses 查到
  const elimRes = await eliminateAutoCandidatesToBlacklist({
    candidateIds: [toEliminate.id],
    reason: "专利/品牌垄断",
    note: "检索到美国外观专利",
  });
  assert.equal(elimRes.eliminatedCount, 1);

  const blacklist = await listEliminatedHypotheses();
  const hit = blacklist.find((item) => item.concept.includes("B0BLACK001"));
  assert.ok(hit, "淘汰记录应同步沉淀至统一避坑库");
  assert.equal(hit?.eliminationReason, "专利/品牌垄断");

  // 3. 修改平台规则同步至统一红灯阈值
  await upsertPlatformConfig({
    platformCode: "amazon",
    marketCode: "US",
    economicsDefaults: { targetMarginRate: 0.22 },
    thresholds: { maxHhi: 2400, maxBrandCr3Percent: 55 },
  });
  const syncedThresholds = await loadFunnelThresholds();
  assert.equal(syncedThresholds.maxHhi, 2400);
  assert.equal(syncedThresholds.maxBrandCr3Percent, 55);
  assert.equal(syncedThresholds.minMarginRate, 0.22);
});
