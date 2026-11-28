import { createHmac } from "node:crypto";
import { httpFailure } from "./providers/http.ts";
import {
  defaultVideoBaseUrl,
  defaultVideoModel,
  loadVideoProviderConfig,
  normalizeVideoProvider,
  validateBaseUrl,
  type VideoProviderConfig,
  type VideoProviderId,
} from "./app-settings.ts";

export type { VideoProviderId } from "./app-settings.ts";

export type VideoAspectRatio = "16:9" | "1:1" | "9:16";
export type VideoDurationSec = 5 | 10;
export type VideoTemplateId = "hero_orbit_5s" | "pain_point_demo_5s" | "social_hook_9x16";

export type VideoTemplateSpec = {
  id: VideoTemplateId;
  name: string;
  tagline: string;
  channelHint: string;
  defaultAspectRatio: VideoAspectRatio;
  defaultDurationSec: VideoDurationSec;
  cameraMotion: string;
  lightingStyle: string;
};

export const VIDEO_TEMPLATES: readonly VideoTemplateSpec[] = [
  {
    id: "hero_orbit_5s",
    name: "质感环绕 / 微距细节",
    tagline: "Amazon 主图第 7 槽首镜 · 低幅度稳态运镜防变形",
    channelHint: "Amazon / Shopify 主图视频",
    defaultAspectRatio: "16:9",
    defaultDurationSec: 5,
    cameraMotion:
      "Slow, ultra-smooth 20-degree studio dolly arc around the product, subtle specular highlight gliding across the surface, zero morphing, locked product geometry",
    lightingStyle: "Clean commercial studio softbox lighting, crisp rim light, neutral tabletop shadow",
  },
  {
    id: "pain_point_demo_5s",
    name: "痛点反制动态演示",
    tagline: "自动注入竞品差评痛点，直观呈现结构改良效果",
    channelHint: "Amazon A+ / 详情页卖点演示",
    defaultAspectRatio: "16:9",
    defaultDurationSec: 5,
    cameraMotion:
      "Steady medium close-up pushing gently forward 10%, demonstrating clean, quiet, reliable product operation in a real home environment with natural depth of field",
    lightingStyle: "Bright natural daylight home interior, editorial commercial color grade, sharp product focus",
  },
  {
    id: "social_hook_9x16",
    name: "TikTok / Reels 竖屏种草开场",
    tagline: "前 2 秒视觉抓手 · 适配 TikTok Shop 与社媒投放",
    channelHint: "TikTok Shop / Reels / Shorts",
    defaultAspectRatio: "9:16",
    defaultDurationSec: 5,
    cameraMotion:
      "Dynamic yet controlled vertical reveal tilting smoothly up to the hero product in lifestyle action, subtle handheld authenticity without shake or distortion",
    lightingStyle: "Vibrant warm lifestyle daylight, shallow depth of field, high-contrast social commerce aesthetic",
  },
] as const;

export type VideoProviderStatus = {
  provider: VideoProviderId;
  label: string;
  model: string;
  baseUrl: string;
  configured: boolean;
  detail: string;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  apiKeySource: VideoProviderConfig["apiKeySource"];
  usingSavedSettings: boolean;
};

export type VideoProviderTestInput = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type VideoProviderTestResult = {
  provider: VideoProviderId;
  model: string;
  latencyMs: number;
  message: string;
};

export type VideoPromptContext = {
  productName: string;
  targetCustomer: string;
  coreDifferentiator: string;
  specifications: string;
  claimsToAvoid: string;
  marketplace: string;
  topPainPoints: string[];
  templateId: VideoTemplateId;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  customInstruction?: string;
};

export type ComposedVideoPrompt = {
  template: VideoTemplateSpec;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  prompt: string;
  negativePrompt: string;
  estimatedCostUsd: number;
  estimatedLatencyLabel: string;
  storyboard: Array<{
    shot: number;
    durationSec: number;
    role: string;
    visualPrompt: string;
    captionEn: string;
    captionZh: string;
  }>;
};

export type SubmitVideoJobInput = {
  prompt: string;
  negativePrompt: string;
  aspectRatio: VideoAspectRatio;
  durationSec: VideoDurationSec;
  referenceImage: {
    bytes: Buffer;
    mimeType: string;
    fileName?: string;
  };
};

