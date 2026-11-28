import { DEFAULT_FUNNEL_THRESHOLDS } from "../sourcing-funnel.ts";
import type {
  AutoGradingThresholds,
  DeliveryMethodCode,
  PlatformEconomicsDefaults,
  PlatformPipelineConfig,
} from "./types.ts";

export const DEFAULT_AUTO_THRESHOLDS: AutoGradingThresholds = {
  ...DEFAULT_FUNNEL_THRESHOLDS,
  sGradeMinMargin: 0.24,
  sGradeMinScore: 65,
  aGradeMinMargin: 0.18,
  aGradeMinScore: 52,
  minPriceCents: 1500,
  maxPriceCents: 25000,
};

export const BUILTIN_PLATFORM_CONFIGS: PlatformPipelineConfig[] = [
  {
    id: "amazon:US",
    platformCode: "amazon",
    marketCode: "US",
    currency: "USD",
    enabled: true,
    label: "Amazon 美国站 (US)",
    economicsDefaults: {
      referralRate: 0.15,
      fbaFeeRate: 0.14,
      fbaFeeMinCents: 380,
      adRate: 0.12,
      returnRate: 0.05,
      estimatedLandedCostRatio: 0.24,
      targetMarginRate: 0.18,
    },
    thresholds: { ...DEFAULT_AUTO_THRESHOLDS },
    deliveryMethods: ["flatfile_tsv", "extension_autofill"],
    inboxDir: ".data/inbox-csv/amazon-US",
  },
  {
    id: "amazon:UK",
    platformCode: "amazon",
    marketCode: "UK",
    currency: "GBP",
    enabled: true,
    label: "Amazon 英国站 (UK)",
    economicsDefaults: {
      referralRate: 0.15,
      fbaFeeRate: 0.14,
      fbaFeeMinCents: 320,
      adRate: 0.12,
      returnRate: 0.06,
      estimatedLandedCostRatio: 0.24,
      targetMarginRate: 0.18,
    },
    thresholds: { ...DEFAULT_AUTO_THRESHOLDS },
    deliveryMethods: ["flatfile_tsv", "extension_autofill"],
    inboxDir: ".data/inbox-csv/amazon-UK",
  },
  {
    id: "amazon:DE",
    platformCode: "amazon",
    marketCode: "DE",
    currency: "EUR",
    enabled: true,
    label: "Amazon 德国站 (DE)",
    economicsDefaults: {
      referralRate: 0.15,
      fbaFeeRate: 0.14,
      fbaFeeMinCents: 350,
      adRate: 0.12,
      returnRate: 0.07,
      estimatedLandedCostRatio: 0.24,
      targetMarginRate: 0.18,
    },
    thresholds: { ...DEFAULT_AUTO_THRESHOLDS },
    deliveryMethods: ["flatfile_tsv", "extension_autofill"],
    inboxDir: ".data/inbox-csv/amazon-DE",
  },
  {
    id: "amazon:JP",
    platformCode: "amazon",
    marketCode: "JP",
    currency: "JPY",
    enabled: true,
    label: "Amazon 日本站 (JP)",
    economicsDefaults: {
      referralRate: 0.12,
      fbaFeeRate: 0.13,
      fbaFeeMinCents: 45000,
      adRate: 0.1,
      returnRate: 0.04,
      estimatedLandedCostRatio: 0.25,
      targetMarginRate: 0.18,
    },
    thresholds: {
      ...DEFAULT_AUTO_THRESHOLDS,
      minPriceCents: 200000,
      maxPriceCents: 3500000,
    },
    deliveryMethods: ["flatfile_tsv", "extension_autofill"],
    inboxDir: ".data/inbox-csv/amazon-JP",
  },
  {
    id: "shopify:US",
    platformCode: "shopify",
    marketCode: "US",
    currency: "USD",
    enabled: true,
    label: "Shopify 独立站 (US)",
    economicsDefaults: {
      referralRate: 0.03,
      fbaFeeRate: 0.1,
      fbaFeeMinCents: 350,
      adRate: 0.22,
      returnRate: 0.05,
      estimatedLandedCostRatio: 0.22,
      targetMarginRate: 0.2,
    },
    thresholds: { ...DEFAULT_AUTO_THRESHOLDS },
    deliveryMethods: ["shopify_csv", "extension_autofill", "api_draft"],
    inboxDir: ".data/inbox-csv/shopify-US",
  },
  {
    id: "tiktok_shop:US",
    platformCode: "tiktok_shop",
    marketCode: "US",
    currency: "USD",
    enabled: true,
    label: "TikTok Shop 美区 (US)",
    economicsDefaults: {
      referralRate: 0.06,
      fbaFeeRate: 0.12,
      fbaFeeMinCents: 350,
      adRate: 0.18,
      returnRate: 0.06,
      estimatedLandedCostRatio: 0.24,
      targetMarginRate: 0.18,
    },
    thresholds: { ...DEFAULT_AUTO_THRESHOLDS },
    deliveryMethods: ["extension_autofill"],
    inboxDir: ".data/inbox-csv/tiktok_shop-US",
  },
];

export function buildConfigId(platformCode: string, marketCode: string): string {
  return `${platformCode.trim().toLowerCase()}:${marketCode.trim().toUpperCase()}`;
}

