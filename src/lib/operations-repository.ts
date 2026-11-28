import { randomUUID } from "node:crypto";
import { getAppMode, isDemoMode, type ModeOptions } from "./app-mode.ts";
import { getDb } from "./db.ts";
import type { ContributionCostKey } from "./operations-metrics.ts";
import type { AdAttributionSource, PipelineResult } from "./operations-pipeline.ts";
import { resolveEffectiveAdSpend, type VarianceBreakdownItem } from "./operations-settlement.ts";

export type ChannelSkuMapping = {
  id: string;
  marketplace: string;
  channelSku: string;
  caseId: string | null;
  caseAsin: string | null;
  caseTitle: string | null;
  caseCategory: string | null;
  unitLandedCostCentsOverride: number | null;
  effectiveUnitLandedCostCents: number | null;
  notes: string;
  updatedAt: string;
};

export type SavedOperationsBatch = {
  id: string;
  label: string;
  marketplace: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  skuCount: number;
  totalRevenueCents: number;
  totalContributionCents: number;
  /** 仅当批次内至少一条 SKU 绑定了采购到岸成本时汇总，否则为 null */
  totalNetProfitCents: number | null;
  /** 已绑定采购到岸成本的 SKU 条数 */
  landedCostCoveredCount: number;
  avgMarginRate: number;
  stockoutRiskCount: number;
  createdBy: string;
  createdAt: string;
  skus: SavedOperationsSkuRow[];
};

export type SavedOperationsSkuRow = {
  id: string;
  batchId: string;
  caseId: string | null;
  sku: string;
  periodKey: string;
  unitsSold: number;
  grossUnits: number;
  refundUnits: number;
  grossRevenueCents: number;
  revenueCents: number;
  refundCents: number;
  discountCents: number;
  platformFeeCents: number;
  fulfillmentFeeCents: number;
  adSpendCents: number;
  externalAdSpendCents: number;
  adAttribution: AdAttributionSource;
  storageFeeCents: number;
  otherFeeCents: number;
  /** 向后兼容旧字段名：保留为实际履约费（不再把所有费用塞进来） */
  fbaFeeCents: number;
  costsByKey: Partial<Record<ContributionCostKey, number>>;
  contributionCents: number;
  /** 平台侧贡献毛利率（平台贡献 / 净营收） */
  marginRate: number;
  unitLandedCostCents: number | null;
  landedCostCents: number | null;
  /** 实盘真实净利（仅当已绑定采购到岸成本时有值，否则为 null） */
  netProfitCents: number | null;
  /** 实盘真实净利率（真实净利 / 净营收），缺采购成本时为 null */
  netMarginRate: number | null;
  costBasis: "true_net_profit" | "platform_contribution_only";
  availableUnits: number | null;
  daysOfSupply: number | null;
  stockoutRisk: "critical" | "warning" | "healthy" | "unknown";
  /** 同口径预测利率：true_net_profit 对应预测净利率（净营收分母）；platform_contribution_only 对应预测平台贡献率 */
  planMarginRate: number | null;
  planPlatformMarginRate: number | null;
  planNetMarginRate: number | null;
  /** 同口径偏差：实盘 - 预测 */
  marginDelta: number | null;
  breakdown: VarianceBreakdownItem[];
};

function classifyStockoutRisk(days: number | null): "critical" | "warning" | "healthy" | "unknown" {
  if (days === null || !Number.isFinite(days)) return "unknown";
  if (days < 15) return "critical";
  if (days < 30) return "warning";
  return "healthy";
}

type CaseCostLookup = {
  id: string;
  asin: string;
  unitLandedCostCents: number | null;
  unitAmortizedFixedCostCents: number;
  planPlatformMarginRate: number | null;
  planNetMarginRate: number | null;
};

