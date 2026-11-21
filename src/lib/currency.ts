/**
 * 跨境电商权威汇率配置与多币种统一转换中心
 * 基准时间：2026-11-01 · 离线兜底基准（实时汇率与手动覆盖由 fx-rates.ts 管理并注入运行时表）
 */

export type FxRateDefinition = {
  currency: string;
  name: string;
  rateToRmb: number; // 1 外币 = 若干 RMB
  symbol: string;
  source: string;
  effectiveDate: string;
};

export const OFFICIAL_FX_CONFIG: Record<string, FxRateDefinition> = {
  USD: { currency: "USD", name: "美元", rateToRmb: 7.22, symbol: "$", source: "CFETS 官方中间价", effectiveDate: "2026-11-01" },
  EUR: { currency: "EUR", name: "欧元", rateToRmb: 7.85, symbol: "€", source: "ECB 官方基准价", effectiveDate: "2026-11-01" },
  GBP: { currency: "GBP", name: "英镑", rateToRmb: 9.35, symbol: "£", source: "BOE 官方基准价", effectiveDate: "2026-11-01" },
  AUD: { currency: "AUD", name: "澳元", rateToRmb: 4.74, symbol: "A$", source: "RBA 官方基准价", effectiveDate: "2026-11-01" },
  JPY: { currency: "JPY", name: "日元", rateToRmb: 0.0475, symbol: "¥", source: "BOJ 官方基准价", effectiveDate: "2026-11-01" },
  CAD: { currency: "CAD", name: "加元", rateToRmb: 5.28, symbol: "C$", source: "BOC 官方基准价", effectiveDate: "2026-11-01" },
  SGD: { currency: "SGD", name: "新加坡元", rateToRmb: 5.38, symbol: "S$", source: "MAS 官方基准价", effectiveDate: "2026-11-01" },
  MYR: { currency: "MYR", name: "马来西亚林吉特", rateToRmb: 1.62, symbol: "RM", source: "BNM 官方基准价", effectiveDate: "2026-11-01" },
};

export const SUPPORTED_FX_CURRENCIES = Object.keys(OFFICIAL_FX_CONFIG);

// 运行时生效汇率表（由 fx-rates.ts 从数据库/实时接口同步写入）
const runtimeRates = new Map<string, number>();

export function setRuntimeFxRates(rates: Record<string, number>) {
  for (const [rawCode, value] of Object.entries(rates)) {
    const code = rawCode.toUpperCase();
    if (Number.isFinite(value) && value > 0) {
      runtimeRates.set(code, value);
    }
  }
}

export function clearRuntimeFxRates() {
  runtimeRates.clear();
}

export function roundFxRate(currency: string, rate: number): number {
  const code = currency.toUpperCase();
  const decimals = code === "JPY" || rate < 0.5 ? 4 : 4;
  return Number(rate.toFixed(decimals));
}

export function formatFxRate(currency: string, rate: number): string {
  const code = currency.toUpperCase();
  if (!Number.isFinite(rate) || rate <= 0) return "—";
  if (code === "JPY" || rate < 0.5) return rate.toFixed(4);
  // 若后两位都是 0 则显示 2 位（如 7.22），否则最多显示 4 位去尾零（如 7.2345）
  const fixed4 = rate.toFixed(4);
  const trimmed = fixed4.replace(/0+$/, "");
  const dotIdx = trimmed.indexOf(".");
  if (dotIdx === -1) return `${trimmed}.00`;
  const fracLen = trimmed.length - dotIdx - 1;
  return fracLen < 2 ? rate.toFixed(2) : trimmed;
}

/**
 * 获取当前货币对人民币的汇率（优先读取实时/手动生效值，否则回落到官方基准）
 */
export function getFxRate(currency: string): number {
  const code = (currency || "USD").toUpperCase();
  const runtime = runtimeRates.get(code);
  if (runtime && Number.isFinite(runtime) && runtime > 0) return runtime;
  return OFFICIAL_FX_CONFIG[code]?.rateToRmb ?? 7.22;
}

/**
 * 将人民币金额转为目标外币分 (Cents)
 * 例如 35 元人民币转 USD: Math.round((35 / 7.22) * 100) = 485 ¢ ($4.85)
 */
export function convertRmbToForeignCents(amountRmb: number, targetCurrency: string): number {
  const rate = getFxRate(targetCurrency);
  return Math.round((amountRmb / rate) * 100);
}

/**
 * 将外币分 (Cents) 转为人民币
 */
export function convertForeignCentsToRmb(cents: number, currency: string): number {
  const rate = getFxRate(currency);
  return Number(((cents / 100) * rate).toFixed(2));
}
