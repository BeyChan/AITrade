/**
 * 实盘校准纯函数引擎（确定性统计，不读库、不调模型）。
 *
 * 从历史实盘快照按 SKU 滚动聚合，剔除低销量噪声，隔离缺失广告归因的 0 值，
 * 按 4 级分层回退（同款 SKU → 同站点同类目 → 同站点全店 → 平台默认）生成校准因子，
 * 并计算应用校准前后的净利、最高到岸成本与 GO/HOLD 变化预览。
 */
import { platformEconomicDefaults } from "./ai-sourcing.ts";
import {
  calculateEconomics,
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
  type CalibrationAppliedMeta,
  type CalibrationStatus,
  type EconomicsAssumptions,
} from "./economics.ts";
import type { AdAttributionSource } from "./operations-pipeline.ts";

export type CalibrationSnapshotRow = {
  marketplace: string;
  currency: string;
  sku: string;
  caseId: string | null;
  caseAsin: string | null;
  category: string | null;
  periodKey: string;
  periodEnd: string;
  unitsSold: number;
  grossUnits: number;
  refundUnits: number;
  grossRevenueCents: number;
  revenueCents: number;
  refundCents: number;
  platformFeeCents: number;
  fulfillmentFeeCents: number;
  adSpendCents: number;
  adAttribution: AdAttributionSource;
  storageFeeCents: number;
};

export type AggregatedSkuObservation = {
  marketplace: string;
  currency: string;
  sku: string;
  caseId: string | null;
  caseAsin: string | null;
  category: string | null;
  grossUnits: number;
  netUnits: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  refundCents: number;
  platformFeeCents: number;
  fulfillmentFeeCents: number;
  adSpendCents: number;
  adAttributedGrossRevenueCents: number;
  hasAdAttribution: boolean;
  storageFeeCents: number;
  latestPeriodEnd: string;
  /** 实测佣金率 = platformFee / netRevenue */
  referralRate: number | null;
  /** 实测退货率 = refund / grossRevenue */
  returnRate: number | null;
  /** 实测单件履约费（分） = fulfillmentFee / grossUnits */
  fbaFeeCents: number | null;
  /** 实测广告费占比 = adSpend / adAttributedGrossRevenue（仅限已归因批次） */
  adRate: number | null;
  /** 实测单件仓储费（分） = storageFee / netUnits */
  storageCents: number | null;
};

export type MetricDistribution = {
  p25: number;
  median: number;
  p75: number;
  sampleSkuCount: number;
  totalUnits: number;
};

export type CalibrationScope = "sku" | "category" | "store" | "platform_default";

export type CalibrationSuggestion = {
  status: CalibrationStatus;
  scope: CalibrationScope;
  scopeLabel: string;
  marketplace: string;
  category: string | null;
  sampleSkuCount: number;
  totalUnits: number;
  latestPeriodEnd: string | null;
  /** 建议应用的校准值（某项若无有效样本则为 null，不强行覆盖） */
  suggested: {
    referralRate: number | null;
    returnRate: number | null;
    adRate: number | null;
    fbaFeeCents: number | null;
    storageCents: number | null;
  };
  /** 各指标的分布统计（P25 / Median / P75） */
  distributions: {
    referralRate: MetricDistribution | null;
    returnRate: MetricDistribution | null;
    adRate: MetricDistribution | null;
    fbaFeeCents: MetricDistribution | null;
    storageCents: MetricDistribution | null;
  };
  /** 平台默认兜底值，供对比参考 */
  platformDefaults: ReturnType<typeof platformEconomicDefaults>;
  notes: string[];
};

export type CalibrationFieldDiff = {
  field: "referralRate" | "returnRate" | "adRate" | "fbaFeeCents" | "storageCents";
  label: string;
  unit: "rate" | "cents";
  before: number;
  after: number;
  delta: number;
  distribution: MetricDistribution | null;
};

export type CalibrationImpactPreview = {
  canApply: boolean;
  appliedFields: CalibrationFieldDiff[];
  nextAssumptions: EconomicsAssumptions;
  before: {
    netProfitCents: number;
    marginRate: number;
    stressProfitCents: number;
    maxLandedCostCents: number;
    score: number;
    recommendation: "GO" | "HOLD" | "NO-GO";
  };
  after: {
    netProfitCents: number;
    marginRate: number;
    stressProfitCents: number;
    maxLandedCostCents: number;
    score: number;
    recommendation: "GO" | "HOLD" | "NO-GO";
  };
  decisionChanged: boolean;
};