async function loadCaseLookupForMarketplace(marketplace: string, isDemo: boolean): Promise<{
  byCaseId: Map<string, CaseCostLookup>;
  bySku: Map<string, { caseId: string | null; unitLandedCostCentsOverride: number | null; lookup: CaseCostLookup | null }>;
}> {
  const db = await getDb();
  const caseRes = await db.query<{
    id: string;
    asin: string;
    assumptions: Record<string, unknown> | null;
    results: Record<string, unknown> | null;
  }>(
    `SELECT pc.id, pc.asin,
            (SELECT cm.assumptions FROM cost_models cm WHERE cm.case_id = pc.id ORDER BY cm.version DESC LIMIT 1) AS assumptions,
            (SELECT cm.results FROM cost_models cm WHERE cm.case_id = pc.id ORDER BY cm.version DESC LIMIT 1) AS results
     FROM product_cases pc
     WHERE UPPER(pc.marketplace) = UPPER($1) AND pc.is_demo = $2`,
    [marketplace, isDemo],
  );

  const byCaseId = new Map<string, CaseCostLookup>();
  const bySku = new Map<
    string,
    { caseId: string | null; unitLandedCostCentsOverride: number | null; lookup: CaseCostLookup | null }
  >();

  for (const row of caseRes.rows) {
    const res = row.results ?? {};
    const assumptions = row.assumptions ?? {};
    const netRev = typeof res.netRevenueCents === "number" ? res.netRevenueCents : null;
    const netProfit = typeof res.netProfitCents === "number" ? res.netProfitCents : null;
    const landed =
      typeof res.landedCostCents === "number"
        ? res.landedCostCents
        : typeof assumptions.landedCostCents === "number"
          ? assumptions.landedCostCents
          : null;
    const amortized = typeof res.amortizedFixedCostCents === "number" ? res.amortizedFixedCostCents : 0;

    let planNetMarginRate: number | null = null;
    if (typeof res.netRevenueMarginRate === "number") {
      planNetMarginRate = res.netRevenueMarginRate;
    } else if (netRev && netRev > 0 && netProfit !== null) {
      planNetMarginRate = netProfit / netRev;
    } else if (typeof res.marginRate === "number") {
      planNetMarginRate = res.marginRate;
    }

    let planPlatformMarginRate: number | null = null;
    if (typeof res.platformContributionMarginRate === "number") {
      planPlatformMarginRate = res.platformContributionMarginRate;
    } else if (netRev && netRev > 0 && netProfit !== null && landed !== null) {
      // 兼容旧版 cost_models.results：把采购成本和一次性摊销加回估算平台侧贡献
      const approxPlatform = netProfit + landed + amortized;
      planPlatformMarginRate = approxPlatform / netRev;
    }

    const lookup: CaseCostLookup = {
      id: row.id,
      asin: row.asin,
      unitLandedCostCents: landed,
      unitAmortizedFixedCostCents: amortized,
      planPlatformMarginRate,
      planNetMarginRate,
    };
    byCaseId.set(row.id, lookup);
    bySku.set(row.asin.toUpperCase(), { caseId: row.id, unitLandedCostCentsOverride: null, lookup });
    bySku.set(`SKU-${row.asin.toUpperCase()}`, { caseId: row.id, unitLandedCostCentsOverride: null, lookup });
  }

  // 显式映射优先覆盖默认 ASIN 猜测
  const mapRes = await db.query<{
    channel_sku: string;
    case_id: string | null;
    unit_landed_cost_cents_override: number | null;
  }>(
    `SELECT channel_sku, case_id, unit_landed_cost_cents_override
     FROM channel_sku_mappings
     WHERE UPPER(marketplace) = UPPER($1) AND is_demo = $2`,
    [marketplace, isDemo],
  );
  for (const m of mapRes.rows) {
    const lookup = m.case_id ? byCaseId.get(m.case_id) ?? null : null;
    bySku.set(m.channel_sku.toUpperCase(), {
      caseId: m.case_id,
      unitLandedCostCentsOverride:
        m.unit_landed_cost_cents_override !== null ? Number(m.unit_landed_cost_cents_override) : null,
      lookup,
    });
  }

  return { byCaseId, bySku };
}

