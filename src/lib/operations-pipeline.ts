/**
 * P3.0 计算管线：把「平台报表文本」一路串到「SKU × 结算周期」的可审计结果。
 *
 * 这是第 14 节切片的**纯计算层**：解析归一化 → 契约校验 → 期间归集 →
 * 预测对齐 → 库存天数，全程不读库、不写表、不调用模型、不生成行动建议。
 *
 * 所有口径参数（本位币、汇率、归因窗口、销量序列、最小分母、成本模型版本）
 * 都由调用方显式提供；缺失的数据不会被猜出来或按 0 静默处理，而是进入
 * warnings 或在结果中置 null。真实报表到位后，这一层可以直接复用。
 */
import {
  inventoryDays,
  type InventoryDaysResult,
  type PeriodPolicy,
} from "./operations-metrics.ts";
import {
  aggregateSettlement,
  compareWithForecast,
  type ForecastComparison,
  type ForecastComparisonInput,
  type NormalizedInventorySnapshot,
  type ReportBatch,
  type SettlementPeriodResult,
} from "./operations-settlement.ts";
import {
  normalizeFbaInventory,
  normalizeSettlementV2,
  type InventoryAdapterOptions,
  type SettlementAdapterOptions,
  type UnmappedRow,
} from "./report-adapters.ts";

export type PipelineInventoryDaysOptions = {
  /** 观察窗口天数，由调用方按真实样本校准后传入。 */
  windowDays: number;
  /** 断货期日均销量下限。 */
  minDailySales: number;
  /** 促销异常日上限。 */
  outlierCap?: number;
  /** 站点日历下的每日销量序列；只能来自真实订单/销量报告。 */
  dailySalesBySku?: Record<string, readonly number[]>;
};

export type PipelineOptions = {
  settlement: SettlementAdapterOptions;
  inventory?: InventoryAdapterOptions;
  /** 结算月（收付实现制）或订单月（权责发生制），两套结果分别运行，不混用。 */
  policy: PeriodPolicy;
  reportingCurrency: string;
  /** 平台 SKU → 单件预测；未提供的 SKU 不输出预测差异。 */
  forecastsBySku?: Record<string, ForecastComparisonInput>;
  inventoryDays?: PipelineInventoryDaysOptions;
};

export type PipelineSkuPeriod = SettlementPeriodResult & {
  /** 币种不一致会直接抛错，不会被吞成 null。 */
  forecast: ForecastComparison | null;
  /** 平台 SKU 直接匹配；channel_sku_mappings 落地后应改为多对一映射。 */
  inventory: NormalizedInventorySnapshot | null;
  inventoryDays: InventoryDaysResult | null;
};

export type PipelineResult = {
  periods: PipelineSkuPeriod[];
  settlement: {
    batch: ReportBatch;
    lineCount: number;
    unmapped: UnmappedRow[];
    orderDateFallbackCount: number;
    communityMappedCount: number;
  };
  inventory: {
    batch: ReportBatch;
    snapshotCount: number;
    unmapped: UnmappedRow[];
  } | null;
  /** 影响结果可信度的情况，必须随结果一起留痕。 */
  warnings: string[];
};

export type PipelineInput = {
  settlementText: string;
  inventoryText?: string;
};

export function runOperationsPipeline(
  input: PipelineInput,
  options: PipelineOptions,
): PipelineResult {
  const normalized = normalizeSettlementV2(input.settlementText, options.settlement);
  const basePeriods = aggregateSettlement(normalized.lines, {
    policy: options.policy,
    reportingCurrency: options.reportingCurrency,
  });

  const warnings: string[] = [];
  if (normalized.orderDateFallbackCount > 0) {
    warnings.push(
      `${normalized.orderDateFallbackCount} 行缺少订单日期，已用记账日代替；权责制辅账（policy=order）此时不可用`,
    );
  }
  if (normalized.communityMappedCount > 0) {
    warnings.push(`${normalized.communityMappedCount} 行使用非官方字段表映射，需用真实结算单核对`);
  }
  if (normalized.unmapped.length > 0) {
    warnings.push(`${normalized.unmapped.length} 行进入待处理队列，未参与归集`);
  }

  let inventoryResult: PipelineResult["inventory"] = null;
  const snapshots = new Map<string, NormalizedInventorySnapshot>();
  if (input.inventoryText !== undefined) {
    if (!options.inventory) {
      throw new Error("inventory options are required when inventoryText is provided");
    }
    const normalizedInventory = normalizeFbaInventory(input.inventoryText, options.inventory);
    inventoryResult = {
      batch: normalizedInventory.batch,
      snapshotCount: normalizedInventory.snapshots.length,
      unmapped: normalizedInventory.unmapped,
    };
    if (normalizedInventory.unmapped.length > 0) {
      warnings.push(`${normalizedInventory.unmapped.length} 行库存数据进入待处理队列`);
    }
    for (const snapshot of normalizedInventory.snapshots) {
      const existing = snapshots.get(snapshot.skuKey);
      if (existing) {
        warnings.push(`库存报表存在重复 SKU ${snapshot.skuKey}，取站点日期较新的快照`);
      }
      if (!existing || snapshot.snapshotDate >= existing.snapshotDate) {
        snapshots.set(snapshot.skuKey, snapshot);
      }
    }
    warnings.push("库存按平台 SKU 直接匹配；channel_sku_mappings 落地后需改为多对一映射");
  }

  const dailySalesBySku = options.inventoryDays?.dailySalesBySku;
  if (options.inventoryDays && !dailySalesBySku) {
    warnings.push("未提供每日销量序列，不计算库存天数");
  }

  const periods: PipelineSkuPeriod[] = basePeriods.map((period) => {
    const forecastInput = options.forecastsBySku?.[period.skuKey];
    const forecast = forecastInput ? compareWithForecast(period, forecastInput) : null;

    const inventory = snapshots.get(period.skuKey) ?? null;
    const dailySales = dailySalesBySku?.[period.skuKey];
    let days: InventoryDaysResult | null = null;
    if (options.inventoryDays && inventory && dailySales) {
      days = inventoryDays({
        availableUnits: inventory.availableUnits,
        dailySales,
        windowDays: options.inventoryDays.windowDays,
        minDailySales: options.inventoryDays.minDailySales,
        ...(options.inventoryDays.outlierCap !== undefined
          ? { outlierCap: options.inventoryDays.outlierCap }
          : {}),
      });
    }

    return { ...period, forecast, inventory, inventoryDays: days };
  });

  return {
    periods,
    settlement: {
      batch: normalized.batch,
      lineCount: normalized.lines.length,
      unmapped: normalized.unmapped,
      orderDateFallbackCount: normalized.orderDateFallbackCount,
      communityMappedCount: normalized.communityMappedCount,
    },
    inventory: inventoryResult,
    warnings,
  };
}
