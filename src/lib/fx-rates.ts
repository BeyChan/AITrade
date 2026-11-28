import { randomUUID } from "node:crypto";
import { isDemoMode, resolveAppMode, type AppMode, type ModeOptions } from "./app-mode.ts";
import { getDb } from "./db.ts";
import {
  OFFICIAL_FX_CONFIG,
  SUPPORTED_FX_CURRENCIES,
  roundFxRate,
  setRuntimeFxRates,
} from "./currency.ts";

export type FxRateMode = "manual" | "live" | "default";

export type FxRateItem = {
  currency: string;
  name: string;
  symbol: string;
  rateToRmb: number;
  liveRateToRmb: number | null;
  manualRateToRmb: number | null;
  defaultRateToRmb: number;
  mode: FxRateMode;
  source: string;
  updatedAt: string;
};

export type FxRatesSnapshot = {
  mode: AppMode;
  items: FxRateItem[];
  byCurrency: Record<string, FxRateItem>;
  liveUpdatedAt: string | null;
  liveProvider: string | null;
  isLiveStale: boolean;
};

type StoredLiveRates = {
  updatedAt: string;
  provider: string;
  rates: Record<string, number>;
};

type StoredManualOverride = {
  rateToRmb: number;
  updatedAt: string;
  updatedBy: string;
};

type StoredManualMap = Record<string, StoredManualOverride>;

const LIVE_RATES_KEY = "fx_live_rates_json";
const MANUAL_OVERRIDES_KEY = "fx_manual_overrides_json";
const LIVE_STALE_MS = 6 * 60 * 60 * 1000; // 6 小时

function normalizeCurrency(code: string): string {
  const upper = (code || "").trim().toUpperCase();
  if (!OFFICIAL_FX_CONFIG[upper]) {
    throw new Error(`暂不支持的币种：${code}`);
  }
  return upper;
}

