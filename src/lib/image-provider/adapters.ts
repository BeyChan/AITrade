import { type ImageProviderConfig } from "../app-settings.ts";
import type { ImageAspectRatio } from "../image-skills.ts";
import { httpFailure } from "../providers/http.ts";
import {
  anthropicImageMessagesEndpoint,
  dashscopeImageEndpoint,
  extensionFromMime,
  geminiInteractionsEndpoint,
  mapDashScopeImageSize,
  mapOpenAIImageSize,
  openAIImageEditsEndpoint,
  openAIImageGenerationsEndpoint,
  type GeneratedImageAssetPayload,
  type GenerateProductImagesInput,
} from "./types.ts";

export async function generateWithGemini(params: {
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

export async function generateWithOpenAICompatible(params: {
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

export async function generateWithDashScope(params: {
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

export async function generateWithAnthropicCompatible(params: {
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


export async function generateWithFal(args: {
  config: ImageProviderConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  referenceImage: { bytes: Buffer; mimeType: string } | null;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const endpoint = `${args.config.baseUrl.replace(/\/+$/, "")}/${args.config.model.replace(/^\/+/, "")}`;
  const imageSize =
    args.aspectRatio === "4:5"
      ? "portrait_4_3"
      : args.aspectRatio === "16:9"
        ? "landscape_16_9"
        : "square_hd";
  const body: Record<string, unknown> = {
    prompt: args.prompt,
    image_size: imageSize,
    num_images: args.count,
  };
  if (args.referenceImage) {
    body.image_url = `data:${args.referenceImage.mimeType};base64,${args.referenceImage.bytes.toString("base64")}`;
  }
  const response = await args.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Key ${args.config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) throw await httpFailure("fal.ai 生图失败", response);
  const data = (await response.json()) as { images?: Array<{ url?: string; content_type?: string }> };
  const results: GeneratedImageAssetPayload[] = [];
  for (let i = 0; i < (data.images ?? []).length; i += 1) {
    const url = data.images?.[i]?.url;
    if (!url) continue;
    const imgResp = await args.fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!imgResp.ok) continue;
    const bytes = Buffer.from(await imgResp.arrayBuffer());
    const mimeType = imgResp.headers.get("content-type")?.split(";")[0]?.trim() || data.images?.[i]?.content_type || "image/png";
    results.push({ bytes, mimeType, suggestedName: `fal-${i + 1}.png` });
  }
  if (results.length === 0) throw new Error("fal.ai 未返回有效图片");
  return results;
}

export async function generateWithIdeogram(args: {
  config: ImageProviderConfig;
  prompt: string;
  aspectRatio: ImageAspectRatio;
  count: number;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<GeneratedImageAssetPayload[]> {
  const endpoint = `${args.config.baseUrl.replace(/\/+$/, "")}/generate`;
  const ratioMap: Record<string, string> = {
    "1:1": "ASPECT_1_1",
    "4:5": "ASPECT_4_5",
    "16:9": "ASPECT_16_9",
    "9:16": "ASPECT_9_16",
  };
  const response = await args.fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Api-Key": args.config.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_request: {
        prompt: args.prompt,
        model: args.config.model || "V_2_TURBO",
        aspect_ratio: ratioMap[args.aspectRatio] || "ASPECT_1_1",
        num_images: args.count,
      },
    }),
    signal: AbortSignal.timeout(args.timeoutMs),
  });
  if (!response.ok) throw await httpFailure("Ideogram 生图失败", response);
  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const results: GeneratedImageAssetPayload[] = [];
  for (let i = 0; i < (data.data ?? []).length; i += 1) {
    const url = data.data?.[i]?.url;
    if (!url) continue;
    const imgResp = await args.fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!imgResp.ok) continue;
    const bytes = Buffer.from(await imgResp.arrayBuffer());
    const mimeType = imgResp.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
    results.push({ bytes, mimeType, suggestedName: `ideogram-${i + 1}.png` });
  }
  if (results.length === 0) throw new Error("Ideogram 未返回有效图片");
  return results;
}
