import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.ts";
import {
  DEFAULT_FUNNEL_THRESHOLDS,
  DEFAULT_SOURCING_CONSTRAINTS,
  type SourcingConstraints,
  type SourcingFunnelThresholds,
} from "./sourcing-funnel.ts";

export type AIProviderId = "template" | "ollama" | "openai-compatible" | "anthropic-compatible";
export type ImageProviderId =
  | "template"
  | "gemini"
  | "dashscope"
  | "volcengine"
  | "siliconflow"
  | "zhipu"
  | "fal"
  | "ideogram"
  | "openai-compatible"
  | "anthropic-compatible";
export type VideoProviderId =
  | "template"
  | "kling"
  | "dashscope"
  | "veo"
  | "runway"
  | "volcengine"
  | "openai-compatible";

export type AIProviderConfig = {
  provider: AIProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeySource: "database" | "environment" | "none" | "unreadable";
  hasSavedSettings: boolean;
};

export type ImageProviderConfig = {
  provider: ImageProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeySource: "database" | "environment" | "none" | "unreadable";
  hasSavedSettings: boolean;
};

export type VideoProviderConfig = {
  provider: VideoProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
  apiKeySource: "database" | "environment" | "none" | "unreadable";
  hasSavedSettings: boolean;
};

export type SaveAIProviderSettingsInput = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  actor: string;
};

export type SaveImageProviderSettingsInput = SaveAIProviderSettingsInput;

const SETTING_KEYS = ["ai_provider", "ai_base_url", "ai_model", "ai_api_key"] as const;
const IMAGE_SETTING_KEYS = ["image_provider", "image_base_url", "image_model", "image_api_key"] as const;
const VIDEO_SETTING_KEYS = ["video_provider", "video_base_url", "video_model", "video_api_key"] as const;
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_DASHSCOPE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_KLING_URL = "https://api.klingai.com";
const DEFAULT_RUNWAY_URL = "https://api.dev.runwayml.com";
const DEFAULT_VOLCENGINE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_SILICONFLOW_URL = "https://api.siliconflow.cn/v1";
const DEFAULT_ZHIPU_URL = "https://open.bigmodel.cn/api/paas/v4";
const DEFAULT_FAL_URL = "https://fal.run";
const DEFAULT_IDEOGRAM_URL = "https://api.ideogram.ai";

export async function loadAIProviderConfig(): Promise<AIProviderConfig> {
  const stored = await readSettingMap(SETTING_KEYS);
  const provider = normalizeAIProvider(stored.get("ai_provider") ?? process.env.AI_PROVIDER);
  const baseUrl = (stored.get("ai_base_url") || process.env.AI_BASE_URL || defaultAIBaseUrl(provider)).trim();
  const model = (stored.get("ai_model") || process.env.AI_MODEL || defaultAIModel(provider)).trim();
  const secret = await resolveStoredSecret(stored.get("ai_api_key"), envKeyForAI(provider));

  return {
    provider,
    baseUrl,
    model,
    apiKey: secret.apiKey,
    apiKeySource: secret.apiKeySource,
    hasSavedSettings: SETTING_KEYS.some((key) => stored.has(key)),
  };
}

