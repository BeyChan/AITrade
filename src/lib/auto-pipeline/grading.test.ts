import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultPlatformConfig, sanitizePlatformConfigPatch } from "./config.ts";
import { computeBatchMarketContext, evaluateAndGradeCandidate } from "./grading.ts";
import { seedsFromExtensionItems } from "./providers.ts";
import type { NormalizedCandidateSeed } from "./types.ts";

function makeSeed(overrides: Partial<NormalizedCandidateSeed> = {}): NormalizedCandidateSeed {
  return {
    platformCode: "amazon",
    marketCode: "US",
    externalId: "B0TEST0001",
    title: "Silicone Kitchen Utensil Organizer Tray",
    brand: "BrandAlpha",
    category: "Kitchen",
    currency: "USD",
    priceCents: 3999,
    monthlySalesEstimate: 1200,
    reviewCount: 220,
    rating: 4.4,
    evidenceSource: "real",
    ...overrides,
  };
}

test("auto-pipeline grading never emits GO and grades high-margin low-competition candidate as S", () => {
  const config = getDefaultPlatformConfig("amazon", "US");
  const seeds: NormalizedCandidateSeed[] = Array.from({ length: 20 }, (_, i) =>
    makeSeed({
      externalId: `B0TEST${String(i).padStart(4, "0")}`,
      brand: `UniqueBrand${i}`,
      reviewCount: 150 + i * 10,
      priceCents: 5999,
      monthlySalesEstimate: 1800,
    }),
  );
  const batchContext = computeBatchMarketContext(seeds);
  const result = evaluateAndGradeCandidate({
    id: "cand-1",
    runId: "run-1",
    seed: seeds[0]!,
    config,
    batchContext,
    fxToCnyRate: 7.2,
  });

  assert.equal(result.grade, "S");
  assert.notEqual(result.verdict as string, "GO");
  assert.equal(result.verdict, "HOLD");
  assert.equal(result.pricingSource, "estimated");
  assert.ok(result.maxLandedCostCents > 0);
  assert.ok(result.maxLandedCostCny > 0);
});

test("auto-pipeline eliminates monopolized or high-compliance-risk candidates", () => {
  const config = getDefaultPlatformConfig("amazon", "US");
  // 所有 20 个竞品全是同一个品牌 → HHI = 10000 寡头垄断
  const seeds = Array.from({ length: 20 }, (_, i) =>
    makeSeed({
      externalId: `B0MONO${String(i).padStart(4, "0")}`,
      brand: "MegaBrand",
    }),
  );
  const batchContext = computeBatchMarketContext(seeds);
  const result = evaluateAndGradeCandidate({
    id: "cand-mono",
    runId: "run-1",
    seed: seeds[0]!,
    config,
    batchContext,
    fxToCnyRate: 7.2,
  });

  assert.equal(result.grade, "ELIMINATED");
  assert.equal(result.verdict, "NO-GO");
  assert.ok(result.reasons.some((r) => r.code === "MARKET_FAIL"));
});

test("auto-pipeline works identically across configurable non-Amazon platforms (e.g. Shopify / TikTok Shop)", () => {
  const shopifyCfg = getDefaultPlatformConfig("shopify", "US");
  const tiktokCfg = getDefaultPlatformConfig("tiktok_shop", "US");
  assert.equal(shopifyCfg.platformCode, "shopify");
  assert.ok(shopifyCfg.deliveryMethods.includes("shopify_csv"));
  assert.equal(tiktokCfg.platformCode, "tiktok_shop");

  const updated = sanitizePlatformConfigPatch(shopifyCfg, {
    economicsDefaults: { referralRate: 0.04, targetMarginRate: 0.22 },
    thresholds: { sGradeMinMargin: 0.28 },
  });
  assert.equal(updated.economicsDefaults.referralRate, 0.04);
  assert.equal(updated.economicsDefaults.targetMarginRate, 0.22);
  assert.equal(updated.thresholds.sGradeMinMargin, 0.28);
});

test("extension seed normalizer deduplicates external IDs and strips invalid rows", () => {
  const seeds = seedsFromExtensionItems({
    platformCode: "amazon",
    marketCode: "US",
    defaultCurrency: "USD",
    items: [
      { asin: "b0abc12345", title: "Item 1", priceCents: 2999, reviewCount: 120, rating: 4.5 },
      { asin: "B0ABC12345", title: "Duplicate", priceCents: 1999 },
      { asin: "", title: "Empty ID" },
    ],
  });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0]!.externalId, "B0ABC12345");
  assert.equal(seeds[0]!.priceCents, 2999);
});
