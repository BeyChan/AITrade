import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decryptSecret,
  encryptSecret,
  loadAIProviderConfig,
  loadImageProviderConfig,
  loadVideoProviderConfig,
  validateBaseUrl,
} from "./app-settings.ts";
import { testAIProviderConnection } from "./ai-provider.ts";
import { checkpointDb, getDb } from "./db.ts";
import { testImageProviderConnection } from "./image-provider.ts";
import { testVideoProviderConnection } from "./video-provider.ts";

export type ModelServiceType = "text" | "image" | "video";

export type ModelVendorPreset = {
  id: string;
  label: string;
  serviceType: ModelServiceType;
  protocol: string;
  defaultName: string;
  baseUrl: string;
  models: string[];
  submitEndpoint?: string;
  queryEndpoint?: string;
  keyHint?: string;
};

export const MODEL_VENDOR_PRESETS: readonly ModelVendorPreset[] = [
  // ===== 文本生成 =====
  {
    id: "openai",
    label: "OpenAI 官方",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "OpenAI 文本模型",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o3-mini"],
  },
  {
    id: "deepseek",
    label: "DeepSeek 深度求索",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "DeepSeek 文本",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    serviceType: "text",
    protocol: "anthropic-compatible",
    defaultName: "Claude 文本模型",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-sonnet-4-5", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"],
  },
  {
    id: "volcengine_text",
    label: "火山引擎 · 豆包方舟",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "火山引擎 豆包文本",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seed-1-6-250615", "doubao-1-5-pro-32k-250115", "deepseek-v3-250324"],
  },
  {
    id: "dashscope_text",
    label: "阿里云百炼 · 通义千问",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "阿里云百炼 Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"],
  },
  {
    id: "siliconflow_text",
    label: "硅基流动 SiliconFlow",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "硅基流动 文本",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"],
  },
  {
    id: "ollama",
    label: "本地 Ollama",
    serviceType: "text",
    protocol: "ollama",
    defaultName: "本机 Ollama",
    baseUrl: "http://127.0.0.1:11434",
    models: ["qwen3", "qwen2.5:14b", "llama3.1"],
    keyHint: "本地无需 API Key",
  },
  {
    id: "custom_text",
    label: "自定义文本厂商 / 中转网关",
    serviceType: "text",
    protocol: "openai-compatible",
    defaultName: "自定义文本网关",
    baseUrl: "",
    models: [],
  },

  // ===== 图片生成 =====
  {
    id: "dashscope_image",
    label: "阿里云百炼（通义万相 / Qwen-Image）",
    serviceType: "image",
    protocol: "dashscope",
    defaultName: "阿里云百炼 生图",
    baseUrl: "https://dashscope.aliyuncs.com",
    models: ["qwen-image-plus", "wan2.6-t2i", "wan2.6-image"],
  },
  {
    id: "volcengine_image",
    label: "火山引擎 · 即梦 Seedream",
    serviceType: "image",
    protocol: "volcengine",
    defaultName: "火山引擎 即梦生图",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seedream-3-0-t2i-250415", "doubao-seedream-4-0-250828"],
  },
  {
    id: "gemini_image",
    label: "Google Gemini（Nano Banana）",
    serviceType: "image",
    protocol: "gemini",
    defaultName: "Gemini Nano Banana",
    baseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-nano-banana-2.1", "gemini-2.5-flash-image"],
  },
  {
    id: "siliconflow_image",
    label: "硅基流动 SiliconFlow（FLUX / Kolors）",
    serviceType: "image",
    protocol: "siliconflow",
    defaultName: "硅基流动 FLUX 生图",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1-schnell", "Kwai-Kolors/Kolors"],
  },
  {
    id: "zhipu_image",
    label: "智谱 BigModel（CogView-4）",
    serviceType: "image",
    protocol: "zhipu",
    defaultName: "智谱 CogView-4",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["cogview-4-250304", "cogview-3-flash"],
  },
  {
    id: "fal_image",
    label: "fal.ai（FLUX Pro / Kontext）",
    serviceType: "image",
    protocol: "fal",
    defaultName: "fal.ai FLUX Pro",
    baseUrl: "https://fal.run",
    models: ["fal-ai/flux-pro/v1.1", "fal-ai/flux-pro/kontext", "fal-ai/flux/dev"],
  },
  {
    id: "ideogram_image",
    label: "Ideogram（电商海报排版）",
    serviceType: "image",
    protocol: "ideogram",
    defaultName: "Ideogram 海报生图",
    baseUrl: "https://api.ideogram.ai",
    models: ["V_2_TURBO", "V_2"],
  },
  {
    id: "openai_image",
    label: "OpenAI 官方 / 兼容生图",
    serviceType: "image",
    protocol: "openai-compatible",
    defaultName: "OpenAI 生图",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-image-1", "dall-e-3"],
  },
  {
    id: "custom_image",
    label: "自定义图片厂商 / 中转网关",
    serviceType: "image",
    protocol: "openai-compatible",
    defaultName: "自定义生图网关",
    baseUrl: "",
    models: [],
  },

  // ===== 视频生成 =====
  {
    id: "kling_video",
    label: "快手可灵 Kling（电商一致性主力）",
    serviceType: "video",
    protocol: "kling",
    defaultName: "可灵 Kling 图生视频",
    baseUrl: "https://api.klingai.com",
    models: ["kling-v2-master", "kling-v1-6", "kling-v1-5"],
    submitEndpoint: "/v1/videos/image2video",
    queryEndpoint: "/v1/videos/image2video/{taskId}",
    keyHint: "支持官方 AccessKey:SecretKey（自动签发 JWT）或中转 Bearer Key",
  },
  {
    id: "volcengine_video",
    label: "火山引擎 · 豆包 Seedance",
    serviceType: "video",
    protocol: "volcengine",
    defaultName: "火山 Seedance 1.0 Pro",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: ["doubao-seedance-1-0-pro-250528", "doubao-seedance-1-0-lite-i2v-250428"],
    submitEndpoint: "/contents/generations/tasks",
    queryEndpoint: "/contents/generations/tasks/{taskId}",
  },
  {
    id: "dashscope_video",
    label: "阿里云百炼 · 通义万相",
    serviceType: "video",
    protocol: "dashscope",
    defaultName: "阿里云百炼 通义万相视频",
    baseUrl: "https://dashscope.aliyuncs.com",
    models: [
      "wan3.0-video",
      "wan3.0-video-prime",
      "wan2.7-i2v",
      "wan2.6-i2v",
      "wan2.6-i2v-flash",
      "wan2.1-i2v-turbo",
    ],
    submitEndpoint: "/api/v1/services/aigc/video-generation/video-synthesis",
    queryEndpoint: "/api/v1/tasks/{taskId}",
  },
  {
    id: "veo_video",
    label: "Google Veo（原生音画一体）",
    serviceType: "video",
    protocol: "veo",
    defaultName: "Google Veo 3.0",
    baseUrl: "https://generativelanguage.googleapis.com",
    models: ["veo-3.0-generate-preview", "veo-2.0-generate-001"],
    submitEndpoint: "/v1beta/models/{model}:predictLongRunning",
    queryEndpoint: "/v1beta/{taskId}",
  },
  {
    id: "runway_video",
    label: "Runway Gen-4",
    serviceType: "video",
    protocol: "runway",
    defaultName: "Runway Gen-4 Turbo",
    baseUrl: "https://api.dev.runwayml.com",
    models: ["gen4_turbo", "gen3a_turbo"],
    submitEndpoint: "/v1/image_to_video",
    queryEndpoint: "/v1/tasks/{taskId}",
  },
  {
    id: "openai_video",
    label: "OpenAI Sora / 兼容视频网关",
    serviceType: "video",
    protocol: "openai-compatible",
    defaultName: "Sora / 兼容视频网关",
    baseUrl: "https://api.openai.com/v1",
    models: ["sora-2", "sora-2-pro"],
    submitEndpoint: "/v1/videos",
    queryEndpoint: "/v1/videos/{taskId}",
  },
  {
    id: "custom_video",
    label: "自定义视频厂商 / 聚合网关",
    serviceType: "video",
    protocol: "openai-compatible",
    defaultName: "自定义视频网关",
    baseUrl: "",
    models: [],
    submitEndpoint: "/v1/videos/generations",
    queryEndpoint: "/v1/video/tasks/{taskId}",
  },
] as const;