export async function saveAIProviderSettings(input: SaveAIProviderSettingsInput) {
  const provider = normalizeAIProvider(input.provider);
  const baseUrl = (input.baseUrl.trim() || defaultAIBaseUrl(provider)).slice(0, 500);
  const model = (input.model.trim() || defaultAIModel(provider)).slice(0, 160);
  const apiKey = input.apiKey.trim();
  const actor = input.actor.trim().slice(0, 80) || "本机管理员";

  if (provider !== "template") {
    validateBaseUrl(baseUrl);
    if (!model) throw new Error("请填写模型名称");
  }
  if ((provider === "openai-compatible" || provider === "anthropic-compatible") && !apiKey) {
    if (!(await hasStoredOrEnvKey("ai_api_key", envKeyForAI(provider)))) {
      throw new Error(
        provider === "anthropic-compatible"
          ? "Anthropic 兼容接口需要 API Key；也可以先在环境变量中配置 AI_API_KEY 或 ANTHROPIC_API_KEY"
          : "OpenAI 兼容接口需要 API Key；也可以先在环境变量中配置 AI_API_KEY",
      );
    }
  }

  const db = await getDb();
  const encryptedKey = apiKey ? await encryptSecret(apiKey) : null;
  const keyAction = encryptedKey ? "updated" : "preserved";

  await db.transaction(async (tx) => {
    const values: Array<[string, string]> = [
      ["ai_provider", provider],
      ["ai_base_url", baseUrl],
      ["ai_model", model],
    ];
    if (encryptedKey) values.push(["ai_api_key", encryptedKey]);

    for (const [key, value] of values) {
      await tx.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, value, actor],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai.settings_saved', 'app_settings', 'ai', $3::jsonb)`,
      [
        randomUUID(),
        actor,
        JSON.stringify({
          provider,
          baseUrl,
          model,
          keyAction,
          keyConfigured: Boolean(encryptedKey) || provider === "template",
        }),
      ],
    );
  });

  return { provider, baseUrl, model, keyAction };
}

export async function clearStoredAIProviderKey(actorInput: string) {
  await clearSettingKey("ai_api_key", "ai.api_key_cleared", "ai", actorInput);
}

export async function loadImageProviderConfig(): Promise<ImageProviderConfig> {
  const stored = await readSettingMap(IMAGE_SETTING_KEYS);
  const provider = normalizeImageProvider(stored.get("image_provider") ?? process.env.IMAGE_PROVIDER);
  const baseUrl = (stored.get("image_base_url") || process.env.IMAGE_BASE_URL || defaultImageBaseUrl(provider)).trim();
  const model = (stored.get("image_model") || process.env.IMAGE_MODEL || defaultImageModel(provider)).trim();
  const secret = await resolveStoredSecret(stored.get("image_api_key"), envKeyForImage(provider));

  return {
    provider,
    baseUrl,
    model,
    apiKey: secret.apiKey,
    apiKeySource: secret.apiKeySource,
    hasSavedSettings: IMAGE_SETTING_KEYS.some((key) => stored.has(key)),
  };
}

