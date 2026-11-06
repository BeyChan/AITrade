/**
 * 平台报表 → 7.3 内部契约的解析与归一化层。
 *
 * 列名依据 Amazon 官方公开规范：
 * - Flat File V2 Settlement Report（GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2，Tab 分隔）
 *   https://developer-docs.amazon.com/sp-api/docs/settlement-reports-attributes
 *   amount-type / amount-description 取值表见 Seller Central G791 帮助页。
 * - FBA Manage Inventory（GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA，Tab 分隔）
 *   https://developer-docs.amazon.com/sp-api/docs/report-type-values-fba
 *
 * 这里只实现「字段规范已知」的部分：列名可覆盖、金额格式必须显式指定、
 * 未知的费用类型进入待处理队列，绝不自动归类或猜 SKU。数字本身仍需用真实
 * 导出核对，因此该层不产生任何业务阈值，也不写库。
 */
import { createHash } from "node:crypto";
import { assertSiteDate, type ContributionCostKey } from "./operations-metrics.ts";
import {
  validateReportBatch,
  type NormalizedInventorySnapshot,
  type NormalizedSettlementLine,
  type ReportBatch,
  type SettlementLineKind,
} from "./operations-settlement.ts";

export class ReportAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportAdapterError";
  }
}

export type NumberFormat = "us" | "eu";

export type SettlementColumnKey =
  | "settlementId"
  | "settlementStart"
  | "settlementEnd"
  | "depositDate"
  | "currency"
  | "transactionType"
  | "orderId"
  | "marketplaceName"
  | "amountType"
  | "amountDescription"
  | "amount"
  | "fulfillmentId"
  | "postedDate"
  | "postedDateTime"
  | "sku"
  | "quantityPurchased"
  | "promotionId";

export type InventoryColumnKey =
  | "sku"
  | "fnsku"
  | "asin"
  | "available"
  | "reserved"
  | "unsellable"
  | "inboundWorking"
  | "inboundShipped"
  | "inboundReceiving";

/** 官方 Flat File V2 结算报表列名；不同站点/模板可用 columns 覆盖。 */
export const SETTLEMENT_V2_COLUMNS: Record<SettlementColumnKey, string> = {
  settlementId: "settlement-id",
  settlementStart: "settlement-start-date",
  settlementEnd: "settlement-end-date",
  depositDate: "deposit-date",
  currency: "currency",
  transactionType: "transaction-type",
  orderId: "order-id",
  marketplaceName: "marketplace-name",
  amountType: "amount-type",
  amountDescription: "amount-description",
  amount: "amount",
  fulfillmentId: "fulfillment-id",
  postedDate: "posted-date",
  postedDateTime: "posted-date-time",
  sku: "sku",
  quantityPurchased: "quantity-purchased",
  promotionId: "promotion-id",
};

/** 官方 FBA Manage Inventory 报表列名。 */
export const FBA_INVENTORY_COLUMNS: Record<InventoryColumnKey, string> = {
  sku: "sku",
  fnsku: "fnsku",
  asin: "asin",
  available: "afn-fulfillable-quantity",
  reserved: "afn-reserved-quantity",
  unsellable: "afn-unsellable-quantity",
  inboundWorking: "afn-inbound-working-quantity",
  inboundShipped: "afn-inbound-shipped-quantity",
  inboundReceiving: "afn-inbound-receiving-quantity",
};

const SETTLEMENT_REQUIRED: readonly SettlementColumnKey[] = [
  "settlementId",
  "settlementStart",
  "settlementEnd",
  "currency",
  "transactionType",
  "amountType",
  "amountDescription",
  "amount",
  "postedDate",
  "sku",
];

const INVENTORY_REQUIRED: readonly InventoryColumnKey[] = ["sku", "available"];

/** Tab / CSV 解析，支持 BOM、CRLF、带引号字段和 "" 转义。 */
export function parseDelimited(text: string, delimiter: "\t" | "," = "\t"): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  const pushRow = () => {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (quoted) throw new ReportAdapterError("unclosed quoted field");
  if (field !== "" || row.length > 0) pushRow();
  return rows;
}

type ColumnMap<K extends string> = Record<K, string>;

function toRecords<K extends string>(
  rows: readonly string[][],
  columns: ColumnMap<K>,
  required: readonly K[],
): Record<K, string>[] {
  if (rows.length < 2) throw new ReportAdapterError("report has no data rows");
  const header = rows[0].map((value) => value.trim());
  const indexByHeader = new Map<string, number>();
  header.forEach((name, index) => indexByHeader.set(name, index));

  const missing = required.filter((key) => !indexByHeader.has(columns[key]));
  if (missing.length > 0) {
    throw new ReportAdapterError(
      `missing required columns: ${missing.map((key) => columns[key]).join(", ")}`,
    );
  }

  const indexByKey = {} as Record<K, number | undefined>;
  for (const key of Object.keys(columns) as K[]) {
    indexByKey[key] = indexByHeader.get(columns[key]);
  }

  return rows.slice(1).map((row) => {
    const record = {} as Record<K, string>;
    for (const key of Object.keys(columns) as K[]) {
      const index = indexByKey[key];
      record[key] = index === undefined ? "" : (row[index] ?? "").trim();
    }
    return record;
  });
}