export type ModelProfilePublic = {
  id: string;
  serviceType: ModelServiceType;
  vendor: string;
  protocol: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  submitEndpoint: string;
  queryEndpoint: string;
  supportsMultiImage: boolean;
  isDefault: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint: string;
  updatedAt: string;
};

type ModelProfileRow = {
  id: string;
  service_type: ModelServiceType;
  vendor: string;
  protocol: string;
  name: string;
  base_url: string;
  api_key_encrypted: string;
  models_json: string;
  default_model: string;
  submit_endpoint: string;
  query_endpoint: string;
  supports_multi_image: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

let ensured = false;

async function ensureProfilesTable() {
  if (ensured) return;
  const db = await getDb();
  await db.query(`
    UPDATE model_provider_profiles
    SET name = BTRIM(REGEXP_REPLACE(name, '\\s*（已迁移）$', ''))
    WHERE name LIKE '%（已迁移）'
  `);
  ensured = true;
}

/** 首次读取时把历史 app_settings 中的已配置模型无损迁入列表，确保老配置不丢 */
async function seedLegacySettingsIfEmpty() {
  const db = await getDb();
  const countRes = await db.query<{ cnt: string }>(`SELECT COUNT(*)::text AS cnt FROM model_provider_profiles`);
  if (Number(countRes.rows[0]?.cnt || 0) > 0) return;

  const [ai, img, vid] = await Promise.all([
    loadAIProviderConfig(),
    loadImageProviderConfig(),
    loadVideoProviderConfig(),
  ]);

  const toSeed: Array<{
    serviceType: ModelServiceType;
    vendor: string;
    protocol: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
  }> = [];

  if (ai.hasSavedSettings && ai.provider !== "template") {
    toSeed.push({
      serviceType: "text",
      vendor: ai.provider,
      protocol: ai.provider,
      name: `${ai.model || ai.provider}`,
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
      defaultModel: ai.model,
    });
  }
  if (img.hasSavedSettings && img.provider !== "template") {
    toSeed.push({
      serviceType: "image",
      vendor: img.provider,
      protocol: img.provider,
      name: `${img.model || img.provider}`,
      baseUrl: img.baseUrl,
      apiKey: img.apiKey,
      defaultModel: img.model,
    });
  }
  if (vid.hasSavedSettings && vid.provider !== "template") {
    toSeed.push({
      serviceType: "video",
      vendor: vid.provider,
      protocol: vid.provider,
      name: `${vid.model || vid.provider}`,
      baseUrl: vid.baseUrl,
      apiKey: vid.apiKey,
      defaultModel: vid.model,
    });
  }

  for (const item of toSeed) {
    const encrypted = item.apiKey ? await encryptSecret(item.apiKey) : "";
    await db.query(
      `INSERT INTO model_provider_profiles (
        id, service_type, vendor, protocol, name, base_url, api_key_encrypted,
        models_json, default_model, is_default
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)`,
      [
        randomUUID(),
        item.serviceType,
        item.vendor,
        item.protocol,
        item.name,
        item.baseUrl,
        encrypted,
        JSON.stringify(item.defaultModel ? [item.defaultModel] : []),
        item.defaultModel,
      ],
    );
  }
}

const VAULT_FILE = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data", "model-profiles.vault.json");

type VaultProfileRecord = {
  id: string;
  service_type: ModelServiceType;
  vendor: string;
  protocol: string;
  name: string;
  base_url: string;
  api_key_encrypted: string;
  models_json: string;
  default_model: string;
  submit_endpoint: string;
  query_endpoint: string;
  supports_multi_image: boolean;
  is_default: boolean;
};

async function syncProfilesVault() {
  try {
    const db = await getDb();
    const res = await db.query<ModelProfileRow>(
      `SELECT * FROM model_provider_profiles ORDER BY is_default DESC, updated_at DESC`,
    );
    const records: VaultProfileRecord[] = res.rows.map((r) => ({
      id: r.id,
      service_type: r.service_type,
      vendor: r.vendor,
      protocol: r.protocol,
      name: r.name,
      base_url: r.base_url,
      api_key_encrypted: r.api_key_encrypted,
      models_json: r.models_json,
      default_model: r.default_model,
      submit_endpoint: r.submit_endpoint,
      query_endpoint: r.query_endpoint,
      supports_multi_image: r.supports_multi_image,
      is_default: r.is_default,
    }));
    await mkdir(path.dirname(VAULT_FILE), { recursive: true });
    const tmp = `${VAULT_FILE}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ schema: "aitrade.model_vault.v1", updatedAt: new Date().toISOString(), profiles: records }, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmp, VAULT_FILE);
  } catch {
    // 镜像写入失败不阻断主流程
  }
}

async function restoreFromVaultIfNeeded() {
  let vaultProfiles: VaultProfileRecord[] = [];
  try {
    const raw = await readFile(VAULT_FILE, "utf8");
    const parsed = JSON.parse(raw) as { profiles?: VaultProfileRecord[] };
    if (Array.isArray(parsed.profiles)) vaultProfiles = parsed.profiles;
  } catch {
    return;
  }
  if (vaultProfiles.length === 0) return;

  const db = await getDb();
  const current = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles`)).rows;

  if (current.length === 0) {
    for (const v of vaultProfiles) {
      await db.query(
        `INSERT INTO model_provider_profiles (
          id, service_type, vendor, protocol, name, base_url, api_key_encrypted,
          models_json, default_model, submit_endpoint, query_endpoint, supports_multi_image, is_default
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (id) DO NOTHING`,
        [
          v.id,
          v.service_type,
          v.vendor,
          v.protocol,
          v.name,
          v.base_url,
          v.api_key_encrypted,
          v.models_json,
          v.default_model,
          v.submit_endpoint,
          v.query_endpoint,
          v.supports_multi_image,
          v.is_default,
        ],
      );
    }
    return;
  }

  // 如果某条记录存在但 api_key_encrypted 为空（如备份恢复后），从本地加密镜像自动回补
  for (const row of current) {
    if (row.api_key_encrypted) continue;
    const match =
      vaultProfiles.find((v) => v.id === row.id && v.api_key_encrypted) ||
      vaultProfiles.find((v) => v.service_type === row.service_type && v.name === row.name && v.base_url === row.base_url && v.api_key_encrypted);
    if (match?.api_key_encrypted) {
      await db.query(
        `UPDATE model_provider_profiles SET api_key_encrypted = $2, updated_at = NOW() WHERE id = $1`,
        [row.id, match.api_key_encrypted],
      );
    }
  }
}