export async function saveImageProviderSettings(input: SaveImageProviderSettingsInput) {
  const provider = normalizeImageProvider(input.provider);
  const baseUrl = (input.baseUrl.trim() || defaultImageBaseUrl(provider)).slice(0, 500);
  const model = (input.model.trim() || defaultImageModel(provider)).slice(0, 160);
  const apiKey = input.apiKey.trim();
  const actor = input.actor.trim().slice(0, 80) || "本机管理员";

  if (provider !== "template") {
    validateBaseUrl(baseUrl);
    if (!model) throw new Error("请填写生图模型名称");
    if (!apiKey && !(await hasStoredOrEnvKey("image_api_key", envKeyForImage(provider)))) {
      throw new Error(
        provider === "gemini"
          ? "Gemini 生图需要 API Key；也可以先配置 IMAGE_API_KEY 或 GEMINI_API_KEY 环境变量"
          : provider === "dashscope"
            ? "阿里云百炼生图需要 API Key；也可以先配置 IMAGE_API_KEY 或 DASHSCOPE_API_KEY 环境变量"
            : provider === "anthropic-compatible"
              ? "Anthropic 兼容生图接口需要 API Key；也可以先配置 IMAGE_API_KEY 或 ANTHROPIC_API_KEY 环境变量"
              : "OpenAI 兼容生图接口需要 API Key；也可以先配置 IMAGE_API_KEY 环境变量",
      );
    }
  }

  const db = await getDb();
  const encryptedKey = apiKey ? await encryptSecret(apiKey) : null;
  const keyAction = encryptedKey ? "updated" : "preserved";

  await db.transaction(async (tx) => {
    const values: Array<[string, string]> = [
      ["image_provider", provider],
      ["image_base_url", baseUrl],
      ["image_model", model],
    ];
    if (encryptedKey) values.push(["image_api_key", encryptedKey]);

    for (const [key, value] of values) {
      await tx.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [key, value, actor],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'image.settings_saved', 'app_settings', 'image', $3::jsonb)`,
      [
        randomUUID(),
        actor,
        JSON.stringify({
          provider,
          baseUrl,
          model,
          keyAction,
          keyConfigured: Boolean(encryptedKey) || provider === "template",
        }),
      ],
    );
  });

  return { provider, baseUrl, model, keyAction };
}

export async function clearStoredImageProviderKey(actorInput: string) {
  await clearSettingKey("image_api_key", "image.api_key_cleared", "image", actorInput);
}

export async function loadVideoProviderConfig(): Promise<VideoProviderConfig> {
  const stored = await readSettingMap(VIDEO_SETTING_KEYS);
  const provider = normalizeVideoProvider(stored.get("video_provider") ?? process.env.VIDEO_PROVIDER);
  const baseUrl = (stored.get("video_base_url") || process.env.VIDEO_BASE_URL || defaultVideoBaseUrl(provider)).trim();
  const model = (stored.get("video_model") || process.env.VIDEO_MODEL || defaultVideoModel(provider)).trim();
  const secret = await resolveStoredSecret(stored.get("video_api_key"), envKeyForVideo(provider));

  return {
    provider,
    baseUrl,
    model,
    apiKey: secret.apiKey,
    apiKeySource: secret.apiKeySource,
    hasSavedSettings: VIDEO_SETTING_KEYS.some((key) => stored.has(key)),
  };
}

async function readSettingMap(keys: readonly string[]) {
  const db = await getDb();
  const result = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN (${keys.map((_, index) => `$${index + 1}`).join(", ")})`,
    [...keys],
  );
  return new Map(result.rows.map((row) => [row.key, row.value]));
}

async function resolveStoredSecret(
  storedKey: string | undefined,
  envKey: string,
): Promise<{ apiKey: string; apiKeySource: AIProviderConfig["apiKeySource"] }> {
  if (storedKey !== undefined) {
    if (!storedKey) return { apiKey: "", apiKeySource: "none" };
    const decrypted = await decryptSecret(storedKey);
    if (decrypted === null) return { apiKey: "", apiKeySource: "unreadable" };
    return { apiKey: decrypted, apiKeySource: "database" };
  }
  if (envKey) return { apiKey: envKey, apiKeySource: "environment" };
  return { apiKey: "", apiKeySource: "none" };
}

async function clearSettingKey(settingKey: string, auditAction: string, entityId: string, actorInput: string) {
  const db = await getDb();
  const actor = actorInput.trim().slice(0, 80) || "本机管理员";
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, '', $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = '', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [settingKey, actor],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, 'app_settings', $4, $5::jsonb)`,
      [randomUUID(), actor, auditAction, entityId, JSON.stringify({ keyConfigured: false, credentialsExposed: false })],
    );
  });
}

function envKeyForAI(provider: AIProviderId) {
  return (
    process.env.AI_API_KEY?.trim() ||
    (provider === "anthropic-compatible" ? process.env.ANTHROPIC_API_KEY?.trim() : "") ||
    ""
  );
}

function envKeyForImage(provider: ImageProviderId) {
  return (
    process.env.IMAGE_API_KEY?.trim() ||
    (provider === "gemini" ? process.env.GEMINI_API_KEY?.trim() : "") ||
    (provider === "dashscope" ? process.env.DASHSCOPE_API_KEY?.trim() : "") ||
    (provider === "volcengine" ? process.env.ARK_API_KEY?.trim() || process.env.VOLCENGINE_API_KEY?.trim() : "") ||
    (provider === "siliconflow" ? process.env.SILICONFLOW_API_KEY?.trim() : "") ||
    (provider === "zhipu" ? process.env.ZHIPU_API_KEY?.trim() : "") ||
    (provider === "fal" ? process.env.FAL_KEY?.trim() || process.env.FAL_API_KEY?.trim() : "") ||
    (provider === "ideogram" ? process.env.IDEOGRAM_API_KEY?.trim() : "") ||
    (provider === "anthropic-compatible" ? process.env.ANTHROPIC_API_KEY?.trim() : "") ||
    ""
  );
}

function envKeyForVideo(provider: VideoProviderId) {
  return (
    process.env.VIDEO_API_KEY?.trim() ||
    (provider === "kling" ? process.env.KLING_API_KEY?.trim() : "") ||
    (provider === "dashscope" ? process.env.DASHSCOPE_API_KEY?.trim() : "") ||
    (provider === "veo" ? process.env.GEMINI_API_KEY?.trim() : "") ||
    (provider === "runway" ? process.env.RUNWAY_API_KEY?.trim() : "") ||
    (provider === "volcengine" ? process.env.ARK_API_KEY?.trim() || process.env.VOLCENGINE_API_KEY?.trim() : "") ||
    ""
  );
}

async function hasStoredOrEnvKey(settingKey: string, envKey: string): Promise<boolean> {
  const stored = await readSettingMap([settingKey]);
  const secret = await resolveStoredSecret(stored.get(settingKey), envKey);
  return Boolean(secret.apiKey);
}

export function normalizeAIProvider(value: string | undefined): AIProviderId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "ollama" || normalized === "openai-compatible" || normalized === "anthropic-compatible") {
    return normalized;
  }
  if (normalized === "anthropic" || normalized === "claude") return "anthropic-compatible";
  return "template";
}

export function defaultAIBaseUrl(provider: AIProviderId) {
  if (provider === "ollama") return DEFAULT_OLLAMA_URL;
  if (provider === "openai-compatible") return DEFAULT_OPENAI_URL;
  if (provider === "anthropic-compatible") return DEFAULT_ANTHROPIC_URL;
  return "";
}

export function defaultAIModel(provider: AIProviderId) {
  if (provider === "ollama") return "qwen3";
  return provider === "template" ? "deterministic-v1" : "";
}

export function normalizeImageProvider(value: string | undefined): ImageProviderId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (
    normalized === "gemini" ||
    normalized === "dashscope" ||
    normalized === "volcengine" ||
    normalized === "siliconflow" ||
    normalized === "zhipu" ||
    normalized === "fal" ||
    normalized === "ideogram" ||
    normalized === "openai-compatible" ||
    normalized === "anthropic-compatible"
  ) {
    return normalized;
  }
  if (normalized === "anthropic" || normalized === "claude") return "anthropic-compatible";
  if (normalized === "aliyun" || normalized === "bailian") return "dashscope";
  if (normalized === "ark" || normalized === "seedream" || normalized === "doubao" || normalized === "jimeng") return "volcengine";
  if (normalized === "bigmodel" || normalized === "cogview") return "zhipu";
  if (normalized === "fal-ai" || normalized === "flux") return "fal";
  return "template";
}

export function defaultImageBaseUrl(provider: ImageProviderId) {
  if (provider === "gemini") return DEFAULT_GEMINI_URL;
  if (provider === "dashscope") return DEFAULT_DASHSCOPE_URL;
  if (provider === "volcengine") return DEFAULT_VOLCENGINE_URL;
  if (provider === "siliconflow") return DEFAULT_SILICONFLOW_URL;
  if (provider === "zhipu") return DEFAULT_ZHIPU_URL;
  if (provider === "fal") return DEFAULT_FAL_URL;
  if (provider === "ideogram") return DEFAULT_IDEOGRAM_URL;
  if (provider === "openai-compatible") return DEFAULT_OPENAI_URL;
  if (provider === "anthropic-compatible") return DEFAULT_ANTHROPIC_URL;
  return "";
}

export function defaultImageModel(provider: ImageProviderId) {
  if (provider === "gemini") return "gemini-nano-banana-2.1";
  if (provider === "dashscope") return "qwen-image-plus";
  if (provider === "volcengine") return "doubao-seedream-3-0-t2i-250415";
  if (provider === "siliconflow") return "black-forest-labs/FLUX.1-dev";
  if (provider === "zhipu") return "cogview-4-250304";
  if (provider === "fal") return "fal-ai/flux-pro/v1.1";
  if (provider === "ideogram") return "V_2_TURBO";
  if (provider === "openai-compatible") return "gpt-image-1";
  if (provider === "anthropic-compatible") return "";
  return "prompt-studio-v1";
}

export function normalizeVideoProvider(value: string | undefined): VideoProviderId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (
    normalized === "kling" ||
    normalized === "dashscope" ||
    normalized === "veo" ||
    normalized === "runway" ||
    normalized === "volcengine" ||
    normalized === "openai-compatible"
  ) {
    return normalized;
  }
  if (normalized === "kuaishou" || normalized === "klingai") return "kling";
  if (normalized === "aliyun" || normalized === "bailian" || normalized === "wan") return "dashscope";
  if (normalized === "gemini" || normalized === "google" || normalized === "veo3") return "veo";
  if (normalized === "runwayml" || normalized === "gen4") return "runway";
  if (normalized === "ark" || normalized === "seedance" || normalized === "doubao") return "volcengine";
  if (normalized === "sora" || normalized === "openai") return "openai-compatible";
  return "template";
}

export function defaultVideoBaseUrl(provider: VideoProviderId) {
  if (provider === "kling") return DEFAULT_KLING_URL;
  if (provider === "dashscope") return DEFAULT_DASHSCOPE_URL;
  if (provider === "veo") return DEFAULT_GEMINI_URL;
  if (provider === "runway") return DEFAULT_RUNWAY_URL;
  if (provider === "volcengine") return DEFAULT_VOLCENGINE_URL;
  if (provider === "openai-compatible") return DEFAULT_OPENAI_URL;
  return "";
}

export function defaultVideoModel(provider: VideoProviderId) {
  if (provider === "kling") return "kling-v2-master";
  if (provider === "dashscope") return "wan3.0-video";
  if (provider === "veo") return "veo-3.0-generate-preview";
  if (provider === "runway") return "gen4_turbo";
  if (provider === "volcengine") return "doubao-seedance-1-0-pro-250528";
  if (provider === "openai-compatible") return "sora-2";
  return "storyboard-studio-v1";
}

export function validateBaseUrl(value: string) {
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

export async function encryptSecret(value: string) {
  const key = await getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export async function decryptSecret(value: string) {
  if (!value.startsWith("v1:")) return null;
  try {
    const [, ivRaw, tagRaw, encryptedRaw] = value.split(":");
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;
    const key = await getEncryptionKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

async function getEncryptionKey() {
  const configured = process.env.AI_SETTINGS_ENCRYPTION_KEY?.trim();
  if (configured) return createHash("sha256").update(configured).digest();

  const keyPath = encryptionKeyPath();
  await mkdir(path.dirname(keyPath), { recursive: true });
  try {
    const existing = (await readFile(keyPath, "utf8")).trim();
    return Buffer.from(existing, "hex");
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }

  const generated = randomBytes(32).toString("hex");
  try {
    await writeFile(keyPath, generated, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return Buffer.from(generated, "hex");
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = (await readFile(keyPath, "utf8")).trim();
    return Buffer.from(existing, "hex");
  }
}

function encryptionKeyPath() {
  const configuredDir = process.env.PGLITE_DATA_DIR || ".data/aitrade";
  // The key file lives beside the configured PGlite data directory at runtime.
  // Keep Turbopack from tracing the whole project for this dynamic path.
  const dataDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDir);
  return `${dataDir}.ai-key`;
}

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

export async function loadFunnelThresholds(): Promise<SourcingFunnelThresholds> {
  const db = await getDb();
  const res = await db.query<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'sourcing_funnel_thresholds' LIMIT 1",
  );
  const raw = res.rows[0]?.value;
  if (!raw) return { ...DEFAULT_FUNNEL_THRESHOLDS };
  try {
    const parsed = JSON.parse(raw) as Partial<SourcingFunnelThresholds>;
    return {
      minCompetitorsForPass: Number(parsed.minCompetitorsForPass) || DEFAULT_FUNNEL_THRESHOLDS.minCompetitorsForPass,
      maxHhi: Number(parsed.maxHhi) || DEFAULT_FUNNEL_THRESHOLDS.maxHhi,
      maxBrandCr3Percent: Number(parsed.maxBrandCr3Percent) || DEFAULT_FUNNEL_THRESHOLDS.maxBrandCr3Percent,
      maxMedianReviews: Number(parsed.maxMedianReviews) || DEFAULT_FUNNEL_THRESHOLDS.maxMedianReviews,
      minMarginRate: Number(parsed.minMarginRate) || DEFAULT_FUNNEL_THRESHOLDS.minMarginRate,
      maxComplianceCostUsd: Number(parsed.maxComplianceCostUsd) || DEFAULT_FUNNEL_THRESHOLDS.maxComplianceCostUsd,
    };
  } catch {
    return { ...DEFAULT_FUNNEL_THRESHOLDS };
  }
}

export async function saveFunnelThresholds(input: Partial<SourcingFunnelThresholds>, actor = "管理员") {
  const db = await getDb();
  const current = await loadFunnelThresholds();
  const merged: SourcingFunnelThresholds = {
    minCompetitorsForPass: Math.max(4, Math.round(Number(input.minCompetitorsForPass ?? current.minCompetitorsForPass))),
    maxHhi: Math.max(1000, Math.round(Number(input.maxHhi ?? current.maxHhi))),
    maxBrandCr3Percent: Math.max(20, Math.min(100, Math.round(Number(input.maxBrandCr3Percent ?? current.maxBrandCr3Percent)))),
    maxMedianReviews: Math.max(100, Math.round(Number(input.maxMedianReviews ?? current.maxMedianReviews))),
    minMarginRate: Math.max(0.05, Math.min(0.6, Number(input.minMarginRate ?? current.minMarginRate))),
    maxComplianceCostUsd: Math.max(100, Math.round(Number(input.maxComplianceCostUsd ?? current.maxComplianceCostUsd))),
  };
  await db.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('sourcing_funnel_thresholds', $1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(merged), actor.trim() || "管理员"],
  );
  return merged;
}

export async function loadSourcingConstraints(): Promise<SourcingConstraints> {
  const db = await getDb();
  const res = await db.query<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = 'sourcing_constraints' LIMIT 1",
  );
  const raw = res.rows[0]?.value;
  if (!raw) return { ...DEFAULT_SOURCING_CONSTRAINTS };
  try {
    const parsed = JSON.parse(raw) as Partial<SourcingConstraints>;
    return {
      minPriceUsd: typeof parsed.minPriceUsd === "number" && parsed.minPriceUsd > 0 ? parsed.minPriceUsd : null,
      maxPriceUsd: typeof parsed.maxPriceUsd === "number" && parsed.maxPriceUsd > 0 ? parsed.maxPriceUsd : null,
      maxWeightKg: typeof parsed.maxWeightKg === "number" && parsed.maxWeightKg > 0 ? parsed.maxWeightKg : null,
      excludedAttrs: Array.isArray(parsed.excludedAttrs) ? parsed.excludedAttrs : DEFAULT_SOURCING_CONSTRAINTS.excludedAttrs,
      customExclusions: Array.isArray(parsed.customExclusions)
        ? parsed.customExclusions.filter(
            (item): item is { id: string; label: string; enabled: boolean } =>
              Boolean(item && typeof item.id === "string" && typeof item.label === "string" && typeof item.enabled === "boolean"),
          )
        : [],
      hiddenAttrs: Array.isArray(parsed.hiddenAttrs) ? parsed.hiddenAttrs : [],
      attrLabelOverrides:
        parsed.attrLabelOverrides && typeof parsed.attrLabelOverrides === "object"
          ? parsed.attrLabelOverrides
          : {},
      customNote: typeof parsed.customNote === "string" ? parsed.customNote : "",
    };
  } catch {
    return { ...DEFAULT_SOURCING_CONSTRAINTS };
  }
}

export async function saveSourcingConstraints(input: SourcingConstraints, actor = "选品负责人") {
  const db = await getDb();
  await db.query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('sourcing_constraints', $1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(input), actor.trim() || "选品负责人"],
  );
  return input;
}
