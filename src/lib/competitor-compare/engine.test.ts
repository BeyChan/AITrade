import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// 与其它 lib 测试一致：每个文件独占 PGlite 数据目录，避免全量跑时目录被并发占用
const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-competitor-engine-test-"));
process.env.PGLITE_DATA_DIR = dataDir;

const { extractAsinFromUrl, parseCompetitorInputs } = await import("./parser.ts");
const { analyzeCompetitors } = await import("./engine.ts");
const { getDb } = await import("../db.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
});

test("extractAsinFromUrl correctly extracts Amazon ASINs", () => {
  assert.equal(extractAsinFromUrl("B08CZ8K652"), "B08CZ8K652");
  assert.equal(
    extractAsinFromUrl("https://www.amazon.com/dp/B08CZ8K652"),
    "B08CZ8K652",
  );
  assert.equal(
    extractAsinFromUrl("https://www.amazon.com/Fanttik-V8-Apex/dp/B09M87J11L?ref=xyz"),
    "B09M87J11L",
  );
});

test("parseCompetitorInputs parses multiple URLs and titles", () => {
  const input = `https://www.amazon.com/dp/B08CZ8K652
https://www.amazon.com/dp/B09M87J11L
B0875X3V95`;
  const items = parseCompetitorInputs(input);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.asin, "B08CZ8K652");
  assert.equal(items[1]?.asin, "B09M87J11L");
  assert.equal(items[2]?.asin, "B0875X3V95");
});

test("analyzeCompetitors produces valid report with percentiles", async () => {
  const result = await analyzeCompetitors({
    rawInputs: `https://www.amazon.com/dp/B08CZ8K652
https://www.amazon.com/dp/B09M87J11L`,
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
  });

  assert.ok(result.id);
  assert.equal(result.competitors.length >= 2, true);
  assert.ok(result.priceStats.min > 0);
  assert.ok(result.priceStats.p50 >= result.priceStats.min);
  assert.ok(result.summary.commonStrengths.length > 0);
  assert.ok(result.summary.commonWeaknesses.length > 0);
  assert.ok(result.summary.attackVector.length > 0);
  assert.ok(result.sourcingAction.recommendedKeywords1688.length > 0);
});