export async function listModelProfiles(): Promise<ModelProfilePublic[]> {
  await ensureProfilesTable();
  await restoreFromVaultIfNeeded();
  await seedLegacySettingsIfEmpty();
  const db = await getDb();
  const res = await db.query<ModelProfileRow>(
    `SELECT * FROM model_provider_profiles ORDER BY is_default DESC, updated_at DESC`,
  );
  if (res.rows.some((r) => Boolean(r.api_key_encrypted))) {
    void syncProfilesVault();
  }
  const out: ModelProfilePublic[] = [];
  for (const row of res.rows) {
    out.push(await toPublicProfile(row));
  }
  return out;
}

export type SaveModelProfileInput = {
  id?: string;
  serviceType: ModelServiceType;
  vendor: string;
  protocol: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  defaultModel: string;
  submitEndpoint?: string;
  queryEndpoint?: string;
  supportsMultiImage?: boolean;
  isDefault?: boolean;
  actor?: string;
};

export async function saveModelProfile(input: SaveModelProfileInput): Promise<ModelProfilePublic> {
  await ensureProfilesTable();
  const serviceType: ModelServiceType =
    input.serviceType === "image" || input.serviceType === "video" ? input.serviceType : "text";
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new Error("请填写配置名称");

  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (input.protocol !== "template") {
    validateBaseUrl(baseUrl);
  }

  const cleanedModels = Array.from(
    new Set(
      input.models
        .map((m) => m.trim())
        .filter(Boolean),
    ),
  );
  const defaultModel = (input.defaultModel.trim() || cleanedModels[0] || "").slice(0, 160);
  if (input.protocol !== "template" && !defaultModel) {
    throw new Error("请至少填写一个模型并选择默认模型");
  }
  if (defaultModel && !cleanedModels.includes(defaultModel)) {
    cleanedModels.unshift(defaultModel);
  }

  const db = await getDb();
  const actor = (input.actor || "本机管理员").trim().slice(0, 80);
  const existing = input.id
    ? (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [input.id])).rows[0]
    : undefined;

  const rawKey = input.apiKey?.trim() || "";
  const encryptedKey = rawKey
    ? await encryptSecret(rawKey)
    : existing?.api_key_encrypted || "";

  // 如果该类型当前还没有默认配置，自动设为默认
  const existingDefaults = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM model_provider_profiles WHERE service_type = $1 AND is_default = TRUE`,
    [serviceType],
  );
  const shouldBeDefault = Boolean(input.isDefault) || Number(existingDefaults.rows[0]?.cnt || 0) === 0;
  const id = existing?.id || randomUUID();

  await db.transaction(async (tx) => {
    if (shouldBeDefault) {
      await tx.query(`UPDATE model_provider_profiles SET is_default = FALSE WHERE service_type = $1`, [serviceType]);
    }
    if (existing) {
      await tx.query(
        `UPDATE model_provider_profiles
         SET service_type = $2, vendor = $3, protocol = $4, name = $5, base_url = $6,
             api_key_encrypted = $7, models_json = $8, default_model = $9,
             submit_endpoint = $10, query_endpoint = $11, supports_multi_image = $12,
             is_default = $13, updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          serviceType,
          input.vendor.trim() || input.protocol,
          input.protocol.trim(),
          name,
          baseUrl,
          encryptedKey,
          JSON.stringify(cleanedModels),
          defaultModel,
          (input.submitEndpoint || "").trim(),
          (input.queryEndpoint || "").trim(),
          Boolean(input.supportsMultiImage),
          shouldBeDefault,
        ],
      );
    } else {
      await tx.query(
        `INSERT INTO model_provider_profiles (
          id, service_type, vendor, protocol, name, base_url, api_key_encrypted,
          models_json, default_model, submit_endpoint, query_endpoint, supports_multi_image, is_default
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          serviceType,
          input.vendor.trim() || input.protocol,
          input.protocol.trim(),
          name,
          baseUrl,
          encryptedKey,
          JSON.stringify(cleanedModels),
          defaultModel,
          (input.submitEndpoint || "").trim(),
          (input.queryEndpoint || "").trim(),
          Boolean(input.supportsMultiImage),
          shouldBeDefault,
        ],
      );
    }

    if (shouldBeDefault) {
      await syncActiveProfileToAppSettings(tx, {
        serviceType,
        protocol: input.protocol.trim(),
        baseUrl,
        defaultModel,
        encryptedKey,
        actor,
      });
    }
  });

  const saved = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [id])).rows[0]!;
  await syncProfilesVault();
  await checkpointDb();
  return toPublicProfile(saved);
}

export async function setDefaultModelProfile(id: string, actor = "本机管理员"): Promise<ModelProfilePublic> {
  await ensureProfilesTable();
  const db = await getDb();
  const row = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error("配置不存在");

  await db.transaction(async (tx) => {
    await tx.query(`UPDATE model_provider_profiles SET is_default = FALSE WHERE service_type = $1`, [row.service_type]);
    await tx.query(`UPDATE model_provider_profiles SET is_default = TRUE, updated_at = NOW() WHERE id = $1`, [id]);
    await syncActiveProfileToAppSettings(tx, {
      serviceType: row.service_type,
      protocol: row.protocol,
      baseUrl: row.base_url,
      defaultModel: row.default_model,
      encryptedKey: row.api_key_encrypted,
      actor,
    });
  });

  const updated = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [id])).rows[0]!;
  return toPublicProfile(updated);
}

export async function deleteModelProfile(id: string): Promise<void> {
  await ensureProfilesTable();
  const db = await getDb();
  const row = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [id])).rows[0];
  if (!row) return;

  await db.transaction(async (tx) => {
    await tx.query(`DELETE FROM model_provider_profiles WHERE id = $1`, [id]);
    if (row.is_default) {
      const next = (
        await tx.query<ModelProfileRow>(
          `SELECT * FROM model_provider_profiles WHERE service_type = $1 ORDER BY updated_at DESC LIMIT 1`,
          [row.service_type],
        )
      ).rows[0];
      if (next) {
        await tx.query(`UPDATE model_provider_profiles SET is_default = TRUE WHERE id = $1`, [next.id]);
        await syncActiveProfileToAppSettings(tx, {
          serviceType: next.service_type,
          protocol: next.protocol,
          baseUrl: next.base_url,
          defaultModel: next.default_model,
          encryptedKey: next.api_key_encrypted,
          actor: "本机管理员",
        });
      }
    }
  });
}

export async function testSavedModelProfile(id: string) {
  await ensureProfilesTable();
  const db = await getDb();
  const row = (await db.query<ModelProfileRow>(`SELECT * FROM model_provider_profiles WHERE id = $1`, [id])).rows[0];
  if (!row) throw new Error("配置不存在");
  const apiKey = row.api_key_encrypted ? (await decryptSecret(row.api_key_encrypted)) || "" : "";

  if (row.service_type === "text") {
    return testAIProviderConnection({
      provider: row.protocol,
      baseUrl: row.base_url,
      model: row.default_model,
      apiKey,
    });
  }
  if (row.service_type === "image") {
    return testImageProviderConnection({
      provider: row.protocol,
      baseUrl: row.base_url,
      model: row.default_model,
      apiKey,
    });
  }
  return testVideoProviderConnection({
    provider: row.protocol,
    baseUrl: row.base_url,
    model: row.default_model,
    apiKey,
  });
}

async function syncActiveProfileToAppSettings(
  tx: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  input: {
    serviceType: ModelServiceType;
    protocol: string;
    baseUrl: string;
    defaultModel: string;
    encryptedKey: string;
    actor: string;
  },
) {
  const prefix = input.serviceType === "text" ? "ai" : input.serviceType === "image" ? "image" : "video";
  const pairs: Array<[string, string]> = [
    [`${prefix}_provider`, input.protocol],
    [`${prefix}_base_url`, input.baseUrl],
    [`${prefix}_model`, input.defaultModel],
    [`${prefix}_api_key`, input.encryptedKey],
  ];
  for (const [key, value] of pairs) {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [key, value, input.actor],
    );
  }
}

async function toPublicProfile(row: ModelProfileRow): Promise<ModelProfilePublic> {
  let models: string[] = [];
  try {
    const parsed = JSON.parse(row.models_json);
    if (Array.isArray(parsed)) models = parsed.filter((m): m is string => typeof m === "string" && Boolean(m));
  } catch {
    models = row.default_model ? [row.default_model] : [];
  }
  const plainKey = row.api_key_encrypted ? (await decryptSecret(row.api_key_encrypted)) || "" : "";
  const hint = plainKey
    ? plainKey.length > 8
      ? `${plainKey.slice(0, 3)}••••${plainKey.slice(-4)}`
      : "••••"
    : "";

  return {
    id: row.id,
    serviceType: row.service_type,
    vendor: row.vendor,
    protocol: row.protocol,
    name: row.name,
    baseUrl: row.base_url,
    models,
    defaultModel: row.default_model,
    submitEndpoint: row.submit_endpoint || "",
    queryEndpoint: row.query_endpoint || "",
    supportsMultiImage: Boolean(row.supports_multi_image),
    isDefault: Boolean(row.is_default),
    apiKeyConfigured: Boolean(plainKey),
    apiKeyHint: hint,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : new Date(row.updated_at).toISOString(),
  };
}
