import { randomUUID } from "node:crypto";
import { getDb } from "./db.ts";
import type { PipelineResult } from "./operations-pipeline.ts";

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
  revenueCents: number;
  refundCents: number;
  adSpendCents: number;
  fbaFeeCents: number;
  contributionCents: number;
  marginRate: number;
  availableUnits: number | null;
  daysOfSupply: number | null;
  stockoutRisk: "critical" | "warning" | "healthy" | "unknown";
  planMarginRate: number | null;
  marginDelta: number | null;
};

function classifyStockoutRisk(days: number | null): "critical" | "warning" | "healthy" | "unknown" {
  if (days === null || !Number.isFinite(days)) return "unknown";
  if (days < 15) return "critical";
  if (days < 30) return "warning";
  return "healthy";
}

let opsTablesReadyPromise: Promise<void> | null = null;

async function ensureOperationsTables(): Promise<void> {
  if (!opsTablesReadyPromise) {
    opsTablesReadyPromise = (async () => {
      const db = await getDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS operations_settlement_batches (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          marketplace TEXT NOT NULL DEFAULT 'US',
          currency TEXT NOT NULL DEFAULT 'USD',
          period_start TEXT NOT NULL DEFAULT '',
          period_end TEXT NOT NULL DEFAULT '',
          settlement_file_name TEXT,
          inventory_file_name TEXT,
          sku_count INTEGER NOT NULL DEFAULT 0,
          total_revenue_cents INTEGER NOT NULL DEFAULT 0,
          total_contribution_cents INTEGER NOT NULL DEFAULT 0,
          avg_margin_rate NUMERIC(8, 6) NOT NULL DEFAULT 0,
          stockout_risk_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '管理员',
          summary JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS operations_sku_snapshots (
          id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL REFERENCES operations_settlement_batches(id) ON DELETE CASCADE,
          case_id TEXT REFERENCES product_cases(id) ON DELETE SET NULL,
          sku TEXT NOT NULL,
          period_key TEXT NOT NULL DEFAULT '',
          units_sold INTEGER NOT NULL DEFAULT 0,
          revenue_cents INTEGER NOT NULL DEFAULT 0,
          refund_cents INTEGER NOT NULL DEFAULT 0,
          ad_spend_cents INTEGER NOT NULL DEFAULT 0,
          fba_fee_cents INTEGER NOT NULL DEFAULT 0,
          contribution_cents INTEGER NOT NULL DEFAULT 0,
          margin_rate NUMERIC(8, 6) NOT NULL DEFAULT 0,
          available_units INTEGER,
          days_of_supply INTEGER,
          stockout_risk TEXT NOT NULL DEFAULT 'unknown'
            CHECK (stockout_risk IN ('critical', 'warning', 'healthy', 'unknown')),
          plan_margin_rate NUMERIC(8, 6),
          margin_delta NUMERIC(8, 6),
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((err) => {
      opsTablesReadyPromise = null;
      throw err;
    });
  }
  await opsTablesReadyPromise;
}

export async function saveOperationsBatch(params: {
  label: string;
  marketplace: string;
  currency: string;
  createdBy: string;
  result: PipelineResult;
  settlementFileName?: string;
  inventoryFileName?: string;
}): Promise<SavedOperationsBatch> {
  await ensureOperationsTables();
  const db = await getDb();
  const batchId = `ops-${randomUUID().slice(0, 12)}`;
  const periods = params.result.periods ?? [];

  // 尝试按 ASIN / SKU 自动匹配已有商品案卷
  const caseRes = await db.query<{ id: string; asin: string; margin_rate: number | null }>(
    `SELECT pc.id, pc.asin,
            (SELECT (cm.results->>'marginRate')::numeric FROM cost_models cm WHERE cm.case_id = pc.id ORDER BY cm.version DESC LIMIT 1) AS margin_rate
     FROM product_cases pc
     WHERE UPPER(pc.marketplace) = UPPER($1)`,
    [params.marketplace],
  );
  const caseBySku = new Map<string, { id: string; planMarginRate: number | null }>();
  for (const row of caseRes.rows) {
    const planMargin = row.margin_rate != null ? Number(row.margin_rate) : null;
    caseBySku.set(row.asin.toUpperCase(), { id: row.id, planMarginRate: planMargin });
    caseBySku.set(`SKU-${row.asin.toUpperCase()}`, { id: row.id, planMarginRate: planMargin });
  }

  let totalRevenueCents = 0;
  let totalContributionCents = 0;
  let stockoutRiskCount = 0;
  const periodKeys: string[] = [];

  const skuRows: SavedOperationsSkuRow[] = periods.map((p) => {
    const rev = p.contribution.netRevenueCents;
    const contrib = p.contribution.contributionProfitCents;
    const marginRate = rev > 0 ? contrib / rev : 0;
    const days = p.inventoryDays?.days ?? null;
    const risk = classifyStockoutRisk(days);
    if (risk === "critical" || risk === "warning") stockoutRiskCount += 1;

    totalRevenueCents += rev;
    totalContributionCents += contrib;
    if (p.periodKey) periodKeys.push(p.periodKey);

    const matched = caseBySku.get(p.skuKey.toUpperCase()) ?? null;
    const planMarginRate = matched?.planMarginRate ?? null;
    const marginDelta = planMarginRate !== null ? marginRate - planMarginRate : null;

    return {
      id: `opsku-${randomUUID().slice(0, 12)}`,
      batchId,
      caseId: matched?.id ?? null,
      sku: p.skuKey,
      periodKey: p.periodKey,
      unitsSold: p.units,
      revenueCents: rev,
      refundCents: 0,
      adSpendCents: 0,
      fbaFeeCents: p.contribution.chargedCents ?? 0,
      contributionCents: contrib,
      marginRate,
      availableUnits: p.inventory?.availableUnits ?? null,
      daysOfSupply: days !== null ? Math.round(days) : null,
      stockoutRisk: risk,
      planMarginRate,
      marginDelta,
    };
  });

  const avgMarginRate = totalRevenueCents > 0 ? totalContributionCents / totalRevenueCents : 0;
  const sortedPeriods = [...new Set(periodKeys)].sort();
  const periodStart = sortedPeriods[0] ?? "";
  const periodEnd = sortedPeriods[sortedPeriods.length - 1] ?? "";

  await db.query(
    `INSERT INTO operations_settlement_batches
      (id, label, marketplace, currency, period_start, period_end, settlement_file_name, inventory_file_name,
       sku_count, total_revenue_cents, total_contribution_cents, avg_margin_rate, stockout_risk_count, created_by, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
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
      JSON.stringify({ warnings: params.result.warnings ?? [] }),
    ],
  );

  for (const row of skuRows) {
    await db.query(
      `INSERT INTO operations_sku_snapshots
        (id, batch_id, case_id, sku, period_key, units_sold, revenue_cents, refund_cents, ad_spend_cents, fba_fee_cents,
         contribution_cents, margin_rate, available_units, days_of_supply, stockout_risk, plan_margin_rate, margin_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        row.id,
        batchId,
        row.caseId,
        row.sku,
        row.periodKey,
        row.unitsSold,
        row.revenueCents,
        row.refundCents,
        row.adSpendCents,
        row.fbaFeeCents,
        row.contributionCents,
        row.marginRate,
        row.availableUnits,
        row.daysOfSupply,
        row.stockoutRisk,
        row.planMarginRate,
        row.marginDelta,
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
    avgMarginRate,
    stockoutRiskCount,
    createdBy: params.createdBy || "管理员",
    createdAt: new Date().toISOString(),
    skus: skuRows,
  };
}

export async function listOperationsBatches(limit = 30): Promise<SavedOperationsBatch[]> {
  await ensureOperationsTables();
  const db = await getDb();
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
    `SELECT * FROM operations_settlement_batches ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );

  if (batchRes.rows.length === 0) return [];
  const batchIds = batchRes.rows.map((b) => b.id);
  const skuRes = await db.query<{
    id: string;
    batch_id: string;
    case_id: string | null;
    sku: string;
    period_key: string;
    units_sold: number;
    revenue_cents: number;
    refund_cents: number;
    ad_spend_cents: number;
    fba_fee_cents: number;
    contribution_cents: number;
    margin_rate: string | number;
    available_units: number | null;
    days_of_supply: number | null;
    stockout_risk: "critical" | "warning" | "healthy" | "unknown";
    plan_margin_rate: string | number | null;
    margin_delta: string | number | null;
  }>(
    `SELECT * FROM operations_sku_snapshots WHERE batch_id = ANY($1::text[]) ORDER BY contribution_cents DESC`,
    [batchIds],
  );

  const skusByBatch = new Map<string, SavedOperationsSkuRow[]>();
  for (const r of skuRes.rows) {
    const list = skusByBatch.get(r.batch_id) ?? [];
    list.push({
      id: r.id,
      batchId: r.batch_id,
      caseId: r.case_id,
      sku: r.sku,
      periodKey: r.period_key,
      unitsSold: Number(r.units_sold),
      revenueCents: Number(r.revenue_cents),
      refundCents: Number(r.refund_cents),
      adSpendCents: Number(r.ad_spend_cents),
      fbaFeeCents: Number(r.fba_fee_cents),
      contributionCents: Number(r.contribution_cents),
      marginRate: Number(r.margin_rate),
      availableUnits: r.available_units !== null ? Number(r.available_units) : null,
      daysOfSupply: r.days_of_supply !== null ? Number(r.days_of_supply) : null,
      stockoutRisk: r.stockout_risk,
      planMarginRate: r.plan_margin_rate !== null ? Number(r.plan_margin_rate) : null,
      marginDelta: r.margin_delta !== null ? Number(r.margin_delta) : null,
    });
    skusByBatch.set(r.batch_id, list);
  }

  return batchRes.rows.map((b) => ({
    id: b.id,
    label: b.label,
    marketplace: b.marketplace,
    currency: b.currency,
    periodStart: b.period_start,
    periodEnd: b.period_end,
    skuCount: Number(b.sku_count),
    totalRevenueCents: Number(b.total_revenue_cents),
    totalContributionCents: Number(b.total_contribution_cents),
    avgMarginRate: Number(b.avg_margin_rate),
    stockoutRiskCount: Number(b.stockout_risk_count),
    createdBy: b.created_by,
    createdAt: String(b.created_at),
    skus: skusByBatch.get(b.id) ?? [],
  }));
}

export async function deleteOperationsBatch(id: string): Promise<void> {
  await ensureOperationsTables();
  const db = await getDb();
  await db.query(`DELETE FROM operations_settlement_batches WHERE id = $1`, [id]);
}
