import {
  defaultImageBaseUrl,
  defaultImageModel,
  loadImageProviderConfig,
  normalizeImageProvider,
  validateBaseUrl,
  type ImageProviderConfig,
  type ImageProviderId,
} from "./app-settings.ts";
import type { ImageAspectRatio } from "./image-skills.ts";

export type { ImageProviderId } from "./app-settings.ts";

export type ImageProviderStatus = {
  provider: ImageProviderId;
  label: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  detail: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  apiKeySource: ImageProviderConfig["apiKeySource"];
  usingSavedSettings: boolean;
};

export type ImageProviderTestInput = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ImageProviderTestResult = {
  provider: ImageProviderId;
  model: string;
  latencyMs: number;
  message: string;
};

export type GenerateProductImagesInput = {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage?: {
    bytes: Buffer;
    mimeType: string;
    fileName?: string;
  } | null;
  timeoutMs?: number;
};

export type GeneratedImageAssetPayload = {
  bytes: Buffer;
  mimeType: string;
  suggestedName: string;
};

export type GenerateProductImagesResult = {
  mode: "model" | "prompt_only";
  provider: ImageProviderId;
  model: string;
  latencyMs: number;
  images: GeneratedImageAssetPayload[];
  note: string;
};

export async function getImageProviderStatus(): Promise<ImageProviderStatus> {
  return imageStatusFromConfig(await loadImageProviderConfig());
}

