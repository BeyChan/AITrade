import type { AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import type { CompetitorProfile, CompetitorProvenance } from "@/lib/competitor-compare/types";
import type { AppMode } from "@/lib/app-mode";
import { calculateEconomics } from "@/lib/economics";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import { convertRmbToForeignCents, OFFICIAL_FX_CONFIG } from "@/lib/currency";

export const PROVENANCE_LABELS: Record<CompetitorProvenance, string> = {
  captured: "浏览器采集",
  manual: "人工录入",
  ai_generated: "AI 推断",
  template: "本地模板",
  demo: "演示示例",
  unknown: "来源未知",
};

export const PROVENANCE_VERIFIED: CompetitorProvenance[] = ["captured", "manual"];

/** 客户端安全：只做字符串统计，不引入服务端专用的文案生成模块 */
export function countDraftPlaceholders(result: AntiListingResult | null): number {
  if (!result) return 0;
  const texts = [
    result.antiTitle,
    ...result.bullets.flatMap((b) => [b.headline, b.content, b.counterTarget]),
    ...(result.aplusModules ?? []).flatMap((m) => [m.title, m.description, m.visualSuggestion]),
  ];
  return texts.reduce((sum, text) => sum + (text.split("[VERIFY:").length - 1), 0);
}

/** 计算买家真实总支付额（券后价 + 买家另付单独运费；亚马逊佣金与卖家毛收入均按总支付额核算） */
export function getBuyerTotalPriceCents(
  item: Pick<CompetitorProfile, "priceCents" | "effectivePriceCents" | "shippingCents">,
): number {
  const base =
    item.effectivePriceCents && item.effectivePriceCents > 0 && item.effectivePriceCents < item.priceCents
      ? item.effectivePriceCents
      : item.priceCents;
  if (!base || base <= 0) return 0;
  return base + (item.shippingCents && item.shippingCents > 0 ? item.shippingCents : 0);
}

/** 基于权威财务内核 calculateEconomics，按 18% 净利率硬门禁倒推该单品的 1688 采购上限 (RMB) */
export function estimateMaxPurchaseRmb(
  salePriceCents: number,
  currency: string,
  platformCode: string,
  mode: AppMode = "sandbox",
  targetMargin = 0.18,
): number {
  if (!salePriceCents || salePriceCents <= 0) return 0;
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const checkMargin = (rmb: number) => {
    const purchaseCents = convertRmbToForeignCents(rmb, currency, mode);
    const landedCostCents = Math.round(purchaseCents * 1.25);
    return calculateEconomics({
      currency,
      salePriceCents,
      landedCostCents,
      ...defaults,
    }).marginRate;
  };
  if (checkMargin(0.5) < targetMargin) return 0;
  let lo = 0;
  let hi = 2000;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (checkMargin(mid) >= targetMargin) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.round(lo * 10) / 10);
}

/** 计算单品在指定拿货价 (RMB) 下的毛利率与单件净利润（外币 + 人民币） */
export function calcItemProfitEstimate(
  salePriceCents: number,
  purchaseRmb: number,
  currency: string,
  platformCode: string,
  mode: AppMode = "sandbox",
): { marginPct: number; netProfitCents: number; netProfitRmb: number } {
  if (!salePriceCents || salePriceCents <= 0 || !purchaseRmb || purchaseRmb <= 0) {
    return { marginPct: 0, netProfitCents: 0, netProfitRmb: 0 };
  }
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const purchaseCents = convertRmbToForeignCents(purchaseRmb, currency, mode);
  const landedCostCents = Math.round(purchaseCents * 1.25);
  const econ = calculateEconomics({
    currency,
    salePriceCents,
    landedCostCents,
    ...defaults,
  });
  const fxRate = (OFFICIAL_FX_CONFIG[currency] || OFFICIAL_FX_CONFIG.USD).rateToRmb;
  return {
    marginPct: Number((econ.marginRate * 100).toFixed(1)),
    netProfitCents: econ.netProfitCents,
    netProfitRmb: Number(((econ.netProfitCents / 100) * fxRate).toFixed(1)),
  };
}

/** 计算单品在指定 1688 实采进价 (RMB) 下的真实净利率 */
export function calcItemRealMarginPct(
  salePriceCents: number,
  actualCny: number,
  currency: string,
  platformCode: string,
  mode: AppMode = "sandbox",
): number {
  if (!salePriceCents || salePriceCents <= 0 || !actualCny || actualCny <= 0) return 0;
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const purchaseCents = convertRmbToForeignCents(actualCny, currency, mode);
  const landedCostCents = Math.round(purchaseCents * 1.25);
  const econ = calculateEconomics({
    currency,
    salePriceCents,
    landedCostCents,
    ...defaults,
  });
  return Number((econ.marginRate * 100).toFixed(1));
}

export const SAMPLE_PRESETS = [
  {
    name: "车载吸尘器三强横向对比",
    inputs: `https://www.amazon.com/dp/B08CZ8K652 (Fanttik V8 Apex 19000Pa High Power)
https://www.amazon.com/dp/B09M87J11L (Baseus A2 Pro Car Vacuum 6000Pa)
https://www.amazon.com/dp/B0875X3V95 (Anker eufy HomeVac H11 Cordless Pure)`,
  },
  {
    name: "口袋便携筋膜枪对标",
    inputs: `https://www.amazon.com/dp/B0B5D982K7 (TheraGun Mini 2.0 Ultra-Portable)
https://www.amazon.com/dp/B09V7N86G5 (Renpho Active Pocket Massage Gun)`,
  },
];
