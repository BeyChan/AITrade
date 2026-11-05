import {
  buildTemplateCategoryRecommendations,
  buildTemplateHypotheses,
  parseCategoryRecommendationsJson,
  parseHypothesesJson,
  researchPriorityScore,
  type AISourcingContext,
  type CategoryRecommendationContext,
  type CategoryRecommendationResult,
  type HypothesisDraft,
  type HypothesisGenerationInput,
  type HypothesisGenerationResult,
} from "./ai-sourcing.ts";
import { loadAIProviderConfig, type AIProviderConfig, type AIProviderId } from "./app-settings.ts";

export type { AIProviderId } from "./app-settings.ts";

export type AIProviderStatus = {
  provider: AIProviderId;
  label: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  detail: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  apiKeySource: AIProviderConfig["apiKeySource"];
  usingSavedSettings: boolean;
};

export type AIProviderTestInput = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type AIProviderTestResult = {
  provider: AIProviderId;
  model: string;
  latencyMs: number;
  message: string;
};

export type StructuredGenerationInput = {
  systemPrompt: string;
  userPrompt: string;
  timeoutMs?: number;
  maxTokens?: number;
};

export type StructuredGenerationResult = {
  provider: AIProviderId;
  model: string;
  content: string;
  latencyMs: number;
};

const SYSTEM_PROMPT = `你是跨境电商选品研究助理。你的任务不是预测销量，也不是替用户做投资决定，而是把模糊需求拆成 5 个可验证的商品机会假设。

硬性规则：
1. 只输出 JSON，不输出 Markdown。
2. 不得编造销量、评分、评论、竞品、供应商、报价、认证、专利或利润事实。
3. 价格、预算、利润率只能作为待验证假设，不能写成市场事实。
4. 每个假设必须包含清晰的目标用户、痛点、差异化、风险、1688/供应商关键词、竞品搜索词和差评搜索词。
5. 推荐售价和首单预算使用整数分（cents）；预计净利率使用 0 到 1 的小数。
6. 必须输出 5 个互不重复、适合小团队首轮验证的方向。

输出结构：
{"hypotheses":[{"concept":"商品概念","targetUser":"目标用户","painPoint":"核心痛点","differentiator":"差异化方向","recommendedPriceCents":2499,"expectedMarginRate":0.22,"firstOrderBudgetCents":120000,"mainRisks":["风险1","风险2"],"supplierKeywords":["关键词1"],"competitorQueries":["搜索词1"],"reviewQueries":["差评搜索词1"]}]}`;

const CATEGORY_SYSTEM_PROMPT = `你是跨境电商选品研究的类目筛选助理。请根据指定国家和平台，给出 5 个适合小团队首轮人工核验的候选类目。

硬性规则：
1. 只输出 JSON，不输出 Markdown。
2. 推荐必须同时考虑指定国家、语言/消费场景和平台形态，不得只给通用类目。
3. 不得声称类目热销、需求高、竞争低、蓝海、利润高或保证盈利；这些结论只能来自后续真实证据。
4. 每条推荐只解释为什么值得验证、第一步怎么核验、主要风险是什么。
5. 类目名称用简洁中文；搜索关键词优先使用目标国家常用搜索语言。
6. 必须返回 5 个互不重复的类目。

输出结构：
{"recommendations":[{"category":"类目名称","reason":"为什么这是值得验证的方向假设，不得写成市场事实","firstValidation":"在该国家与平台执行的第一步人工核验","riskNote":"首轮最需要核对的风险","searchKeywords":["搜索词1","搜索词2"]}]}`;

export async function getAIProviderStatus(): Promise<AIProviderStatus> {
  return statusFromConfig(await loadAIProviderConfig());
}

export async function generateHypotheses(input: HypothesisGenerationInput): Promise<HypothesisGenerationResult> {
  const config = await loadAIProviderConfig();
  const status = statusFromConfig(config);
  if (!status.configured || status.provider === "template") return templateResult(input);

  try {
    if (config.provider === "ollama") return await generateWithOllama(input, config);
    return await generateWithOpenAICompatible(input, config);
  } catch (error) {
    const fallback = templateResult(input);
    return {
      ...fallback,
      responseSummary: {
        ...fallback.responseSummary,
        fallback: true,
        providerError: safeProviderError(error),
      },
    };
  }
}

