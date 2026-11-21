/**
 * 确定性跨境物流（FBA 尺寸分段 & 降档预警 + 抛货头程）、站点 VAT 税制与 90 天现金流回本纯函数层。
 * 全程纯计算、无 IO、无模型调用；口径透明可审计。
 */

import { convertForeignCentsToRmb, convertRmbToForeignCents } from "./currency.ts";

export type ShippingMethod = "sea_slow" | "sea_fast" | "air_ddp";

export type FbaSizeTier =
  | "small_standard"
  | "large_standard"
  | "large_bulky"
  | "extra_large";

export type FbaDimensionResult = {
  tier: FbaSizeTier;
  tierLabel: string;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
  weightOz: number;
  weightLb: number;
  dimensionalWeightLb: number;
  billableWeightLb: number;
  estimatedFbaFeeCents: number;
  downgradeOpportunity: {
    targetTierLabel: string;
    axisLabel: string;
    currentValue: string;
    limitValue: string;
    reductionNeeded: string;
    estimatedSavingCents: number;
  } | null;
};

export type VolumetricFreightResult = {
  method: ShippingMethod;
  methodLabel: string;
  actualWeightKg: number;
  volumetricWeightKg: number;
  billableWeightKg: number;
  isVolumetricCharged: boolean;
  rateRmbPerKg: number;
  freightRmb: number;
  freightForeignCents: number;
  currency: string;
};

export type VatBreakdown = {
  marketCode: string;
  vatRate: number;
  vatLabel: string;
  grossSalePriceCents: number;
  vatAmountCents: number;
  netExVatPriceCents: number;
};

export type CashflowInput = {
  currency: string;
  moq: number;
  unitLandedCostCents: number;
  sampleAndMoldCents: number;
  certificationCents: number;
  launchAdExtraCents: number;
  monthlySalesEstimate: number;
  steadyNetProfitCents: number;
  reorderLeadDays?: number;
};

export type MonthlyCashflowPoint = {
  month: number;
  label: string;
  unitsSold: number;
  netOperatingCents: number;
  reorderOutflowCents: number;
  cumulativeCashCents: number;
};

export type LaunchCashflowResult = {
  currency: string;
  firstOrderInventoryCents: number;
  upfrontFixedCents: number;
  totalInitialCapitalCents: number;
  totalInitialCapitalRmb: number;
  peakCashOutflowCents: number;
  peakCashOutflowRmb: number;
  paybackMonths: number | null;
  annualizedCapitalRoi: number;
  monthlyCurve: MonthlyCashflowPoint[];
};

const SHIPPING_RATES_RMB_PER_KG: Record<ShippingMethod, { label: string; rateRmbPerKg: number }> = {
  sea_slow: { label: "海运普船 (DDP · 35-45天)", rateRmbPerKg: 11 },
  sea_fast: { label: "美森快船 (DDP · 18-24天)", rateRmbPerKg: 18 },
  air_ddp: { label: "空派专线 (DDP · 8-12天)", rateRmbPerKg: 46 },
};

const MARKET_VAT_RATES: Record<string, { rate: number; label: string }> = {
  US: { rate: 0, label: "美国站（销售税由平台代收代缴，定价不含税）" },
  DE: { rate: 0.19, label: "德国站标准 VAT 19%（前台售价含税）" },
  GB: { rate: 0.2, label: "英国站标准 VAT 20%（前台售价含税）" },
  JP: { rate: 0.1, label: "日本站消费税 JCT 10%（前台售价含税）" },
  AU: { rate: 0.1, label: "澳大利亚 GST 10%（前台售价含税）" },
  SG: { rate: 0.09, label: "新加坡 GST 9%（前台售价含税）" },
  MY: { rate: 0.1, label: "马来西亚低值商品税 LVG 10%" },
};

const CM_PER_INCH = 2.54;
const GRAMS_PER_LB = 453.59237;
const DIM_DIVISOR_IN = 139;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/**
 * 按 Amazon US 标准尺寸阶梯估算 FBA 配送费与降档省钱提醒（纯确定性公式）。
 */