export async function saveOperationsBatch(params: {
  label: string;
  marketplace: string;
  currency: string;
  createdBy: string;
  result: PipelineResult;
  settlementFileName?: string;
  inventoryFileName?: string;
}, options?: ModeOptions): Promise<SavedOperationsBatch> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  const demo = isDemoMode(mode);
  const batchId = `ops-${randomUUID().slice(0, 12)}`;
  const periods = params.result.periods ?? [];
  const { bySku } = await loadCaseLookupForMarketplace(params.marketplace, demo);

  let totalRevenueCents = 0;
  let totalContributionCents = 0;
  let totalNetProfitAccum = 0;
  let landedCostCoveredCount = 0;
  let stockoutRiskCount = 0;
  const periodKeys: string[] = [];

  const skuRows: SavedOperationsSkuRow[] = periods.map((p) => {
    const rev = p.contribution.netRevenueCents;
    const grossRev = typeof p.grossRevenueCents === "number" && p.grossRevenueCents > 0 ? p.grossRevenueCents : rev;
    const refundCents = typeof p.refundCents === "number" ? p.refundCents : 0;
    const discountCents = typeof p.discountCents === "number" ? p.discountCents : 0;
    const grossUnits = typeof p.grossUnits === "number" && p.grossUnits > 0 ? p.grossUnits : p.units;
    const refundUnits = typeof p.refundUnits === "number" ? p.refundUnits : 0;
    const costsByKey = p.costsByKey ?? {};

    const platformFeeCents = costsByKey.platformFee ?? 0;
    const fulfillmentFeeCents = costsByKey.fulfillmentFee ?? 0;
    const settlementAdCents = costsByKey.adCost ?? 0;
    const externalAdSpendCents = typeof p.externalAdSpendCents === "number" ? p.externalAdSpendCents : 0;
    const adResolved = resolveEffectiveAdSpend(settlementAdCents, externalAdSpendCents, "dedupe_max");
    const totalAdSpendCents = adResolved.effectiveTotalAdCents;
    const adAttribution: AdAttributionSource =
      p.adAttribution ??
      (externalAdSpendCents > 0 ? "ads_report" : settlementAdCents > 0 ? "settlement" : "missing");
    const storageFeeCents = (costsByKey.storage ?? 0) + (costsByKey.longTermStorage ?? 0);
    const otherFeeCents =
      (costsByKey.other ?? 0) +
      (costsByKey.removalFee ?? 0) +
      (costsByKey.couponDealFee ?? 0) +
      (costsByKey.vatOrSalesTax ?? 0) +
      (costsByKey.fxLoss ?? 0) +
      (costsByKey.returnLoss ?? 0);

    const contrib = p.contribution.contributionProfitCents;
    const marginRate = rev > 0 ? contrib / rev : 0;
    const days = p.inventoryDays?.days ?? null;
    const risk = classifyStockoutRisk(days);
    if (risk === "critical" || risk === "warning") stockoutRiskCount += 1;

    totalRevenueCents += rev;
    totalContributionCents += contrib;
    if (p.periodKey) periodKeys.push(p.periodKey);

    const matched = bySku.get(p.skuKey.toUpperCase()) ?? null;
    const effectiveUnitLanded =
      p.unitLandedCostCents ??
      matched?.unitLandedCostCentsOverride ??
      matched?.lookup?.unitLandedCostCents ??
      null;
    const landedCostCents =
      effectiveUnitLanded !== null ? Math.round(effectiveUnitLanded * p.units) : null;
    const amortizedTotal = Math.round((matched?.lookup?.unitAmortizedFixedCostCents ?? 0) * p.units);
    const netProfitCents =
      landedCostCents !== null
        ? contrib - landedCostCents - adResolved.incrementalDeductionCents - amortizedTotal
        : null;
    const netMarginRate = netProfitCents !== null && rev > 0 ? netProfitCents / rev : null;
    const costBasis: "true_net_profit" | "platform_contribution_only" =
      netProfitCents !== null ? "true_net_profit" : "platform_contribution_only";

    if (netProfitCents !== null) {
      totalNetProfitAccum += netProfitCents;
      landedCostCoveredCount += 1;
    }

    const planPlatformMarginRate = matched?.lookup?.planPlatformMarginRate ?? null;
    const planNetMarginRate = matched?.lookup?.planNetMarginRate ?? null;

    // 严格同口径：有采购成本用真实净利率 vs 预测净利率（净营收分母）；无采购成本用平台贡献率 vs 预测平台贡献率
    const planMarginRate =
      costBasis === "true_net_profit" ? planNetMarginRate : planPlatformMarginRate;
    const actualComparableRate = costBasis === "true_net_profit" ? netMarginRate : marginRate;
    const marginDelta =
      planMarginRate !== null && actualComparableRate !== null
        ? actualComparableRate - planMarginRate
        : null;

    const breakdown = p.forecast?.breakdown ?? [];

    return {
      id: `opsku-${randomUUID().slice(0, 12)}`,
      batchId,
      caseId: matched?.caseId ?? null,
      sku: p.skuKey,
      periodKey: p.periodKey,
      unitsSold: p.units,
      grossUnits,
      refundUnits,
      grossRevenueCents: grossRev,
      revenueCents: rev,
      refundCents,
      discountCents,
      platformFeeCents,
      fulfillmentFeeCents,
      adSpendCents: totalAdSpendCents,
      externalAdSpendCents,
      adAttribution,
      storageFeeCents,
      otherFeeCents,
      fbaFeeCents: fulfillmentFeeCents,
      costsByKey,
      contributionCents: contrib,
      marginRate,
      unitLandedCostCents: effectiveUnitLanded,
      landedCostCents,
      netProfitCents,
      netMarginRate,
      costBasis,
      availableUnits: p.inventory?.availableUnits ?? null,
      daysOfSupply: days !== null ? Math.round(days) : null,
      stockoutRisk: risk,
      planMarginRate,
      planPlatformMarginRate,
      planNetMarginRate,
      marginDelta,
      breakdown,
    };
  });

  const avgMarginRate = totalRevenueCents > 0 ? totalContributionCents / totalRevenueCents : 0;
  const totalNetProfitCents = landedCostCoveredCount > 0 ? totalNetProfitAccum : null;
  const sortedPeriods = [...new Set(periodKeys)].sort();
  const periodStart = sortedPeriods[0] ?? "";
  const periodEnd = sortedPeriods[sortedPeriods.length - 1] ?? "";

  await db.query(
    `INSERT INTO operations_settlement_batches
      (id, label, marketplace, currency, period_start, period_end, settlement_file_name, inventory_file_name,
       sku_count, total_revenue_cents, total_contribution_cents, avg_margin_rate, stockout_risk_count, created_by, summary, is_demo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16)`,
    [
      batchId,
      params.label.trim() || `${params.marketplace} 实盘账本 (${periodStart || new Date().toISOString().slice(0, 10)})`,
      params.marketplace.toUpperCase(),
      params.currency.toUpperCase(),
      periodStart,
      periodEnd,
      params.settlementFileName ?? null,
      params.inventoryFileName ?? null,
      skuRows.length,
      totalRevenueCents,
      totalContributionCents,
      avgMarginRate,
      stockoutRiskCount,
      params.createdBy || "管理员",
      JSON.stringify({
        warnings: params.result.warnings ?? [],
        landedCostCoveredCount,
        totalNetProfitCents,
      }),
      demo,
    ],
  );

  for (const row of skuRows) {
    await db.query(
      `INSERT INTO operations_sku_snapshots
        (id, batch_id, case_id, sku, period_key, units_sold, gross_units, refund_units,
         gross_revenue_cents, revenue_cents, refund_cents, discount_cents,
         platform_fee_cents, fulfillment_fee_cents, ad_spend_cents, external_ad_spend_cents, ad_attribution,
         storage_fee_cents, other_fee_cents, fba_fee_cents,
         contribution_cents, margin_rate, unit_landed_cost_cents, landed_cost_cents,
         net_profit_cents, net_margin_rate, cost_basis,
         available_units, days_of_supply, stockout_risk,
         plan_margin_rate, plan_platform_margin_rate, plan_net_margin_rate, margin_delta, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
               $9, $10, $11, $12,
               $13, $14, $15, $16, $17,
               $18, $19, $20,
               $21, $22, $23, $24,
               $25, $26, $27,
               $28, $29, $30,
               $31, $32, $33, $34, $35::jsonb)`,
      [
        row.id,
        batchId,
        row.caseId,
        row.sku,
        row.periodKey,
        row.unitsSold,
        row.grossUnits,
        row.refundUnits,
        row.grossRevenueCents,
        row.revenueCents,
        row.refundCents,
        row.discountCents,
        row.platformFeeCents,
        row.fulfillmentFeeCents,
        row.adSpendCents,
        row.externalAdSpendCents,
        row.adAttribution,
        row.storageFeeCents,
        row.otherFeeCents,
        row.fbaFeeCents,
        row.contributionCents,
        row.marginRate,
        row.unitLandedCostCents,
        row.landedCostCents,
        row.netProfitCents,
        row.netMarginRate,
        row.costBasis,
        row.availableUnits,
        row.daysOfSupply,
        row.stockoutRisk,
        row.planMarginRate,
        row.planPlatformMarginRate,
        row.planNetMarginRate,
        row.marginDelta,
        JSON.stringify({
          costsByKey: row.costsByKey,
          breakdown: row.breakdown,
        }),
      ],
    );
  }

  return {
    id: batchId,
    label: params.label.trim() || `${params.marketplace} 实盘账本`,
    marketplace: params.marketplace.toUpperCase(),
    currency: params.currency.toUpperCase(),
    periodStart,
    periodEnd,
    skuCount: skuRows.length,
    totalRevenueCents,
    totalContributionCents,
    totalNetProfitCents,
    landedCostCoveredCount,
    avgMarginRate,
    stockoutRiskCount,
    createdBy: params.createdBy || "管理员",
    createdAt: new Date().toISOString(),
    skus: skuRows,
  };
}