export async function generateCategoryRecommendations(
  context: CategoryRecommendationContext,
): Promise<CategoryRecommendationResult> {
  const config = await loadAIProviderConfig();
  const status = statusFromConfig(config);
  if (!status.configured || status.provider === "template") return templateCategoryResult(context);

  try {
    if (config.provider === "ollama") return await generateCategoryWithOllama(context, config);
    return await generateCategoryWithOpenAICompatible(context, config);
  } catch (error) {
    const fallback = templateCategoryResult(context);
    return {
      ...fallback,
      responseSummary: {
        ...fallback.responseSummary,
        fallback: true,
        providerError: safeProviderError(error),
      },
    };
  }
}

export async function testAIProviderConnection(input: AIProviderTestInput): Promise<AIProviderTestResult> {
  const current = await loadAIProviderConfig();
  const provider = normalizeProvider(input.provider);
  const baseUrl = (input.baseUrl.trim() || (provider === current.provider ? current.baseUrl : defaultBaseUrl(provider))).replace(/\/+$/, "");
  const model = input.model.trim() || (provider === current.provider ? current.model : defaultModel(provider));
  const apiKey = input.apiKey.trim() || current.apiKey;

  if (provider === "template") {
    return {
      provider,
      model: "deterministic-v1",
      latencyMs: 0,
      message: "模板模式可用，无需外部模型连接。",
    };
  }

  validateBaseUrl(baseUrl);
  if (!model) throw new Error("请填写模型名称");
  if (provider === "openai-compatible" && !apiKey) {
    throw new Error("缺少 API Key；请填写新 Key 或先保存配置");
  }

  const startedAt = Date.now();
  if (provider === "ollama") {
    const response = await fetch(ollamaChatEndpoint(baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: "user", content: "只回复 OK" }],
        options: { num_predict: 4, temperature: 0 },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Ollama 连接失败：HTTP ${response.status}`);
  } else {
    const response = await fetch(openAIChatEndpoint(baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8,
        messages: [{ role: "user", content: "只回复 OK" }],
        stream: false,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`模型接口连接失败：HTTP ${response.status}`);
  }

  return {
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    message: "连接测试通过。",
  };
}

/**
 * Shared server-side JSON generation entry point. Callers must still parse and
 * validate model output against a deterministic schema before persisting it.
 */
export async function generateStructuredJSON(
  input: StructuredGenerationInput,
): Promise<StructuredGenerationResult> {
  const config = await loadAIProviderConfig();
  const status = statusFromConfig(config);
  if (!status.configured || config.provider === "template") {
    throw new Error("当前为免 Key 模板模式，未调用外部模型");
  }

  const startedAt = Date.now();
  validateBaseUrl(config.baseUrl);
  if (config.provider === "ollama") {
    const response = await fetch(ollamaChatEndpoint(config.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
    });
    if (!response.ok) throw new Error(`Ollama 请求失败：HTTP ${response.status}`);
    const payload = await response.json() as { message?: { content?: string } };
    if (!payload.message?.content) throw new Error("Ollama 未返回结构化内容");
    return {
      provider: "ollama",
      model: config.model,
      content: payload.message.content,
      latencyMs: Date.now() - startedAt,
    };
  }

  const response = await fetch(openAIChatEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: input.maxTokens ?? 2_500,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });
  if (!response.ok) throw new Error(`AI 接口请求失败：HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 接口未返回结构化内容");
  return {
    provider: "openai-compatible",
    model: config.model,
    content,
    latencyMs: Date.now() - startedAt,
  };
}

export function attachResearchPriority(
  hypotheses: HypothesisDraft[],
  category: string,
  context?: Pick<AISourcingContext, "currency" | "fxRateToUsd">,
) {
  return hypotheses.map((hypothesis) => ({
    hypothesis,
    priorityScore: researchPriorityScore(hypothesis, category, context),
  }));
}

function statusFromConfig(config: AIProviderConfig): AIProviderStatus {
  const apiKeyConfigured = Boolean(config.apiKey);
  if (config.provider === "ollama") {
    return {
      provider: config.provider,
      label: "本地 Ollama",
      model: config.model || "未配置模型",
      baseUrl: config.baseUrl,
      configured: Boolean(config.baseUrl && config.model),
      detail: config.baseUrl && config.model
        ? "生成内容只在本机或你指定的 Ollama 服务处理；证据和投资结论仍由本地代码计算。"
        : "已选择 Ollama，但 Base URL 或模型名称不完整，生成时会自动回退模板模式。",
      apiKeyConfigured: false,
      apiKeyHint: "",
      apiKeySource: config.apiKeySource,
      usingSavedSettings: config.hasSavedSettings,
    };
  }
  if (config.provider === "openai-compatible") {
    const configured = Boolean(config.baseUrl && config.model && apiKeyConfigured);
    let detail = "API Key 只在服务端读取，不返回到浏览器、不写入日志；页面只显示脱敏尾号。";
    if (config.apiKeySource === "unreadable") {
      detail = "已保存的 API Key 无法解密，请重新填写并保存；生成时会自动回退模板模式。";
    } else if (!apiKeyConfigured) {
      detail = "还没有可用的 API Key，保存后即可启用；生成时会自动回退模板模式。";
    } else if (!config.model) {
      detail = "还缺少模型名称；生成时会自动回退模板模式。";
    }
    return {
      provider: config.provider,
      label: "OpenAI 兼容接口",
      model: config.model || "未配置模型",
      baseUrl: config.baseUrl,
      configured,
      detail,
      apiKeyConfigured,
      apiKeyHint: maskApiKey(config.apiKey),
      apiKeySource: config.apiKeySource,
      usingSavedSettings: config.hasSavedSettings,
    };
  }
  return {
    provider: "template",
    label: "免 Key 模板模式",
    model: "deterministic-v1",
    baseUrl: "",
    configured: true,
    detail: "无需任何 Key。输出是可执行的验证假设，不代表市场事实；所有证据数从 0 开始。",
    apiKeyConfigured: false,
    apiKeyHint: "",
    apiKeySource: config.apiKeySource,
    usingSavedSettings: config.hasSavedSettings,
  };
}

function templateResult(input: HypothesisGenerationInput): HypothesisGenerationResult {
  return {
    provider: "template",
    model: "deterministic-v1",
    hypotheses: buildTemplateHypotheses(input),
    responseSummary: {
      mode: "template",
      evidenceCreated: 0,
      note: "模板仅生成假设，不包含任何真实市场证据。",
    },
  };
}

function templateCategoryResult(context: CategoryRecommendationContext): CategoryRecommendationResult {
  return {
    provider: "template",
    model: "deterministic-v1",
    recommendations: buildTemplateCategoryRecommendations(context),
    responseSummary: {
      mode: "template",
      evidenceCreated: 0,
      note: "模板按国家与平台生成候选方向，不代表需求、销量、竞争度或利润事实。",
    },
  };
}

async function generateCategoryWithOllama(
  context: CategoryRecommendationContext,
  config: AIProviderConfig,
): Promise<CategoryRecommendationResult> {
  validateBaseUrl(config.baseUrl);
  const response = await fetch(ollamaChatEndpoint(config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: CATEGORY_SYSTEM_PROMPT },
        { role: "user", content: buildCategoryUserPrompt(context) },
      ],
      options: { temperature: 0.35 },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Ollama 请求失败：HTTP ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error("Ollama 未返回类目推荐内容");
  return categoryProviderResult("ollama", config.model, content, context);
}

async function generateCategoryWithOpenAICompatible(
  context: CategoryRecommendationContext,
  config: AIProviderConfig,
): Promise<CategoryRecommendationResult> {
  validateBaseUrl(config.baseUrl);
  const response = await fetch(openAIChatEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CATEGORY_SYSTEM_PROMPT },
        { role: "user", content: buildCategoryUserPrompt(context) },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`AI 接口请求失败：HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 接口未返回类目推荐内容");
  return categoryProviderResult("openai-compatible", config.model, content, context);
}

function categoryProviderResult(
  provider: AIProviderId,
  model: string,
  content: string,
  context: CategoryRecommendationContext,
): CategoryRecommendationResult {
  return {
    provider,
    model,
    recommendations: parseCategoryRecommendationsJson(content, context),
    responseSummary: {
      mode: "model",
      evidenceCreated: 0,
      marketCode: context.marketCode,
      platformCode: context.platformCode,
      note: "推荐只是首轮验证方向；使用前仍需检索真实商品、评价、供应商与合规信息。",
    },
  };
}

function buildCategoryUserPrompt(context: CategoryRecommendationContext) {
  return `请为以下站点推荐 5 个首轮人工核验类目：
国家/市场：${context.marketName}（${context.marketCode}）
平台：${context.platformName}（${context.platformCode}）

类目要适合一人或两人的小团队验证，优先考虑轻小件、场景明确、能通过真实商品页面和差评核验的方向。不要把推荐写成销量或竞争度结论。输出仅限指定 JSON 结构。`;
}

async function generateWithOllama(input: HypothesisGenerationInput, config: AIProviderConfig): Promise<HypothesisGenerationResult> {
  validateBaseUrl(config.baseUrl);
  const response = await fetch(ollamaChatEndpoint(config.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      options: { temperature: 0.35 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Ollama 请求失败：HTTP ${response.status}`);
  const payload = await response.json() as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error("Ollama 未返回结构化内容");
  return providerResult("ollama", config.model, content, input);
}

