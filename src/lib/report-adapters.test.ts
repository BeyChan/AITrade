/**
 * 报表适配器测试。
 *
 * 注意：本文件里的报表内容全部是**人工合成的示例数据**，不是真实平台导出。
 * 列名依据 Amazon 公开规范，但金额、行组合、日期与 SKU 均为构造值，仅用于验证
 * 解析与归一化逻辑；真实导出的字段取值仍需按 7.4 核对后才能接入导入通道。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  FBA_INVENTORY_COLUMNS,
  SETTLEMENT_V2_COLUMNS,
  ReportAdapterError,
  classifySettlementAmount,
  computeRawHash,
  normalizeFbaInventory,
  normalizeSettlementV2,
  parseDelimited,
  parseLocalizedAmount,
  parseReportTimestamp,
  type InventoryColumnKey,
  type SettlementColumnKey,
} from "./report-adapters.ts";
import {
  aggregateSettlement,
  compareWithForecast,
  validateInventorySnapshot,
} from "./operations-settlement.ts";

const SETTLEMENT_ROW: Record<SettlementColumnKey, string> = {
  settlementId: "SET-2026-10B",
  settlementStart: "2026-10-16T00:00:00-07:00",
  settlementEnd: "2026-10-31T00:00:00-07:00",
  depositDate: "2026-11-02T00:00:00-08:00",
  currency: "USD",
  transactionType: "Order",
  orderId: "ORD-1",
  marketplaceName: "amazon.com",
  amountType: "ItemPrice",
  amountDescription: "Principal",
  amount: "100.00",
  fulfillmentId: "AFN",
  postedDate: "2026-10-29",
  postedDateTime: "2026-10-29T23:30:00-07:00",
  sku: "SKU-A",
  quantityPurchased: "2",
  promotionId: "",
};

function settlementTsv(rows: Array<Partial<Record<SettlementColumnKey, string>>>): string {
  const keys = Object.keys(SETTLEMENT_V2_COLUMNS) as SettlementColumnKey[];
  const header = keys.map((key) => SETTLEMENT_V2_COLUMNS[key]).join("\t");
  const body = rows.map((row) => keys.map((key) => row[key] ?? SETTLEMENT_ROW[key]).join("\t")).join("\n");
  return `${header}\n${body}\n`;
}

const INVENTORY_ROW: Record<InventoryColumnKey, string> = {
  sku: "SKU-A",
  fnsku: "FNSKU-1",
  asin: "ASIN-1",
  available: "120",
  reserved: "3",
  unsellable: "1",
  inboundWorking: "10",
  inboundShipped: "5",
  inboundReceiving: "2",
};

function inventoryTsv(rows: Array<Partial<Record<InventoryColumnKey, string>>>): string {
  const keys = Object.keys(FBA_INVENTORY_COLUMNS) as InventoryColumnKey[];
  const header = keys.map((key) => FBA_INVENTORY_COLUMNS[key]).join("\t");
  const body = rows.map((row) => keys.map((key) => row[key] ?? INVENTORY_ROW[key]).join("\t")).join("\n");
  return `${header}\n${body}\n`;
}

const settlementOptions = {
  ingestionRunId: "run-synthetic-1",
  marketplaceCode: "US",
  reportTimezone: "America/Los_Angeles",
  reportingCurrency: "USD",
} as const;

test("parseDelimited handles BOM, CRLF, quoted fields and empty lines", () => {
  const text = '\uFEFFa\tb\r\n"x\ty"\t"he said ""hi"""\r\n\r\n1\t2\n';
  assert.deepEqual(parseDelimited(text, "\t"), [
    ["a", "b"],
    ["x\ty", 'he said "hi"'],
    ["1", "2"],
  ]);
  assert.deepEqual(parseDelimited('a,"b,c"\n', ","), [["a", "b,c"]]);
  assert.throws(() => parseDelimited('a\t"unclosed\n'), /unclosed quoted field/);
});

test("localized amounts must be parsed with an explicitly declared format", () => {
  assert.equal(parseLocalizedAmount("1,234.56", "us"), 123_456);
  assert.equal(parseLocalizedAmount("1.234,56", "eu"), 123_456);
  assert.equal(parseLocalizedAmount("-15.00", "us"), -1_500);
  assert.equal(parseLocalizedAmount("95,00", "eu"), 9_500);
  // 把欧洲写法当美国格式解析会静默放大 100 倍，必须直接失败。
  assert.throws(() => parseLocalizedAmount("95,00", "us"), ReportAdapterError);
  assert.throws(() => parseLocalizedAmount("1,234.56", "eu"), ReportAdapterError);
  assert.throws(() => parseLocalizedAmount("1.234", "us"), /unsupported amount/);
  assert.throws(() => parseLocalizedAmount("n/a", "us"), /unsupported amount/);
});

test("report timestamps keep the site calendar day instead of converting through local time", () => {
  const withOffset = parseReportTimestamp("2026-10-29T23:30:00-07:00");
  assert.equal(withOffset.siteDate, "2026-10-29");
  assert.equal(withOffset.offset, "-07:00");
  assert.equal(parseReportTimestamp("2026-11-01T00:00:00Z").siteDate, "2026-11-01");
  assert.equal(parseReportTimestamp("2026-11-01T00:00:00.123+01:00").siteDate, "2026-11-01");
  assert.equal(parseReportTimestamp("2026-10-29").offset, null);
  assert.throws(() => parseReportTimestamp("2026-02-30T00:00:00Z"), /invalid site-calendar date/);
  assert.throws(() => parseReportTimestamp("10/29/2026"), /unsupported report timestamp/);
  assert.throws(() => parseReportTimestamp("2026-10-29T00:00:00"), /unsupported report timestamp/);
});

test("only confirmed amount combinations are classified; account-level lines stay unmapped", () => {
  assert.deepEqual(classifySettlementAmount("ItemPrice", "Principal", "Order"), {
    kind: "revenue",
    source: "official",
  });
  assert.deepEqual(classifySettlementAmount("ItemPrice", "Principal", "Refund"), {
    kind: "refund",
    source: "official",
  });
  assert.deepEqual(classifySettlementAmount("ItemFees", "Commission", "Order"), {
    kind: "platformFee",
    source: "official",
  });
  assert.deepEqual(classifySettlementAmount("ItemFees", "FBAPerUnitFulfillmentFee", "Order"), {
    kind: "fulfillmentFee",
    source: "official",
  });
  assert.deepEqual(classifySettlementAmount("Promotion", "Shipping discount", "Order"), {
    kind: "discount",
    source: "official",
  });
  assert.equal(classifySettlementAmount("ItemFees", "UnknownNewFee", "Order"), null);
  assert.equal(classifySettlementAmount("other-transaction", "Reserve", "Order"), null);
  assert.equal(classifySettlementAmount("Transfer", "Storage Fee", "Order"), null);
  assert.equal(classifySettlementAmount("Cost of Advertising", "", "")?.source, "community");
});

test("settlement V2 normalizes a batch, keeps the contract, and quarantines unknown rows", () => {
  const text = settlementTsv([
    {},
    {
      amountType: "ItemFees",
      amountDescription: "Commission",
      amount: "-15.00",
      quantityPurchased: "",
    },
    {
      amountType: "ItemFees",
      amountDescription: "FBAPerUnitFulfillmentFee",
      amount: "-8.50",
      quantityPurchased: "",
    },
    {
      amountType: "Promotion",
      amountDescription: "Shipping discount",
      amount: "-5.00",
      quantityPurchased: "",
    },
    { amountType: "other-transaction", amountDescription: "Reserve", sku: "" },
    { amountType: "ItemFees", amountDescription: "BrandNewFee", amount: "-1.00" },
  ]);

  const result = normalizeSettlementV2(text, settlementOptions);
  assert.equal(result.batch.ingestionRunId, "run-synthetic-1");
  assert.equal(result.batch.rawHash, computeRawHash(text));
  assert.equal(result.batch.periodStart, "2026-10-16");
  assert.equal(result.batch.periodEnd, "2026-10-31");
  assert.equal(result.batch.observedAt, "2026-11-02");
  assert.equal(result.batch.currency, "USD");
  assert.equal(result.batch.reportTimezone, "America/Los_Angeles");

  assert.equal(result.lines.length, 4);
  const [revenue, commission, fulfillment, discount] = result.lines;
  assert.equal(revenue.kind, "revenue");
  assert.equal(revenue.amountCents, 10_000);
  assert.equal(revenue.units, 2);
  assert.equal(revenue.settlementDate, "2026-10-29");
  assert.equal(revenue.orderDate, "2026-10-29");
  assert.equal(commission.kind, "platformFee");
  assert.equal(commission.amountCents, 1_500);
  assert.equal(fulfillment.kind, "fulfillmentFee");
  assert.equal(fulfillment.amountCents, 850);
  assert.equal(discount.kind, "discount");
  assert.equal(discount.amountCents, 500);

  assert.equal(result.unmapped.length, 2);
  assert.match(result.unmapped[0].reason, /without a sku/);
  assert.match(result.unmapped[1].reason, /unmapped amount-type/);
  // 结算单没有订单日期，未提供订单报告时只能退回记账日，并显式计数。
  assert.equal(result.orderDateFallbackCount, 4);
  assert.equal(result.communityMappedCount, 0);
});

test("order report dates remove the fallback; deducted fees are flagged for double-count protection", () => {
  const text = settlementTsv([
    {},
    { amountType: "ItemFees", amountDescription: "Commission", amount: "-15.00", quantityPurchased: "" },
  ]);
  const result = normalizeSettlementV2(text, {
    ...settlementOptions,
    orderDateByOrderId: { "ORD-1": "2026-10-20" },
    deductedCostKeys: ["platformFee"],
  });

  assert.equal(result.orderDateFallbackCount, 0);
  assert.equal(result.lines[0].orderDate, "2026-10-20");
  assert.equal(result.lines[1].deductedInSettlement, true);

  const periods = aggregateSettlement(result.lines, { policy: "settlement", reportingCurrency: "USD" });
  assert.equal(periods.length, 1);
  // 10000 收入 − 0 费用（佣金已在净额扣除）= 10000；不能减成 8500。
  assert.equal(periods[0].contribution.netRevenueCents, 10_000);
  assert.equal(periods[0].contribution.contributionProfitCents, 10_000);
  assert.deepEqual(periods[0].contribution.skippedKeys, ["platformFee"]);

  const orderPeriods = aggregateSettlement(result.lines, { policy: "order", reportingCurrency: "USD" });
  assert.equal(orderPeriods[0].periodKey, "2026-10");
});

test("mixed settlement batches or currencies are quarantined, never merged", () => {
  const text = settlementTsv([
    {},
    { settlementId: "SET-2026-11A" },
    { currency: "EUR" },
    { settlementEnd: "2026-11-01T00:00:00-07:00" },
  ]);
  const result = normalizeSettlementV2(text, settlementOptions);
  assert.equal(result.lines.length, 1);
  assert.equal(result.unmapped.length, 3);
  assert.ok(result.unmapped.every((entry) => /different settlement batch or currency/.test(entry.reason)));
});

test("cross-currency batches require an explicit rate and rate date", () => {
  const text = settlementTsv([{ currency: "EUR", amount: "95,00" }]);
  assert.throws(
    () =>
      normalizeSettlementV2(text, {
        ...settlementOptions,
        marketplaceCode: "DE",
        reportTimezone: "Europe/Berlin",
        reportingCurrency: "CNY",
        decimalFormat: "eu",
      }),
    /cross-currency batches require a positive fxRate/,
  );

  const result = normalizeSettlementV2(text, {
    ...settlementOptions,
    marketplaceCode: "DE",
    reportTimezone: "Europe/Berlin",
    reportingCurrency: "CNY",
    decimalFormat: "eu",
    fxRate: 7.8,
    fxRateDate: "2026-10-31",
  });
  assert.equal(result.batch.currency, "EUR");
  assert.equal(result.batch.fxRate, 7.8);
  assert.equal(result.lines[0].amountCents, 9_500);
});

test("column overrides and non-US decimal formats are explicit, not guessed", () => {
  const custom = [
    "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\tcurrency\ttransaction-type\tamount-type\tamount-description\tamount\tposted-date\tsku",
    "SET-1\t2026-10-01\t2026-10-15\t2026-10-16\tEUR\tOrder\tItemPrice\tPrincipal\t95,00\t2026-10-05\tSKU-EU",
  ].join("\n");
  const result = normalizeSettlementV2(custom, {
    ...settlementOptions,
    marketplaceCode: "DE",
    reportTimezone: "Europe/Berlin",
    reportingCurrency: "EUR",
    decimalFormat: "eu",
    columns: { orderId: "missing-on-purpose" },
  });
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].amountCents, 9_500);
  assert.equal(result.lines[0].orderDate, "2026-10-05");
});

test("malformed rows are quarantined with a reason instead of being silently dropped", () => {
  const text = settlementTsv([
    {},
    { amount: "not-a-number" },
    { amount: "12.345" },
    { postedDateTime: "10/29/2026" },
    { quantityPurchased: "-2" },
  ]);
  const result = normalizeSettlementV2(text, settlementOptions);
  assert.equal(result.lines.length, 1);
  assert.equal(result.unmapped.length, 4);
  assert.match(result.unmapped[0].reason, /unsupported amount/);
  assert.match(result.unmapped[1].reason, /unsupported amount/);
  assert.match(result.unmapped[2].reason, /unsupported report timestamp/);
  assert.match(result.unmapped[3].reason, /invalid quantity-purchased/);
});

test("FBA inventory keeps external ids, sums inbound quantities, and validates the contract", () => {
  const text = inventoryTsv([{}, { sku: "SKU-B", fnsku: "FNSKU-2", asin: "ASIN-2", available: "8" }]);
  const result = normalizeFbaInventory(text, {
    ...settlementOptions,
    snapshotDate: "2026-10-31",
  });

  assert.equal(result.batch.periodStart, "2026-10-31");
  assert.equal(result.batch.currency, "USD");
  assert.equal(result.snapshots.length, 2);
  const [first, second] = result.snapshots;
  assert.equal(first.availableUnits, 120);
  assert.equal(first.reservedUnits, 3);
  assert.equal(first.unsellableUnits, 1);
  assert.equal(first.inTransitUnits, 17);
  assert.deepEqual(first.externalIds, { fnsku: "FNSKU-1", asin: "ASIN-1" });
  assert.equal(second.skuKey, "SKU-B");
  validateInventorySnapshot(first, "USD");
  validateInventorySnapshot(second, "USD");

  const bad = inventoryTsv([{ available: "12.5" }, { sku: "" }]);
  const badResult = normalizeFbaInventory(bad, {
    ...settlementOptions,
    snapshotDate: "2026-10-31",
  });
  assert.equal(badResult.snapshots.length, 0);
  assert.equal(badResult.unmapped.length, 2);
  assert.match(badResult.unmapped[0].reason, /invalid afn-fulfillable-quantity/);
  assert.match(badResult.unmapped[1].reason, /without a sku/);
});

test("missing required columns and empty reports fail loudly", () => {
  assert.throws(() => normalizeSettlementV2("foo\tbar\n1\t2\n", settlementOptions), /missing required columns/);
  assert.throws(() => normalizeSettlementV2("no-data-rows\n", settlementOptions), /no data rows/);
  assert.throws(
    () => normalizeFbaInventory("sku\tthing\nSKU-A\t1\n", { ...settlementOptions, snapshotDate: "2026-10-31" }),
    /missing required columns/,
  );
  assert.throws(
    () => normalizeFbaInventory(inventoryTsv([{}]), { ...settlementOptions, snapshotDate: "2026-02-30" }),
    /invalid site-calendar date/,
  );
});

test("end-to-end: synthetic report -> aggregation -> forecast comparison keeps the units aligned", () => {
  const text = settlementTsv([
    {},
    { amountType: "ItemFees", amountDescription: "Commission", amount: "-15.00", quantityPurchased: "" },
    { amountType: "ItemFees", amountDescription: "FBAPerUnitFulfillmentFee", amount: "-8.50", quantityPurchased: "" },
    { amountType: "Promotion", amountDescription: "Shipping discount", amount: "-5.00", quantityPurchased: "" },
  ]);
  const { lines } = normalizeSettlementV2(text, {
    ...settlementOptions,
    orderDateByOrderId: { "ORD-1": "2026-10-20" },
  });
  const [period] = aggregateSettlement(lines, { policy: "settlement", reportingCurrency: "USD" });

  assert.equal(period.units, 2);
  assert.equal(period.contribution.netRevenueCents, 9_500);
  assert.equal(period.contribution.contributionProfitCents, 7_150);
  assert.deepEqual(period.rawHashes, [computeRawHash(text)]);
  assert.deepEqual(period.ingestionRunIds, ["run-synthetic-1"]);

  const comparison = compareWithForecast(period, {
    unitNetProfitCents: 4_000,
    costModelVersion: "cm-v1",
    forecastCurrency: "USD",
    minDenominatorCents: 1_000,
  });
  // 单件 4000 分 × 实际 2 件 = 8000 分；实际 7150，差异 -850，比率 -10.625%。
  assert.equal(comparison.folded.foldedProfitCents, 8_000);
  assert.equal(comparison.folded.costModelVersion, "cm-v1");
  assert.equal(comparison.variance.differenceCents, -850);
  assert.equal(comparison.variance.ratio, -0.10625);

  assert.throws(
    () =>
      compareWithForecast(period, {
        unitNetProfitCents: 4_000,
        costModelVersion: "cm-v1",
        forecastCurrency: "CNY",
        minDenominatorCents: 1_000,
      }),
    /must match settlement currency/,
  );
});

test("raw hash is stable for identical content and changes with content", () => {
  const text = settlementTsv([{}]);
  assert.equal(computeRawHash(text), computeRawHash(text));
  assert.notEqual(computeRawHash(text), computeRawHash(`${text}extra`));
  assert.match(computeRawHash(text), /^[0-9a-f]{64}$/);
});