export type SubmitVideoJobResult = {
  mode: "model" | "prompt_only";
  provider: VideoProviderId;
  model: string;
  externalTaskId: string;
  pollUrl: string;
  status: "queued" | "running" | "succeeded" | "prompt_only";
  videoBytes?: Buffer;
  videoMimeType?: string;
  estimatedCostUsd: number;
  note: string;
};

export type PollVideoJobInput = {
  provider: VideoProviderId;
  model: string;
  externalTaskId: string;
  pollUrl?: string;
};

export type PollVideoJobResult = {
  status: "queued" | "running" | "succeeded" | "failed";
  videoBytes?: Buffer;
  videoMimeType?: string;
  videoUrl?: string;
  errorMessage?: string;
};

export function getVideoTemplateById(id: string | undefined): VideoTemplateSpec {
  return VIDEO_TEMPLATES.find((item) => item.id === id) ?? VIDEO_TEMPLATES[0]!;
}

export function normalizeVideoAspectRatio(value: string | undefined, fallback: VideoAspectRatio = "16:9"): VideoAspectRatio {
  if (value === "16:9" || value === "1:1" || value === "9:16") return value;
  return fallback;
}

export function normalizeVideoDuration(value: unknown, fallback: VideoDurationSec = 5): VideoDurationSec {
  const num = typeof value === "number" ? value : Number(value);
  return num >= 8 ? 10 : num === 5 ? 5 : fallback;
}

export function estimateVideoCostUsd(provider: VideoProviderId, durationSec: VideoDurationSec): number {
  const multiplier = durationSec >= 10 ? 2 : 1;
  switch (provider) {
    case "template":
      return 0;
    case "dashscope":
      return Number((0.18 * multiplier).toFixed(2));
    case "volcengine":
      return Number((0.22 * multiplier).toFixed(2));
    case "kling":
      return Number((0.28 * multiplier).toFixed(2));
    case "runway":
      return Number((0.35 * multiplier).toFixed(2));
    case "veo":
      return Number((0.75 * multiplier).toFixed(2));
    case "openai-compatible":
      return Number((0.5 * multiplier).toFixed(2));
  }
}