async function generateWithOpenAICompatible(
  input: HypothesisGenerationInput,
  config: AIProviderConfig,
): Promise<HypothesisGenerationResult> {
  validateBaseUrl(config.baseUrl);
  const response = await fetch(openAIChatEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`AI 接口请求失败：HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 接口未返回结构化内容");
  return providerResult("openai-compatible", config.model, content, input);
}

function providerResult(
  provider: AIProviderId,
  model: string,
  content: string,
  input: HypothesisGenerationInput,
): HypothesisGenerationResult {
  const hypotheses = parseHypothesesJson(content, input);
  return {
    provider,
    model,
    hypotheses,
    responseSummary: {
      mode: "model",
      evidenceCreated: 0,
      note: "模型只生成假设；所有市场事实必须通过证据表单录入。",
    },
  };
}

function buildUserPrompt(input: HypothesisGenerationInput) {
  const fx = input.context.currency === "USD"
    ? "目标币种为 USD，无需汇率。"
    : `目标币种为 ${input.context.currency}；当前汇率假设为 ${input.context.fxRateToUsd ?? "未提供"}，汇率来源为 ${input.context.fxSourceUrl ?? "未提供"}。不得自行发明汇率。`;
  return `请为以下站点生成 5 个首轮选品验证假设：
国家/市场：${input.context.marketName}（${input.context.marketCode}）
平台：${input.context.platformName}（${input.context.platformCode}）
类目：${input.category}
用户简报：${input.brief}
${fx}

搜索词必须适合该国家和平台。输出仅限指定 JSON 结构。`;
}

function normalizeProvider(value: string | undefined): AIProviderId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "ollama" || normalized === "openai-compatible") return normalized;
  return "template";
}

function defaultBaseUrl(provider: AIProviderId) {
  if (provider === "ollama") return "http://127.0.0.1:11434";
  if (provider === "openai-compatible") return "https://api.openai.com/v1";
  return "";
}

function defaultModel(provider: AIProviderId) {
  if (provider === "ollama") return "qwen3";
  return provider === "template" ? "deterministic-v1" : "";
}

function validateBaseUrl(value: string) {
  if (!value) throw new Error("请填写 Base URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Base URL 格式不正确");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL 只支持 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("Base URL 不能包含用户名或密码");
  }
}

function ollamaChatEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/api/chat")) return base;
  if (base.endsWith("/api")) return `${base}/chat`;
  return `${base}/api/chat`;
}

function openAIChatEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  if (base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function maskApiKey(value: string) {
  if (!value) return "";
  const tail = value.length >= 8 ? value.slice(-4) : value.slice(-2);
  return `••••${tail}`;
}

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 300);
}