export async function testImageProviderConnection(
  input: ImageProviderTestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageProviderTestResult> {
  const current = await loadImageProviderConfig();
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
  } else {
    const response = await fetchImpl(openAIModelsEndpoint(baseUrl), {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("OpenAI 兼容生图接口连接失败", response);
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
): Promise<GenerateProductImagesResult> {
  const config = overrideConfig ?? (await loadImageProviderConfig());
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

async function generateWithGemini(params: {
  config: ImageProviderConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage: GenerateProductImagesInput["referenceImage"];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const endpoint = geminiInteractionsEndpoint(params.config.baseUrl);
  const requestInput = params.referenceImage
    ? [
        {
          type: "image",
          data: params.referenceImage.bytes.toString("base64"),
          mime_type: params.referenceImage.mimeType,
        },
        {
          type: "text",
          text: params.prompt,
        },
      ]
    : params.prompt;

  const collected: GeneratedImageAssetPayload[] = [];
  for (let idx = 0; idx < params.count; idx += 1) {
    const response = await params.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": params.config.apiKey,
      },
      body: JSON.stringify({
        model: params.config.model,
        response_modalities: ["image"],
        response_format: {
          type: "image",
          aspect_ratio: params.aspectRatio,
        },
        input: requestInput,
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    if (!response.ok) throw await httpFailure("Gemini 生图请求失败", response);

    const payload = (await response.json()) as GeminiInteractionResponse;
    const extracted = extractGeminiImages(payload, idx + 1);
    collected.push(...extracted);
  }

  if (collected.length === 0) {
    throw new Error("Gemini 未返回图片内容，请检查所选模型是否支持图像输出（推荐 gemini-nano-banana-2.1）");
  }
  return collected;
}

async function generateWithOpenAICompatible(params: {
  config: ImageProviderConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage: GenerateProductImagesInput["referenceImage"];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const size = mapOpenAIImageSize(params.config.model, params.aspectRatio);
  let response: Response;

  if (params.referenceImage) {
    const form = new FormData();
    form.append("model", params.config.model);
    form.append("prompt", params.prompt);
    form.append("n", String(params.count));
    form.append("size", size);
    form.append(
      "image",
      new Blob([new Uint8Array(params.referenceImage.bytes)], { type: params.referenceImage.mimeType }),
      params.referenceImage.fileName || "reference.png",
    );
    response = await params.fetchImpl(openAIImageEditsEndpoint(params.config.baseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${params.config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  } else {
    response = await params.fetchImpl(openAIImageGenerationsEndpoint(params.config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify({
        model: params.config.model,
        prompt: params.prompt,
        n: params.count,
        size,
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
  }

  if (!response.ok) throw await httpFailure("生图接口请求失败", response);
  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const items = Array.isArray(payload.data) ? payload.data : [];
  const results: GeneratedImageAssetPayload[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.b64_json) {
      results.push({
        bytes: Buffer.from(item.b64_json, "base64"),
        mimeType: "image/png",
        suggestedName: `ai-generated-${index + 1}.png`,
      });
    } else if (item.url) {
      results.push(
        await downloadRemoteImage({
          url: item.url,
          suggestedPrefix: `ai-generated-${index + 1}`,
          protocolErrorMessage: "生图接口返回了不支持的图片 URL 协议",
          fetchErrorPrefix: "拉取生成图片失败",
          fetchImpl: params.fetchImpl,
        }),
      );
    }
  }

  if (results.length === 0) {
    throw new Error("生图接口未返回有效图片数据");
  }
  return results;
}

type DashScopeResponse = {
  code?: string;
  message?: string;
  output?: {
    choices?: Array<{
      message?: {
        content?: Array<{
          image?: string;
          image_url?: { url?: string };
        }>;
      };
    }>;
    results?: Array<{ url?: string }>;
  };
};

async function generateWithDashScope(params: {
  config: ImageProviderConfig;
  prompt: string;
  negativePrompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage: GenerateProductImagesInput["referenceImage"];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const endpoint = dashscopeImageEndpoint(params.config.baseUrl);
  const content: Array<Record<string, string>> = [];
  if (params.referenceImage) {
    content.push({
      image: `data:${params.referenceImage.mimeType};base64,${params.referenceImage.bytes.toString("base64")}`,
    });
  }
  content.push({ text: params.prompt });

  const parameters: Record<string, unknown> = {
    size: mapDashScopeImageSize(params.config.model, params.aspectRatio),
    n: params.count,
    watermark: false,
  };
  if (params.negativePrompt) {
    parameters.negative_prompt = params.negativePrompt.slice(0, 500);
  }

  const response = await params.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.config.apiKey}`,
    },
    body: JSON.stringify({
      model: params.config.model,
      input: {
        messages: [
          {
            role: "user",
            content,
          },
        ],
      },
      parameters,
    }),
    signal: AbortSignal.timeout(params.timeoutMs),
  });

  if (!response.ok) throw await httpFailure("阿里云百炼生图请求失败", response);
  const payload = (await response.json()) as DashScopeResponse;
  if (payload.code && payload.message) {
    throw new Error(`阿里云百炼生图请求失败：${payload.code}（${payload.message}）`);
  }

  const imageUrls: string[] = [];
  for (const choice of payload.output?.choices ?? []) {
    for (const part of choice.message?.content ?? []) {
      const url = part.image || part.image_url?.url;
      if (typeof url === "string" && url.trim()) imageUrls.push(url.trim());
    }
  }
  for (const item of payload.output?.results ?? []) {
    if (typeof item.url === "string" && item.url.trim()) imageUrls.push(item.url.trim());
  }

  const results: GeneratedImageAssetPayload[] = [];
  for (let index = 0; index < imageUrls.length; index += 1) {
    results.push(
      await downloadRemoteImage({
        url: imageUrls[index]!,
        suggestedPrefix: `dashscope-${index + 1}`,
        protocolErrorMessage: "阿里云百炼返回了不支持的图片 URL 协议",
        fetchErrorPrefix: "拉取百炼生成图片失败",
        fetchImpl: params.fetchImpl,
      }),
    );
  }

  if (results.length === 0) {
    throw new Error("阿里云百炼生图接口未返回有效图片");
  }
  return results;
}

type AnthropicImageBlock = {
  type?: string;
  text?: string;
  data?: string;
  mime_type?: string;
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
    url?: string;
  };
  image_url?: {
    url?: string;
  };
};

type AnthropicMessagesResponse = {
  content?: AnthropicImageBlock[];
};

async function generateWithAnthropicCompatible(params: {
  config: ImageProviderConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage: GenerateProductImagesInput["referenceImage"];
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const endpoint = anthropicImageMessagesEndpoint(params.config.baseUrl);
  const contentBlocks: Array<Record<string, unknown>> = [];
  if (params.referenceImage) {
    contentBlocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: params.referenceImage.mimeType,
        data: params.referenceImage.bytes.toString("base64"),
      },
    });
  }
  contentBlocks.push({
    type: "text",
    text: `${params.prompt}\n\nTarget aspect ratio: ${params.aspectRatio}. Generate and return the image directly.`,
  });

  const collected: GeneratedImageAssetPayload[] = [];
  for (let idx = 0; idx < params.count; idx += 1) {
    const response = await params.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": params.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: params.config.model,
        max_tokens: 4096,
        messages: [{ role: "user", content: contentBlocks }],
      }),
      signal: AbortSignal.timeout(params.timeoutMs),
    });
    if (!response.ok) throw await httpFailure("Anthropic 兼容生图请求失败", response);

    const payload = (await response.json()) as AnthropicMessagesResponse;
    const extracted = await extractAnthropicImages(payload, idx + 1, params.fetchImpl);
    collected.push(...extracted);
  }

  if (collected.length === 0) {
    throw new Error("Anthropic 兼容接口未返回图片内容；请确认所用兼容网关与模型支持图像输出（原生 Claude 模型仅支持文本与读图）");
  }
  return collected;
}

async function extractAnthropicImages(
  payload: AnthropicMessagesResponse,
  batchIndex: number,
  fetchImpl: typeof fetch,
): Promise<GeneratedImageAssetPayload[]> {
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const images: GeneratedImageAssetPayload[] = [];
  const seenUrls = new Set<string>();

  const pushBytes = (bytes: Buffer, mimeType: string) => {
    images.push({
      bytes,
      mimeType,
      suggestedName: `anthropic-${batchIndex}-${images.length + 1}.${extensionFromMime(mimeType)}`,
    });
  };

  const handleImageUrl = async (rawUrl: string) => {
    const dataUrl = parseDataImageUrl(rawUrl);
    if (dataUrl) {
      pushBytes(dataUrl.bytes, dataUrl.mimeType);
      return;
    }
    if (seenUrls.has(rawUrl)) return;
    seenUrls.add(rawUrl);
    images.push(
      await downloadRemoteImage({
        url: rawUrl,
        suggestedPrefix: `anthropic-${batchIndex}-${images.length + 1}`,
        protocolErrorMessage: "Anthropic 兼容接口返回了不支持的图片 URL 协议",
        fetchErrorPrefix: "拉取 Anthropic 兼容生图图片失败",
        fetchImpl,
      }),
    );
  };

  for (const block of blocks) {
    if (!block) continue;

    if (block.type === "image" && block.source?.type === "base64" && block.source.data?.trim()) {
      pushBytes(Buffer.from(block.source.data, "base64"), block.source.media_type || "image/png");
      continue;
    }
    if (block.type === "image" && block.data?.trim()) {
      pushBytes(Buffer.from(block.data, "base64"), block.mime_type || "image/png");
      continue;
    }

    const blockUrl =
      block.type === "image" && block.source?.type === "url"
        ? block.source.url?.trim()
        : block.type === "image" && block.source?.url
          ? block.source.url.trim()
          : block.type === "image_url"
            ? block.image_url?.url?.trim()
            : undefined;
    if (blockUrl) {
      await handleImageUrl(blockUrl);
      continue;
    }

    if (block.type === "text" && typeof block.text === "string") {
      for (const match of block.text.matchAll(/data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+/gi)) {
        const parsed = parseDataImageUrl(match[0]);
        if (parsed) pushBytes(parsed.bytes, parsed.mimeType);
      }
      for (const match of block.text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi)) {
        const url = match[1]?.trim();
        if (url) await handleImageUrl(url);
      }
    }
  }

  return images;
}

function parseDataImageUrl(value: string): { mimeType: string; bytes: Buffer } | null {
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  const rawMime = match[1]!.toLowerCase();
  const mimeType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const bytes = Buffer.from(match[2]!.replace(/\s+/g, ""), "base64");
  return bytes.length > 0 ? { mimeType, bytes } : null;
}

async function downloadRemoteImage(params: {
  url: string;
  suggestedPrefix: string;
  protocolErrorMessage: string;
  fetchErrorPrefix: string;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload> {
  const parsed = new URL(params.url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(params.protocolErrorMessage);
  }
  const downloaded = await params.fetchImpl(parsed.toString(), {
    signal: AbortSignal.timeout(25_000),
  });
  if (!downloaded.ok) throw new Error(`${params.fetchErrorPrefix}：HTTP ${downloaded.status}`);
  const contentType = downloaded.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  return {
    bytes,
    mimeType: contentType,
    suggestedName: `${params.suggestedPrefix}.${extensionFromMime(contentType)}`,
  };
}

type GeminiContentPart = {
  type?: string;
  data?: string;
  mime_type?: string;
};

type GeminiInteractionResponse = {
  steps?: Array<{
    type?: string;
    content?: GeminiContentPart[];
  }>;
  outputs?: GeminiContentPart[];
};

function extractGeminiImages(
  payload: GeminiInteractionResponse,
  batchIndex: number,
): GeneratedImageAssetPayload[] {
  const parts: GeminiContentPart[] = [];
  if (Array.isArray(payload.steps)) {
    for (const step of payload.steps) {
      if (step?.type === "model_output" && Array.isArray(step.content)) {
        parts.push(...step.content);
      }
    }
  }
  if (parts.length === 0 && Array.isArray(payload.outputs)) {
    parts.push(...payload.outputs);
  }

  const images: GeneratedImageAssetPayload[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part?.type === "image" && typeof part.data === "string" && part.data.trim()) {
      const mimeType = part.mime_type || "image/png";
      images.push({
        bytes: Buffer.from(part.data, "base64"),
        mimeType,
        suggestedName: `gemini-${batchIndex}-${i + 1}.${extensionFromMime(mimeType)}`,
      });
    }
  }
  return images;
}

function buildFullPromptText(prompt: string, negativePrompt?: string): string {
  const trimmed = prompt.trim();
  const neg = negativePrompt?.trim();
  if (!neg) return trimmed;
  return `${trimmed}\n\nAvoid strictly: ${neg}`;
}

function mapDashScopeImageSize(model: string, aspectRatio: ImageAspectRatio): string {
  const isQwen = model.toLowerCase().includes("qwen");
  if (isQwen) {
    if (aspectRatio === "4:5") return "1140*1472";
    if (aspectRatio === "16:9") return "1664*928";
    return "1328*1328";
  }
  if (aspectRatio === "4:5") return "1024*1280";
  if (aspectRatio === "16:9") return "1280*720";
  return "1280*1280";
}

function isDashScopeEndpoint(provider: ImageProviderId, baseUrl: string): boolean {
  if (provider === "dashscope") return true;
  if (provider !== "openai-compatible") return false;
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return (
      hostname === "dashscope.aliyuncs.com" ||
      hostname === "dashscope-intl.aliyuncs.com" ||
      hostname.endsWith(".maas.aliyuncs.com")
    );
  } catch {
    return false;
  }
}

function mapOpenAIImageSize(model: string, aspectRatio: ImageAspectRatio): string {
  const isDallE = model.toLowerCase().includes("dall-e");
  if (aspectRatio === "4:5") return isDallE ? "1024x1792" : "1024x1536";
  if (aspectRatio === "16:9") return isDallE ? "1792x1024" : "1536x1024";
  return "1024x1024";
}

function extensionFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

function imageStatusFromConfig(config: ImageProviderConfig): ImageProviderStatus {
  const label =
    config.provider === "gemini"
      ? "Google Gemini 生图"
      : config.provider === "anthropic-compatible"
        ? "Anthropic 兼容生图接口"
        : config.provider === "dashscope" || isDashScopeEndpoint(config.provider, config.baseUrl)
          ? "阿里云百炼生图"
          : config.provider === "openai-compatible"
            ? "OpenAI 兼容生图接口"
            : "免 Key 提示词模式";

  if (config.provider === "template") {
    return {
      provider: "template",
      label,
      model: config.model || "prompt-studio-v1",
      baseUrl: "",
      configured: true,
      detail: "当前仅生成结构化生图 Prompt，不调用外部付费出图接口；可在「系统设置」切换 Gemini、阿里云百炼、OpenAI 兼容或 Anthropic 兼容接口。",
      apiKeyConfigured: false,
      apiKeyHint: "",
      apiKeySource: "none",
      usingSavedSettings: config.hasSavedSettings,
    };
  }

  const unreadable = config.apiKeySource === "unreadable";
  const configured = Boolean(config.baseUrl && config.model && config.apiKey && !unreadable);
  return {
    provider: config.provider,
    label,
    model: config.model || defaultImageModel(config.provider) || "未配置模型",
    baseUrl: config.baseUrl,
    configured,
    detail: unreadable
      ? "已保存的生图 API Key 无法解密，请重新输入并保存。"
      : configured
        ? `已接入 ${label}（${config.model}），支持文生图与参考底图图生图。`
        : `未完成 ${label} 配置（缺少模型或 API Key），暂仅输出结构化 Prompt。`,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyHint: maskApiKey(config.apiKey),
    apiKeySource: config.apiKeySource,
    usingSavedSettings: config.hasSavedSettings,
  };
}

export function anthropicImageMessagesEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/messages")) return base;
  if (base.endsWith("/v1")) return `${base}/messages`;
  return `${base}/v1/messages`;
}

export function anthropicModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/messages$/i, "");
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

export function dashscopeImageEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/generation")) return base;
  const root = base
    .replace(/\/compatible-mode\/v1$/i, "")
    .replace(/\/compatible-mode$/i, "")
    .replace(/\/api\/v1$/i, "")
    .replace(/\/v1$/i, "");
  return `${root}/api/v1/services/aigc/multimodal-generation/generation`;
}

function dashscopeModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  const root = base
    .replace(/\/api\/v1\/services\/aigc\/multimodal-generation\/generation$/i, "")
    .replace(/\/compatible-mode\/v1$/i, "")
    .replace(/\/compatible-mode$/i, "")
    .replace(/\/api\/v1$/i, "")
    .replace(/\/v1$/i, "");
  return `${root}/compatible-mode/v1/models`;
}

export function geminiInteractionsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/interactions")) return base;
  if (base.endsWith("/v1beta")) return `${base}/interactions`;
  if (base.endsWith("/v1")) return `${base.slice(0, -3)}/v1beta/interactions`;
  return `${base}/v1beta/interactions`;
}

function geminiModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1beta") || base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1beta/models`;
}

function openAIModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1/models`;
}

export function openAIImageGenerationsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/images/generations")) return base;
  if (base.endsWith("/v1")) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

export function openAIImageEditsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/images/edits")) return base;
  if (base.endsWith("/v1")) return `${base}/images/edits`;
  return `${base}/v1/images/edits`;
}

function maskApiKey(value: string) {
  if (!value) return "";
  const tail = value.length >= 8 ? value.slice(-4) : value.slice(-2);
  return `••••${tail}`;
}

async function httpFailure(label: string, response: Response): Promise<Error> {
  let detail = "";
  try {
    const raw = (await response.text()).trim();
    if (raw) {
      try {
        const payload = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
        const fromError = typeof payload.error === "string" ? payload.error : payload.error?.message;
        detail = fromError || payload.message || raw;
      } catch {
        detail = raw;
      }
    }
  } catch {
    // Ignore body read failures.
  }
  const safe = redactProviderError(detail).replace(/\s+/g, " ").slice(0, 240);
  return new Error(safe ? `${label}：HTTP ${response.status}（${safe}）` : `${label}：HTTP ${response.status}`);
}

function redactProviderError(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{16,}/g, "[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, "[REDACTED]")
    .replace(/x-api-key\s*[=:]\s*\S+/gi, "x-api-key=[REDACTED]")
    .replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[REDACTED]");
}

function safeProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  return redactProviderError(message).slice(0, 300);
}