/**
 * 金额必须是显式格式：官方说明欧洲站用 `95,00` 而不是 `95.00`。
 * 分组分隔符不合法的写法（例如把 US 格式误读成 `95,00`）直接报错，
 * 避免把 95 元静默放大成 9500 元。
 */
export function parseLocalizedAmount(raw: string, format: NumberFormat = "us"): number {
  const text = raw.trim();
  const pattern =
    format === "us"
      ? /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/
      : /^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if (!pattern.test(text)) {
    throw new ReportAdapterError(`unsupported amount "${text}" for ${format} format`);
  }
  let normalized = text;
  if (format === "us") {
    normalized = normalized.replace(/,/g, "");
  } else {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  return Math.round(Number(normalized) * 100);
}

const ISO_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export type ReportTimestamp = { siteDate: string; offset: string | null; raw: string };

/**
 * 官方结算日期是带时区偏移的 ISO 8601（如 2003-10-03T16:00:00-07:00）。
 * 这里只截取原始字符串的日历日，绝不经过 Date 对象转换，避免服务器时区
 * 或浏览器本地时区把站点日历改到另一天。
 */
export function parseReportTimestamp(raw: string): ReportTimestamp {
  const text = raw.trim();
  const match = ISO_WITH_OFFSET.exec(text);
  if (match) {
    assertSiteDate(match[1]);
    return { siteDate: match[1], offset: match[2], raw: text };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    assertSiteDate(text);
    return { siteDate: text, offset: null, raw: text };
  }
  throw new ReportAdapterError(`unsupported report timestamp: ${text}`);
}

/** 官方 G791 金额类型表 + 卖家社区常见值；后者标记 community，需真实报表核对。 */
const FEE_KIND_BY_DESCRIPTION: Record<string, { kind: ContributionCostKey; source: "official" | "community" }> = {
  Commission: { kind: "platformFee", source: "official" },
  RefundCommission: { kind: "platformFee", source: "official" },
  VariableClosingFee: { kind: "platformFee", source: "official" },
  FBAPerUnitFulfillmentFee: { kind: "fulfillmentFee", source: "official" },
  FBAWeightBasedFee: { kind: "fulfillmentFee", source: "official" },
  GiftwrapChargeback: { kind: "other", source: "official" },
  ShippingChargeback: { kind: "fulfillmentFee", source: "official" },
  FBAPerOrderFulfillmentFee: { kind: "fulfillmentFee", source: "community" },
  FBATransportationFee: { kind: "fulfillmentFee", source: "official" },
  "Cost of Advertising": { kind: "adCost", source: "community" },
  "Subscription Fee": { kind: "other", source: "community" },
  "Storage Fee": { kind: "storage", source: "community" },
  StorageRenewal: { kind: "longTermStorage", source: "community" },
  "ItemWithheldTax": { kind: "vatOrSalesTax", source: "community" },
  "FBA Inventory Reimbursement": { kind: "other", source: "community" },
};

export type AmountClassification = {
  kind: SettlementLineKind;
  source: "official" | "community";
};

/**
 * 只映射已确认的组合。账户级项目（Reserve / Transfer 等）和新增费用类型
 * 一律返回 null，由调用方放进待处理队列，不能自动归到某个 SKU。
 */
export function classifySettlementAmount(
  amountType: string,
  amountDescription: string,
  transactionType: string,
): AmountClassification | null {
  const type = amountType.trim();
  const description = amountDescription.trim();
  const transaction = transactionType.trim().toLowerCase();

  if (type === "ItemPrice") {
    if (description === "Principal" || description === "Shipping" || description === "GiftWrap") {
      return { kind: transaction === "refund" ? "refund" : "revenue", source: "official" };
    }
    if (description === "Goodwill" || description === "RestockingFee") {
      return { kind: "refund", source: "official" };
    }
    if (/tax/i.test(description)) {
      return { kind: transaction === "refund" ? "refund" : "revenue", source: "community" };
    }
    return null;
  }
  if (type === "Promotion") return { kind: "discount", source: "official" };
  if (type === "Cost of Advertising") return { kind: "adCost", source: "community" };
  if (type === "ItemWithheldTax") return { kind: "vatOrSalesTax", source: "community" };
  if (type === "Storage Fee") return { kind: "storage", source: "community" };
  if (type === "ItemFees" || type === "ShipmentFees" || type === "FBAFees") {
    const mapped = FEE_KIND_BY_DESCRIPTION[description];
    return mapped ? { kind: mapped.kind, source: mapped.source } : null;
  }
  if (type === "Refund" && /reimburs/i.test(description)) {
    return { kind: "other", source: "community" };
  }
  if (type === "FBA Inventory Reimbursement") return { kind: "other", source: "community" };
  // other-transaction / Reserve / Transfer / Liquidation 等属于账户级，不归 SKU。
  return null;
}

export function computeRawHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type SettlementAdapterOptions = {
  ingestionRunId: string;
  rawHash?: string;
  marketplaceCode: string;
  /** IANA 时区，对应站点日历；报表里的 UTC 偏移另行保留。 */
  reportTimezone: string;
  reportingCurrency: string;
  fxRate?: number;
  fxRateDate?: string;
  /** 美国站 "us"，欧洲站 "eu"；不自动推断。 */
  decimalFormat?: NumberFormat;
  columns?: Partial<Record<SettlementColumnKey, string>>;
  /** 订单日来自订单报告；结算单本身没有订单日期字段。 */
  orderDateByOrderId?: Record<string, string>;
  /** 若导入的是已扣费用的净额，列出不应再扣一次的费用项。 */
  deductedCostKeys?: readonly ContributionCostKey[];
};

export type UnmappedRow = { row: number; reason: string; record: Record<string, string> };

export type SettlementNormalizeResult = {
  batch: ReportBatch;
  lines: NormalizedSettlementLine[];
  unmapped: UnmappedRow[];
  /** 因缺少订单报告而把记账日当作订单日的行数；权责制辅账此时不可用。 */
  orderDateFallbackCount: number;
  /** 社区来源（非官方字段表）的映射行数，需要用真实报表核对。 */
  communityMappedCount: number;
};

function normalizedAmount(
  kind: SettlementLineKind,
  rawCents: number,
  transactionType: string,
  description: string,
): number {
  // 契约约定 revenue / refund / discount 记正数，方向由 kind 决定。
  if (kind === "revenue" || kind === "refund" || kind === "discount") {
    return Math.abs(rawCents);
  }
  // 费用列在官方报表里可能是负数（从余额扣）；冲正 / 赔付要保留为负数做加回项。
  const isCredit = /refund|adjustment|reimburs|liquidation/i.test(`${transactionType} ${description}`);
  if (rawCents < 0) return Math.abs(rawCents);
  return isCredit ? -Math.abs(rawCents) : rawCents;
}

export function normalizeSettlementV2(
  text: string,
  options: SettlementAdapterOptions,
): SettlementNormalizeResult {
  const columns: Record<SettlementColumnKey, string> = { ...SETTLEMENT_V2_COLUMNS, ...options.columns };
  const records = toRecords(parseDelimited(text, "\t"), columns, SETTLEMENT_REQUIRED);
  const first = records[0];
  const settlementId = first.settlementId.trim();
  const start = parseReportTimestamp(first.settlementStart).siteDate;
  const end = parseReportTimestamp(first.settlementEnd).siteDate;
  const currency = first.currency.trim().toUpperCase();
  const format = options.decimalFormat ?? "us";

  const batch: ReportBatch = {
    ingestionRunId: options.ingestionRunId,
    rawHash: options.rawHash ?? computeRawHash(text),
    marketplaceCode: options.marketplaceCode,
    reportTimezone: options.reportTimezone,
    periodStart: start,
    periodEnd: end,
    observedAt: first.depositDate
      ? parseReportTimestamp(first.depositDate).siteDate
      : end,
    currency,
    ...(options.fxRate !== undefined ? { fxRate: options.fxRate, fxRateDate: options.fxRateDate } : {}),
  };
  validateReportBatch(batch, options.reportingCurrency);

  const deducted = new Set<ContributionCostKey>(options.deductedCostKeys ?? []);
  const lines: NormalizedSettlementLine[] = [];
  const unmapped: UnmappedRow[] = [];
  let orderDateFallbackCount = 0;
  let communityMappedCount = 0;

  records.forEach((record, index) => {
    const row = index + 2;
    if (
      record.settlementId.trim() !== settlementId ||
      parseReportTimestamp(record.settlementStart).siteDate !== start ||
      parseReportTimestamp(record.settlementEnd).siteDate !== end ||
      record.currency.trim().toUpperCase() !== currency
    ) {
      unmapped.push({ row, reason: "row belongs to a different settlement batch or currency", record });
      return;
    }
    const skuKey = record.sku.trim();
    if (!skuKey) {
      unmapped.push({ row, reason: "account-level line without a sku", record });
      return;
    }
    const classification = classifySettlementAmount(
      record.amountType,
      record.amountDescription,
      record.transactionType,
    );
    if (!classification) {
      unmapped.push({ row, reason: `unmapped amount-type/description: ${record.amountType}/${record.amountDescription}`, record });
      return;
    }

    let rawCents: number;
    let posted: ReportTimestamp;
    try {
      rawCents = parseLocalizedAmount(record.amount, format);
      posted = parseReportTimestamp(record.postedDateTime || record.postedDate);
    } catch (error) {
      unmapped.push({ row, reason: (error as Error).message, record });
      return;
    }

    const orderId = record.orderId.trim();
    const suppliedOrderDate = options.orderDateByOrderId?.[orderId];
    const orderDate = suppliedOrderDate ?? posted.siteDate;
    if (!suppliedOrderDate) orderDateFallbackCount += 1;
    if (classification.source === "community") communityMappedCount += 1;

    let kind = classification.kind;
    if (kind === "revenue" && rawCents < 0) kind = "refund";
    const unitsRaw = record.quantityPurchased.trim();
    const units = unitsRaw === "" ? undefined : Number(unitsRaw);
    if (units !== undefined && (!Number.isFinite(units) || units < 0)) {
      unmapped.push({ row, reason: `invalid quantity-purchased: ${unitsRaw}`, record });
      return;
    }

    lines.push({
      batch,
      settlementId,
      skuKey,
      orderDate,
      settlementDate: posted.siteDate,
      kind,
      amountCents: normalizedAmount(kind, rawCents, record.transactionType, record.amountDescription),
      ...(units !== undefined && (kind === "revenue" || kind === "refund") ? { units } : {}),
      ...(deducted.has(kind as ContributionCostKey) ? { deductedInSettlement: true } : {}),
    });
  });

  return { batch, lines, unmapped, orderDateFallbackCount, communityMappedCount };
}

export type InventoryAdapterOptions = {
  ingestionRunId: string;
  rawHash?: string;
  marketplaceCode: string;
  reportTimezone: string;
  /** 库存报表没有币种列，件数也不涉及换算，按本位币记批次。 */
  reportingCurrency: string;
  /** YYYY-MM-DD，导出当天的站点日历日期。 */
  snapshotDate: string;
  columns?: Partial<Record<InventoryColumnKey, string>>;
};

export type InventoryNormalizeResult = {
  batch: ReportBatch;
  snapshots: NormalizedInventorySnapshot[];
  unmapped: UnmappedRow[];
};

function parseUnits(raw: string, field: string): number {
  const text = raw.trim();
  if (text === "") return 0;
  if (!/^\d+$/.test(text)) throw new ReportAdapterError(`invalid ${field}: ${text}`);
  return Number(text);
}

export function normalizeFbaInventory(
  text: string,
  options: InventoryAdapterOptions,
): InventoryNormalizeResult {
  const columns: Record<InventoryColumnKey, string> = { ...FBA_INVENTORY_COLUMNS, ...options.columns };
  const records = toRecords(parseDelimited(text, "\t"), columns, INVENTORY_REQUIRED);
  assertSiteDate(options.snapshotDate);

  const batch: ReportBatch = {
    ingestionRunId: options.ingestionRunId,
    rawHash: options.rawHash ?? computeRawHash(text),
    marketplaceCode: options.marketplaceCode,
    reportTimezone: options.reportTimezone,
    periodStart: options.snapshotDate,
    periodEnd: options.snapshotDate,
    observedAt: options.snapshotDate,
    currency: options.reportingCurrency,
  };
  validateReportBatch(batch, options.reportingCurrency);

  const snapshots: NormalizedInventorySnapshot[] = [];
  const unmapped: UnmappedRow[] = [];

  records.forEach((record, index) => {
    const row = index + 2;
    const skuKey = record.sku.trim();
    if (!skuKey) {
      unmapped.push({ row, reason: "inventory row without a sku", record });
      return;
    }
    try {
      const externalIds: Record<string, string> = {};
      if (record.fnsku) externalIds.fnsku = record.fnsku;
      if (record.asin) externalIds.asin = record.asin;
      snapshots.push({
        batch,
        skuKey,
        snapshotDate: options.snapshotDate,
        availableUnits: parseUnits(record.available, "afn-fulfillable-quantity"),
        reservedUnits: parseUnits(record.reserved, "afn-reserved-quantity"),
        unsellableUnits: parseUnits(record.unsellable, "afn-unsellable-quantity"),
        inTransitUnits:
          parseUnits(record.inboundWorking, "afn-inbound-working-quantity") +
          parseUnits(record.inboundShipped, "afn-inbound-shipped-quantity") +
          parseUnits(record.inboundReceiving, "afn-inbound-receiving-quantity"),
        externalIds,
      });
    } catch (error) {
      unmapped.push({ row, reason: (error as Error).message, record });
    }
  });

  return { batch, snapshots, unmapped };
}
