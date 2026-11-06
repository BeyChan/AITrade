import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompetitorBenchmark,
  buildCompetitorProfile,
  buildTemplateBenchmarkBullets,
  evaluateBenchmarkAdvisories,
  evaluateConfirmedPriceAdvisory,
  validateBenchmarkBulletProposal,
  type CompetitorBenchmarkScope,
  type CompetitorSnapshotInput,
  type HypothesisAnchorInput,
  type ReviewInsightInput,
} from "./competitor-insights.ts";
import { preflightListing } from "./listing.ts";

const US_SCOPE: CompetitorBenchmarkScope = {
  runId: "run-us-1",
  hypothesisId: "hyp-1",
  marketCode: "US",
  platformCode: "amazon",
  currency: "USD",
};

const BASE_HYPOTHESIS: HypothesisAnchorInput = {
  concept: "静音可拆洗宠物饮水器",
  targetUser: "养猫家庭",
  painPoint: "夜间水泵噪音大、死角难拆洗易发霉",
  differentiator: "磁吸无线快拆水泵，静音低分贝",
  recommendedPriceCents: 3299,
  confirmedPriceCents: 3199,
  expectedMarginRate: 0.22,
  bestQuoteLandedCostCents: 650,
  bestQuoteId: "quote-1",
};

test("deduplicates same ASIN and detects low coverage on 20 homogeneous snapshots", () => {
  const homogeneousSnapshots: CompetitorSnapshotInput[] = Array.from({ length: 20 }, (_, index) => ({
    id: `snap-${index}`,
    hypothesisId: "hyp-1",
    asin: index < 3 ? "B00SAME001" : `B00UNIQ${String(index).padStart(3, "0")}`,
    title: `BrandX Pet Fountain ${index}`,
    sourceUrl: `https://www.amazon.com/dp/${index < 3 ? "B00SAME001" : `B00UNIQ${String(index).padStart(3, "0")}`}`,
    priceCents: 2999,
    rating: 4.3,
    reviewCount: 300,
    bsr: 1200,
    observedAt: "2026-11-04T10:00:00Z",
  }));

  const homogeneousProfile = buildCompetitorProfile(homogeneousSnapshots, [], US_SCOPE, {
    now: "2026-11-06T10:00:00Z",
  });

  // 3 identical ASINs collapse into 1 -> 18 deduped out of 20
  assert.equal(homogeneousProfile.coverage.competitorCount, 20);
  assert.equal(homogeneousProfile.coverage.dedupedCount, 18);
  assert.equal(homogeneousProfile.coverage.priceBandCount, 1);
  assert.equal(homogeneousProfile.coverage.themeCount, 0);
  assert.equal(homogeneousProfile.coverage.sufficient, false);

  const diversePrices = [1899, 2199, 2499, 2699, 2999, 3199, 3499, 3999, 4499, 4999];
  const diverseSnapshots: CompetitorSnapshotInput[] = diversePrices.map((priceCents, index) => ({
    id: `div-${index}`,
    hypothesisId: "hyp-1",
    asin: `B00DIV000${index}`,
    title: `PetSafe Fountain ${index}`,
    sourceUrl: `https://www.amazon.com/dp/B00DIV000${index}`,
    priceCents,
    rating: 4.1 + (index % 4) * 0.1,
    reviewCount: 150 + index * 50,
    bsr: 800 + index * 100,
    observedAt: "2026-11-04T10:00:00Z",
  }));

  const insights: ReviewInsightInput[] = [
    {
      id: "rev-1",
      hypothesisId: "hyp-1",
      evidenceId: "ev-rev-1",
      competitorSnapshotId: null,
      theme: "水泵噪音大",
      sentiment: "negative",
      sampleSize: 18,
      representativeQuote: "Pump gets very loud after two weeks.",
    },
    {
      id: "rev-2",
      hypothesisId: "hyp-1",
      evidenceId: "ev-rev-2",
      competitorSnapshotId: null,
      theme: "难拆洗发霉",
      sentiment: "negative",
      sampleSize: 12,
      representativeQuote: "Hard to clean the inner pump crevices, slimy mold builds up.",
    },
  ];

  const diverseProfile = buildCompetitorProfile(diverseSnapshots, insights, US_SCOPE, {
    now: "2026-11-06T10:00:00Z",
  });

  assert.equal(diverseProfile.coverage.sufficient, true);
  assert.ok(diverseProfile.coverage.priceBandCount >= 3);
  assert.equal(diverseProfile.coverage.themeCount, 2);
  assert.equal(diverseProfile.coverage.reviewSampleCount, 30);
});

