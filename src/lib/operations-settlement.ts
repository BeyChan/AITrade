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
  /** 退货前毛销量 */
  grossUnits: number;
  /** 退货件数 */
  refundUnits: number;
  /** 退货与促销冲减前的毛营收 */
  grossRevenueCents: number;
  /** 退款金额（正数） */
  refundCents: number;
  /** 促销/折扣冲减金额（正数） */
  discountCents: number;
  /** 按费用项保留的完整分项金额（含冲正负数），不再全塞进单一字段 */
  costsByKey: Partial<Record<ContributionCostKey, number>>;
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
  grossRevenueCents: number;
  refundCents: number;
  discountCents: number;
  units: number;
  grossUnits: number;
  refundUnits: number;
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
        grossRevenueCents: 0,
        refundCents: 0,
        discountCents: 0,
        units: 0,
        grossUnits: 0,
        refundUnits: 0,
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
      group.grossRevenueCents += amount;
      group.units += line.units ?? 0;
      group.grossUnits += line.units ?? 0;
    } else if (line.kind === "refund") {
      group.revenueCents -= amount;
      group.refundCents += amount;
      group.units -= line.units ?? 0;
      group.refundUnits += line.units ?? 0;
    } else if (line.kind === "discount") {
      group.revenueCents -= amount;
      group.discountCents += amount;
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
      grossUnits: Math.max(0, group.grossUnits),
      refundUnits: Math.max(0, group.refundUnits),
      grossRevenueCents: group.grossRevenueCents,
      refundCents: group.refundCents,
      discountCents: group.discountCents,
      costsByKey: { ...group.costsCents },
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

export type ForecastPlanBreakdown = {
  salePriceCents: number;
  landedCostCents: number;
  fbaFeeCents: number;
  referralRate: number;
  adRate: number;
  returnRate: number;
  storageCents: number;
  amortizedFixedCostCents?: number;
};

export type ForecastComparisonBasis =
  | "true_net_profit"
  | "platform_contribution"
  | "legacy_unadjusted";

export type VarianceBreakdownItem = {
  key: "salePrice" | "referralRate" | "fulfillmentFee" | "returnRate" | "adRate" | "storageFee";
  label: string;
  unit: "cents" | "rate";
  planned: number;
  actual: number | null;
  delta: number | null;
  status: "compared" | "unattributed" | "insufficient_units";
};

/**
 * 结算单广告费与外部 Ads 报表广告费的重叠处理口径：
 * - dedupe_max（默认 · 补差防重扣）：两份报表同时存在时，总广告费取二者较大值，
 *   对已扣过结算单广告费的 contributionProfitCents 仅补扣 max(0, external - settlement)，杜绝重复扣款。
 * - prefer_external：以外部 Ads 报表为准替换结算单广告费。
 * - prefer_settlement：以结算单广告费为准，忽略外部 Ads 报表。
 * - additive：仅在明确确认两份报表覆盖互斥渠道（如站内 + 站外）时才允许相加。
 */
export type AdOverlapPolicy = "dedupe_max" | "prefer_external" | "prefer_settlement" | "additive";

export type ResolvedAdSpend = {
  settlementAdCents: number;
  externalAdCents: number;
  /** 去重后的周期有效总广告费（分），用于广告费占比与实盘校准 */
  effectiveTotalAdCents: number;
  /**
   * 相对 contributionProfitCents（内部已扣过 settlementAdCents）还需额外扣减的净额（分）。
   * 若为 prefer_external 且 external < settlement，可为负数表示回冲差额。
   */
  incrementalDeductionCents: number;
  /** 是否检测到同一周期内同时存在结算单广告费与外部 Ads 广告费 */
  overlapDetected: boolean;
  /** 实际生效的去重口径 */
  policy: AdOverlapPolicy;
};

export function resolveEffectiveAdSpend(
  rawSettlementAdCents: number,
  rawExternalAdCents: number,
  policy: AdOverlapPolicy = "dedupe_max",
): ResolvedAdSpend {
  const settlementAdCents = Math.max(0, Math.round(rawSettlementAdCents || 0));
  const externalAdCents = Math.max(0, Math.round(rawExternalAdCents || 0));
  const overlapDetected = settlementAdCents > 0 && externalAdCents > 0;

  if (!overlapDetected) {
    return {
      settlementAdCents,
      externalAdCents,
      effectiveTotalAdCents: settlementAdCents + externalAdCents,
      incrementalDeductionCents: externalAdCents,
      overlapDetected: false,
      policy,
    };
  }

  if (policy === "additive") {
    return {
      settlementAdCents,
      externalAdCents,
      effectiveTotalAdCents: settlementAdCents + externalAdCents,
      incrementalDeductionCents: externalAdCents,
      overlapDetected: true,
      policy,
    };
  }

  if (policy === "prefer_settlement") {
    return {
      settlementAdCents,
      externalAdCents,
      effectiveTotalAdCents: settlementAdCents,
      incrementalDeductionCents: 0,
      overlapDetected: true,
      policy,
    };
  }

  if (policy === "prefer_external") {
    return {
      settlementAdCents,
      externalAdCents,
      effectiveTotalAdCents: externalAdCents,
      incrementalDeductionCents: externalAdCents - settlementAdCents,
      overlapDetected: true,
      policy,
    };
  }

  // 默认 dedupe_max：补差防重扣
  const effectiveTotalAdCents = Math.max(settlementAdCents, externalAdCents);
  return {
    settlementAdCents,
    externalAdCents,
    effectiveTotalAdCents,
    incrementalDeductionCents: Math.max(0, externalAdCents - settlementAdCents),
    overlapDetected: true,
    policy: "dedupe_max",
  };
}

export type ForecastComparisonInput = {
  /** 单件预测净利，必须是站点币种；跨币种换算由调用方按 fxRate 显式完成。 */
  unitNetProfitCents: number;
  /** 可选：单件预测平台侧贡献（不含采购到岸成本与一次性固定摊销），用于无采购成本时同口径对比。 */
  unitPlatformContributionCents?: number;
  /** 可选：单件采购到岸成本（已绑定案卷或手动覆盖），传入后可计算实盘真实净利。 */
  unitLandedCostCents?: number | null;
  /** 可选：单件一次性固定成本摊销 */
  unitAmortizedFixedCostCents?: number;
  /** 可选：外部导入的 SKU 级广告花费（非结算单内扣款），单位分 */
  externalAdSpendCents?: number;
  /** 可选：结算单广告费与外部 Ads 报表同时存在时的去重口径，默认 dedupe_max（补差防重扣） */
  adOverlapPolicy?: AdOverlapPolicy;
  /** 可选：广告归因状态 */
  adAttribution?: "settlement" | "ads_report" | "manual" | "missing";
  /** 可选：立项成本模型原始假设，用于输出分项误差拆解 */
  planBreakdown?: ForecastPlanBreakdown;
  costModelVersion: string;
  forecastCurrency: string;
  minDenominatorCents: number;
};

export type ForecastComparison = {
  folded: FoldedForecast;
  variance: ForecastVariance;
  /** 本次对比采用的利润口径 */
  comparisonBasis: ForecastComparisonBasis;
  /** 实盘比较值（分）：true_net_profit 为真实净利，platform_contribution 为平台侧贡献 */
  actualComparableProfitCents: number;
  /** 预测比较值（分），与 actualComparableProfitCents 严格同口径 */
  forecastComparableProfitCents: number;
  /** 是否已显式扣减采购到岸成本 */
  landedCostApplied: boolean;
  /** 扣减的周期采购到岸总成本（未绑定时为 null） */
  landedCostTotalCents: number | null;
  /** 扣减的外部广告花费净额（分，已按去重口径处理，避免与结算单广告费重复扣除） */
  externalAdSpendCents: number;
  /** 是否检测到结算单广告费与外部 Ads 报表重叠 */
  adOverlapDetected: boolean;
  /** 实盘真实净利（未绑定采购成本时为 null） */
  trueNetProfitCents: number | null;
  /** 实盘分项 vs 立项预测误差拆解 */
  breakdown: VarianceBreakdownItem[];
};

function buildVarianceBreakdown(
  result: SettlementPeriodResult,
  input: ForecastComparisonInput,
): VarianceBreakdownItem[] {
  const plan = input.planBreakdown;
  if (!plan) return [];

  const grossUnits = result.grossUnits > 0 ? result.grossUnits : result.units;
  const netUnits = result.units;
  const grossRev = result.grossRevenueCents > 0 ? result.grossRevenueCents : result.contribution.netRevenueCents;
  const netRev = result.contribution.netRevenueCents;

  const actualSalePrice = grossUnits > 0 ? Math.round(grossRev / grossUnits) : null;
  const platformFee = result.costsByKey.platformFee ?? 0;
  const fulfillmentFee = result.costsByKey.fulfillmentFee ?? 0;
  const adResolved = resolveEffectiveAdSpend(
    result.costsByKey.adCost ?? 0,
    input.externalAdSpendCents ?? 0,
    input.adOverlapPolicy ?? "dedupe_max",
  );
  const totalAd = adResolved.effectiveTotalAdCents;
  const storageFee = (result.costsByKey.storage ?? 0) + (result.costsByKey.longTermStorage ?? 0);

  const actualReferralRate = netRev > 0 ? platformFee / netRev : null;
  const actualFulfillmentPerUnit = grossUnits > 0 ? Math.round(fulfillmentFee / grossUnits) : null;
  const actualReturnRate = grossRev > 0 ? result.refundCents / grossRev : null;
  const adAttributed =
    input.adAttribution === "settlement" ||
    input.adAttribution === "ads_report" ||
    input.adAttribution === "manual" ||
    totalAd > 0;
  const actualAdRate = adAttributed && grossRev > 0 ? totalAd / grossRev : null;
  const actualStoragePerUnit = netUnits > 0 ? Math.round(storageFee / netUnits) : null;

  return [
    {
      key: "salePrice",
      label: "实际均价",
      unit: "cents",
      planned: plan.salePriceCents,
      actual: actualSalePrice,
      delta: actualSalePrice !== null ? actualSalePrice - plan.salePriceCents : null,
      status: actualSalePrice !== null ? "compared" : "insufficient_units",
    },
    {
      key: "referralRate",
      label: "平台佣金率",
      unit: "rate",
      planned: plan.referralRate,
      actual: actualReferralRate,
      delta: actualReferralRate !== null ? actualReferralRate - plan.referralRate : null,
      status: actualReferralRate !== null ? "compared" : "insufficient_units",
    },
    {
      key: "fulfillmentFee",
      label: "单件履约费",
      unit: "cents",
      planned: plan.fbaFeeCents,
      actual: actualFulfillmentPerUnit,
      delta: actualFulfillmentPerUnit !== null ? actualFulfillmentPerUnit - plan.fbaFeeCents : null,
      status: actualFulfillmentPerUnit !== null ? "compared" : "insufficient_units",
    },
    {
      key: "returnRate",
      label: "退款/退货率",
      unit: "rate",
      planned: plan.returnRate,
      actual: actualReturnRate,
      delta: actualReturnRate !== null ? actualReturnRate - plan.returnRate : null,
      status: actualReturnRate !== null ? "compared" : "insufficient_units",
    },
    {
      key: "adRate",
      label: "广告费占比",
      unit: "rate",
      planned: plan.adRate,
      actual: actualAdRate,
      delta: actualAdRate !== null ? actualAdRate - plan.adRate : null,
      status: adAttributed ? (actualAdRate !== null ? "compared" : "insufficient_units") : "unattributed",
    },
    {
      key: "storageFee",
      label: "单件仓储费",
      unit: "cents",
      planned: plan.storageCents,
      actual: actualStoragePerUnit,
      delta: actualStoragePerUnit !== null ? actualStoragePerUnit - plan.storageCents : null,
      status: actualStoragePerUnit !== null ? "compared" : "insufficient_units",
    },
  ];
}

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
  const adResolved = resolveEffectiveAdSpend(
    result.costsByKey.adCost ?? 0,
    input.externalAdSpendCents ?? 0,
    input.adOverlapPolicy ?? "dedupe_max",
  );
  const incrementalExternalAdCents = adResolved.incrementalDeductionCents;
  const hasLandedCost =
    typeof input.unitLandedCostCents === "number" &&
    Number.isFinite(input.unitLandedCostCents) &&
    input.unitLandedCostCents >= 0;

  let comparisonBasis: ForecastComparisonBasis;
  let actualComparableProfitCents: number;
  let forecastUnitProfitCents: number;
  let landedCostTotalCents: number | null = null;
  let trueNetProfitCents: number | null = null;

  if (hasLandedCost) {
    comparisonBasis = "true_net_profit";
    landedCostTotalCents = Math.round((input.unitLandedCostCents as number) * result.units);
    const amortizedTotal = Math.round((input.unitAmortizedFixedCostCents ?? 0) * result.units);
    trueNetProfitCents =
      result.contribution.contributionProfitCents -
      landedCostTotalCents -
      incrementalExternalAdCents -
      amortizedTotal;
    actualComparableProfitCents = trueNetProfitCents;
    forecastUnitProfitCents = input.unitNetProfitCents;
  } else if (
    typeof input.unitPlatformContributionCents === "number" &&
    Number.isFinite(input.unitPlatformContributionCents)
  ) {
    comparisonBasis = "platform_contribution";
    actualComparableProfitCents =
      result.contribution.contributionProfitCents - incrementalExternalAdCents;
    forecastUnitProfitCents = input.unitPlatformContributionCents;
  } else {
    comparisonBasis = "legacy_unadjusted";
    actualComparableProfitCents = result.contribution.contributionProfitCents;
    forecastUnitProfitCents = input.unitNetProfitCents;
  }

  const folded = foldForecastToPeriod({
    unitNetProfitCents: forecastUnitProfitCents,
    actualUnits: result.units,
    costModelVersion: input.costModelVersion,
    forecastCurrency,
    reportingCurrency: result.currency,
  });
  const variance = forecastVariance({
    actualProfitCents: actualComparableProfitCents,
    foldedForecastProfitCents: folded.foldedProfitCents,
    minDenominatorCents: input.minDenominatorCents,
  });
  return {
    folded,
    variance,
    comparisonBasis,
    actualComparableProfitCents,
    forecastComparableProfitCents: folded.foldedProfitCents,
    landedCostApplied: hasLandedCost,
    landedCostTotalCents,
    externalAdSpendCents: incrementalExternalAdCents,
    adOverlapDetected: adResolved.overlapDetected,
    trueNetProfitCents,
    breakdown: buildVarianceBreakdown(result, input),
  };
}
