import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVideoBaseUrl,
  defaultVideoModel,
  normalizeVideoProvider,
} from "./app-settings.ts";
import { detectVideoType } from "./storage.ts";
import {
  buildKlingBearerToken,
  composeVideoPrompt,
  estimateVideoCostUsd,
} from "./video-provider.ts";

test("video provider normalization and defaults cover all common APIs", () => {
  assert.equal(normalizeVideoProvider("kling"), "kling");
  assert.equal(normalizeVideoProvider("kuaishou"), "kling");
  assert.equal(normalizeVideoProvider("dashscope"), "dashscope");
  assert.equal(normalizeVideoProvider("bailian"), "dashscope");
  assert.equal(normalizeVideoProvider("veo3"), "veo");
  assert.equal(normalizeVideoProvider("runwayml"), "runway");
  assert.equal(normalizeVideoProvider("seedance"), "volcengine");
  assert.equal(normalizeVideoProvider("sora"), "openai-compatible");
  assert.equal(normalizeVideoProvider("unknown"), "template");

  assert.equal(defaultVideoBaseUrl("kling"), "https://api.klingai.com");
  assert.equal(defaultVideoModel("kling"), "kling-v2-master");
  assert.equal(defaultVideoModel("dashscope"), "wan3.0-video");
  assert.equal(defaultVideoModel("veo"), "veo-3.0-generate-preview");
  assert.equal(defaultVideoModel("runway"), "gen4_turbo");
  assert.equal(defaultVideoModel("volcengine"), "doubao-seedance-1-0-pro-250528");
});

test("composeVideoPrompt injects competitor pain points and builds 3-shot storyboard", () => {
  const result = composeVideoPrompt(
    {
      productName: "Stainless Steel Pet Water Fountain",
      targetCustomer: "Cat owners",
      coreDifferentiator: "Ultra-quiet 22dB brushless pump",
      specifications: "304 Stainless Steel, 2.5L",
      claimsToAvoid: "medical cure",
      marketplace: "US",
      topPainPoints: ["noisy pump", "hard to clean"],
      templateId: "pain_point_demo_5s",
      aspectRatio: "16:9",
      durationSec: 5,
    },
    "kling",
  );

  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.durationSec, 5);
  assert.equal(result.estimatedCostUsd, estimateVideoCostUsd("kling", 5));
  assert.ok(result.prompt.includes("Stainless Steel Pet Water Fountain"));
  assert.ok(result.prompt.includes("noisy pump"));
  assert.ok(result.negativePrompt.includes("medical cure"));
  assert.equal(result.storyboard.length, 3);
  assert.equal(result.storyboard[0]?.shot, 1);
  assert.equal(result.storyboard[2]?.shot, 3);
});

test("buildKlingBearerToken signs AK:SK into HS256 JWT and preserves raw Bearer keys", () => {
  assert.equal(buildKlingBearerToken("sk-proxy-123456"), "sk-proxy-123456");
  const jwt = buildKlingBearerToken("ak_demo_123:sk_secret_456");
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")) as { alg: string; typ: string };
  const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as { iss: string; exp: number };
  assert.equal(header.alg, "HS256");
  assert.equal(header.typ, "JWT");
  assert.equal(payload.iss, "ak_demo_123");
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test("detectVideoType recognizes MP4, MOV, and WebM signatures", () => {
  const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const mov = Buffer.from([0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00, 0x00, 0x00]);

  assert.deepEqual(detectVideoType(mp4), { extension: "mp4", mimeType: "video/mp4" });
  assert.deepEqual(detectVideoType(mov), { extension: "mov", mimeType: "video/quicktime" });
  assert.deepEqual(detectVideoType(webm), { extension: "webm", mimeType: "video/webm" });
});
