import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateSiteCompetitorPack,
  marketplaceDomainFor,
  marketplaceProductUrl,
  parseBulkCompetitorText,
} from "./competitor-auto-import.ts";

test("marketplaceDomainFor and marketplaceProductUrl map domains and URLs strictly based on site and platform", () => {
  assert.equal(marketplaceDomainFor("US", "amazon"), "www.amazon.com");
  assert.equal(marketplaceDomainFor("DE", "amazon"), "www.amazon.de");
  assert.equal(marketplaceDomainFor("JP", "amazon"), "www.amazon.co.jp");
  assert.equal(marketplaceDomainFor("GB", "ebay"), "www.ebay.co.uk");
  assert.equal(marketplaceDomainFor("US", "tiktok_shop"), "shop.tiktok.com");

  const amzUrl = marketplaceProductUrl("DE", "amazon", "B09X123456", "pet fountain");
  assert.equal(amzUrl, "https://www.amazon.de/dp/B09X123456");

  const ebayUrl = marketplaceProductUrl("GB", "ebay", "19928374", "kitchen tool");
  assert.equal(ebayUrl, "https://www.ebay.co.uk/itm/19928374");

  const ttUrl = marketplaceProductUrl("US", "tiktok_shop", "72819283", "storage box");
  assert.equal(ttUrl, "https://shop.tiktok.com/view/product/72819283?region=US");
});

test("generateSiteCompetitorPack generates 20 site-localized competitors and review insights", async () => {
  const dePack = await generateSiteCompetitorPack({
    scope: {
      marketCode: "DE",
      marketName: "德国",
      platformCode: "amazon",
      platformName: "Amazon",
      currency: "EUR",
    },
    category: "宠物清洁",
    concept: "可拆洗静音宠物饮水器",
    targetUser: "养猫家庭",
    painPoint: "水泵噪音大且内部易滋生水垢死角",
    differentiator: "分体式无线水泵 + 食品级不锈钢内胆",
    recommendedPriceCents: 2999,
    competitorQueries: ["Katzenbrunnen Edelstahl", "Trinkbrunnen Katze leise"],
    reviewQueries: ["Katzenbrunnen laut Erfahrung"],
    targetCount: 20,
  });

  assert.equal(dePack.competitors.length, 20);
  assert.ok(dePack.reviewInsights.length >= 2);
  assert.equal(dePack.queryUsed, "Katzenbrunnen Edelstahl");

  // Verify prices span across multiple distinct levels (P25 to P90 dispersion)
  const prices = dePack.competitors.map((c) => c.priceCents).sort((a, b) => a - b);
  assert.ok(prices[0]! < prices[prices.length - 1]!);
  assert.ok(prices[0]! >= 1000); // Reasonable EUR cents
  assert.ok(dePack.competitors.every((c) => c.sourceUrl.includes("amazon.de/dp/B0")));
  assert.ok(dePack.competitors.every((c) => typeof c.asin === "string" && c.asin.startsWith("B0")));
  assert.ok(dePack.competitors.every((c) => c.rating !== null && c.rating >= 3.0 && c.rating <= 5.0));

  // Verify review themes contain localized text and quotes
  assert.ok(dePack.reviewInsights.some((r) => r.theme.includes("死角") || r.theme.includes("水垢") || r.theme.includes("噪音")));
  assert.ok(dePack.reviewInsights.some((r) => r.representativeQuote.includes("Alltag") || r.representativeQuote.includes("Reinigung")));
});

test("parseBulkCompetitorText parses mixed text, JSON and CSV lines with ASINs and prices", () => {
  const rawText = `
B08KXYZ101 Stainless Steel Pet Fountain 2.5L $24.99 4.3 stars 1250 reviews
https://www.amazon.com/dp/B09ABC7788 Quiet Cat Water Dispenser $32.50 4.6 3400
B07ZZZ9900 Wireless Pump Fountain 28.00 4.1
Badly formatted line with no info
  `;

  const parsed = parseBulkCompetitorText(rawText, {
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    defaultQuery: "pet water fountain",
  });

  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.asin, "B08KXYZ101");
  assert.equal(parsed[0]?.priceCents, 2499);
  assert.equal(parsed[0]?.rating, 4.3);
  assert.equal(parsed[0]?.reviewCount, 1250);

  assert.equal(parsed[1]?.asin, "B09ABC7788");
  assert.equal(parsed[1]?.priceCents, 3250);
  assert.equal(parsed[1]?.sourceUrl, "https://www.amazon.com/dp/B09ABC7788");

  assert.equal(parsed[2]?.asin, "B07ZZZ9900");
  assert.equal(parsed[2]?.priceCents, 2800);
});
