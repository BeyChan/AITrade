import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db.ts";

export type AIProviderId = "template" | "ollama" | "openai-compatible";

export type AIProviderConfig = {
  provider: AIProviderId;
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

const SETTING_KEYS = ["ai_provider", "ai_base_url", "ai_model", "ai_api_key"] as const;
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

export async function loadAIProviderConfig(): Promise<AIProviderConfig> {
  const db = await getDb();
  const result = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN (${SETTING_KEYS.map((_, index) => `$${index + 1}`).join(", ")})`,
    [...SETTING_KEYS],
  );
  const stored = new Map(result.rows.map((row) => [row.key, row.value]));
  const provider = normalizeProvider(stored.get("ai_provider") ?? process.env.AI_PROVIDER);
  const baseUrl = (stored.get("ai_base_url") ?? process.env.AI_BASE_URL ?? defaultBaseUrl(provider)).trim();
  const model = (stored.get("ai_model") ?? process.env.AI_MODEL ?? defaultModel(provider)).trim();

  let apiKey = "";
  let apiKeySource: AIProviderConfig["apiKeySource"] = "none";
  const storedKey = stored.get("ai_api_key");
  if (storedKey !== undefined) {
    if (!storedKey) {
      apiKeySource = "none";
    } else {
      const decrypted = await decryptSecret(storedKey);
      if (decrypted === null) {
        apiKeySource = "unreadable";
      } else {
        apiKey = decrypted;
        apiKeySource = "database";
      }
    }
  } else if (process.env.AI_API_KEY?.trim()) {
    apiKey = process.env.AI_API_KEY.trim();
    apiKeySource = "environment";
  }

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    apiKeySource,
    hasSavedSettings: SETTING_KEYS.some((key) => stored.has(key)),
  };
}

export async function saveAIProviderSettings(input: SaveAIProviderSettingsInput) {
  const provider = normalizeProvider(input.provider);
  const baseUrl = input.baseUrl.trim().slice(0, 500);
  const model = input.model.trim().slice(0, 160);
  const apiKey = input.apiKey.trim();
  const actor = input.actor.trim().slice(0, 80) || "本机管理员";

  if (provider !== "template") {
    validateBaseUrl(baseUrl);
    if (!model) throw new Error("请填写模型名称");
  }
  if (provider === "openai-compatible" && !apiKey) {
    const current = await loadAIProviderConfig();
    if (!current.apiKey) throw new Error("OpenAI 兼容接口需要 API Key；也可以先在环境变量中配置 AI_API_KEY");
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
  const db = await getDb();
  const actor = actorInput.trim().slice(0, 80) || "本机管理员";
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('ai_api_key', '', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = '', updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [actor],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'ai.api_key_cleared', 'app_settings', 'ai', $3::jsonb)`,
      [randomUUID(), actor, JSON.stringify({ keyConfigured: false, credentialsExposed: false })],
    );
  });
}

function normalizeProvider(value: string | undefined): AIProviderId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "-");
  if (normalized === "ollama" || normalized === "openai-compatible") return normalized;
  return "template";
}

function defaultBaseUrl(provider: AIProviderId) {
  if (provider === "ollama") return DEFAULT_OLLAMA_URL;
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