export async function listOperationsBatches(limit = 30, options?: ModeOptions): Promise<SavedOperationsBatch[]> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  const demo = isDemoMode(mode);
  const batchRes = await db.query<{
    id: string;
    label: string;
    marketplace: string;
    currency: string;
    period_start: string;
    period_end: string;
    sku_count: number;
    total_revenue_cents: number;
    total_contribution_cents: number;
    avg_margin_rate: string | number;
    stockout_risk_count: number;
    created_by: string;
    created_at: string;
  }>(
    `SELECT * FROM operations_settlement_batches WHERE is_demo = $2 ORDER BY created_at DESC LIMIT $1`,
    [limit, demo],
  );

  if (batchRes.rows.length === 0) return [];
  const batchIds = batchRes.rows.map((b) => b.id);
  const skuRes = await db.query<Record<string, unknown>>(
    `SELECT s.*
     FROM operations_sku_snapshots s
     JOIN operations_settlement_batches b ON b.id = s.batch_id
     WHERE s.batch_id = ANY($1::text[]) AND b.is_demo = $2
     ORDER BY s.contribution_cents DESC`,
    [batchIds, demo],
  );

  const skusByBatch = new Map<string, SavedOperationsSkuRow[]>();
  for (const r of skuRes.rows) {
    const batchId = String(r.batch_id);
    const payload = (r.payload && typeof r.payload === "object" ? r.payload : {}) as {
      costsByKey?: Partial<Record<ContributionCostKey, number>>;
      breakdown?: VarianceBreakdownItem[];
    };
    const list = skusByBatch.get(batchId) ?? [];
    const revenueCents = Number(r.revenue_cents ?? 0);
    const grossRevenueCents = Number(r.gross_revenue_cents ?? 0) || revenueCents;
    const unitsSold = Number(r.units_sold ?? 0);
    const grossUnits = Number(r.gross_units ?? 0) || unitsSold;
    const fulfillmentFeeCents =
      r.fulfillment_fee_cents !== null && r.fulfillment_fee_cents !== undefined
        ? Number(r.fulfillment_fee_cents)
        : Number(r.fba_fee_cents ?? 0);

    list.push({
      id: String(r.id),
      batchId,
      caseId: r.case_id ? String(r.case_id) : null,
      sku: String(r.sku),
      periodKey: String(r.period_key ?? ""),
      unitsSold,
      grossUnits,
      refundUnits: Number(r.refund_units ?? 0),
      grossRevenueCents,
      revenueCents,
      refundCents: Number(r.refund_cents ?? 0),
      discountCents: Number(r.discount_cents ?? 0),
      platformFeeCents: Number(r.platform_fee_cents ?? 0),
      fulfillmentFeeCents,
      adSpendCents: Number(r.ad_spend_cents ?? 0),
      externalAdSpendCents: Number(r.external_ad_spend_cents ?? 0),
      adAttribution: (r.ad_attribution as AdAttributionSource) || "missing",
      storageFeeCents: Number(r.storage_fee_cents ?? 0),
      otherFeeCents: Number(r.other_fee_cents ?? 0),
      fbaFeeCents: fulfillmentFeeCents,
      costsByKey: payload.costsByKey ?? {},
      contributionCents: Number(r.contribution_cents ?? 0),
      marginRate: Number(r.margin_rate ?? 0),
      unitLandedCostCents: r.unit_landed_cost_cents != null ? Number(r.unit_landed_cost_cents) : null,
      landedCostCents: r.landed_cost_cents != null ? Number(r.landed_cost_cents) : null,
      netProfitCents: r.net_profit_cents != null ? Number(r.net_profit_cents) : null,
      netMarginRate: r.net_margin_rate != null ? Number(r.net_margin_rate) : null,
      costBasis:
        r.cost_basis === "true_net_profit" ? "true_net_profit" : "platform_contribution_only",
      availableUnits: r.available_units != null ? Number(r.available_units) : null,
      daysOfSupply: r.days_of_supply != null ? Number(r.days_of_supply) : null,
      stockoutRisk: (r.stockout_risk as SavedOperationsSkuRow["stockoutRisk"]) || "unknown",
      planMarginRate: r.plan_margin_rate != null ? Number(r.plan_margin_rate) : null,
      planPlatformMarginRate:
        r.plan_platform_margin_rate != null ? Number(r.plan_platform_margin_rate) : null,
      planNetMarginRate: r.plan_net_margin_rate != null ? Number(r.plan_net_margin_rate) : null,
      marginDelta: r.margin_delta != null ? Number(r.margin_delta) : null,
      breakdown: Array.isArray(payload.breakdown) ? payload.breakdown : [],
    });
    skusByBatch.set(batchId, list);
  }

  return batchRes.rows.map((b) => {
    const skus = skusByBatch.get(b.id) ?? [];
    const covered = skus.filter((s) => s.netProfitCents !== null);
    const totalNetProfitCents =
      covered.length > 0 ? covered.reduce((acc, s) => acc + (s.netProfitCents ?? 0), 0) : null;
    return {
      id: b.id,
      label: b.label,
      marketplace: b.marketplace,
      currency: b.currency,
      periodStart: b.period_start,
      periodEnd: b.period_end,
      skuCount: Number(b.sku_count),
      totalRevenueCents: Number(b.total_revenue_cents),
      totalContributionCents: Number(b.total_contribution_cents),
      totalNetProfitCents,
      landedCostCoveredCount: covered.length,
      avgMarginRate: Number(b.avg_margin_rate),
      stockoutRiskCount: Number(b.stockout_risk_count),
      createdBy: b.created_by,
      createdAt: String(b.created_at),
      skus,
    };
  });
}