export function composeVideoPrompt(ctx: VideoPromptContext, provider: VideoProviderId = "template"): ComposedVideoPrompt {
  const template = getVideoTemplateById(ctx.templateId);
  const aspectRatio = normalizeVideoAspectRatio(ctx.aspectRatio, template.defaultAspectRatio);
  const durationSec = normalizeVideoDuration(ctx.durationSec, template.defaultDurationSec);
  const painClause =
    ctx.topPainPoints.length > 0
      ? `Visually addresses buyer pain points (${ctx.topPainPoints.slice(0, 2).join("; ")}) with effortless, reliable product performance.`
      : "Highlights dependable everyday usability and build quality.";
  const diffClause = ctx.coreDifferentiator
    ? `Key product advantage shown naturally: ${ctx.coreDifferentiator.slice(0, 220)}.`
    : "";
  const customClause = ctx.customInstruction?.trim() ? `Additional direction: ${ctx.customInstruction.trim()}.` : "";

  const prompt = [
    `Commercial e-commerce product demonstration video (${durationSec}s, ${aspectRatio}) anchored strictly to the reference product image: ${ctx.productName}.`,
    `Preserve exact product shape, color, proportions, and material details from the first frame.`,
    template.cameraMotion + ".",
    template.lightingStyle + ".",
    painClause,
    diffClause,
    customClause,
    "No on-screen text, no watermarks, no price tags, no distorted logos or extra fingers.",
  ]
    .filter(Boolean)
    .join(" ");

  const negativePrompt = [
    "text overlay, captions, watermarks, logos, price badges, flickering, morphing product shape, melted details, blurry, low resolution, jittery camera, deformed hands",
    ctx.claimsToAvoid ? `forbidden claims: ${ctx.claimsToAvoid.slice(0, 180)}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const primaryPain = ctx.topPainPoints[0] || "common durability & usability issues";
  const storyboard = [
    {
      shot: 1,
      durationSec: 5,
      role: "首镜抓手 · 外观质感",
      visualPrompt: `Smooth studio arc revealing ${ctx.productName} from the approved hero photo, crisp material texture and clean silhouette.`,
      captionEn: `Meet ${ctx.productName.slice(0, 42)} — engineered for everyday reliability.`,
      captionZh: `核心外观与材质质感亮相（适配 Amazon 主图首镜）`,
    },
    {
      shot: 2,
      durationSec: 5,
      role: "痛点反制 · 实景演示",
      visualPrompt: `Real-home medium close-up showing ${ctx.productName} solving ${primaryPain} effortlessly in daily use.`,
      captionEn: ctx.coreDifferentiator
        ? ctx.coreDifferentiator.slice(0, 68)
        : `Built to eliminate ${primaryPain.slice(0, 48)}.`,
      captionZh: `直击竞品差评痛点（${primaryPain.slice(0, 24)}）的动态实景演示`,
    },
    {
      shot: 3,
      durationSec: 5,
      role: "细节收尾 · 转化定格",
      visualPrompt: `Macro push-in on key craftsmanship details of ${ctx.productName}, ending on a clean hero frame for brand trust.`,
      captionEn: `Verified materials. Ready for ${ctx.marketplace || "US"} shoppers.`,
      captionZh: `工艺细节微距收尾，强化品质信任与下单转化`,
    },
  ];

  return {
    template,
    aspectRatio,
    durationSec,
    prompt,
    negativePrompt,
    estimatedCostUsd: estimateVideoCostUsd(provider, durationSec),
    estimatedLatencyLabel: provider === "template" ? "即时生成脚本" : "约 45 ~ 150 秒（异步队列）",
    storyboard,
  };
}

export async function getVideoProviderStatus(): Promise<VideoProviderStatus> {
  return videoStatusFromConfig(await loadVideoProviderConfig());
}

export async function testVideoProviderConnection(
  input: VideoProviderTestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoProviderTestResult> {
  const current = await loadVideoProviderConfig();
  const provider = normalizeVideoProvider(input.provider);
  const baseUrl = (
    input.baseUrl.trim() ||
    (provider === current.provider ? current.baseUrl : defaultVideoBaseUrl(provider))
  ).replace(/\/+$/, "");
  const model =
    input.model.trim() ||
    (provider === current.provider ? current.model : defaultVideoModel(provider));
  const apiKey = input.apiKey.trim() || current.apiKey;

  if (provider === "template") {
    return {
      provider,
      model: "storyboard-studio-v1",
      latencyMs: 0,
      message: "分镜脚本模式可用，无需外部 API Key（自动输出 3 镜英文分镜 Prompt 与字幕条）。",
    };
  }

  validateBaseUrl(baseUrl);
  if (!model) throw new Error("请填写视频模型名称");
  if (!apiKey) throw new Error("缺少 API Key；请填写新 Key 或先保存配置");

  const startedAt = Date.now();
  if (provider === "veo") {
    const response = await fetchImpl(`${baseUrl}/v1beta/models`, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("Google Veo / Gemini 接口连接失败", response);
  } else if (provider === "dashscope") {
    const dashOrigin = baseUrl.replace(/\/(compatible-mode\/v1|api\/v1)\/?$/i, "");
    const response = await fetchImpl(`${dashOrigin}/compatible-mode/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("阿里云百炼视频接口连接失败", response);
  } else if (provider === "runway") {
    const response = await fetchImpl(`${baseUrl}/v1/organization`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("Runway 接口连接失败", response);
  } else if (provider === "kling") {
    const token = buildKlingBearerToken(apiKey);
    const response = await fetchImpl(`${baseUrl}/v1/videos/image2video?pageNum=1&pageSize=1`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("可灵 Kling 接口连接失败", response);
  } else if (provider === "volcengine") {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("火山引擎豆包 Ark 接口连接失败", response);
  } else {
    const response = await fetchImpl(`${baseUrl.replace(/\/v1$/, "")}/v1/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw await httpFailure("OpenAI 兼容视频接口连接失败", response);
  }

  return {
    provider,
    model,
    latencyMs: Date.now() - startedAt,
    message: `${providerLabel(provider)} 连接测试通过。`,
  };
}

export async function submitVideoGenerationJob(
  input: SubmitVideoJobInput,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitVideoJobResult> {
  const config = await loadVideoProviderConfig();
  const cost = estimateVideoCostUsd(config.provider, input.durationSec);

  if (config.provider === "template") {
    return {
      mode: "prompt_only",
      provider: "template",
      model: "storyboard-studio-v1",
      externalTaskId: "",
      pollUrl: "",
      status: "prompt_only",
      estimatedCostUsd: 0,
      note: "当前为免 Key 分镜脚本模式，已生成结构化分镜与 I2V 提示词；如需直接生成 MP4 视频，请前往「系统设置 → 商品视频」配置 API Key。",
    };
  }

  if (!config.apiKey) {
    throw new Error(`未配置 ${providerLabel(config.provider)} API Key，请前往「系统设置 → 商品视频」填写。`);
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const model = config.model || defaultVideoModel(config.provider);
  const imageBase64 = input.referenceImage.bytes.toString("base64");
  const dataUri = `data:${input.referenceImage.mimeType};base64,${imageBase64}`;

  if (config.provider === "kling") {
    const token = buildKlingBearerToken(config.apiKey);
    const endpoint = `${baseUrl}/v1/videos/image2video`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: model,
        image: imageBase64,
        prompt: input.prompt,
        negative_prompt: input.negativePrompt,
        duration: String(input.durationSec),
        aspect_ratio: input.aspectRatio,
        mode: "std",
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await httpFailure("可灵 Kling 提交任务失败", response);
    const data = (await response.json()) as { data?: { task_id?: string }; task_id?: string };
    const taskId = data.data?.task_id || data.task_id || "";
    if (!taskId) throw new Error("可灵 Kling 未返回 task_id");
    return {
      mode: "model",
      provider: "kling",
      model,
      externalTaskId: taskId,
      pollUrl: `${baseUrl}/v1/videos/image2video/${encodeURIComponent(taskId)}`,
      status: "queued",
      estimatedCostUsd: cost,
      note: "已提交至可灵 Kling 异步渲染队列。",
    };
  }

  if (config.provider === "dashscope") {
    const dashOrigin = baseUrl.replace(/\/(compatible-mode\/v1|api\/v1)\/?$/i, "");
    const endpoint = `${dashOrigin}/api/v1/services/aigc/video-generation/video-synthesis`;
    const isUnifiedWan = /^wan(2\.7|3\.)/i.test(model);
    const inputPayload = isUnifiedWan
      ? {
          prompt: input.prompt,
          negative_prompt: input.negativePrompt,
          media: [{ type: "first_frame", url: dataUri }],
        }
      : {
          prompt: input.prompt,
          negative_prompt: input.negativePrompt,
          img_url: dataUri,
        };
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-DashScope-Async": "enable",
      },
      body: JSON.stringify({
        model,
        input: inputPayload,
        parameters: {
          duration: input.durationSec,
          resolution: "720P",
          prompt_extend: true,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await httpFailure("阿里云百炼提交视频任务失败", response);
    const data = (await response.json()) as { output?: { task_id?: string } };
    const taskId = data.output?.task_id || "";
    if (!taskId) throw new Error("阿里云百炼未返回 task_id");
    return {
      mode: "model",
      provider: "dashscope",
      model,
      externalTaskId: taskId,
      pollUrl: `${dashOrigin}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      status: "queued",
      estimatedCostUsd: cost,
      note: "已提交至阿里云百炼通义万相异步队列。",
    };
  }

  if (config.provider === "veo") {
    const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "x-goog-api-key": config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: input.prompt,
            image: {
              bytesBase64Encoded: imageBase64,
              mimeType: input.referenceImage.mimeType,
            },
          },
        ],
        parameters: {
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSec,
          negativePrompt: input.negativePrompt,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await httpFailure("Google Veo 提交视频任务失败", response);
    const data = (await response.json()) as { name?: string };
    const opName = data.name || "";
    if (!opName) throw new Error("Google Veo 未返回长任务 operation name");
    const pollUrl = opName.startsWith("http")
      ? opName
      : `${baseUrl}/v1beta/${opName.replace(/^\/+/, "")}`;
    return {
      mode: "model",
      provider: "veo",
      model,
      externalTaskId: opName,
      pollUrl,
      status: "queued",
      estimatedCostUsd: cost,
      note: "已提交至 Google Veo 异步渲染任务。",
    };
  }

  if (config.provider === "runway") {
    const ratio =
      input.aspectRatio === "9:16"
        ? "720:1280"
        : input.aspectRatio === "1:1"
          ? "960:960"
          : "1280:720";
    const endpoint = `${baseUrl}/v1/image_to_video`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "X-Runway-Version": "2024-11-06",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        promptImage: dataUri,
        promptText: input.prompt,
        ratio,
        duration: input.durationSec,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await httpFailure("Runway 提交视频任务失败", response);
    const data = (await response.json()) as { id?: string };
    const taskId = data.id || "";
    if (!taskId) throw new Error("Runway 未返回任务 id");
    return {
      mode: "model",
      provider: "runway",
      model,
      externalTaskId: taskId,
      pollUrl: `${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`,
      status: "queued",
      estimatedCostUsd: cost,
      note: "已提交至 Runway Gen-4 异步队列。",
    };
  }

  if (config.provider === "volcengine") {
    const endpoint = `${baseUrl}/contents/generations/tasks`;
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        content: [
          {
            type: "text",
            text: `${input.prompt} --ratio ${input.aspectRatio} --dur ${input.durationSec}`,
          },
          {
            type: "image_url",
            image_url: { url: dataUri },
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw await httpFailure("火山引擎 Seedance 提交视频任务失败", response);
    const data = (await response.json()) as { id?: string };
    const taskId = data.id || "";
    if (!taskId) throw new Error("火山引擎 Seedance 未返回任务 id");
    return {
      mode: "model",
      provider: "volcengine",
      model,
      externalTaskId: taskId,
      pollUrl: `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      status: "queued",
      estimatedCostUsd: cost,
      note: "已提交至火山引擎豆包 Seedance 异步队列。",
    };
  }

  // OpenAI / Sora / 聚合中转兼容接口
  const normalizedBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  let response = await fetchImpl(`${normalizedBase}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      image: dataUri,
      seconds: String(input.durationSec),
      size:
        input.aspectRatio === "9:16"
          ? "720x1280"
          : input.aspectRatio === "1:1"
            ? "1024x1024"
            : "1280x720",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  let pollPrefix = `${normalizedBase}/videos`;
  if (response.status === 404 || response.status === 405) {
    pollPrefix = `${normalizedBase}/video/generations`;
    response = await fetchImpl(pollPrefix, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: input.prompt,
        image_url: dataUri,
        duration: input.durationSec,
        aspect_ratio: input.aspectRatio,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!response.ok) throw await httpFailure("OpenAI 兼容视频接口提交失败", response);
  const data = (await response.json()) as { id?: string; task_id?: string; data?: { id?: string; url?: string } };
  const taskId = data.id || data.task_id || data.data?.id || "";
  if (!taskId) throw new Error("OpenAI 兼容视频接口未返回任务 ID");
  return {
    mode: "model",
    provider: "openai-compatible",
    model,
    externalTaskId: taskId,
    pollUrl: `${pollPrefix}/${encodeURIComponent(taskId)}`,
    status: "queued",
    estimatedCostUsd: cost,
    note: "已提交至 OpenAI 兼容视频网关异步队列。",
  };
}

export async function pollVideoGenerationJob(
  input: PollVideoJobInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PollVideoJobResult> {
  const config = await loadVideoProviderConfig();
  if (!config.apiKey) {
    return { status: "failed", errorMessage: "视频 API Key 未配置，无法查询任务状态" };
  }

  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  if (input.provider === "kling") {
    const token = buildKlingBearerToken(config.apiKey);
    const url = input.pollUrl || `${baseUrl}/v1/videos/image2video/${encodeURIComponent(input.externalTaskId)}`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw await httpFailure("查询可灵任务失败", response);
    const payload = (await response.json()) as {
      data?: {
        task_status?: string;
        task_status_msg?: string;
        task_result?: { videos?: Array<{ url?: string }> };
      };
    };
    const st = (payload.data?.task_status || "").toLowerCase();
    if (st === "succeed" || st === "succeeded") {
      const videoUrl = payload.data?.task_result?.videos?.[0]?.url;
      if (!videoUrl) return { status: "failed", errorMessage: "可灵任务完成但未返回视频地址" };
      const downloaded = await downloadVideoUrl(videoUrl, {}, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl };
    }
    if (st === "failed") {
      return { status: "failed", errorMessage: payload.data?.task_status_msg || "可灵渲染失败" };
    }
    return { status: st === "processing" ? "running" : "queued" };
  }

  if (input.provider === "dashscope") {
    const url = input.pollUrl || `${baseUrl}/api/v1/tasks/${encodeURIComponent(input.externalTaskId)}`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw await httpFailure("查询百炼任务失败", response);
    const payload = (await response.json()) as {
      output?: { task_status?: string; video_url?: string; message?: string };
    };
    const st = (payload.output?.task_status || "").toUpperCase();
    if (st === "SUCCEEDED") {
      const videoUrl = payload.output?.video_url;
      if (!videoUrl) return { status: "failed", errorMessage: "百炼任务完成但未返回 video_url" };
      const downloaded = await downloadVideoUrl(videoUrl, {}, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl };
    }
    if (st === "FAILED" || st === "CANCELED") {
      return { status: "failed", errorMessage: payload.output?.message || "阿里云百炼视频生成失败" };
    }
    return { status: st === "RUNNING" ? "running" : "queued" };
  }

  if (input.provider === "veo") {
    const url = input.pollUrl || `${baseUrl}/v1beta/${input.externalTaskId.replace(/^\/+/, "")}`;
    const response = await fetchImpl(url, {
      headers: { "x-goog-api-key": config.apiKey },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw await httpFailure("查询 Google Veo 任务失败", response);
    const payload = (await response.json()) as {
      done?: boolean;
      error?: { message?: string };
      response?: {
        generateVideoResponse?: {
          generatedSamples?: Array<{ video?: { uri?: string; bytesBase64Encoded?: string } }>;
        };
      };
    };
    if (!payload.done) return { status: "running" };
    if (payload.error) return { status: "failed", errorMessage: payload.error.message || "Google Veo 渲染失败" };
    const sample = payload.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
    if (sample?.bytesBase64Encoded) {
      return {
        status: "succeeded",
        videoBytes: Buffer.from(sample.bytesBase64Encoded, "base64"),
        videoMimeType: "video/mp4",
      };
    }
    if (sample?.uri) {
      const downloaded = await downloadVideoUrl(sample.uri, { "x-goog-api-key": config.apiKey }, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl: sample.uri };
    }
    return { status: "failed", errorMessage: "Google Veo 完成但未返回视频样本" };
  }

  if (input.provider === "runway") {
    const url = input.pollUrl || `${baseUrl}/v1/tasks/${encodeURIComponent(input.externalTaskId)}`;
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "X-Runway-Version": "2024-11-06",
      },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw await httpFailure("查询 Runway 任务失败", response);
    const payload = (await response.json()) as {
      status?: string;
      output?: string[];
      failure?: string;
    };
    const st = (payload.status || "").toUpperCase();
    if (st === "SUCCEEDED") {
      const videoUrl = payload.output?.[0];
      if (!videoUrl) return { status: "failed", errorMessage: "Runway 完成但未返回输出链接" };
      const downloaded = await downloadVideoUrl(videoUrl, {}, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl };
    }
    if (st === "FAILED" || st === "CANCELLED") {
      return { status: "failed", errorMessage: payload.failure || "Runway 渲染失败" };
    }
    return { status: st === "RUNNING" ? "running" : "queued" };
  }

  if (input.provider === "volcengine") {
    const url = input.pollUrl || `${baseUrl}/contents/generations/tasks/${encodeURIComponent(input.externalTaskId)}`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) throw await httpFailure("查询火山引擎 Seedance 任务失败", response);
    const payload = (await response.json()) as {
      status?: string;
      content?: { video_url?: string };
      error?: { message?: string };
    };
    const st = (payload.status || "").toLowerCase();
    if (st === "succeeded") {
      const videoUrl = payload.content?.video_url;
      if (!videoUrl) return { status: "failed", errorMessage: "火山引擎完成但未返回 video_url" };
      const downloaded = await downloadVideoUrl(videoUrl, {}, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl };
    }
    if (st === "failed" || st === "cancelled") {
      return { status: "failed", errorMessage: payload.error?.message || "火山引擎 Seedance 渲染失败" };
    }
    return { status: st === "running" ? "running" : "queued" };
  }

  // OpenAI-compatible
  const normalizedBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const url = input.pollUrl || `${normalizedBase}/videos/${encodeURIComponent(input.externalTaskId)}`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw await httpFailure("查询 OpenAI 兼容视频任务失败", response);
  const payload = (await response.json()) as {
    status?: string;
    url?: string;
    video_url?: string;
    output?: { url?: string; video_url?: string };
    error?: { message?: string } | string;
  };
  const st = (payload.status || "").toLowerCase();
  if (st === "completed" || st === "succeeded" || st === "success") {
    const videoUrl = payload.url || payload.video_url || payload.output?.url || payload.output?.video_url;
    if (videoUrl) {
      const downloaded = await downloadVideoUrl(videoUrl, {}, fetchImpl);
      return { status: "succeeded", ...downloaded, videoUrl };
    }
    // 兼容 OpenAI Sora `/v1/videos/{id}/content` 二进制下载端点
    const contentResp = await fetchImpl(`${url}/content`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(60_000),
    });
    if (!contentResp.ok) return { status: "failed", errorMessage: "视频已完成但无法下载视频文件" };
    const buf = Buffer.from(await contentResp.arrayBuffer());
    return { status: "succeeded", videoBytes: buf, videoMimeType: contentResp.headers.get("content-type") || "video/mp4" };
  }
  if (st === "failed" || st === "error" || st === "cancelled") {
    const errText = typeof payload.error === "string" ? payload.error : payload.error?.message;
    return { status: "failed", errorMessage: errText || "视频生成任务失败" };
  }
  return { status: st === "in_progress" || st === "running" ? "running" : "queued" };
}

async function downloadVideoUrl(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ videoBytes: Buffer; videoMimeType: string }> {
  const resp = await fetchImpl(url, { headers, signal: AbortSignal.timeout(60_000) });
  if (!resp.ok) throw new Error(`下载生成视频失败（HTTP ${resp.status}）`);
  const bytes = Buffer.from(await resp.arrayBuffer());
  const mime = resp.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  return { videoBytes: bytes, videoMimeType: mime.startsWith("video/") ? mime : "video/mp4" };
}

/**
 * 可灵 Kling 支持两种凭证形式：
 * 1) 聚合网关直接传入 Bearer API Key
 * 2) 官方控制台 AccessKey:SecretKey（以冒号分隔），自动按 HS256 签发短期 JWT
 */
export function buildKlingBearerToken(rawKey: string): string {
  const trimmed = rawKey.trim();
  const sep = trimmed.indexOf(":");
  if (sep <= 0 || sep >= trimmed.length - 1 || trimmed.startsWith("sk-") || trimmed.includes(".")) {
    return trimmed;
  }
  const ak = trimmed.slice(0, sep);
  const sk = trimmed.slice(sep + 1);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })).toString("base64url");
  const sig = createHmac("sha256", sk).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function videoStatusFromConfig(config: VideoProviderConfig): VideoProviderStatus {
  const configured = config.provider === "template" ? true : Boolean(config.apiKey && config.model && config.baseUrl);
  const label = providerLabel(config.provider);
  const apiKeyHint = maskKey(config.apiKey);
  const detail =
    config.provider === "template"
      ? "当前为免 Key 分镜脚本模式，输出 3 镜英文 I2V 提示词与字幕条，可随时切换主流视频 API。"
      : configured
        ? `已连接 ${label}（${config.model}），支持由已审商品图异步生成演示短视频。`
        : `${label} 缺少 API Key 或模型 ID，请前往「系统设置 → 商品视频」补全。`;

  return {
    provider: config.provider,
    label,
    model: config.model || defaultVideoModel(config.provider),
    baseUrl: config.baseUrl,
    configured,
    detail,
    apiKeyConfigured: Boolean(config.apiKey),
    apiKeyHint,
    apiKeySource: config.apiKeySource,
    usingSavedSettings: config.hasSavedSettings,
  };
}

function providerLabel(provider: VideoProviderId): string {
  switch (provider) {
    case "kling":
      return "快手可灵 Kling";
    case "dashscope":
      return "阿里云百炼 · 通义万相";
    case "veo":
      return "Google Veo";
    case "runway":
      return "Runway Gen-4";
    case "volcengine":
      return "火山引擎 · 豆包 Seedance";
    case "openai-compatible":
      return "OpenAI / Sora 兼容接口";
    default:
      return "免 Key 分镜脚本模式";
  }
}

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-4)}`;
}
