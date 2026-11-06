/**
 * P3.0 导入契约与结算归集（纯函数层）。
 *
 * 只定义「归一化之后」的内部契约与归集规则：不解析平台 CSV 列名（由
 * `report-adapters.ts` 承担）、不读库、不建表、不启用阈值。列名映射依据平台公开
 * 报表规范，但金额与行组合仍须用真实结算单和库存快照核对；校准前不得把本契约
 * 直接接入 `ingestion_runs` / `evidence_snapshots` 写入通道。
 */
import {
  CONTRIBUTION_COST_KEYS,
  assertSiteDate,
  assignPeriod,
  contributionProfit,
  foldForecastToPeriod,
  forecastVariance,
  type ContributionCostKey,
  type ContributionResult,
  type FoldedForecast,
  type ForecastVariance,
  type PeriodPolicy,
} from "./operations-metrics.ts";

export class ReportContractError extends Error {
  constructor(field: string, message: string) {
    super(`${field}: ${message}`);
    this.name = "ReportContractError";
  }
}

/** 一次导入批次的公共契约，对应方案 7.3 的必填字段。 */
export type ReportBatch = {
  ingestionRunId: string;
  /** 原始文件内容的 sha256，与 ingestion.ts 的 evidence_snapshots 一致。 */
  rawHash: string;
  marketplaceCode: string;
  /** IANA 时区；日期一律按站点日历解释，不用服务器本地时区。 */
  reportTimezone: string;
  periodStart: string;
  periodEnd: string;
  observedAt: string;
  currency: string;
  /** 站点币种 → 本位币；跨币种必填，同币种不得填 1 以外的值。 */
  fxRate?: number;
  fxRateDate?: string;
};

export type SettlementLineKind = "revenue" | "refund" | "discount" | ContributionCostKey;

export const SETTLEMENT_LINE_KINDS: readonly SettlementLineKind[] = [
  "revenue",
  "refund",
  "discount",
  ...CONTRIBUTION_COST_KEYS,
];

/**
 * 归一化后的结算行。金额是站点币种原值的整数「分」：
 * 费用/退款/折扣记正数，平台冲正或赔付记负数（作为加回项）。
 */
export type NormalizedSettlementLine = {
  batch: ReportBatch;
  settlementId: string;
  /** 平台侧 SKU 标识；到内部商品的映射由 channel_sku_mappings 负责，不在这里猜。 */
  skuKey: string;
  orderDate: string;
  settlementDate: string;
  kind: SettlementLineKind;
  amountCents: number;
  /** 收入/退款行的件数，用于把单件预测折算成周期总量。 */
  units?: number;
  /** 该费用是否已包含在结算净额里；为真时不再从净销售额中扣一次。 */
  deductedInSettlement?: boolean;
};

export type NormalizedInventorySnapshot = {
  batch: ReportBatch;
  skuKey: string;
  snapshotDate: string;
  availableUnits: number;
  reservedUnits?: number;
  inTransitUnits?: number;
  unsellableUnits?: number;
  /** 同一 SKU 的多个平台标识（ASIN / FNSKU / MSKU），供多对一映射使用。 */
  externalIds?: Record<string, string>;
};

function requireText(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ReportContractError(field, "must be a non-empty string");
  }
  return value.trim();
}

function requireDate(value: string, field: string): string {
  const text = requireText(value, field);
  try {
    assertSiteDate(text);
  } catch {
    throw new ReportContractError(field, `invalid site-calendar date: ${text}`);
  }
  return text;
}

function requireCurrency(value: string, field: string): string {
  const text = requireText(value, field).toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) {
    throw new ReportContractError(field, "must be a 3-letter currency code");
  }
  return text;
}

function requireTimezone(value: string, field: string): string {
  const text = requireText(value, field);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text }).format(new Date(0));
  } catch {
    throw new ReportContractError(field, `invalid IANA timezone: ${text}`);
  }
  return text;
}

function requireNonNegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ReportContractError(field, "must be a finite non-negative number");
  }
  return value;
}