export function calculateFbaSizeTier(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  weightG: number,
): FbaDimensionResult {
  const dimsCm = [
    Math.max(0.1, Number(lengthCm) || 0.1),
    Math.max(0.1, Number(widthCm) || 0.1),
    Math.max(0.1, Number(heightCm) || 0.1),
  ].sort((a, b) => b - a);

  const lengthIn = round2(dimsCm[0]! / CM_PER_INCH);
  const widthIn = round2(dimsCm[1]! / CM_PER_INCH);
  const heightIn = round2(dimsCm[2]! / CM_PER_INCH);
  const weightLb = round2(Math.max(1, Number(weightG) || 1) / GRAMS_PER_LB);
  const weightOz = round2(weightLb * 16);
  const dimensionalWeightLb = round2((lengthIn * widthIn * heightIn) / DIM_DIVISOR_IN);

  const isSmallStandard =
    lengthIn <= 15 && widthIn <= 12 && heightIn <= 0.75 && weightOz <= 16;
  const isLargeStandard =
    lengthIn <= 18 && widthIn <= 14 && heightIn <= 8 && weightLb <= 20;
  const isLargeBulky =
    lengthIn <= 59 && widthIn <= 33 && heightIn <= 33 && weightLb <= 50;

  let tier: FbaSizeTier = "extra_large";
  let tierLabel = "超大件 (Extra-Large)";
  let billableWeightLb = Math.max(weightLb, dimensionalWeightLb);
  let estimatedFbaFeeCents = 2600;

  if (isSmallStandard) {
    tier = "small_standard";
    tierLabel = "小号标准件 (Small Standard)";
    billableWeightLb = weightLb;
    estimatedFbaFeeCents = estimateSmallStandardFeeCents(weightOz);
  } else if (isLargeStandard) {
    tier = "large_standard";
    tierLabel = "大号标准件 (Large Standard)";
    billableWeightLb = weightLb <= 1 ? weightLb : Math.max(weightLb, dimensionalWeightLb);
    estimatedFbaFeeCents = estimateLargeStandardFeeCents(billableWeightLb);
  } else if (isLargeBulky) {
    tier = "large_bulky";
    tierLabel = "大件抛货 (Large Bulky)";
    billableWeightLb = Math.max(weightLb, dimensionalWeightLb);
    estimatedFbaFeeCents = Math.round(961 + Math.max(0, Math.ceil(billableWeightLb) - 1) * 38);
  } else {
    estimatedFbaFeeCents = Math.round(2633 + Math.max(0, Math.ceil(billableWeightLb) - 50) * 38);
  }

  let downgradeOpportunity: FbaDimensionResult["downgradeOpportunity"] = null;

  // 检测是否接近降档临界线（超标 ≤ 20% 且仅单维超标时触发高价值压缩建议）
  if (tier === "large_standard" && lengthIn <= 15 && widthIn <= 12 && weightOz <= 16 && heightIn > 0.75 && heightIn <= 1.2) {
    const targetFee = estimateSmallStandardFeeCents(weightOz);
    const saving = estimatedFbaFeeCents - targetFee;
    if (saving > 0) {
      downgradeOpportunity = {
        targetTierLabel: "小号标准件 (Small Standard)",
        axisLabel: "最短边厚度",
        currentValue: `${heightIn.toFixed(2)} in (${dimsCm[2]!.toFixed(1)} cm)`,
        limitValue: "0.75 in (1.9 cm)",
        reductionNeeded: `压缩 ${(dimsCm[2]! - 1.9).toFixed(1)} cm`,
        estimatedSavingCents: saving,
      };
    }
  } else if (tier === "large_bulky") {
    const overDims: Array<{ label: string; curIn: number; limIn: number; curCm: number; limCm: number }> = [];
    if (lengthIn > 18) overDims.push({ label: "最长边", curIn: lengthIn, limIn: 18, curCm: dimsCm[0]!, limCm: 45.7 });
    if (widthIn > 14) overDims.push({ label: "次长边", curIn: widthIn, limIn: 14, curCm: dimsCm[1]!, limCm: 35.5 });
    if (heightIn > 8) overDims.push({ label: "最短边高度", curIn: heightIn, limIn: 8, curCm: dimsCm[2]!, limCm: 20.3 });
    if (overDims.length === 1 && weightLb <= 20) {
      const over = overDims[0]!;
      if (over.curIn <= over.limIn * 1.2) {
        const targetFee = estimateLargeStandardFeeCents(Math.max(weightLb, dimensionalWeightLb * 0.85));
        const saving = estimatedFbaFeeCents - targetFee;
        if (saving > 0) {
          downgradeOpportunity = {
            targetTierLabel: "大号标准件 (Large Standard)",
            axisLabel: over.label,
            currentValue: `${over.curIn.toFixed(2)} in (${over.curCm.toFixed(1)} cm)`,
            limitValue: `${over.limIn} in (${over.limCm} cm)`,
            reductionNeeded: `压缩 ${(over.curCm - over.limCm).toFixed(1)} cm`,
            estimatedSavingCents: saving,
          };
        }
      }
    }
  }

  return {
    tier,
    tierLabel,
    lengthIn,
    widthIn,
    heightIn,
    weightOz,
    weightLb,
    dimensionalWeightLb,
    billableWeightLb: round2(billableWeightLb),
    estimatedFbaFeeCents,
    downgradeOpportunity,
  };
}