export async function deleteOperationsBatch(id: string, options?: ModeOptions): Promise<void> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  await db.query(`DELETE FROM operations_settlement_batches WHERE id = $1 AND is_demo = $2`, [
    id,
    isDemoMode(mode),
  ]);
}

export async function listChannelSkuMappings(
  marketplace?: string,
  options?: ModeOptions,
): Promise<ChannelSkuMapping[]> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  const params: unknown[] = [isDemoMode(mode)];
  const filters = ["m.is_demo = $1"];
  if (marketplace) {
    params.push(marketplace);
    filters.push(`UPPER(m.marketplace) = UPPER($${params.length})`);
  }

  const res = await db.query<{
    id: string;
    marketplace: string;
    channel_sku: string;
    case_id: string | null;
    case_asin: string | null;
    case_title: string | null;
    case_category: string | null;
    unit_landed_cost_cents_override: number | null;
    case_landed_cost_cents: string | number | null;
    notes: string;
    updated_at: string;
  }>(
    `SELECT m.id, m.marketplace, m.channel_sku, m.case_id,
            pc.asin AS case_asin, pc.title AS case_title, pc.category AS case_category,
            m.unit_landed_cost_cents_override,
            (SELECT (cm.assumptions->>'landedCostCents')::integer FROM cost_models cm WHERE cm.case_id = m.case_id ORDER BY cm.version DESC LIMIT 1) AS case_landed_cost_cents,
            m.notes, m.updated_at
     FROM channel_sku_mappings m
     LEFT JOIN product_cases pc ON pc.id = m.case_id AND pc.is_demo = m.is_demo
     WHERE ${filters.join(" AND ")}
     ORDER BY m.updated_at DESC`,
    params,
  );

  return res.rows.map((r) => {
    const override =
      r.unit_landed_cost_cents_override !== null ? Number(r.unit_landed_cost_cents_override) : null;
    const fromCase = r.case_landed_cost_cents !== null ? Number(r.case_landed_cost_cents) : null;
    return {
      id: r.id,
      marketplace: r.marketplace,
      channelSku: r.channel_sku,
      caseId: r.case_id,
      caseAsin: r.case_asin,
      caseTitle: r.case_title,
      caseCategory: r.case_category,
      unitLandedCostCentsOverride: override,
      effectiveUnitLandedCostCents: override ?? fromCase,
      notes: r.notes ?? "",
      updatedAt: String(r.updated_at),
    };
  });
}