/** 校验一批报表文件的公共契约；reportingCurrency 是本位币代码。 */
export function validateReportBatch(batch: ReportBatch, reportingCurrency: string): ReportBatch {
  if (!batch || typeof batch !== "object") {
    throw new ReportContractError("batch", "must be an object");
  }
  requireText(batch.ingestionRunId, "ingestionRunId");
  requireText(batch.rawHash, "rawHash");
  requireText(batch.marketplaceCode, "marketplaceCode");
  requireTimezone(batch.reportTimezone, "reportTimezone");

  const currency = requireCurrency(batch.currency, "currency");
  const base = requireCurrency(reportingCurrency, "reportingCurrency");
  const start = requireDate(batch.periodStart, "periodStart");
  const end = requireDate(batch.periodEnd, "periodEnd");
  requireDate(batch.observedAt, "observedAt");
  if (start > end) {
    throw new ReportContractError("periodEnd", "must not be earlier than periodStart");
  }

  if (currency === base) {
    if (batch.fxRate !== undefined && batch.fxRate !== 1) {
      throw new ReportContractError("fxRate", "same-currency batches must not apply a rate other than 1");
    }
  } else {
    if (!Number.isFinite(batch.fxRate) || (batch.fxRate ?? 0) <= 0) {
      throw new ReportContractError("fxRate", "cross-currency batches require a positive fxRate");
    }
    requireDate(batch.fxRateDate ?? "", "fxRateDate");
  }

  return { ...batch, currency };
}

export function validateSettlementLine(line: NormalizedSettlementLine, reportingCurrency: string): void {
  if (!line || typeof line !== "object") {
    throw new ReportContractError("line", "must be an object");
  }
  validateReportBatch(line.batch, reportingCurrency);
  requireText(line.settlementId, "settlementId");
  requireText(line.skuKey, "skuKey");
  requireDate(line.orderDate, "orderDate");
  requireDate(line.settlementDate, "settlementDate");
  if (!SETTLEMENT_LINE_KINDS.includes(line.kind)) {
    throw new ReportContractError("kind", `unsupported settlement line kind: ${String(line.kind)}`);
  }
  if (!Number.isFinite(line.amountCents)) {
    throw new ReportContractError("amountCents", "must be a finite number of cents");
  }
  if (line.units !== undefined) {
    requireNonNegative(line.units, "units");
  }
  if (line.deductedInSettlement && !CONTRIBUTION_COST_KEYS.includes(line.kind as ContributionCostKey)) {
    throw new ReportContractError(
      "deductedInSettlement",
      "only cost lines can be flagged as already deducted in the settlement",
    );
  }
}

export function validateInventorySnapshot(
  snapshot: NormalizedInventorySnapshot,
  reportingCurrency: string,
): void {
  if (!snapshot || typeof snapshot !== "object") {
    throw new ReportContractError("snapshot", "must be an object");
  }
  const batch = validateReportBatch(snapshot.batch, reportingCurrency);
  requireText(snapshot.skuKey, "skuKey");
  const date = requireDate(snapshot.snapshotDate, "snapshotDate");
  if (date < batch.periodStart || date > batch.periodEnd) {
    throw new ReportContractError("snapshotDate", "must fall inside the report period");
  }
  requireNonNegative(snapshot.availableUnits, "availableUnits");
  for (const field of ["reservedUnits", "inTransitUnits", "unsellableUnits"] as const) {
    if (snapshot[field] !== undefined) {
      requireNonNegative(snapshot[field], field);
    }
  }
}

export type SettlementPeriodResult = {
  skuKey: string;
  settlementId: string;
  periodKey: string;
  policy: PeriodPolicy;
  marketplaceCode: string;
  reportTimezone: string;
  currency: string;
  fxRate: number;
  fxRateDate: string | null;
  units: number;
  lineCount: number;
  rawHashes: string[];
  ingestionRunIds: string[];
  contribution: ContributionResult;
};

export type AggregateOptions = {
  policy: PeriodPolicy;
  reportingCurrency: string;
};

type Group = {
  skuKey: string;
  settlementId: string;
  periodKey: string;
  policy: PeriodPolicy;
  marketplaceCode: string;
  reportTimezone: string;
  currency: string;
  fxRate: number;
  fxRateDate: string | null;
  revenueCents: number;
  units: number;
  costsCents: Partial<Record<ContributionCostKey, number>>;
  deducted: Set<ContributionCostKey>;
  rawHashes: Set<string>;
  ingestionRunIds: Set<string>;
  lineCount: number;
};

/**
 * 按 SKU × 结算批次 × 期间归集。同一组内时区或汇率不一致会直接报错，
 * 避免跨站、跨币种金额被静默合并；归集结果保留站点原币，不做跨站汇总。
 */
