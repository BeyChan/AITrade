import test from "node:test";
import assert from "node:assert/strict";
import {
  getChannelProfile,
  mapChannelPayload,
  preflightChannelContent,
  type ChannelContext,
} from "./channels.ts";
import type { ListingDraftContent } from "./listing.ts";

const context: ChannelContext = { marketCode: "US", locale: "en-US", currency: "USD" };
const content: ListingDraftContent = {
  brand: "PawLab",
  title: "PawLab Quiet Pet Water Fountain with Easy-Clean Filter for Cats and Small Dogs",
  bullets: [
    "Whisper-quiet pump keeps nighttime noise low while your pet stays hydrated.",
    "Tool-free tray and filter access make weekly cleaning faster and easier.",
    "Visible water window helps you check the level without opening the lid.",
    "Stable non-slip base keeps the fountain in place on tile and hardwood floors.",
    "PawLab includes a starter filter and a clearly labeled replacement reminder.",
  ],
  description: "PawLab is a quiet, easy-clean pet fountain designed for everyday hydration at home.",
  searchTerms: "quiet pet fountain cat water dispenser easy clean filter",
};

test("Amazon profile maps canonical copy into SP-API-shaped attributes", () => {
  const payload = mapChannelPayload("amazon", content, { marketCode: "GB", locale: "en-GB", currency: "GBP" });
  assert.equal(payload.marketplace_id, "GB");
  assert.equal(payload.locale, "en-GB");
  assert.equal((payload.attributes as Record<string, unknown>).item_name instanceof Array, true);
});

test("Shopify profile creates a draft product payload and does not require Amazon search terms", () => {
  const shopifyContent = { ...content, searchTerms: "" };
  const payload = mapChannelPayload("shopify", shopifyContent, context);
  const product = payload.product as Record<string, unknown>;
  assert.equal(product.status, "draft");
  assert.match(String(product.handle), /^pawlab-/);
  assert.equal(preflightChannelContent("shopify", shopifyContent, context).passed, true);
});

test("TikTok Shop profile keeps locale, currency and selling points separate", () => {
  const payload = mapChannelPayload("tiktok_shop", content, { marketCode: "MY", locale: "en-MY", currency: "MYR" });
  assert.equal(payload.currency, "MYR");
  assert.equal((payload.selling_points as unknown[]).length, 5);
});

test("platform rules differ: empty search terms fail Amazon but not manual export", () => {
  const candidate = { ...content, searchTerms: "" };
  assert.equal(preflightChannelContent("amazon", candidate, context).passed, false);
  assert.equal(preflightChannelContent("manual", candidate, context).passed, true);
});

test("eBay profile is explicitly marked as an unconnected local preview", () => {
  const profile = getChannelProfile("ebay");
  assert.equal(profile.publishingSupported, false);
  assert.match(profile.connectionLabel, /未接入/);
  const result = preflightChannelContent("ebay", content, context);
  assert.ok(result.findings.some((finding) => finding.code === "CONNECTOR_NOT_CONNECTED"));
});

test("country context is preserved for non-US markets", () => {
  const result = preflightChannelContent("shopify", content, { marketCode: "JP", locale: "ja-JP", currency: "JPY" });
  assert.equal(result.errorCount, 0);
  const payload = mapChannelPayload("shopify", content, { marketCode: "JP", locale: "ja-JP", currency: "JPY" });
  assert.deepEqual(payload._meta, { market: "JP", locale: "ja-JP", currency: "JPY" });
});