export type ComputeCalibrationOptions = {
  marketplace: string;
  currency?: string;
  category?: string | null;
  asin?: string | null;
  sku?: string | null;
  platformCode?: string;
  salePriceCents: number;
  /** 单 SKU 参与校准的最小累计毛销量，过滤小样本噪声（默认 10 件） */
  minUnitsPerSku?: number;
  /** 类目/全店级校准所需的最小有效 SKU 数（默认 3 个） */
  minSkusForGroup?: number;
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

function summarizeDistribution(
  entries: Array<{ value: number; units: number }>,
  roundInteger = false,
): MetricDistribution | null {
  if (entries.length === 0) return null;
  const sorted = entries.map((e) => e.value).sort((a, b) => a - b);
  const totalUnits = entries.reduce((sum, e) => sum + e.units, 0);
  const fmt = (v: number) => (roundInteger ? Math.round(v) : Number(v.toFixed(4)));
  return {
    p25: fmt(percentile(sorted, 0.25)),
    median: fmt(percentile(sorted, 0.5)),
    p75: fmt(percentile(sorted, 0.75)),
    sampleSkuCount: entries.length,
    totalUnits,
  };
}

/**
 * 将多期结算快照按 (marketplace, sku) 滚动聚合为单 SKU 观测值，避免单期 14 天跨期噪声。
 */
export function aggregateSkuObservations(
  rows: readonly CalibrationSnapshotRow[],
): AggregatedSkuObservation[] {
  const byKey = new Map<
    string,
    {
      marketplace: string;
      currency: string;
      sku: string;
      caseId: string | null;
      caseAsin: string | null;
      category: string | null;
      grossUnits: number;
      netUnits: number;
      grossRevenueCents: number;
      netRevenueCents: number;
      refundCents: number;
      platformFeeCents: number;
      fulfillmentFeeCents: number;
      adSpendCents: number;
      adAttributedGrossRevenueCents: number;
      hasAdAttribution: boolean;
      storageFeeCents: number;
      latestPeriodEnd: string;
    }
  >();

  for (const r of rows) {
    const market = r.marketplace.toUpperCase();
    const skuKey = r.sku.toUpperCase();
    const key = `${market}::${skuKey}`;
    const existing = byKey.get(key) ?? {
      marketplace: market,
      currency: r.currency.toUpperCase(),
      sku: r.sku,
      caseId: r.caseId,
      caseAsin: r.caseAsin,
      category: r.category,
      grossUnits: 0,
      netUnits: 0,
      grossRevenueCents: 0,
      netRevenueCents: 0,
      refundCents: 0,
      platformFeeCents: 0,
      fulfillmentFeeCents: 0,
      adSpendCents: 0,
      adAttributedGrossRevenueCents: 0,
      hasAdAttribution: false,
      storageFeeCents: 0,
      latestPeriodEnd: "",
    };

    const gUnits = r.grossUnits > 0 ? r.grossUnits : r.unitsSold;
    const gRev = r.grossRevenueCents > 0 ? r.grossRevenueCents : r.revenueCents;

    existing.grossUnits += Math.max(0, gUnits);
    existing.netUnits += Math.max(0, r.unitsSold);
    existing.grossRevenueCents += Math.max(0, gRev);
    existing.netRevenueCents += Math.max(0, r.revenueCents);
    existing.refundCents += Math.max(0, r.refundCents);
    existing.platformFeeCents += Math.max(0, r.platformFeeCents);
    existing.fulfillmentFeeCents += Math.max(0, r.fulfillmentFeeCents);
    existing.storageFeeCents += Math.max(0, r.storageFeeCents);

    if (r.adAttribution !== "missing") {
      existing.hasAdAttribution = true;
      existing.adSpendCents += Math.max(0, r.adSpendCents);
      existing.adAttributedGrossRevenueCents += Math.max(0, gRev);
    }

    if (!existing.caseId && r.caseId) existing.caseId = r.caseId;
    if (!existing.caseAsin && r.caseAsin) existing.caseAsin = r.caseAsin;
    if (!existing.category && r.category) existing.category = r.category;
    if (r.periodEnd && r.periodEnd > existing.latestPeriodEnd) {
      existing.latestPeriodEnd = r.periodEnd;
    }

    byKey.set(key, existing);
  }

  return [...byKey.values()].map((item) => ({
    ...item,
    referralRate:
      item.netRevenueCents > 0 ? clampRate(item.platformFeeCents / item.netRevenueCents, 0, 0.5) : null,
    returnRate:
      item.grossRevenueCents > 0 ? clampRate(item.refundCents / item.grossRevenueCents, 0, 0.95) : null,
    fbaFeeCents: item.grossUnits > 0 ? Math.round(item.fulfillmentFeeCents / item.grossUnits) : null,
    adRate:
      item.hasAdAttribution && item.adAttributedGrossRevenueCents > 0
        ? clampRate(item.adSpendCents / item.adAttributedGrossRevenueCents, 0, 0.8)
        : null,
    storageCents: item.netUnits > 0 ? Math.round(item.storageFeeCents / item.netUnits) : null,
  }));
}

function clampRate(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function buildDistributions(obs: readonly AggregatedSkuObservation[], includeUnitFees: boolean) {
  const referralEntries = obs
    .filter((o) => o.referralRate !== null)
    .map((o) => ({ value: o.referralRate!, units: o.grossUnits }));
  const returnEntries = obs
    .filter((o) => o.returnRate !== null)
    .map((o) => ({ value: o.returnRate!, units: o.grossUnits }));
  const adEntries = obs
    .filter((o) => o.adRate !== null)
    .map((o) => ({ value: o.adRate!, units: o.grossUnits }));
  const fbaEntries = includeUnitFees
    ? obs
        .filter((o) => o.fbaFeeCents !== null && o.fbaFeeCents > 0)
        .map((o) => ({ value: o.fbaFeeCents!, units: o.grossUnits }))
    : [];
  const storageEntries = includeUnitFees
    ? obs
        .filter((o) => o.storageCents !== null && o.storageCents >= 0)
        .map((o) => ({ value: o.storageCents!, units: o.netUnits }))
    : [];

  return {
    referralRate: summarizeDistribution(referralEntries, false),
    returnRate: summarizeDistribution(returnEntries, false),
    adRate: summarizeDistribution(adEntries, false),
    fbaFeeCents: summarizeDistribution(fbaEntries, true),
    storageCents: summarizeDistribution(storageEntries, true),
  };
}

/**
 * 基于历史实盘快照，按 4 级分层回退计算校准建议。
 */
export function computeCalibrationSuggestion(
  rows: readonly CalibrationSnapshotRow[],
  options: ComputeCalibrationOptions,
): CalibrationSuggestion {
  const marketplace = options.marketplace.toUpperCase();
  const currency = options.currency?.toUpperCase();
  const category = options.category?.trim() || null;
  const asinUpper = options.asin?.trim().toUpperCase() || null;
  const skuUpper = options.sku?.trim().toUpperCase() || null;
  const minUnitsPerSku = Math.max(1, options.minUnitsPerSku ?? 10);
  const minSkusForGroup = Math.max(1, options.minSkusForGroup ?? 3);
  const platformDefaults = platformEconomicDefaults(
    options.platformCode || "amazon",
    Math.max(100, options.salePriceCents),
  );

  const allObs = aggregateSkuObservations(rows).filter((o) => {
    if (o.marketplace !== marketplace) return false;
    if (currency && o.currency !== currency) return false;
    return o.grossUnits >= minUnitsPerSku;
  });

  // Level 1: 同款 SKU / 同 ASIN 自身历史实盘（适合补货或二代改款）
  const exactObs = allObs.filter(
    (o) =>
      (skuUpper && o.sku.toUpperCase() === skuUpper) ||
      (asinUpper &&
        (o.sku.toUpperCase() === asinUpper ||
          o.sku.toUpperCase() === `SKU-${asinUpper}` ||
          o.caseAsin?.toUpperCase() === asinUpper)),
  );

  // Level 2: 同站点 + 同类目
  const categoryObs = category
    ? allObs.filter((o) => o.category && o.category.trim().toLowerCase() === category.toLowerCase())
    : [];

  let scope: CalibrationScope = "platform_default";
  let selected: AggregatedSkuObservation[] = [];
  let scopeLabel = "平台默认基准（尚未积累足够实盘样本）";
  const notes: string[] = [];

  if (exactObs.length > 0) {
    scope = "sku";
    selected = exactObs;
    scopeLabel = `同款 SKU 历史实盘（${exactObs[0].sku}）`;
  } else if (category && categoryObs.length >= minSkusForGroup) {
    scope = "category";
    selected = categoryObs;
    scopeLabel = `${marketplace} 站「${category}」类目实盘中位数（${categoryObs.length} 个 SKU）`;
  } else if (allObs.length >= minSkusForGroup) {
    scope = "store";
    selected = allObs;
    scopeLabel = `${marketplace} 站全店实盘中位数（${allObs.length} 个 SKU，跨类目参考）`;
    if (category && categoryObs.length > 0) {
      notes.push(
        `「${category}」类目目前仅有 ${categoryObs.length} 个达标 SKU（门槛 ${minSkusForGroup} 个），已自动回退到同站点全店实盘统计。`,
      );
    }
  } else {
    scope = "platform_default";
    selected = [];
    notes.push(
      `${marketplace} 站累计销量 ≥ ${minUnitsPerSku} 件的实盘 SKU 为 ${allObs.length} 个（需 ≥ ${minSkusForGroup} 个才能启用群体校准），当前仍使用平台默认比例。`,
    );
  }

  // 全店跨类目只校准比例项（退货/佣金/广告），不跨类目强行套用单件 FBA 履约费与仓储费
  const includeUnitFees = scope === "sku" || scope === "category";
  const distributions =
    selected.length > 0
      ? buildDistributions(selected, includeUnitFees)
      : {
          referralRate: null,
          returnRate: null,
          adRate: null,
          fbaFeeCents: null,
          storageCents: null,
        };

  if (selected.length > 0 && !distributions.adRate) {
    notes.push("历史结算单未导入 SKU 级广告归因（已隔离 0 值），广告率保持现有假设不变。");
  }

  const totalUnits = selected.reduce((sum, o) => sum + o.grossUnits, 0);
  const latestPeriodEnd =
    selected.reduce((latest, o) => (o.latestPeriodEnd > latest ? o.latestPeriodEnd : latest), "") ||
    null;

  const suggested = {
    referralRate: distributions.referralRate?.median ?? null,
    returnRate: distributions.returnRate?.median ?? null,
    adRate: distributions.adRate?.median ?? null,
    fbaFeeCents: distributions.fbaFeeCents?.median ?? null,
    storageCents: distributions.storageCents?.median ?? null,
  };

  const availableMetricsCount = Object.values(suggested).filter((v) => v !== null).length;
  const status: CalibrationStatus =
    scope === "platform_default" || availableMetricsCount === 0
      ? "uncalibrated"
      : suggested.adRate !== null && suggested.returnRate !== null && suggested.referralRate !== null
        ? "calibrated"
        : "partial";

  return {
    status,
    scope,
    scopeLabel,
    marketplace,
    category,
    sampleSkuCount: selected.length,
    totalUnits,
    latestPeriodEnd,
    suggested,
    distributions,
    platformDefaults,
    notes,
  };
}

/**
 * 预览应用实盘校准前后的财务结果与 GO/HOLD 门禁变化（纯函数，不改库）。
 */
export function previewCalibrationImpact(params: {
  assumptions: EconomicsAssumptions;
  suggestion: CalibrationSuggestion;
  monthlySalesEstimate: number;
  reviewCount: number;
  evidenceScore: number;
  targetMarginRate?: number;
}): CalibrationImpactPreview {
  const { assumptions, suggestion } = params;
  const targetMarginRate = params.targetMarginRate ?? 0.18;

  const next: EconomicsAssumptions = { ...assumptions };
  const diffs: CalibrationFieldDiff[] = [];

  const applyRate = (
    field: "referralRate" | "returnRate" | "adRate",
    label: string,
    suggestedValue: number | null,
    dist: MetricDistribution | null,
  ) => {
    if (suggestedValue === null) return;
    const beforeVal = assumptions[field];
    if (Math.abs(suggestedValue - beforeVal) < 1e-4) return;
    next[field] = suggestedValue;
    diffs.push({
      field,
      label,
      unit: "rate",
      before: beforeVal,
      after: suggestedValue,
      delta: Number((suggestedValue - beforeVal).toFixed(4)),
      distribution: dist,
    });
  };

  const applyCents = (
    field: "fbaFeeCents" | "storageCents",
    label: string,
    suggestedValue: number | null,
    dist: MetricDistribution | null,
  ) => {
    if (suggestedValue === null) return;
    const beforeVal = assumptions[field];
    if (Math.round(suggestedValue) === Math.round(beforeVal)) return;
    next[field] = Math.round(suggestedValue);
    diffs.push({
      field,
      label,
      unit: "cents",
      before: beforeVal,
      after: Math.round(suggestedValue),
      delta: Math.round(suggestedValue) - beforeVal,
      distribution: dist,
    });
  };

  applyRate("referralRate", "平台佣金率", suggestion.suggested.referralRate, suggestion.distributions.referralRate);
  applyRate("returnRate", "退货率", suggestion.suggested.returnRate, suggestion.distributions.returnRate);
  applyRate("adRate", "广告费占比", suggestion.suggested.adRate, suggestion.distributions.adRate);
  applyCents("fbaFeeCents", "单件履约费 (FBA)", suggestion.suggested.fbaFeeCents, suggestion.distributions.fbaFeeCents);
  applyCents("storageCents", "单件仓储费", suggestion.suggested.storageCents, suggestion.distributions.storageCents);

  const meta: CalibrationAppliedMeta = {
    status: suggestion.status,
    scope: suggestion.scope,
    sampleSkuCount: suggestion.sampleSkuCount,
    totalUnits: suggestion.totalUnits,
    appliedFields: diffs.map((d) => d.field),
    latestPeriodEnd: suggestion.latestPeriodEnd,
  };
  next.calibrationMeta = meta;

  const beforeRes = calculateEconomics(assumptions);
  const afterRes = calculateEconomics(next);
  const beforeScore = opportunityScore(
    beforeRes,
    params.monthlySalesEstimate,
    params.reviewCount,
    params.evidenceScore,
  );
  const afterScore = opportunityScore(
    afterRes,
    params.monthlySalesEstimate,
    params.reviewCount,
    params.evidenceScore,
  );
  const beforeRec = recommendationFor(beforeRes, beforeScore);
  const afterRec = recommendationFor(afterRes, afterScore);

  const beforeTarget = calculateTargetLandedCost({
    currency: assumptions.currency,
    salePriceCents: assumptions.salePriceCents,
    fbaFeeCents: assumptions.fbaFeeCents,
    referralRate: assumptions.referralRate,
    adRate: assumptions.adRate,
    returnRate: assumptions.returnRate,
    returnProcessingCents: assumptions.returnProcessingCents,
    returnRecoveryRate: assumptions.returnRecoveryRate,
    couponCents: assumptions.couponCents,
    storageCents: assumptions.storageCents,
    otherCostCents: assumptions.otherCostCents,
    oneTimeFixedCostCents: assumptions.oneTimeFixedCostCents,
    initialOrderUnits: assumptions.initialOrderUnits,
    targetMarginRate,
  });
  const afterTarget = calculateTargetLandedCost({
    currency: next.currency,
    salePriceCents: next.salePriceCents,
    fbaFeeCents: next.fbaFeeCents,
    referralRate: next.referralRate,
    adRate: next.adRate,
    returnRate: next.returnRate,
    returnProcessingCents: next.returnProcessingCents,
    returnRecoveryRate: next.returnRecoveryRate,
    couponCents: next.couponCents,
    storageCents: next.storageCents,
    otherCostCents: next.otherCostCents,
    oneTimeFixedCostCents: next.oneTimeFixedCostCents,
    initialOrderUnits: next.initialOrderUnits,
    targetMarginRate,
  });

  return {
    canApply: suggestion.scope !== "platform_default" && diffs.length > 0,
    appliedFields: diffs,
    nextAssumptions: next,
    before: {
      netProfitCents: beforeRes.netProfitCents,
      marginRate: beforeRes.marginRate,
      stressProfitCents: beforeRes.stressProfitCents,
      maxLandedCostCents: beforeTarget.maxLandedCostCents,
      score: beforeScore,
      recommendation: beforeRec,
    },
    after: {
      netProfitCents: afterRes.netProfitCents,
      marginRate: afterRes.marginRate,
      stressProfitCents: afterRes.stressProfitCents,
      maxLandedCostCents: afterTarget.maxLandedCostCents,
      score: afterScore,
      recommendation: afterRec,
    },
    decisionChanged: beforeRec !== afterRec,
  };
}