function parseJsonSafe<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readStoredFxSettings(mode: AppMode): Promise<{
  live: StoredLiveRates | null;
  manual: StoredManualMap;
}> {
  const db = await getDb();
  const result = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key = ANY($1::text[]) AND is_demo = $2`,
    [[LIVE_RATES_KEY, MANUAL_OVERRIDES_KEY], isDemoMode(mode)],
  );
  const map = new Map(result.rows.map((row) => [row.key, row.value]));
  const live = parseJsonSafe<StoredLiveRates>(map.get(LIVE_RATES_KEY));
  const manual = parseJsonSafe<StoredManualMap>(map.get(MANUAL_OVERRIDES_KEY)) ?? {};
  return { live, manual };
}

function buildSnapshot(live: StoredLiveRates | null, manual: StoredManualMap, mode: AppMode): FxRatesSnapshot {
  const items: FxRateItem[] = [];
  const byCurrency: Record<string, FxRateItem> = {};
  const runtimeMap: Record<string, number> = {};

  for (const code of SUPPORTED_FX_CURRENCIES) {
    const def = OFFICIAL_FX_CONFIG[code];
    const liveVal =
      live?.rates && Number.isFinite(live.rates[code]) && live.rates[code] > 0
        ? roundFxRate(code, live.rates[code])
        : null;
    const manualEntry = manual[code];
    const manualVal =
      manualEntry && Number.isFinite(manualEntry.rateToRmb) && manualEntry.rateToRmb > 0
        ? roundFxRate(code, manualEntry.rateToRmb)
        : null;

    let mode: FxRateMode = "default";
    let rateToRmb = def.rateToRmb;
    let source = def.source;
    let updatedAt = def.effectiveDate;

    if (manualVal !== null) {
      mode = "manual";
      rateToRmb = manualVal;
      source = `手动锁定 (${manualEntry.updatedBy || "用户"})`;
      updatedAt = manualEntry.updatedAt || new Date().toISOString();
    } else if (liveVal !== null) {
      mode = "live";
      rateToRmb = liveVal;
      source = live?.provider || "实时外汇接口";
      updatedAt = live?.updatedAt || new Date().toISOString();
    }

    const item: FxRateItem = {
      currency: code,
      name: def.name,
      symbol: def.symbol,
      rateToRmb,
      liveRateToRmb: liveVal,
      manualRateToRmb: manualVal,
      defaultRateToRmb: def.rateToRmb,
      mode,
      source,
      updatedAt,
    };
    items.push(item);
    byCurrency[code] = item;
    runtimeMap[code] = rateToRmb;
  }

  setRuntimeFxRates(runtimeMap, mode);

  const liveTimestamp = live?.updatedAt ? Date.parse(live.updatedAt) : Number.NaN;
  const isLiveStale = !Number.isFinite(liveTimestamp) || Date.now() - liveTimestamp > LIVE_STALE_MS;

  return {
    mode,
    items,
    byCurrency,
    liveUpdatedAt: live?.updatedAt ?? null,
    liveProvider: live?.provider ?? null,
    isLiveStale,
  };
}

export async function getFxRatesSnapshot(options?: ModeOptions): Promise<FxRatesSnapshot> {
  const mode = await resolveAppMode(options?.mode);
  const { live, manual } = await readStoredFxSettings(mode);
  return buildSnapshot(live, manual, mode);
}

export async function getEffectiveFxRate(currency: string, options?: ModeOptions): Promise<number> {
  const code = (currency || "USD").trim().toUpperCase();
  const snapshot = await getFxRatesSnapshot(options);
  return snapshot.byCurrency[code]?.rateToRmb ?? OFFICIAL_FX_CONFIG[code]?.rateToRmb ?? 7.22;
}

async function fetchFromOpenErApi(): Promise<{ provider: string; rates: Record<string, number> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/CNY", {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result !== "success" || !data.rates) {
      throw new Error("返回格式无效");
    }
    const parsed: Record<string, number> = {};
    for (const code of SUPPORTED_FX_CURRENCIES) {
      const cnyToForeign = data.rates[code];
      if (Number.isFinite(cnyToForeign) && cnyToForeign > 0) {
        parsed[code] = roundFxRate(code, 1 / cnyToForeign);
      }
    }
    if (Object.keys(parsed).length === 0) {
      throw new Error("未解析到有效币种汇率");
    }
    return { provider: "Open Exchange Rates (实时)", rates: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromFrankfurter(): Promise<{ provider: string; rates: Record<string, number> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const targets = SUPPORTED_FX_CURRENCIES.join(",");
    const res = await fetch(`https://api.frankfurter.app/latest?from=CNY&to=${encodeURIComponent(targets)}`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { rates?: Record<string, number> };
    if (!data.rates) throw new Error("返回格式无效");
    const parsed: Record<string, number> = {};
    for (const code of SUPPORTED_FX_CURRENCIES) {
      const cnyToForeign = data.rates[code];
      if (Number.isFinite(cnyToForeign) && cnyToForeign > 0) {
        parsed[code] = roundFxRate(code, 1 / cnyToForeign);
      }
    }
    if (Object.keys(parsed).length === 0) {
      throw new Error("未解析到有效币种汇率");
    }
    return { provider: "ECB / Frankfurter (实时)", rates: parsed };
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshLiveFxRates(
  actorInput = "本机管理员",
  recordAudit = true,
  options?: ModeOptions,
): Promise<{
  snapshot: FxRatesSnapshot;
  refreshed: boolean;
  error?: string;
}> {
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const actor = actorInput.trim().slice(0, 80) || "本机管理员";
  let fetched: { provider: string; rates: Record<string, number> } | null = null;
  let lastError = "";

  try {
    fetched = await fetchFromOpenErApi();
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    try {
      fetched = await fetchFromFrankfurter();
    } catch (err2) {
      lastError = err2 instanceof Error ? err2.message : String(err2);
    }
  }

  if (!fetched) {
    const snapshot = await getFxRatesSnapshot({ mode });
    return {
      snapshot,
      refreshed: false,
      error: `实时汇率拉取失败（${lastError || "网络不可达"}），当前继续使用已缓存/基准汇率`,
    };
  }

  const nowIso = new Date().toISOString();
  const payload: StoredLiveRates = {
    updatedAt: nowIso,
    provider: fetched.provider,
    rates: fetched.rates,
  };

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at, is_demo)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (key, is_demo) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [LIVE_RATES_KEY, JSON.stringify(payload), actor, demo],
    );
    if (recordAudit) {
      await tx.query(
        `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
         VALUES ($1, $2, 'fx.live_rates_refreshed', 'fx_rate', 'ALL', $3::jsonb, $4)`,
        [
          randomUUID(),
          actor,
          JSON.stringify({
            provider: fetched.provider,
            count: Object.keys(fetched.rates).length,
            usdRateToRmb: fetched.rates.USD ?? null,
          }),
          demo,
        ],
      );
    }
  });

  const { manual } = await readStoredFxSettings(mode);
  return {
    snapshot: buildSnapshot(payload, manual, mode),
    refreshed: true,
  };
}

