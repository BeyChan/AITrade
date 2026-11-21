import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ImageProviderConfig } from "./app-settings.ts";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-image-provider-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_SETTINGS_ENCRYPTION_KEY = "test-only-encryption-key";

const {
  anthropicImageMessagesEndpoint,
  anthropicModelsEndpoint,
  dashscopeImageEndpoint,
  geminiInteractionsEndpoint,
  generateImagesWithProvider,
  openAIImageEditsEndpoint,
  openAIImageGenerationsEndpoint,
  testImageProviderConnection,
} = await import("./image-provider.ts");
const { getDb } = await import("./db.ts");

after(async () => {
  const db = await getDb();
  await db.close();
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(`${dataDir}.ai-key`, { force: true }).catch(() => undefined);
});

const samplePngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64");

test("endpoint builders normalize base URLs consistently", () => {
  assert.equal(
    geminiInteractionsEndpoint("https://generativelanguage.googleapis.com"),
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(
    geminiInteractionsEndpoint("https://generativelanguage.googleapis.com/v1"),
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(
    geminiInteractionsEndpoint("https://generativelanguage.googleapis.com/v1beta"),
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  assert.equal(
    openAIImageGenerationsEndpoint("https://api.openai.com/v1"),
    "https://api.openai.com/v1/images/generations",
  );
  assert.equal(
    openAIImageEditsEndpoint("https://relay.example.com"),
    "https://relay.example.com/v1/images/edits",
  );
  assert.equal(
    dashscopeImageEndpoint("https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  );
  assert.equal(
    dashscopeImageEndpoint("https://dashscope-intl.aliyuncs.com"),
    "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  );
  assert.equal(
    anthropicImageMessagesEndpoint("https://api.anthropic.com"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    anthropicImageMessagesEndpoint("https://relay.example.com/anthropic/v1"),
    "https://relay.example.com/anthropic/v1/messages",
  );
  assert.equal(
    anthropicModelsEndpoint("https://relay.example.com/anthropic/v1/messages"),
    "https://relay.example.com/anthropic/v1/models",
  );
});

test("template provider returns prompt_only without external fetch", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    throw new Error("should not call fetch");
  };
  const config: ImageProviderConfig = {
    provider: "template",
    baseUrl: "",
    model: "prompt-studio-v1",
    apiKey: "",
    apiKeySource: "none",
    hasSavedSettings: false,
  };

  const result = await generateImagesWithProvider(
    { prompt: "Studio white background product", aspectRatio: "1:1", count: 1 },
    fakeFetch,
    config,
  );
  assert.equal(called, false);
  assert.equal(result.mode, "prompt_only");
  assert.equal(result.images.length, 0);
});

test("gemini provider sends Interactions API v1 payload for text-to-image and image-to-image", async () => {
  const capturedCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    capturedCalls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        steps: [
          {
            type: "model_output",
            content: [{ type: "image", data: samplePngBase64, mime_type: "image/png" }],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const config: ImageProviderConfig = {
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    model: "gemini-nano-banana-2.1",
    apiKey: "AIzaSyTestSecretKey1234567890",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  const result = await generateImagesWithProvider(
    {
      prompt: "Modern kitchen lifestyle shot",
      negativePrompt: "watermark",
      aspectRatio: "4:5",
      count: 1,
      referenceImage: {
        bytes: Buffer.from("fake-ref"),
        mimeType: "image/png",
        fileName: "ref.png",
      },
    },
    fakeFetch,
    config,
  );

  assert.equal(result.mode, "model");
  assert.equal(result.images.length, 1);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0]!.url, "https://generativelanguage.googleapis.com/v1beta/interactions");
  assert.equal(capturedCalls[0]!.headers["x-goog-api-key"], "AIzaSyTestSecretKey1234567890");
  assert.deepEqual(capturedCalls[0]!.body.response_modalities, ["image"]);
  assert.deepEqual(capturedCalls[0]!.body.response_format, { type: "image", aspect_ratio: "4:5" });
  const inputParts = capturedCalls[0]!.body.input as Array<{ type: string; data?: string; text?: string }>;
  assert.equal(Array.isArray(inputParts), true);
  assert.equal(inputParts[0]!.type, "image");
  assert.equal(inputParts[1]!.type, "text");
  assert.match(inputParts[1]!.text ?? "", /Avoid strictly: watermark/);
});

test("openai-compatible switches between /images/generations and /images/edits and redacts keys", async () => {
  const urls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    urls.push(String(input));
    return new Response(
      JSON.stringify({ data: [{ b64_json: samplePngBase64 }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const config: ImageProviderConfig = {
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    apiKey: "sk-test-secret-1234567890",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  await generateImagesWithProvider(
    { prompt: "White background", aspectRatio: "1:1", count: 1 },
    fakeFetch,
    config,
  );
  await generateImagesWithProvider(
    {
      prompt: "Put on wooden table",
      aspectRatio: "16:9",
      count: 1,
      referenceImage: { bytes: Buffer.from("ref"), mimeType: "image/png" },
    },
    fakeFetch,
    config,
  );

  assert.deepEqual(urls, [
    "https://api.openai.com/v1/images/generations",
    "https://api.openai.com/v1/images/edits",
  ]);

  const failingFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: "Invalid key sk-test-secret-1234567890 rejected" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    () =>
      generateImagesWithProvider(
        { prompt: "test", aspectRatio: "1:1", count: 1 },
        failingFetch,
        config,
      ),
    (error: Error) => !error.message.includes("sk-test-secret-1234567890") && error.message.includes("[REDACTED]"),
  );
});

test("dashscope provider and DashScope URLs route to multimodal-generation and download image", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("multimodal-generation/generation")) {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(
        JSON.stringify({
          output: {
            choices: [
              {
                message: {
                  content: [{ image: "https://cdn.example.com/generated-qwen.png" }],
                },
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(Buffer.from(samplePngBase64, "base64"), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };

  const config: ImageProviderConfig = {
    provider: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-image-plus",
    apiKey: "sk-dashscope-secret-123",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  const result = await generateImagesWithProvider(
    {
      prompt: "White background studio product shot",
      negativePrompt: "watermark",
      aspectRatio: "4:5",
      count: 1,
      referenceImage: { bytes: Buffer.from("ref"), mimeType: "image/png" },
    },
    fakeFetch,
    config,
  );

  assert.equal(result.provider, "dashscope");
  assert.equal(result.images.length, 1);
  assert.equal(
    calls[0]!.url,
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  );
  assert.equal((calls[0]!.body.parameters as Record<string, unknown>).size, "1140*1472");
  const messages = (calls[0]!.body.input as { messages: Array<{ content: Array<{ image?: string; text?: string }> }> }).messages;
  assert.match(messages[0]!.content[0]!.image ?? "", /^data:image\/png;base64,/);
});

test("testImageProviderConnection supports anthropic-compatible GET /v1/models and 404 fallback to POST /v1/messages", async () => {
  const calls: Array<{ method: string; url: string; headers: Record<string, string> }> = [];
  const modelsOkFetch: typeof fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? "GET",
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const okRes = await testImageProviderConnection(
    {
      provider: "anthropic-compatible",
      baseUrl: "https://api.anthropic.com",
      model: "image-gateway-v1",
      apiKey: "sk-ant-img-test-123",
    },
    modelsOkFetch,
  );
  assert.equal(okRes.provider, "anthropic-compatible");
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/models");
  assert.equal(calls[0]!.headers["x-api-key"], "sk-ant-img-test-123");

  const fallbackCalls: Array<{ method: string; url: string }> = [];
  const fallbackFetch: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    fallbackCalls.push({ method, url });
    if (method === "GET") {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: "OK" }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await testImageProviderConnection(
    {
      provider: "anthropic-compatible",
      baseUrl: "https://relay.example.com/anthropic",
      model: "image-gateway-v1",
      apiKey: "sk-ant-img-test-123",
    },
    fallbackFetch,
  );
  assert.deepEqual(fallbackCalls, [
    { method: "GET", url: "https://relay.example.com/anthropic/v1/models" },
    { method: "POST", url: "https://relay.example.com/anthropic/v1/messages" },
  ]);
});

test("anthropic-compatible image provider supports base64/url extraction, avoids DashScope hijack, and redacts errors", async () => {
  const capturedCalls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const base64Fetch: typeof fetch = async (input, init) => {
    capturedCalls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: samplePngBase64,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  // Even with a dashscope.aliyuncs.com URL, anthropic-compatible must route to /v1/messages.
  const config: ImageProviderConfig = {
    provider: "anthropic-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    model: "claude-image-relay",
    apiKey: "sk-ant-secret-key-123456",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  const base64Result = await generateImagesWithProvider(
    {
      prompt: "Studio product shot",
      aspectRatio: "4:5",
      count: 1,
      referenceImage: {
        bytes: Buffer.from("ref-bytes"),
        mimeType: "image/png",
        fileName: "ref.png",
      },
    },
    base64Fetch,
    config,
  );

  assert.equal(base64Result.provider, "anthropic-compatible");
  assert.equal(base64Result.images.length, 1);
  assert.equal(base64Result.images[0]!.suggestedName, "anthropic-1-1.png");
  assert.equal(
    capturedCalls[0]!.url,
    "https://dashscope.aliyuncs.com/apps/anthropic/v1/messages",
  );
  assert.equal(capturedCalls[0]!.headers["x-api-key"], "sk-ant-secret-key-123456");
  const messages = capturedCalls[0]!.body.messages as Array<{
    content: Array<{ type: string; source?: { type: string; media_type: string; data: string }; text?: string }>;
  }>;
  assert.equal(messages[0]!.content[0]!.type, "image");
  assert.equal(messages[0]!.content[0]!.source?.type, "base64");
  assert.equal(messages[0]!.content[1]!.type, "text");
  assert.match(messages[0]!.content[1]!.text ?? "", /Target aspect ratio: 4:5/);

  // Markdown image URL extraction & download
  const markdownFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/messages")) {
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: "Here is your image: ![product](https://cdn.example.com/out.png)",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(Buffer.from(samplePngBase64, "base64"), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };
  const urlResult = await generateImagesWithProvider(
    { prompt: "Studio shot", aspectRatio: "1:1", count: 1 },
    markdownFetch,
    config,
  );
  assert.equal(urlResult.images.length, 1);
  assert.equal(urlResult.images[0]!.suggestedName, "anthropic-1-1.png");

  // Text-only response fails clearly
  const textOnlyFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ content: [{ type: "text", text: "I cannot generate images." }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    () => generateImagesWithProvider({ prompt: "test", aspectRatio: "1:1", count: 1 }, textOnlyFetch, config),
    /未返回图片内容/,
  );

  // Error redaction for x-api-key and sk-ant-*
  const authErrorFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: "Bad x-api-key=sk-ant-secret-key-123456" } }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  await assert.rejects(
    () => generateImagesWithProvider({ prompt: "test", aspectRatio: "1:1", count: 1 }, authErrorFetch, config),
    (error: Error) =>
      !error.message.includes("sk-ant-secret-key-123456") &&
      error.message.includes("[REDACTED]"),
  );
});