/**
 * 写入或更新 SKU → 案卷 / 单位到岸成本映射，并自动回填历史账本中该 SKU 的真实净利与同口径偏差。
 */
export async function upsertChannelSkuMapping(input: {
  marketplace: string;
  channelSku: string;
  caseId?: string | null;
  unitLandedCostCentsOverride?: number | null;
  notes?: string;
}, options?: ModeOptions): Promise<{ mapping: ChannelSkuMapping; updatedSnapshotCount: number }> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  const demo = isDemoMode(mode);
  const marketplace = input.marketplace.trim().toUpperCase() || "US";
  const channelSku = input.channelSku.trim();
  if (!channelSku) throw new Error("channelSku 不能为空");

  const caseId = input.caseId && input.caseId.trim() ? input.caseId.trim() : null;
  if (caseId) {
    const caseRes = await db.query<{ id: string }>(
      `SELECT id FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [caseId, demo],
    );
    if (!caseRes.rows[0]) throw new Error("未找到对应商品案卷");
  }
  const override =
    typeof input.unitLandedCostCentsOverride === "number" &&
    Number.isFinite(input.unitLandedCostCentsOverride) &&
    input.unitLandedCostCentsOverride >= 0
      ? Math.round(input.unitLandedCostCentsOverride)
      : null;

  const id = `skumap-${randomUUID().slice(0, 12)}`;
  await db.query(
    `INSERT INTO channel_sku_mappings
       (id, marketplace, channel_sku, case_id, unit_landed_cost_cents_override, notes, is_demo, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (marketplace, channel_sku, is_demo)
     DO UPDATE SET
       case_id = EXCLUDED.case_id,
       unit_landed_cost_cents_override = EXCLUDED.unit_landed_cost_cents_override,
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [id, marketplace, channelSku, caseId, override, input.notes?.trim() ?? "", demo],
  );

  // 回填并重算该站点下该 SKU 的所有历史账本快照
  const { byCaseId } = await loadCaseLookupForMarketplace(marketplace, demo);
  const lookup = caseId ? byCaseId.get(caseId) ?? null : null;
  const effectiveUnitLanded = override ?? lookup?.unitLandedCostCents ?? null;
  const amortizedUnit = lookup?.unitAmortizedFixedCostCents ?? 0;
  const planPlatform = lookup?.planPlatformMarginRate ?? null;
  const planNet = lookup?.planNetMarginRate ?? null;

  const snapRes = await db.query<{
    id: string;
    units_sold: number;
    revenue_cents: number;
    contribution_cents: number;
    external_ad_spend_cents: number;
    margin_rate: string | number;
    payload: { costsByKey?: Partial<Record<ContributionCostKey, number>> } | null;
  }>(
    `SELECT s.id, s.units_sold, s.revenue_cents, s.contribution_cents, s.external_ad_spend_cents, s.margin_rate, s.payload
     FROM operations_sku_snapshots s
     JOIN operations_settlement_batches b ON b.id = s.batch_id
     WHERE UPPER(b.marketplace) = UPPER($1) AND UPPER(s.sku) = UPPER($2) AND b.is_demo = $3`,
    [marketplace, channelSku, demo],
  );

  for (const snap of snapRes.rows) {
    const units = Number(snap.units_sold);
    const rev = Number(snap.revenue_cents);
    const contrib = Number(snap.contribution_cents);
    const settlementAd = Number(snap.payload?.costsByKey?.adCost ?? 0);
    const extAd = Number(snap.external_ad_spend_cents ?? 0);
    const adResolved = resolveEffectiveAdSpend(settlementAd, extAd, "dedupe_max");
    const platformMargin = Number(snap.margin_rate);

    const landedTotal = effectiveUnitLanded !== null ? Math.round(effectiveUnitLanded * units) : null;
    const netProfit =
      landedTotal !== null
        ? contrib - landedTotal - adResolved.incrementalDeductionCents - Math.round(amortizedUnit * units)
        : null;
    const netMargin = netProfit !== null && rev > 0 ? netProfit / rev : null;
    const costBasis = netProfit !== null ? "true_net_profit" : "platform_contribution_only";
    const planRate = costBasis === "true_net_profit" ? planNet : planPlatform;
    const actualRate = costBasis === "true_net_profit" ? netMargin : platformMargin;
    const delta = planRate !== null && actualRate !== null ? actualRate - planRate : null;

    await db.query(
      `UPDATE operations_sku_snapshots
       SET case_id = $1,
           unit_landed_cost_cents = $2,
           landed_cost_cents = $3,
           net_profit_cents = $4,
           net_margin_rate = $5,
           cost_basis = $6,
           plan_margin_rate = $7,
           plan_platform_margin_rate = $8,
           plan_net_margin_rate = $9,
           margin_delta = $10
       WHERE id = $11
         AND batch_id IN (SELECT id FROM operations_settlement_batches WHERE is_demo = $12)`,
      [
        caseId,
        effectiveUnitLanded,
        landedTotal,
        netProfit,
        netMargin,
        costBasis,
        planRate,
        planPlatform,
        planNet,
        delta,
        snap.id,
        demo,
      ],
    );
  }

  const all = await listChannelSkuMappings(marketplace, { mode });
  const mapping = all.find((m) => m.channelSku.toUpperCase() === channelSku.toUpperCase());
  if (!mapping) throw new Error("保存 SKU 映射后读取失败");
  return { mapping, updatedSnapshotCount: snapRes.rows.length };
}

export async function deleteChannelSkuMapping(id: string, options?: ModeOptions): Promise<void> {
  const db = await getDb();
  const mode = options?.mode ?? (await getAppMode());
  await db.query(`DELETE FROM channel_sku_mappings WHERE id = $1 AND is_demo = $2`, [
    id,
    isDemoMode(mode),
  ]);
}
