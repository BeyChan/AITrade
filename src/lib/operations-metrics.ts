/**
 * P3.0 确定性经营口径内核。
 *
 * 只做纯计算：不读数据库、不调模型、不假设任何真实报表字段。金额一律使用
 * 整数「分」，与 economics.ts 保持一致。所有阈值（观察窗口、断货下限、异常
 * 上限、最小分母）都由调用方传入：在拿到真实结算单和库存快照校准之前，
 * 这里不内置任何业务默认值，也不生成行动建议。
 */

const cents = (value: number) => Math.round(value);

/**
 * 财务入口不接受 NaN / Infinity。来自 CSV 或 JSON 的坏值必须显式失败，
 * 否则静默按 0 处理会把「解析失败」伪装成「没有收入」。
 */
function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

/** 把 cost_models 的单件预测折算成「同一周期 × 实际销量 × 同一币种」的总量。 */
export type FoldForecastInput = {
  unitNetProfitCents: number;
  actualUnits: number;
  costModelVersion: string;
  forecastCurrency: string;
  reportingCurrency: string;
  /** forecastCurrency -> reportingCurrency；同币种时恒为 1，异币种必填。 */
  fxRate?: number;
};

export type FoldedForecast = {
  foldedProfitCents: number;
  actualUnits: number;
  costModelVersion: string;
  fxRate: number;
  currency: string;
};

export function foldForecastToPeriod(input: FoldForecastInput): FoldedForecast {
  const units = Math.max(0, requireFinite(input.actualUnits, "actualUnits"));
  const unitProfit = requireFinite(input.unitNetProfitCents, "unitNetProfitCents");
  const sameCurrency = input.forecastCurrency === input.reportingCurrency;
  const fxRate = sameCurrency ? 1 : (input.fxRate ?? Number.NaN);

  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    throw new Error("cross-currency forecast requires a positive fxRate");
  }

  return {
    foldedProfitCents: cents(unitProfit * units * fxRate),
    actualUnits: units,
    costModelVersion: input.costModelVersion,
    fxRate,
    currency: input.reportingCurrency,
  };
}

export type ForecastVarianceInput = {
  actualProfitCents: number;
  foldedForecastProfitCents: number;
  /** 由调用方按真实样本校准后传入；本模块不内置阈值。 */
  minDenominatorCents: number;
};

export type ForecastVariance = {
  differenceCents: number;
  ratio: number | null;
  ratioSuppressed: boolean;
  minDenominatorCents: number;
};

/** 预测误差必须建立在已折算的预测上；分母趋零时只给绝对差额。 */
export function forecastVariance(input: ForecastVarianceInput): ForecastVariance {
  const actual = requireFinite(input.actualProfitCents, "actualProfitCents");
  const forecast = requireFinite(input.foldedForecastProfitCents, "foldedForecastProfitCents");
  const min = Math.max(0, requireFinite(input.minDenominatorCents, "minDenominatorCents"));
  const denominator = Math.abs(forecast);
  const suppressed = denominator === 0 || denominator < min;
  const differenceCents = actual - forecast;

  return {
    differenceCents,
    ratio: suppressed ? null : differenceCents / denominator,
    ratioSuppressed: suppressed,
    minDenominatorCents: min,
  };
}

export const CONTRIBUTION_COST_KEYS = [
  "purchaseLanded",
  "platformFee",
  "fulfillmentFee",
  "adCost",
  "returnLoss",
  "storage",
  "longTermStorage",
  "removalFee",
  "couponDealFee",
  "vatOrSalesTax",
  "fxLoss",
  "other",
] as const;

export type ContributionCostKey = (typeof CONTRIBUTION_COST_KEYS)[number];

export type ContributionInput = {
  netRevenueCents: number;
  /** 正数记费用，负数记冲正 / 赔付等加回项。 */
  costsCents: Partial<Record<ContributionCostKey, number>>;
  /** 平台结算净额里已经扣掉的费用，不允许再减一次。 */
  alreadyDeductedInSettlement?: readonly ContributionCostKey[];
};

export type ContributionResult = {
  netRevenueCents: number;
  contributionProfitCents: number;
  /** 实际计入的费用净额（含负数冲正），用于和结算单对账。 */
  chargedCents: number;
  /** 只列出确实出现在本次费用里、且被判定为已在结算净额扣除的项。 */
  skippedKeys: ContributionCostKey[];
};