export async function setManualFxRate(input: {
  currency: string;
  rateToRmb: number;
  actor?: string;
}, options?: ModeOptions): Promise<FxRatesSnapshot> {
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const code = normalizeCurrency(input.currency);
  const rawRate = Number(input.rateToRmb);
  if (!Number.isFinite(rawRate) || rawRate <= 0 || rawRate > 10000) {
    throw new Error("请输入大于 0 且不超过 10000 的有效汇率");
  }
  const rateToRmb = roundFxRate(code, rawRate);
  const actor = (input.actor || "本机管理员").trim().slice(0, 80) || "本机管理员";

  const { live, manual } = await readStoredFxSettings(mode);
  const previousSnapshot = buildSnapshot(live, manual, mode);
  const previousRateToRmb = previousSnapshot.byCurrency[code]?.rateToRmb ?? OFFICIAL_FX_CONFIG[code].rateToRmb;
  const nextManual: StoredManualMap = {
    ...manual,
    [code]: {
      rateToRmb,
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    },
  };

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at, is_demo)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (key, is_demo) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [MANUAL_OVERRIDES_KEY, JSON.stringify(nextManual), actor, demo],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'fx.manual_rate_set', 'fx_rate', $3, $4::jsonb, $5)`,
      [randomUUID(), actor, code, JSON.stringify({ currency: code, previousRateToRmb, rateToRmb }), demo],
    );
  });

  return buildSnapshot(live, nextManual, mode);
}

export async function clearManualFxRate(input: {
  currency: string;
  actor?: string;
}, options?: ModeOptions): Promise<FxRatesSnapshot> {
  const mode = await resolveAppMode(options?.mode);
  const demo = isDemoMode(mode);
  const code = normalizeCurrency(input.currency);
  const actor = (input.actor || "本机管理员").trim().slice(0, 80) || "本机管理员";

  const { live, manual } = await readStoredFxSettings(mode);
  const previousManualRateToRmb = manual[code]?.rateToRmb ?? null;
  const nextManual: StoredManualMap = { ...manual };
  delete nextManual[code];
  const nextSnapshot = buildSnapshot(live, nextManual, mode);

  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at, is_demo)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (key, is_demo) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [MANUAL_OVERRIDES_KEY, JSON.stringify(nextManual), actor, demo],
    );
    await tx.query(
      `INSERT INTO audit_logs (id, actor, action, entity_type, entity_id, details, is_demo)
       VALUES ($1, $2, 'fx.manual_rate_cleared', 'fx_rate', $3, $4::jsonb, $5)`,
      [
        randomUUID(),
        actor,
        code,
        JSON.stringify({
          currency: code,
          previousRateToRmb: previousManualRateToRmb,
          rateToRmb: nextSnapshot.byCurrency[code]?.rateToRmb ?? OFFICIAL_FX_CONFIG[code].rateToRmb,
        }),
        demo,
      ],
    );
  });

  return nextSnapshot;
}