function estimateSmallStandardFeeCents(weightOz: number): number {
  if (weightOz <= 2) return 306;
  if (weightOz <= 4) return 315;
  if (weightOz <= 6) return 324;
  if (weightOz <= 8) return 333;
  if (weightOz <= 10) return 343;
  if (weightOz <= 12) return 353;
  if (weightOz <= 14) return 360;
  return 365;
}

function estimateLargeStandardFeeCents(billableWeightLb: number): number {
  const oz = billableWeightLb * 16;
  if (oz <= 4) return 368;
  if (oz <= 8) return 390;
  if (oz <= 12) return 415;
  if (oz <= 16) return 455;
  if (billableWeightLb <= 1.25) return 499;
  if (billableWeightLb <= 1.5) return 537;
  if (billableWeightLb <= 1.75) return 552;
  if (billableWeightLb <= 2) return 577;
  if (billableWeightLb <= 2.25) return 587;
  if (billableWeightLb <= 2.5) return 605;
  if (billableWeightLb <= 2.75) return 621;
  if (billableWeightLb <= 3) return 662;
  const extraHalfPounds = Math.ceil((billableWeightLb - 3) * 2);
  return 692 + extraHalfPounds * 16;
}

/**
 * 抛货体积重与头程运费计算（材积除数 6000）。
 */
export function calculateVolumetricFreight(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  weightG: number,
  method: ShippingMethod,
  currency: string = "USD",
): VolumetricFreightResult {
  const actualWeightKg = round2(Math.max(1, Number(weightG) || 1) / 1000);
  const volumeCm3 =
    Math.max(1, Number(lengthCm) || 1) *
    Math.max(1, Number(widthCm) || 1) *
    Math.max(1, Number(heightCm) || 1);
  const volumetricWeightKg = round2(volumeCm3 / 6000);
  const billableWeightKg = round2(Math.max(actualWeightKg, volumetricWeightKg));
  const isVolumetricCharged = volumetricWeightKg > actualWeightKg * 1.05;
  const config = SHIPPING_RATES_RMB_PER_KG[method] ?? SHIPPING_RATES_RMB_PER_KG.sea_fast;
  const freightRmb = round2(billableWeightKg * config.rateRmbPerKg);
  const freightForeignCents = convertRmbToForeignCents(freightRmb, currency);

  return {
    method,
    methodLabel: config.label,
    actualWeightKg,
    volumetricWeightKg,
    billableWeightKg,
    isVolumetricCharged,
    rateRmbPerKg: config.rateRmbPerKg,
    freightRmb,
    freightForeignCents,
    currency: currency.toUpperCase(),
  };
}

/**
 * 站点含税售价 VAT / 消费税拆解。
 */
