import {
  defaultImageBaseUrl,
  defaultImageModel,
  loadImageProviderConfig,
  normalizeImageProvider,
  validateBaseUrl,
  type ImageProviderConfig,
} from "../app-settings.ts";
import type { ModeOptions } from "../app-mode.ts";
import { httpFailure, safeProviderError } from "../providers/http.ts";
import {
  generateWithAnthropicCompatible,
  generateWithDashScope,
  generateWithFal,
  generateWithGemini,
  generateWithIdeogram,
  generateWithOpenAICompatible,
} from "./adapters.ts";
import {
  anthropicImageMessagesEndpoint,
  anthropicModelsEndpoint,
  buildFullPromptText,
  dashscopeModelsEndpoint,
  geminiModelsEndpoint,
  imageProviderLabel,
  imageStatusFromConfig,
  isDashScopeEndpoint,
  openAIModelsEndpoint,
  type GenerateProductImagesInput,
  type GenerateProductImagesResult,
  type ImageProviderStatus,
  type ImageProviderTestInput,
  type ImageProviderTestResult,
} from "./types.ts";

export async function getImageProviderStatus(options?: ModeOptions): Promise<ImageProviderStatus> {
  return imageStatusFromConfig(await loadImageProviderConfig(options));
}

export async function testImageProviderConnection(
  input: ImageProviderTestInput,
  fetchImpl: typeof fetch = fetch,
  options?: ModeOptions,
): Promise<ImageProviderTestResult> {
  const current = await loadImageProviderConfig(options);
  const provider = normalizeImageProvider(input.provider);
  const baseUrl = (
    input.baseUrl.trim() ||
    (provider === current.provider ? current.baseUrl : defaultImageBaseUrl(provider))
  ).replace(/\/+$/, "");
  const model = (
    input.model.trim() ||
    (provider === current.provider ? current.model : defaultImageModel(provider))
  );
  const apiKey =
    input.apiKey.trim() ||
    current.apiKey ||
    (provider === "anthropic-compatible" && !current.hasSavedSettings
      ? process.env.ANTHROPIC_API_KEY?.trim() || ""
      : "");

  if (provider === "template") {
    return {
      provider,
      model: "prompt-studio-v1",
      latencyMs: 0,
      message: "提示词模式可用，无需外部 API Key（生成结构化 Prompt 供拍摄或外部工具使用）。",
    };
  }

  validateBaseUrl(baseUrl);
  if (!model) throw new Error("请填写生图模型名称");
  if (!apiKey) throw new Error("缺少 API Key；请填写新 Key 或先保存配置");

  const startedAt = Date.now();
  if (provider === "gemini") {
    const response = await fetchImpl(geminiModelsEndpoint(baseUrl), {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("Gemini 生图接口连接失败", response);
  } else if (provider === "anthropic-compatible") {
    const headers = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    let response = await fetchImpl(anthropicModelsEndpoint(baseUrl), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 404 || response.status === 405) {
      response = await fetchImpl(anthropicImageMessagesEndpoint(baseUrl), {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "OK" }],
        }),
        signal: AbortSignal.timeout(20_000),
      });
    }
    if (!response.ok) throw await httpFailure("Anthropic 兼容生图接口连接失败", response);
  } else if (isDashScopeEndpoint(provider, baseUrl)) {
    const response = await fetchImpl(dashscopeModelsEndpoint(baseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("阿里云百炼接口连接失败", response);
  } else if (provider === "fal") {
    const response = await fetchImpl(`${baseUrl}/${model.replace(/^\/+/, "")}`, {
      method: "OPTIONS",
      headers: { Authorization: `Key ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw await httpFailure("fal.ai 鉴权失败", response);
    }
  } else if (provider === "ideogram") {
    const response = await fetchImpl(`${baseUrl}/describe`, {
      method: "GET",
      headers: { "Api-Key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw await httpFailure("Ideogram 鉴权失败", response);
    }
  } else {
    const response = await fetchImpl(openAIModelsEndpoint(baseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure(`${imageProviderLabel(provider)}连接失败`, response);
  }

  return {
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    message: "生图服务连接测试通过。",
  };
}

export async function generateImagesWithProvider(
  input: GenerateProductImagesInput,
  fetchImpl: typeof fetch = fetch,
  overrideConfig?: ImageProviderConfig,
  options?: ModeOptions,
): Promise<GenerateProductImagesResult> {
  const config = overrideConfig ?? (await loadImageProviderConfig(options));
  const status = imageStatusFromConfig(config);
  const count = Math.max(1, Math.min(2, Math.round(input.count || 1)));

  if (!status.configured || config.provider === "template") {
    return {
      mode: "prompt_only",
      provider: config.provider,
      model: config.model || "prompt-studio-v1",
      latencyMs: 0,
      images: [],
      note: status.provider === "template"
        ? "当前为免 Key 提示词模式，未发起外部出图请求；可复制下方结构化 Prompt 使用，或前往「系统设置」接入 Gemini、阿里云百炼、OpenAI 兼容或 Anthropic 兼容生图模型。"
        : "生图模型配置尚不完整，已回退为结构化 Prompt 输出；请前往「系统设置」补全 Base URL、模型与 API Key。",
    };
  }

  const startedAt = Date.now();
  validateBaseUrl(config.baseUrl);
  const fullPrompt = buildFullPromptText(input.prompt, input.negativePrompt);

  try {
    if (config.provider === "gemini") {
      const images = await generateWithGemini({
        config,
        prompt: fullPrompt,
        aspectRatio: input.aspectRatio,
        count,
        referenceImage: input.referenceImage ?? null,
        timeoutMs: input.timeoutMs ?? 60_000,
        fetchImpl,
      });
      return {
        mode: "model",
        provider: "gemini",
        model: config.model,
        latencyMs: Date.now() - startedAt,
        images,
        note: `已通过 Gemini (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
      };
    }

    if (config.provider === "anthropic-compatible") {
      const images = await generateWithAnthropicCompatible({
        config,
        prompt: fullPrompt,
        aspectRatio: input.aspectRatio,
        count,
        referenceImage: input.referenceImage ?? null,
        timeoutMs: input.timeoutMs ?? 60_000,
        fetchImpl,
      });
      return {
        mode: "model",
        provider: "anthropic-compatible",
        model: config.model,
        latencyMs: Date.now() - startedAt,
        images,
        note: `已通过 Anthropic 兼容接口 (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
      };
    }

    if (isDashScopeEndpoint(config.provider, config.baseUrl)) {
      const images = await generateWithDashScope({
        config,
        prompt: input.prompt.trim(),
        negativePrompt: input.negativePrompt?.trim() || "",
        aspectRatio: input.aspectRatio,
        count,
        referenceImage: input.referenceImage ?? null,
        timeoutMs: input.timeoutMs ?? 60_000,
        fetchImpl,
      });
      return {
        mode: "model",
        provider: "dashscope",
        model: config.model,
        latencyMs: Date.now() - startedAt,
        images,
        note: `已通过阿里云百炼 (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
      };
    }

    if (config.provider === "fal") {
      const images = await generateWithFal({
        config,
        prompt: fullPrompt,
        aspectRatio: input.aspectRatio,
        count,
        referenceImage: input.referenceImage ?? null,
        timeoutMs: input.timeoutMs ?? 60_000,
        fetchImpl,
      });
      return {
        mode: "model",
        provider: "fal",
        model: config.model,
        latencyMs: Date.now() - startedAt,
        images,
        note: `已通过 fal.ai (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
      };
    }

    if (config.provider === "ideogram") {
      const images = await generateWithIdeogram({
        config,
        prompt: fullPrompt,
        aspectRatio: input.aspectRatio,
        count,
        timeoutMs: input.timeoutMs ?? 60_000,
        fetchImpl,
      });
      return {
        mode: "model",
        provider: "ideogram",
        model: config.model,
        latencyMs: Date.now() - startedAt,
        images,
        note: `已通过 Ideogram (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
      };
    }

    const images = await generateWithOpenAICompatible({
      config,
      prompt: fullPrompt,
      aspectRatio: input.aspectRatio,
      count,
      referenceImage: input.referenceImage ?? null,
      timeoutMs: input.timeoutMs ?? 60_000,
      fetchImpl,
    });
    return {
      mode: "model",
      provider: "openai-compatible",
      model: config.model,
      latencyMs: Date.now() - startedAt,
      images,
      note: `已通过 OpenAI 兼容接口 (${config.model}) 生成 ${images.length} 张草稿素材，等待人工逐项审核。`,
    };
  } catch (error) {
    throw new Error(safeProviderError(error));
  }
}

