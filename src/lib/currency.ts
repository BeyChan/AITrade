/**
 * 跨境电商权威汇率配置与多币种统一转换中心
 * 基准时间：2026-11-01 · 汇率来源：中国外汇交易中心 (CFETS) 与欧洲央行 (ECB) 官方基准
 */

export type FxRateDefinition = {
  currency: string;
  rateToRmb: number; // 1 外币 = 若干 RMB
  symbol: string;
  source: string;
  effectiveDate: string;
};

export const OFFICIAL_FX_CONFIG: Record<string, FxRateDefinition> = {
  USD: { currency: "USD", rateToRmb: 7.22, symbol: "$", source: "CFETS 官方中间价", effectiveDate: "2026-11-01" },
  AUD: { currency: "AUD", rateToRmb: 4.74, symbol: "A$", source: "RBA 官方基准价", effectiveDate: "2026-11-01" },
  EUR: { currency: "EUR", rateToRmb: 7.85, symbol: "€", source: "ECB 官方基准价", effectiveDate: "2026-11-01" },
  GBP: { currency: "GBP", rateToRmb: 9.35, symbol: "£", source: "BOE 官方基准价", effectiveDate: "2026-11-01" },
  JPY: { currency: "JPY", rateToRmb: 0.0475, symbol: "¥", source: "BOJ 官方基准价", effectiveDate: "2026-11-01" },
  CAD: { currency: "CAD", rateToRmb: 5.28, symbol: "C$", source: "BOC 官方基准价", effectiveDate: "2026-11-01" },
};

/**
 * 将人民币金额转为目标外币分 (Cents)
 * 例如 35 元人民币转 USD: Math.round((35 / 7.22) * 100) = 485 ¢ ($4.85)
 */
export function convertRmbToForeignCents(amountRmb: number, targetCurrency: string): number {
  const config = OFFICIAL_FX_CONFIG[targetCurrency.toUpperCase()] || OFFICIAL_FX_CONFIG.USD;
  return Math.round((amountRmb / config.rateToRmb) * 100);
}

/**
 * 将外币分 (Cents) 转为人民币
 */
export function convertForeignCentsToRmb(cents: number, currency: string): number {
  const config = OFFICIAL_FX_CONFIG[currency.toUpperCase()] || OFFICIAL_FX_CONFIG.USD;
  return Number(((cents / 100) * config.rateToRmb).toFixed(2));
}

/**
 * 获取当前货币对人民币的汇率
 */
export function getFxRate(currency: string): number {
  return OFFICIAL_FX_CONFIG[currency.toUpperCase()]?.rateToRmb ?? 7.22;
}
