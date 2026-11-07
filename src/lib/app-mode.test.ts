import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CandidateImportRow } from "./csv.ts";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-mode-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { getAppMode, DEFAULT_APP_MODE } = await import("./app-mode.ts");
const { listCases, listSourcingCases, importCandidates } = await import("./repository.ts");
const { resetDemoData } = await import("./db.ts");

function createMockCandidate(asin: string, title: string): CandidateImportRow {
  return {
    asin,
    marketplace: "US",
    category: "测试类目",
    title,
    url: "",
    competitorPriceCents: 2999,
    currency: "USD",
    monthlySalesEstimate: 1000,
    monthlySalesMin: 800,
    monthlySalesMax: 1200,
    reviewCount: 100,
    rating: 4.5,
    bsr: 100,
    keyword: "test",
    keywordSearchVolume: 5000,
    sellerCount: 3,
    variationCount: 1,
    notes: "测试",
    source: "manual",
    sourceRecordId: "mock-1",
    observedAt: new Date().toISOString(),
    assumptions: {
      salePriceCents: 2999,
      landedCostCents: 800,
      fbaFeeCents: 500,
      referralRate: 0.15,
      adRate: 0.1,
      returnRate: 0.05,
      returnProcessingCents: 200,
      returnRecoveryRate: 0.3,
      couponCents: 0,
      storageCents: 30,
      otherCostCents: 20,
    },
    rawPayload: {},
  };
}

test("app-mode: defaults to sandbox when not in request context", async () => {
  const mode = await getAppMode();
  assert.equal(mode, "sandbox");
  assert.equal(DEFAULT_APP_MODE, "sandbox");
});

test("app-mode: listCases isolates demo data in live mode", async () => {
  await resetDemoData();
  const sandboxCases = await listCases({ mode: "sandbox" });
  assert.ok(sandboxCases.length > 0, "sandbox mode should return demo cases");
  assert.ok(sandboxCases.some((c) => c.is_demo), "sandbox cases contain demo cases");

  const liveCases = await listCases({ mode: "live" });
  assert.ok(liveCases.every((c) => !c.is_demo), "live mode must never contain is_demo=true cases");
});

test("app-mode: listSourcingCases isolates demo cases in live mode", async () => {
  const sandboxSourcing = await listSourcingCases({ mode: "sandbox" });
  const liveSourcing = await listSourcingCases({ mode: "live" });
  assert.ok(sandboxSourcing.length >= liveSourcing.length);
  assert.ok(liveSourcing.every((c) => !c.productCase.is_demo), "live sourcing cases must not be demo");
});

test("app-mode: importCandidates tags is_demo correctly per mode", async () => {
  const testAsinLive = `TEST-LIVE-${Date.now()}`;
  await importCandidates(
    [createMockCandidate(testAsinLive, "真实导入测试商品")],
    "测试员",
    { isDemo: false },
  );

  const liveCases = await listCases({ mode: "live" });
  const foundLive = liveCases.find((c) => c.asin === testAsinLive);
  assert.ok(foundLive, "live case must be visible in live mode");
  assert.equal(foundLive.is_demo, false);

  const testAsinDemo = `TEST-DEMO-${Date.now()}`;
  await importCandidates(
    [createMockCandidate(testAsinDemo, "沙盒导入测试商品")],
    "测试员",
    { isDemo: true },
  );

  const liveCasesAfter = await listCases({ mode: "live" });
  const foundDemoInLive = liveCasesAfter.find((c) => c.asin === testAsinDemo);
  assert.equal(foundDemoInLive, undefined, "demo case must not appear in live mode");

  const sandboxCases = await listCases({ mode: "sandbox" });
  const foundDemoInSandbox = sandboxCases.find((c) => c.asin === testAsinDemo);
  assert.ok(foundDemoInSandbox, "demo case must appear in sandbox mode");
});

test("app-mode: resetDemoData cleans demo modifications and reseeds original demos", async () => {
  await resetDemoData();
  const cases = await listCases({ mode: "sandbox" });
  assert.equal(cases.filter((c) => c.is_demo).length, 4, "should reseed exactly 4 demo cases");
});
