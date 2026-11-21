import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = await mkdtemp(path.join(os.tmpdir(), "aitrade-ai-provider-test-"));
process.env.PGLITE_DATA_DIR = dataDir;
process.env.AI_SETTINGS_ENCRYPTION_KEY = "test-only-encryption-key";

const {
  ANTHROPIC_API_VERSION,
  anthropicMessagesEndpoint,
  extractAnthropicText,
  extractJsonPayload,
  generateCategoryRecommendations,
  generateHypotheses,
  generateStructuredJSON,
  testAIProviderConnection,
} = await import("./ai-provider.ts");
const { getDb } = await import("./db.ts");
import type { AIProviderConfig } from "./app-settings.ts";

after(async () => {
  const db = await getDb();
  await db.close();
  delete process.env.AI_SETTINGS_ENCRYPTION_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  await rm(`${dataDir}.ai-key`, { force: true }).catch(() => undefined);
});

test("anthropicMessagesEndpoint normalizes root, /v1, /v1/messages, and gateway subpaths", () => {
  assert.equal(
    anthropicMessagesEndpoint("https://api.anthropic.com"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    anthropicMessagesEndpoint("https://api.anthropic.com/"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    anthropicMessagesEndpoint("https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    anthropicMessagesEndpoint("https://api.anthropic.com/v1/messages"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    anthropicMessagesEndpoint("https://coding.dashscope.aliyuncs.com/apps/anthropic"),
    "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages",
  );
});

test("extractAnthropicText ignores non-text blocks and joins text blocks", () => {
  const text = extractAnthropicText({
    content: [
      { type: "thinking", thinking: "internal reasoning" },
      { type: "text", text: "第一段" },
      { type: "tool_use", id: "tool_1" },
      { type: "text", text: "第二段" },
    ],
  });
  assert.equal(text, "第一段\n第二段");
});

test("extractJsonPayload unwraps raw, fenced, and prose-wrapped JSON", () => {
  assert.equal(extractJsonPayload('{"ok":true}'), '{"ok":true}');
  assert.equal(
    extractJsonPayload('```json\n{"hypotheses":[1,2]}\n```'),
    '{"hypotheses":[1,2]}',
  );
  assert.equal(
    extractJsonPayload('分析完成：\n{"ok": true, "note": "brace } in string"}\n备注：{非JSON}'),
    '{"ok": true, "note": "brace } in string"}',
  );
});

test("testAIProviderConnection validates anthropic-compatible request headers and redacts keys on error", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({ content: [{ type: "text", text: "OK" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await testAIProviderConnection(
    {
      provider: "anthropic-compatible",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-5",
      apiKey: "sk-ant-test-secret-123456",
    },
    fakeFetch,
  );

  assert.equal(result.provider, "anthropic-compatible");
  assert.equal(result.model, "claude-sonnet-4-5");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0]!.headers["x-api-key"], "sk-ant-test-secret-123456");
  assert.equal(calls[0]!.headers["anthropic-version"], ANTHROPIC_API_VERSION);
  assert.equal(calls[0]!.body.max_tokens, 16);
  assert.deepEqual(calls[0]!.body.messages, [{ role: "user", content: "只回复 OK" }]);

  const failingFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: { message: "Invalid x-api-key=sk-ant-test-secret-123456 provided" },
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );

  await assert.rejects(
    () =>
      testAIProviderConnection(
        {
          provider: "anthropic-compatible",
          baseUrl: "https://api.anthropic.com",
          model: "claude-sonnet-4-5",
          apiKey: "sk-ant-test-secret-123456",
        },
        failingFetch,
      ),
    (error: Error) =>
      !error.message.includes("sk-ant-test-secret-123456") &&
      error.message.includes("[REDACTED]"),
  );
});

test("generateStructuredJSON sends Anthropic Messages payload and unwraps fenced JSON", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        content: [
          { type: "thinking", thinking: "formatting json" },
          { type: "text", text: '结果如下：\n```json\n{"status":"ok","items":[1,2]}\n```' },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const config: AIProviderConfig = {
    provider: "anthropic-compatible",
    baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    model: "claude-sonnet-4-5",
    apiKey: "sk-ant-structured-secret-123",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  const result = await generateStructuredJSON(
    {
      systemPrompt: "只输出 JSON",
      userPrompt: "提取字段",
      maxTokens: 1200,
    },
    fakeFetch,
    config,
  );

  assert.equal(result.provider, "anthropic-compatible");
  assert.equal(result.model, "claude-sonnet-4-5");
  assert.deepEqual(JSON.parse(result.content), { status: "ok", items: [1, 2] });
  assert.equal(
    calls[0]!.url,
    "https://coding.dashscope.aliyuncs.com/apps/anthropic/v1/messages",
  );
  assert.equal(calls[0]!.headers["x-api-key"], "sk-ant-structured-secret-123");
  assert.equal(calls[0]!.headers["anthropic-version"], ANTHROPIC_API_VERSION);
  assert.equal(calls[0]!.body.system, "只输出 JSON");
  assert.equal(calls[0]!.body.max_tokens, 1200);
  assert.deepEqual(calls[0]!.body.messages, [{ role: "user", content: "提取字段" }]);
});

test("generateHypotheses and generateCategoryRecommendations support anthropic-compatible responses", async () => {
  const hypothesis = (index: number) => ({
    concept: `硅胶折叠沥水篮方案 ${index}`,
    targetUser: "小户型厨房用户",
    painPoint: "台面空间小且传统沥水架易积水发霉",
    differentiator: "可折叠加厚防滑底槽结构",
    recommendedPriceCents: 2499 + index * 100,
    expectedMarginRate: 0.25,
    firstOrderBudgetCents: 120000,
    mainRisks: ["硅胶材质异味风险待测"],
    supplierKeywords: ["硅胶折叠沥水篮 工厂"],
    competitorQueries: ["collapsible dish drying rack"],
    reviewQueries: ["collapsible rack leaks"],
  });

  const recommendation = (index: number) => ({
    category: `厨房收纳方向 ${index}`,
    reason: "属于轻小件且使用场景清晰，适合首轮人工验证。",
    firstValidation: "在美国 Amazon 检索前 10 个同类商品的价格带和差评。",
    riskNote: "需要人工排查结构专利和材质安全要求。",
    searchKeywords: ["kitchen organizer", "sink caddy"],
  });

  const config: AIProviderConfig = {
    provider: "anthropic-compatible",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    apiKey: "sk-ant-sourcing-secret-123",
    apiKeySource: "database",
    hasSavedSettings: true,
  };

  const hypothesesFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: `\`\`\`json\n${JSON.stringify({ hypotheses: Array.from({ length: 5 }, (_, idx) => hypothesis(idx)) })}\n\`\`\``,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const hypResult = await generateHypotheses(
    {
      category: "厨房收纳",
      brief: "面向小户型厨房的轻小件收纳",
      context: {
        marketCode: "US",
        marketName: "美国",
        platformCode: "amazon",
        platformName: "Amazon",
        currency: "USD",
        fxRateToUsd: 1,
        fxSourceUrl: null,
      },
    },
    hypothesesFetch,
    config,
  );

  assert.equal(hypResult.provider, "anthropic-compatible");
  assert.equal(hypResult.responseSummary.mode, "model");
  assert.equal(hypResult.hypotheses.length, 5);

  const categoriesFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: `\`\`\`json\n${JSON.stringify({ recommendations: Array.from({ length: 5 }, (_, idx) => recommendation(idx)) })}\n\`\`\``,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const catResult = await generateCategoryRecommendations(
    {
      marketCode: "US",
      marketName: "美国",
      platformCode: "amazon",
      platformName: "Amazon",
    },
    categoriesFetch,
    config,
  );

  assert.equal(catResult.provider, "anthropic-compatible");
  assert.equal(catResult.responseSummary.mode, "model");
  assert.equal(catResult.recommendations.length, 5);
});
