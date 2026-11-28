import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPlatformFeedExport,
  buildSemiAutoListingPayload,
  preflightListingImages,
} from "./listing-delivery.ts";

test("buildPlatformFeedExport generates Amazon TSV and Shopify Draft CSV from same normalized input", () => {
  const base = {
    sku: "SKU-B0TEST99",
    externalProductId: "B0TEST99",
    brand: "PeakHome",
    title: "PeakHome Silicone Sink Mat",
    price: "29.99",
    currency: "USD",
    category: "Kitchen",
    bullets: ["Heat resistant up to 450F", "Non-slip drainage grid", "Dishwasher safe", "BPA free silicone", "Fits standard sinks"],
    description: "Durable silicone sink protector mat for everyday kitchens.",
    searchTerms: "sink mat silicone kitchen protector",
    imageFilenames: ["01_main.jpg", "02_scene.jpg"],
  };

  const amazon = buildPlatformFeedExport({ ...base, platformCode: "amazon" });
  assert.equal(amazon.format, "tsv");
  assert.match(amazon.fileName, /^amazon_flatfile_/);
  assert.match(amazon.content, /main_image_local_file/);
  assert.match(amazon.content, /01_main\.jpg/);

  const shopify = buildPlatformFeedExport({ ...base, platformCode: "shopify" });
  assert.equal(shopify.format, "csv");
  assert.match(shopify.fileName, /^shopify_draft_/);
  assert.match(shopify.content, /Status/);
  assert.match(shopify.content, /,draft,/);
  assert.match(shopify.content, /,FALSE,/);

  const tiktok = buildPlatformFeedExport({ ...base, platformCode: "tiktok_shop" });
  assert.equal(tiktok.format, "tsv");
  assert.match(tiktok.fileName, /^tiktok_shop_listing_/);
});

test("preflightListingImages blocks missing approved main image and warns on low resolution", () => {
  const missing = preflightListingImages([]);
  assert.equal(missing.passed, false);
  assert.ok(missing.findings.some((f) => f.code === "MAIN_IMAGE_NOT_APPROVED"));

  const lowRes = preflightListingImages([
    { id: "1", assetType: "main_image", status: "approved", fileName: "main.jpg", width: 800, height: 800, sizeBytes: 120000 },
  ]);
  assert.equal(lowRes.passed, true);
  assert.ok(lowRes.findings.some((f) => f.code === "MAIN_IMAGE_LOW_RES"));
});

test("buildSemiAutoListingPayload produces platform-specific mapped payload and preflight", () => {
  const payload = buildSemiAutoListingPayload({
    caseId: "case-1",
    platformCode: "amazon",
    marketCode: "US",
    currency: "USD",
    sku: "SKU-B0TEST99",
    externalProductId: "B0TEST99",
    price: "29.99",
    category: "Kitchen",
    listing: {
      brand: "PeakHome",
      title: "PeakHome Silicone Kitchen Sink Protector Mat with Drainage Grid, Heat Resistant",
      bullets: [
        "HEAT RESISTANT SILICONE: Protects stainless steel and porcelain sinks up to 450F safely.",
        "SMART DRAINAGE GRID: Raised feet elevate dishes for faster drying and cleaner airflow.",
        "CUSTOMIZABLE DRAIN HOLE: Center drain alignment fits most standard US kitchen sinks.",
        "EASY TO CLEAN: Flexible food-grade silicone rinses clean or goes directly in dishwasher.",
        "COMPLETE PACKAGE: Includes 1 silicone sink mat by PeakHome with 1-year support.",
      ],
      description: "PeakHome silicone sink mat keeps your kitchen sink scratch-free and clean every day.",
      searchTerms: "kitchen sink mat silicone protector grid",
    },
    images: [
      { id: "img-1", assetType: "main_image", status: "approved", fileName: "main.jpg", width: 1500, height: 1500 },
    ],
  });

  assert.equal(payload.platformCode, "amazon");
  assert.equal(payload.preflight.passed, true);
  assert.equal(payload.imagePreflight.passed, true);
  assert.equal(payload.fields.sku, "SKU-B0TEST99");
});