export function calculateVatBreakdown(
  salePriceCents: number,
  marketCode: string,
): VatBreakdown {
  const code = (marketCode || "US").toUpperCase();
  const policy = MARKET_VAT_RATES[code] ?? MARKET_VAT_RATES.US!;
  const gross = Math.max(0, Math.round(salePriceCents));
  const netExVat = policy.rate > 0 ? Math.round(gross / (1 + policy.rate)) : gross;
  const vatAmount = gross - netExVat;
  return {
    marketCode: code,
    vatRate: policy.rate,
    vatLabel: policy.label,
    grossSalePriceCents: gross,
    vatAmountCents: vatAmount,
    netExVatPriceCents: netExVat,
  };
}

/**
 * 首单现金流与 6 个月冷启动回本曲线：
 * - Month 0：首单货款 + 打样/开模 + 认证
 * - Month 1–2：冷启动期（销量按 40% / 70% 爬坡，分摊冷启动额外广告与推广）
 * - Month 3–6：稳态期，并在库存余量低于补货提前期时自动计入第二批翻单采购款。
 */
export function calculateLaunchCashflow(input: CashflowInput): LaunchCashflowResult {
  const moq = Math.max(1, Math.round(input.moq));
  const unitLanded = Math.max(0, Math.round(input.unitLandedCostCents));
  const firstOrderInventoryCents = moq * unitLanded;
  const upfrontFixedCents =
    Math.max(0, Math.round(input.sampleAndMoldCents)) +
    Math.max(0, Math.round(input.certificationCents));
  const totalInitialCapitalCents =
    firstOrderInventoryCents + upfrontFixedCents + Math.max(0, Math.round(input.launchAdExtraCents));

  const monthlySales = Math.max(0, Math.round(input.monthlySalesEstimate));
  const steadyProfit = Math.round(input.steadyNetProfitCents);
  const rampFactors = [0.4, 0.7, 1.0, 1.0, 1.0, 1.0];
  const launchAdSplit = [0.6, 0.4, 0, 0, 0, 0];

  let cumulative = -(firstOrderInventoryCents + upfrontFixedCents);
  let remainingStock = moq;
  let peakOutflow = Math.abs(cumulative);
  let paybackMonths: number | null = null;
  let total6mOperatingProfit = 0;

  const monthlyCurve: MonthlyCashflowPoint[] = [];

  for (let i = 0; i < 6; i++) {
    const month = i + 1;
    const unitsSold = Math.max(0, Math.round(monthlySales * rampFactors[i]!));
    const extraAd = Math.round(Math.max(0, input.launchAdExtraCents) * launchAdSplit[i]!);
    // 卖出的货回笼了本金 + 单件净利
    const operatingCashIn = unitsSold * (unitLanded + steadyProfit) - extraAd;
    total6mOperatingProfit += unitsSold * steadyProfit - extraAd;

    remainingStock -= unitsSold;
    let reorderOutflow = 0;
    if (remainingStock < Math.round(monthlySales * ((input.reorderLeadDays ?? 45) / 30)) && month <= 5) {
      const reorderUnits = Math.max(moq, Math.round(monthlySales * 1.5));
      reorderOutflow = reorderUnits * unitLanded;
      remainingStock += reorderUnits;
    }

    cumulative += operatingCashIn - reorderOutflow;
    if (cumulative < 0) {
      peakOutflow = Math.max(peakOutflow, Math.abs(cumulative));
    }
    if (paybackMonths === null && cumulative >= 0) {
      paybackMonths = month;
    }

    monthlyCurve.push({
      month,
      label: `第 ${month} 月`,
      unitsSold,
      netOperatingCents: operatingCashIn,
      reorderOutflowCents: reorderOutflow,
      cumulativeCashCents: cumulative,
    });
  }

  const annualizedProfit = total6mOperatingProfit * 2;
  const annualizedCapitalRoi = peakOutflow > 0 ? annualizedProfit / peakOutflow : 0;

  return {
    currency: input.currency.toUpperCase(),
    firstOrderInventoryCents,
    upfrontFixedCents,
    totalInitialCapitalCents,
    totalInitialCapitalRmb: convertForeignCentsToRmb(totalInitialCapitalCents, input.currency),
    peakCashOutflowCents: peakOutflow,
    peakCashOutflowRmb: convertForeignCentsToRmb(peakOutflow, input.currency),
    paybackMonths,
    annualizedCapitalRoi,
    monthlyCurve,
  };
}