export function getDefaultPlatformConfig(
  platformCode: string,
  marketCode: string,
): PlatformPipelineConfig {
  const normalizedPlatform = platformCode.trim().toLowerCase() || "amazon";
  const normalizedMarket = marketCode.trim().toUpperCase() || "US";
  const exact = BUILTIN_PLATFORM_CONFIGS.find(
    (c) => c.platformCode === normalizedPlatform && c.marketCode === normalizedMarket,
  );
  if (exact) return structuredClone(exact);

  const samePlatform = BUILTIN_PLATFORM_CONFIGS.find((c) => c.platformCode === normalizedPlatform);
  const currencyMap: Record<string, string> = {
    US: "USD",
    UK: "GBP",
    GB: "GBP",
    DE: "EUR",
    FR: "EUR",
    IT: "EUR",
    ES: "EUR",
    JP: "JPY",
    CA: "CAD",
    AU: "AUD",
  };
  const currency = currencyMap[normalizedMarket] || samePlatform?.currency || "USD";

  return {
    id: buildConfigId(normalizedPlatform, normalizedMarket),
    platformCode: normalizedPlatform,
    marketCode: normalizedMarket,
    currency,
    enabled: true,
    label: `${normalizedPlatform.toUpperCase()} (${normalizedMarket})`,
    economicsDefaults: structuredClone(
      samePlatform?.economicsDefaults ?? BUILTIN_PLATFORM_CONFIGS[0]!.economicsDefaults,
    ),
    thresholds: structuredClone(
      samePlatform?.thresholds ?? DEFAULT_AUTO_THRESHOLDS,
    ),
    deliveryMethods: [...(samePlatform?.deliveryMethods ?? ["extension_autofill"])],
    inboxDir: `.data/inbox-csv/${normalizedPlatform}-${normalizedMarket}`,
  };
}

export function sanitizePlatformConfigPatch(
  base: PlatformPipelineConfig,
  patch: Partial<{
    currency: string;
    enabled: boolean;
    label: string;
    economicsDefaults: Partial<PlatformEconomicsDefaults>;
    thresholds: Partial<AutoGradingThresholds>;
    deliveryMethods: DeliveryMethodCode[];
    inboxDir: string | null;
  }>,
): PlatformPipelineConfig {
  const clampNum = (val: unknown, fallback: number, min: number, max: number) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const econ = patch.economicsDefaults ?? {};
  const th = patch.thresholds ?? {};

  return {
    ...base,
    currency: typeof patch.currency === "string" && patch.currency.trim() ? patch.currency.trim().toUpperCase() : base.currency,
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : base.enabled,
    label: typeof patch.label === "string" && patch.label.trim() ? patch.label.trim() : base.label,
    inboxDir: patch.inboxDir === undefined ? base.inboxDir : (patch.inboxDir?.trim() || null),
    deliveryMethods: Array.isArray(patch.deliveryMethods) && patch.deliveryMethods.length > 0
      ? patch.deliveryMethods
      : base.deliveryMethods,
    economicsDefaults: {
      referralRate: clampNum(econ.referralRate, base.economicsDefaults.referralRate, 0, 0.5),
      fbaFeeRate: clampNum(econ.fbaFeeRate, base.economicsDefaults.fbaFeeRate, 0, 0.5),
      fbaFeeMinCents: Math.round(clampNum(econ.fbaFeeMinCents, base.economicsDefaults.fbaFeeMinCents, 0, 500000)),
      adRate: clampNum(econ.adRate, base.economicsDefaults.adRate, 0, 0.6),
      returnRate: clampNum(econ.returnRate, base.economicsDefaults.returnRate, 0, 0.5),
      estimatedLandedCostRatio: clampNum(econ.estimatedLandedCostRatio, base.economicsDefaults.estimatedLandedCostRatio, 0.05, 0.7),
      targetMarginRate: clampNum(econ.targetMarginRate, base.economicsDefaults.targetMarginRate, 0.05, 0.6),
    },
    thresholds: {
      minMarginRate: clampNum(th.minMarginRate, base.thresholds.minMarginRate, 0.05, 0.6),
      maxHhi: Math.round(clampNum(th.maxHhi, base.thresholds.maxHhi, 500, 10000)),
      maxBrandCr3Percent: Math.round(clampNum(th.maxBrandCr3Percent, base.thresholds.maxBrandCr3Percent, 20, 100)),
      maxMedianReviews: Math.round(clampNum(th.maxMedianReviews, base.thresholds.maxMedianReviews, 50, 50000)),
      minCompetitorsForPass: Math.round(clampNum(th.minCompetitorsForPass, base.thresholds.minCompetitorsForPass, 1, 100)),
      maxComplianceCostUsd: Math.round(clampNum(th.maxComplianceCostUsd, base.thresholds.maxComplianceCostUsd, 100, 50000)),
      sGradeMinMargin: clampNum(th.sGradeMinMargin, base.thresholds.sGradeMinMargin, 0.1, 0.7),
      sGradeMinScore: Math.round(clampNum(th.sGradeMinScore, base.thresholds.sGradeMinScore, 40, 99)),
      aGradeMinMargin: clampNum(th.aGradeMinMargin, base.thresholds.aGradeMinMargin, 0.05, 0.6),
      aGradeMinScore: Math.round(clampNum(th.aGradeMinScore, base.thresholds.aGradeMinScore, 30, 95)),
      minPriceCents: Math.round(clampNum(th.minPriceCents, base.thresholds.minPriceCents, 100, 10000000)),
      maxPriceCents: Math.round(clampNum(th.maxPriceCents, base.thresholds.maxPriceCents, 500, 50000000)),
    },
  };
}