test("isolates marketCode / currency and preserves 180-day-old samples with freshness metric", () => {
  const mixedSnapshots: CompetitorSnapshotInput[] = [
    {
      id: "us-1",
      hypothesisId: "hyp-1",
      asin: "B00US00001",
      title: "US Competitor 1",
      sourceUrl: "https://www.amazon.com/dp/B00US00001",
      priceCents: 2500,
      rating: 4.2,
      reviewCount: 100,
      bsr: 1500,
      observedAt: "2026-05-10T10:00:00Z", // ~180 days before 2026-11-06
      marketCode: "US",
      currency: "USD",
    },
    {
      id: "jp-1",
      hypothesisId: "hyp-1",
      asin: "B00JP00001",
      title: "JP Competitor 1",
      sourceUrl: "https://www.amazon.co.jp/dp/B00JP00001",
      priceCents: 380000,
      rating: 4.0,
      reviewCount: 80,
      bsr: 900,
      observedAt: "2026-11-05T10:00:00Z",
      marketCode: "JP",
      currency: "JPY",
    },
  ];

  const profile = buildCompetitorProfile(mixedSnapshots, [], US_SCOPE, {
    now: "2026-11-06T10:00:00Z",
  });

  assert.equal(profile.coverage.competitorCount, 1);
  assert.equal(profile.price?.p50, 2500);
  assert.equal(profile.coverage.freshnessDaysP50, 180);
});

test("flags P90+ price premium and produces non-blocking price confirmation advisory", () => {
  const prices = [1999, 2299, 2599, 2899, 3199, 3499, 3699, 3899, 4099, 4299];
  const snapshots: CompetitorSnapshotInput[] = prices.map((priceCents, idx) => ({
    id: `s-${idx}`,
    hypothesisId: "hyp-1",
    asin: `B00PRC000${idx}`,
    title: `Catit Fountain ${idx}`,
    sourceUrl: `https://www.amazon.com/dp/B00PRC000${idx}`,
    priceCents,
    rating: 4.2,
    reviewCount: 200,
    bsr: 1000,
    observedAt: "2026-11-05T00:00:00Z",
  }));

  const benchmark = buildCompetitorBenchmark({
    snapshots,
    insights: [],
    scope: US_SCOPE,
    hypothesis: {
      ...BASE_HYPOTHESIS,
      confirmedPriceCents: 5500, // above P90
    },
    now: "2026-11-06T00:00:00Z",
  });

  assert.equal(benchmark.price?.hypothesisPricePosition, "above_p90");
  const priceContradiction = benchmark.contradictions.find((item) => item.field === "price");
  assert.equal(priceContradiction?.verdict, "contradicted");

  const advisory = evaluateConfirmedPriceAdvisory(5500, benchmark.price, "USD");
  assert.ok(advisory && advisory.includes("高于竞品价格带 P90"));
});

