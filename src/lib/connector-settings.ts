import { randomUUID } from "node:crypto";
import { decryptSecret, encryptSecret } from "./app-settings.ts";
import { getDb } from "./db.ts";
import type { ConnectorEnv } from "./connectors/diagnostics.ts";
import { getConnectorReadiness } from "./connectors/registry.ts";
import { registerConnectorSecrets } from "./connectors/security.ts";

/**
 * 连接器凭证的界面设置。
 * 值经 AES-256-GCM 加密后写入 app_settings，页面永不回显；读取时合并到环境变量之上。
 * 语义与「设置页 AI 配置」一致：界面值优先，环境变量作为回退。
 */

const KEY_PREFIX = "connector.";

export type ConnectorFieldStatus = {
  name: string;
  sensitive: boolean;
  source: "ui" | "environment" | "none";
};

export type ConnectorSettingsStatus = {
  code: string;
  fields: ConnectorFieldStatus[];
  hasUiSettings: boolean;
};

type SettingRow = { key: string; value: string };

function settingKey(code: string, name: string) {
  return `${KEY_PREFIX}${code}.${name}`;
}

function parseSettingKey(key: string): { code: string; name: string } | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const raw = key.slice(KEY_PREFIX.length);
  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return null;
  return { code: raw.slice(0, dot), name: raw.slice(dot + 1) };
}

export function isSensitiveConnectorField(name: string) {
  return /SECRET|TOKEN|API_KEY|PASSWORD|REFRESH/.test(name);
}

function knownConnectorCodes() {
  return getConnectorReadiness({}).filter((item) => item.credentialEnv.length > 0);
}

function assertKnownConnector(code: string) {
  const definition = knownConnectorCodes().find((item) => item.code === code);
  if (!definition) throw new Error("未知的连接器或该连接器无需凭证");
  return definition;
}

async function readSettingRows(): Promise<SettingRow[]> {
  const db = await getDb();
  const result = await db.query<SettingRow>(
    "SELECT key, value FROM app_settings WHERE key LIKE $1",
    [`${KEY_PREFIX}%`],
  );
  return result.rows;
}

/** 合并后的凭证视图：界面配置覆盖同名环境变量，供 readiness 与只读诊断使用 */
export async function loadConnectorEnv(): Promise<ConnectorEnv> {
  const rows = await readSettingRows();
  const merged: Record<string, string | undefined> = { ...process.env };
  const runtimeSecrets: string[] = [];
  for (const row of rows) {
    const parsed = parseSettingKey(row.key);
    if (!parsed) continue;
    const value = await decryptSecret(row.value);
    if (!value) continue;
    merged[parsed.name] = value;
    runtimeSecrets.push(value);
  }
  // 界面凭证也必须进入错误信息脱敏列表，避免通过同步/诊断报错回显
  registerConnectorSecrets(runtimeSecrets);
  return merged;
}

/** 页面展示用：只返回是否已配置与来源，不返回任何凭证值 */
export async function getConnectorSettingsStatus(): Promise<Map<string, ConnectorSettingsStatus>> {
  const rows = await readSettingRows();
  const uiKeys = new Set(rows.map((row) => row.key));
  const result = new Map<string, ConnectorSettingsStatus>();
  for (const definition of knownConnectorCodes()) {
    const fields = definition.credentialEnv.map((name) => ({
      name,
      sensitive: isSensitiveConnectorField(name),
      source: uiKeys.has(settingKey(definition.code, name))
        ? ("ui" as const)
        : process.env[name]?.trim()
          ? ("environment" as const)
          : ("none" as const),
    }));
    result.set(definition.code, {
      code: definition.code,
      fields,
      hasUiSettings: fields.some((field) => field.source === "ui"),
    });
  }
  return result;
}

/** 保存界面配置：留空字段保持原值，只记录字段名不记录值 */
export async function saveConnectorSettings(
  code: string,
  values: Record<string, string | undefined>,
  actor: string,
): Promise<number> {
  const definition = assertKnownConnector(code);
  const entries = definition.credentialEnv
    .map((name) => ({ name, value: String(values[name] ?? "").trim() }))
    .filter((entry) => entry.value.length > 0);
  if (entries.length === 0) throw new Error("没有填写新值；留空表示保留已保存的配置");
  if (entries.some((entry) => entry.value.length > 2_000)) throw new Error("单个凭证长度不能超过 2000 字符");

  const operator = actor.trim() || "本机管理员";
  const db = await getDb();
  await db.transaction(async (tx) => {
    for (const entry of entries) {
      const encrypted = await encryptSecret(entry.value);
      await tx.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [settingKey(code, entry.name), encrypted, operator],
      );
    }
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'connector.settings_saved', 'data_source', $3, $4::jsonb)`,
      [
        randomUUID(),
        operator,
        code,
        JSON.stringify({ fields: entries.map((entry) => entry.name), credentialsExposed: false }),
      ],
    );
  });
  return entries.length;
}

/** 清除某个连接器的界面配置，回到环境变量 / 未配置状态 */
export async function clearConnectorSettings(code: string, actor: string): Promise<number> {
  assertKnownConnector(code);
  const operator = actor.trim() || "本机管理员";
  const db = await getDb();
  const removed = await db.query<{ key: string }>(
    "DELETE FROM app_settings WHERE key LIKE $1 RETURNING key",
    [`${settingKey(code, "")}%`],
  );
  if (removed.rows.length === 0) throw new Error("当前没有界面保存的配置");
  await db.query(
    `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'connector.settings_cleared', 'data_source', $3, $4::jsonb)`,
    [
      randomUUID(),
      operator,
      code,
      JSON.stringify({ fieldsRemoved: removed.rows.length, credentialsExposed: false }),
    ],
  );
  return removed.rows.length;
}
