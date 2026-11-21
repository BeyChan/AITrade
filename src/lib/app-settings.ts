import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.ts";

export type AIProviderId = "template" | "ollama" | "openai-compatible" | "anthropic-compatible";
export type ImageProviderId = "template" | "gemini" | "dashscope" | "openai-compatible" | "anthropic-compatible";

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
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_GEMINI_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_DASHSCOPE_URL = "https://dashscope.aliyuncs.com";

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
    (provider === "anthropic-compatible" ? process.env.ANTHROPIC_API_KEY?.trim() : "") ||
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
  if (normalized === "gemini" || normalized === "openai-compatible" || normalized === "anthropic-compatible") {
    return normalized;
  }
  if (normalized === "anthropic" || normalized === "claude") return "anthropic-compatible";
  if (normalized === "dashscope" || normalized === "aliyun" || normalized === "bailian") return "dashscope";
  return "template";
}

export function defaultImageBaseUrl(provider: ImageProviderId) {
  if (provider === "gemini") return DEFAULT_GEMINI_URL;
  if (provider === "dashscope") return DEFAULT_DASHSCOPE_URL;
  if (provider === "openai-compatible") return DEFAULT_OPENAI_URL;
  if (provider === "anthropic-compatible") return DEFAULT_ANTHROPIC_URL;
  return "";
}

export function defaultImageModel(provider: ImageProviderId) {
  if (provider === "gemini") return "gemini-nano-banana-2.1";
  if (provider === "dashscope") return "qwen-image-plus";
  if (provider === "openai-compatible") return "gpt-image-1";
  if (provider === "anthropic-compatible") return "";
  return "prompt-studio-v1";
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