test("evaluates benchmark advisories without altering preflightListing passed or score", () => {
  const snapshots: CompetitorSnapshotInput[] = [
    {
      id: "s-1",
      hypothesisId: "hyp-1",
      asin: "B00COMP001",
      title: "PetSafe Stainless Fountain",
      sourceUrl: "https://www.amazon.com/dp/B00COMP001",
      priceCents: 2999,
      rating: 4.2,
      reviewCount: 520,
      bsr: 600,
      observedAt: "2026-11-05T00:00:00Z",
    },
  ];
  const insights: ReviewInsightInput[] = [
    {
      id: "r-1",
      hypothesisId: "hyp-1",
      evidenceId: "ev-1",
      competitorSnapshotId: "s-1",
      theme: "水泵噪音大",
      sentiment: "negative",
      sampleSize: 25,
      representativeQuote: "Motor is super loud at night.",
    },
    {
      id: "r-2",
      hypothesisId: "hyp-1",
      evidenceId: "ev-2",
      competitorSnapshotId: "s-1",
      theme: "难拆洗发霉",
      sentiment: "negative",
      sampleSize: 19,
      representativeQuote: "Impossible to clean inside the pump.",
    },
  ];

  const benchmark = buildCompetitorBenchmark({
    snapshots,
    insights,
    scope: US_SCOPE,
    hypothesis: BASE_HYPOTHESIS,
    now: "2026-11-06T00:00:00Z",
  });

  const draft = {
    brand: "AquaPaw",
    title: "AquaPaw Automatic Cat Water Dispenser with Stainless Steel Bowl for Indoor Cats and Dogs",
    bullets: [
      "Large 2.5L capacity keeps pets hydrated for up to 7 days without frequent refilling.",
      "Food-grade 304 stainless steel drinking tray is durable and dishwasher safe for daily use.",
      "Triple filtration system with activated carbon removes hair and debris from tap water.",
      "Low voltage 5V USB power adapter ensures safe operation around curious kittens and puppies.",
      "Transparent water level window with soft LED indicator lets you check remaining water at a glance.",
    ],
    description: "AquaPaw cat water dispenser provides fresh running water for your pets every day. Better than PetSafe models and FDA approved.",
    searchTerms: "cat water fountain dog bowl B00COMP001",
  };

  const preflight = preflightListing(draft);
  const advisories = evaluateBenchmarkAdvisories(draft, benchmark, {
    coreDifferentiator: BASE_HYPOTHESIS.differentiator,
    claimsToAvoid: "不得写 FDA approved；不得写 100% 静音",
  });

  // Advisories catch uncovered gap ("静音/噪音"), competitor brand/ASIN ("PetSafe", "B00COMP001"), and forbidden claim ("FDA approved")
  assert.ok(advisories.some((a) => a.code === "BENCHMARK_GAP_UNCOVERED"));
  assert.ok(advisories.some((a) => a.code === "BENCHMARK_COMPARATIVE_CLAIM"));
  assert.ok(advisories.some((a) => a.code === "BENCHMARK_CLAIM_CONFLICT"));

  // Preflight score and passed status remain strictly identical to baseline preflightListing
  const baselinePreflight = preflightListing(draft);
  assert.equal(preflight.passed, baselinePreflight.passed);
  assert.equal(preflight.score, baselinePreflight.score);
});

test("rejects AI bullet proposals missing sourceQuote and builds valid template fallback", () => {
  const benchmark = buildCompetitorBenchmark({
    snapshots: [],
    insights: [
      {
        id: "r-1",
        hypothesisId: "hyp-1",
        evidenceId: "ev-1",
        competitorSnapshotId: null,
        theme: "水泵噪音大",
        sentiment: "negative",
        sampleSize: 20,
        representativeQuote: "The pump hums loudly at night.",
      },
    ],
    scope: US_SCOPE,
    hypothesis: BASE_HYPOTHESIS,
  });

  assert.throws(
    () =>
      validateBenchmarkBulletProposal(
        {
          bullets: [
            {
              theme: "水泵噪音大",
              bullet: "采用静音水泵结构，适合夜间室内摆放使用。",
              sourceQuote: "",
              evidenceRefs: ["ev-1"],
            },
          ],
        },
        benchmark,
      ),
    /缺少原文引用（sourceQuote）/,
  );

  const fallback = buildTemplateBenchmarkBullets(benchmark);
  assert.ok(fallback);
  assert.equal(fallback.requiresReview, true);
  assert.equal(fallback.bullets.length, 5);
  assert.ok(fallback.bullets.every((item) => item.sourceQuote.length > 0 && item.evidenceRefs.length > 0));
});