export function aggregateSettlement(
  lines: readonly NormalizedSettlementLine[],
  options: AggregateOptions,
): SettlementPeriodResult[] {
  const base = requireCurrency(options.reportingCurrency, "reportingCurrency");
  const groups = new Map<string, Group>();

  for (const line of lines) {
    validateSettlementLine(line, base);
    const batch = validateReportBatch(line.batch, base);
    const periodKey = assignPeriod({
      orderDate: line.orderDate,
      settlementDate: line.settlementDate,
      policy: options.policy,
    }).periodKey;
    const fxRate = batch.currency === base ? 1 : (batch.fxRate ?? Number.NaN);
    const key = [line.skuKey, line.settlementId, periodKey, batch.marketplaceCode, batch.currency].join("\u0000");

    let group = groups.get(key);
    if (!group) {
      group = {
        skuKey: line.skuKey,
        settlementId: line.settlementId,
        periodKey,
        policy: options.policy,
        marketplaceCode: batch.marketplaceCode,
        reportTimezone: batch.reportTimezone,
        currency: batch.currency,
        fxRate,
        fxRateDate: batch.fxRateDate ?? null,
        revenueCents: 0,
        units: 0,
        costsCents: {},
        deducted: new Set<ContributionCostKey>(),
        rawHashes: new Set<string>(),
        ingestionRunIds: new Set<string>(),
        lineCount: 0,
      };
      groups.set(key, group);
    } else if (group.reportTimezone !== batch.reportTimezone || group.fxRate !== fxRate) {
      throw new ReportContractError(
        "batch",
        `inconsistent timezone or fxRate inside ${line.skuKey}/${line.settlementId}/${periodKey}`,
      );
    }

    group.lineCount += 1;
    group.rawHashes.add(batch.rawHash);
    group.ingestionRunIds.add(batch.ingestionRunId);

    const amount = line.amountCents;
    if (line.kind === "revenue") {
      group.revenueCents += amount;
      group.units += line.units ?? 0;
    } else if (line.kind === "refund" || line.kind === "discount") {
      group.revenueCents -= amount;
      group.units -= line.units ?? 0;
    } else {
      group.costsCents[line.kind] = (group.costsCents[line.kind] ?? 0) + amount;
      if (line.deductedInSettlement) {
        group.deducted.add(line.kind);
      }
    }
  }

  return [...groups.values()]
    .map((group): SettlementPeriodResult => ({
      skuKey: group.skuKey,
      settlementId: group.settlementId,
      periodKey: group.periodKey,
      policy: group.policy,
      marketplaceCode: group.marketplaceCode,
      reportTimezone: group.reportTimezone,
      currency: group.currency,
      fxRate: group.fxRate,
      fxRateDate: group.fxRateDate,
      units: Math.max(0, group.units),
      lineCount: group.lineCount,
      rawHashes: [...group.rawHashes].sort(),
      ingestionRunIds: [...group.ingestionRunIds].sort(),
      contribution: contributionProfit({
        netRevenueCents: group.revenueCents,
        costsCents: group.costsCents,
        alreadyDeductedInSettlement: [...group.deducted],
      }),
    }))
    .sort((a, b) =>
      [a.skuKey, a.periodKey, a.settlementId, a.marketplaceCode]
        .join("|")
        .localeCompare([b.skuKey, b.periodKey, b.settlementId, b.marketplaceCode].join("|")),
    );
}

export type ForecastComparisonInput = {
  /** 单件预测，必须是站点币种；跨币种换算由调用方按 fxRate 显式完成。 */
  unitNetProfitCents: number;
  costModelVersion: string;
  forecastCurrency: string;
  minDenominatorCents: number;
};

export type ForecastComparison = {
  folded: FoldedForecast;
  variance: ForecastVariance;
};

/** 只有同币种、且预测已按实际销量折算成周期总量之后，才允许比较。 */
export function compareWithForecast(
  result: SettlementPeriodResult,
  input: ForecastComparisonInput,
): ForecastComparison {
  const forecastCurrency = requireCurrency(input.forecastCurrency, "forecastCurrency");
  if (forecastCurrency !== result.currency) {
    throw new ReportContractError(
      "forecastCurrency",
      `must match settlement currency ${result.currency}; convert with fxRate ${result.fxRate} first`,
    );
  }
  const folded = foldForecastToPeriod({
    unitNetProfitCents: input.unitNetProfitCents,
    actualUnits: result.units,
    costModelVersion: input.costModelVersion,
    forecastCurrency,
    reportingCurrency: result.currency,
  });
  const variance = forecastVariance({
    actualProfitCents: result.contribution.contributionProfitCents,
    foldedForecastProfitCents: folded.foldedProfitCents,
    minDenominatorCents: input.minDenominatorCents,
  });
  return { folded, variance };
}