export function contributionProfit(input: ContributionInput): ContributionResult {
  const deducted = new Set<ContributionCostKey>(input.alreadyDeductedInSettlement ?? []);
  const skippedKeys: ContributionCostKey[] = [];
  let chargedCents = 0;

  for (const key of CONTRIBUTION_COST_KEYS) {
    const raw = input.costsCents[key];
    if (raw === undefined) continue;
    const amount = requireFinite(raw, `costsCents.${key}`);
    if (deducted.has(key)) {
      skippedKeys.push(key);
      continue;
    }
    // 结算单里的冲正 / 赔付是负数，属于加回项，不能被 clamp 成 0 丢掉。
    chargedCents += amount;
  }

  const netRevenueCents = requireFinite(input.netRevenueCents, "netRevenueCents");
  return {
    netRevenueCents,
    contributionProfitCents: netRevenueCents - chargedCents,
    chargedCents,
    skippedKeys,
  };
}

/** 盈亏平衡 ACOS 是「广告前贡献毛利率」，不是绝对金额。 */
export function breakEvenAcos(preAdContributionMarginRate: number): number {
  return Math.min(1, Math.max(0, requireFinite(preAdContributionMarginRate, "preAdContributionMarginRate")));
}

export type AdEfficiencyInput = {
  adSpendCents: number;
  adAttributedSalesCents: number;
  totalSalesCents: number;
  /** 广告平台的归因窗口必须显式记录，不能与结算周期隐式对齐。 */
  attributionWindowDays: number;
};

export type AdEfficiency = {
  acos: number | null;
  tacos: number | null;
  attributionWindowDays: number;
};

export function adEfficiency(input: AdEfficiencyInput): AdEfficiency {
  const window = requireFinite(input.attributionWindowDays, "attributionWindowDays");
  if (window <= 0) {
    throw new Error("attributionWindowDays must be positive");
  }
  const spend = Math.max(0, requireFinite(input.adSpendCents, "adSpendCents"));
  const attributed = Math.max(0, requireFinite(input.adAttributedSalesCents, "adAttributedSalesCents"));
  const total = Math.max(0, requireFinite(input.totalSalesCents, "totalSalesCents"));
  return {
    acos: attributed > 0 ? spend / attributed : null,
    tacos: total > 0 ? spend / total : null,
    attributionWindowDays: window,
  };
}

export type InventoryDaysInput = {
  availableUnits: number;
  /** 按时间升序的最近每日销量，单位：件。 */
  dailySales: readonly number[];
  windowDays: number;
  /** 断货期日均下限，由调用方按真实样本校准后传入。 */
  minDailySales: number;
  /** 可选的单日销量上限，用于剔除促销异常日。 */
  outlierCap?: number;
};

export type InventoryDaysResult = {
  days: number;
  windowDays: number;
  usedDays: number;
  averageDailySales: number;
  fallbackApplied: boolean;
  clampedDays: number;
};

export function inventoryDays(input: InventoryDaysInput): InventoryDaysResult {
  const windowDays = Math.max(1, Math.floor(requireFinite(input.windowDays, "windowDays")));
  const minDailySales = Math.max(0, requireFinite(input.minDailySales, "minDailySales"));
  const cap = Math.max(
    minDailySales,
    input.outlierCap === undefined
      ? Number.POSITIVE_INFINITY
      : requireFinite(input.outlierCap, "outlierCap"),
  );
  const series = input.dailySales
    .slice(-windowDays)
    .map((value, index) => Math.max(0, requireFinite(value, `dailySales[${index}]`)));
  const usedDays = series.length;
  const normalized = series.map((value) => Math.min(Math.max(value, minDailySales), cap));
  const clampedDays = normalized.filter((value, index) => value !== series[index]).length;
  const averageDailySales =
    usedDays > 0 ? normalized.reduce((sum, value) => sum + value, 0) / usedDays : minDailySales;
  const availableUnits = Math.max(0, requireFinite(input.availableUnits, "availableUnits"));

  return {
    days: averageDailySales > 0 ? availableUnits / averageDailySales : 0,
    windowDays,
    usedDays,
    averageDailySales,
    fallbackApplied: usedDays < windowDays,
    clampedDays,
  };
}

export type PeriodPolicy = "settlement" | "order";

export type AssignPeriodInput = {
  /** YYYY-MM-DD，站点日历；本模块不使用服务器本地时区。 */
  orderDate: string;
  settlementDate: string;
  policy: PeriodPolicy;
};

const SITE_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 只接受真实存在的日历日期，避免 2026-02-30 这类脏数据被悄悄归到某个月。 */
function siteMonth(date: string): string {
  const match = SITE_DATE.exec(date);
  if (!match) {
    throw new Error(`invalid site-calendar date: ${date}`);
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`invalid site-calendar date: ${date}`);
  }
  return `${yearText}-${monthText}`;
}

/** 结算周期（收付实现制）与订单月（权责发生制）必须分列，不混用。 */
export function assignPeriod(input: AssignPeriodInput): { periodKey: string; policy: PeriodPolicy } {
  const date = input.policy === "settlement" ? input.settlementDate : input.orderDate;
  return { periodKey: siteMonth(date), policy: input.policy };
}
