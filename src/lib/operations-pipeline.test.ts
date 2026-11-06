/**
 * 计算管线的端到端验证。所有报表内容都是**人工合成示例**，不是真实平台导出。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { FBA_INVENTORY_COLUMNS, SETTLEMENT_V2_COLUMNS, computeRawHash } from "./report-adapters.ts";
import { runOperationsPipeline, type PipelineOptions } from "./operations-pipeline.ts";

const SETTLEMENT_DEFAULTS = {
  "settlement-id": "SET-2026-10B",
  "settlement-start-date": "2026-10-16T00:00:00-07:00",
  "settlement-end-date": "2026-10-31T00:00:00-07:00",
  "deposit-date": "2026-11-02T00:00:00-08:00",
  currency: "USD",
  "transaction-type": "Order",
  "order-id": "ORD-1",
  "amount-type": "ItemPrice",
  "amount-description": "Principal",
  amount: "100.00",
  "posted-date": "2026-10-29",
  "posted-date-time": "2026-10-29T23:30:00-07:00",
  sku: "SKU-A",
  "quantity-purchased": "2",
};

function settlementTsv(overrides: Array<Record<string, string>> = [{}]): string {
  const columns = Object.values(SETTLEMENT_V2_COLUMNS);
  const header = columns.join("\t");
  const rows = overrides.map((override) =>
    columns.map((column) => ({ ...SETTLEMENT_DEFAULTS, ...override })[column] ?? "").join("\t"),
  );
  return `${header}\n${rows.join("\n")}\n`;
}

const INVENTORY_DEFAULTS = {
  sku: "SKU-A",
  fnsku: "FNSKU-1",
  asin: "ASIN-1",
  "afn-fulfillable-quantity": "120",
  "afn-reserved-quantity": "3",
  "afn-unsellable-quantity": "1",
  "afn-inbound-working-quantity": "10",
  "afn-inbound-shipped-quantity": "5",
  "afn-inbound-receiving-quantity": "2",
};

function inventoryTsv(overrides: Array<Record<string, string>> = [{}]): string {
  const columns = Object.values(FBA_INVENTORY_COLUMNS);
  const rows = overrides.map((override) =>
    columns.map((column) => ({ ...INVENTORY_DEFAULTS, ...override })[column] ?? "").join("\t"),
  );
  return `${columns.join("\t")}\n${rows.join("\n")}\n`;
}

const baseOptions = (): PipelineOptions => ({
  settlement: {
    ingestionRunId: "run-pipeline-1",
    marketplaceCode: "US",
    reportTimezone: "America/Los_Angeles",
    reportingCurrency: "USD",
  },
  inventory: {
    ingestionRunId: "run-pipeline-2",
    marketplaceCode: "US",
    reportTimezone: "America/Los_Angeles",
    reportingCurrency: "USD",
    snapshotDate: "2026-10-31",
  },
  policy: "settlement",
  reportingCurrency: "USD",
});

test("pipeline joins settlement, inventory, forecast and stock days into one auditable row", () => {
  const settlementText = settlementTsv([
    {},
    { "amount-type": "ItemFees", "amount-description": "Commission", amount: "-15.00", "quantity-purchased": "" },
    { "amount-type": "ItemFees", "amount-description": "FBAPerUnitFulfillmentFee", amount: "-8.50", "quantity-purchased": "" },
    { "amount-type": "Promotion", "amount-description": "Shipping discount", amount: "-5.00", "quantity-purchased": "" },
  ]);
  const inventoryText = inventoryTsv();
  const options = baseOptions();
  options.forecastsBySku = {
    "SKU-A": {
      unitNetProfitCents: 4_000,
      costModelVersion: "cm-v1",
      forecastCurrency: "USD",
      minDenominatorCents: 1_000,
    },
  };
  options.inventoryDays = {
    windowDays: 7,
    minDailySales: 0.5,
    dailySalesBySku: { "SKU-A": [2, 2, 2] },
  };

  const result = runOperationsPipeline({ settlementText, inventoryText }, options);

  assert.equal(result.settlement.lineCount, 4);
  assert.equal(result.settlement.unmapped.length, 0);
  assert.equal(result.inventory?.snapshotCount, 1);
  assert.equal(result.periods.length, 1);

  const period = result.periods[0];
  assert.equal(period.skuKey, "SKU-A");
  assert.equal(period.periodKey, "2026-10");
  assert.equal(period.units, 2);
  assert.equal(period.contribution.contributionProfitCents, 7_150);
  assert.deepEqual(period.rawHashes, [computeRawHash(settlementText)]);
  assert.deepEqual(period.ingestionRunIds, ["run-pipeline-1"]);

  assert.equal(period.forecast?.folded.foldedProfitCents, 8_000);
  assert.equal(period.forecast?.variance.differenceCents, -850);
  assert.equal(period.inventory?.availableUnits, 120);
  assert.equal(period.inventory?.inTransitUnits, 17);
  assert.equal(period.inventoryDays?.days, 60);
  assert.equal(period.inventoryDays?.fallbackApplied, true);

  assert.ok(result.warnings.some((warning) => /缺少订单日期/.test(warning)));
  assert.ok(result.warnings.some((warning) => /多对一映射/.test(warning)));
});

test("missing inputs produce explicit warnings and nulls instead of guessed numbers", () => {
  const settlementText = settlementTsv([{}, { "amount-type": "unknown-kind", sku: "" }]);
  const options = baseOptions();
  options.inventoryDays = { windowDays: 28, minDailySales: 1 };

  const result = runOperationsPipeline({ settlementText }, options);
  const period = result.periods[0];
  assert.equal(period.forecast, null);
  assert.equal(period.inventory, null);
  assert.equal(period.inventoryDays, null);
  assert.equal(result.inventory, null);
  assert.equal(result.settlement.unmapped.length, 1);
  assert.ok(result.warnings.some((warning) => /待处理队列/.test(warning)));
  assert.ok(result.warnings.some((warning) => /不计算库存天数/.test(warning)));
});

test("providing inventory text without inventory options fails loudly", () => {
  assert.throws(
    () =>
      runOperationsPipeline(
        { settlementText: settlementTsv(), inventoryText: inventoryTsv() },
        { ...baseOptions(), inventory: undefined },
      ),
    /inventory options are required/,
  );
});

test("forecast currency mismatch is not swallowed by the pipeline", () => {
  const options = baseOptions();
  options.forecastsBySku = {
    "SKU-A": {
      unitNetProfitCents: 4_000,
      costModelVersion: "cm-v1",
      forecastCurrency: "CNY",
      minDenominatorCents: 1_000,
    },
  };
  assert.throws(
    () => runOperationsPipeline({ settlementText: settlementTsv() }, options),
    /must match settlement currency/,
  );
});

test("order-month policy uses the supplied order date and reports no fallback", () => {
  const options = baseOptions();
  options.policy = "order";
  options.settlement = {
    ...options.settlement,
    orderDateByOrderId: { "ORD-1": "2026-09-28" },
  };
  const result = runOperationsPipeline({ settlementText: settlementTsv() }, options);
  assert.equal(result.periods[0].periodKey, "2026-09");
  assert.equal(result.settlement.orderDateFallbackCount, 0);
  assert.ok(!result.warnings.some((warning) => /缺少订单日期/.test(warning)));
});

test("duplicate inventory sku keeps the newer snapshot and records a warning", () => {
  const options = baseOptions();
  options.inventory = { ...options.inventory!, snapshotDate: "2026-10-31" };
  const result = runOperationsPipeline(
    { settlementText: settlementTsv(), inventoryText: inventoryTsv([{}, { "afn-fulfillable-quantity": "50" }]) },
    options,
  );
  assert.equal(result.inventory?.snapshotCount, 2);
  assert.equal(result.periods[0].inventory?.availableUnits, 50);
  assert.ok(result.warnings.some((warning) => /重复 SKU/.test(warning)));
});
