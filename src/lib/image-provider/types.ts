import {
  defaultImageModel,
  type ImageProviderConfig,
  type ImageProviderId,
} from "../app-settings.ts";
import type { ImageAspectRatio } from "../image-skills.ts";
import { maskApiKey } from "../providers/http.ts";

export type { ImageProviderId } from "../app-settings.ts";

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


export function buildFullPromptText(prompt: string, negativePrompt?: string): string {
  const trimmed = prompt.trim();
  const neg = negativePrompt?.trim();
  if (!neg) return trimmed;
  return `${trimmed}\n\nAvoid strictly: ${neg}`;
}

export function mapDashScopeImageSize(model: string, aspectRatio: ImageAspectRatio): string {
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

export function isDashScopeEndpoint(provider: ImageProviderId, baseUrl: string): boolean {
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

export function mapOpenAIImageSize(model: string, aspectRatio: ImageAspectRatio): string {
  const isDallE = model.toLowerCase().includes("dall-e");
  if (aspectRatio === "4:5") return isDallE ? "1024x1792" : "1024x1536";
  if (aspectRatio === "16:9") return isDallE ? "1792x1024" : "1536x1024";
  return "1024x1024";
}

export function extensionFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  return "png";
}

export function imageProviderLabel(provider: ImageProviderId, baseUrl = ""): string {
  switch (provider) {
    case "gemini":
      return "Google Gemini 生图";
    case "anthropic-compatible":
      return "Anthropic 兼容生图接口";
    case "dashscope":
      return "阿里云百炼生图";
    case "volcengine":
      return "火山引擎 · 豆包 Seedream";
    case "siliconflow":
      return "硅基流动 SiliconFlow";
    case "zhipu":
      return "智谱 BigModel · CogView";
    case "fal":
      return "fal.ai · FLUX";
    case "ideogram":
      return "Ideogram 电商海报生图";
    case "openai-compatible":
      return isDashScopeEndpoint(provider, baseUrl) ? "阿里云百炼生图" : "OpenAI 兼容生图接口";
    default:
      return "免 Key 提示词模式";
  }
}

export function imageStatusFromConfig(config: ImageProviderConfig): ImageProviderStatus {
  const label = imageProviderLabel(config.provider, config.baseUrl);

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

export function dashscopeModelsEndpoint(baseUrl: string) {
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

export function geminiModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  if (base.endsWith("/v1beta") || base.endsWith("/v1")) return `${base}/models`;
  return `${base}/v1beta/models`;
}

export function openAIModelsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/models")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

export function openAIImageGenerationsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/images/generations")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/images/generations`;
  return `${base}/v1/images/generations`;
}

export function openAIImageEditsEndpoint(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/images/edits")) return base;
  if (/\/v\d+$/.test(base)) return `${base}/images/edits`;
  return `${base}/v1/images/edits`;
}

