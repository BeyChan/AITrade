import { calculateEconomics, calculateTargetLandedCost } from "./economics.ts";
import { platformEconomicDefaults } from "./ai-sourcing.ts";
import { convertForeignCentsToRmb, convertRmbToForeignCents } from "./currency.ts";
import {
  evaluatePrelaunchCompliance,
  type ProductComplianceAttribute,
} from "./prelaunch-compliance.ts";
import type { CompetitorComparisonReport } from "./competitor-compare/types.ts";
import type { AISourcingHypothesisDetail, AIValidationTask } from "./ai-sourcing-repo/types.ts";

export const ELIMINATION_REASONS = [
  "大牌垄断",
  "评论壁垒高",
  "利润不够",
  "合规",
  "太重",
  "货源不行",
] as const;

export type EliminationReason = (typeof ELIMINATION_REASONS)[number];

export function isValidEliminationReason(value: string): value is EliminationReason {
  return (ELIMINATION_REASONS as readonly string[]).includes(value);
}

/** 选品漏斗红灯阈值（存于 app_settings，可随时调整） */
export type SourcingFunnelThresholds = {
  minCompetitorsForPass: number;
  maxHhi: number;
  maxBrandCr3Percent: number;
  maxMedianReviews: number;
  minMarginRate: number;
  maxComplianceCostUsd: number;
};

export const DEFAULT_FUNNEL_THRESHOLDS: SourcingFunnelThresholds = {
  minCompetitorsForPass: 20,
  maxHhi: 3500,
  maxBrandCr3Percent: 60,
  maxMedianReviews: 3000,
  minMarginRate: 0.18,
  maxComplianceCostUsd: 1000,
};

export type CustomExclusionItem = {
  id: string;
  label: string;
  enabled: boolean;
};

/** 结构化选品约束（阶段 4） */
export type SourcingConstraints = {
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  maxWeightKg: number | null;
  excludedAttrs: ProductComplianceAttribute[];
  customExclusions?: CustomExclusionItem[];
  hiddenAttrs?: ProductComplianceAttribute[];
  attrLabelOverrides?: Partial<Record<ProductComplianceAttribute, string>>;
  customNote: string;
};

export const DEFAULT_SOURCING_CONSTRAINTS: SourcingConstraints = {
  minPriceUsd: 20,
  maxPriceUsd: 60,
  maxWeightKg: 1.0,
  excludedAttrs: ["battery", "children", "liquid_cosmetic", "laser_medical"],
  customNote: "",
};

const EXCLUSION_KEYWORDS: Record<ProductComplianceAttribute, RegExp> = {
  battery: /锂电|电池|充电宝|无线吸尘|电动|battery|rechargeable|lithium|power bank/i,
  wireless: /蓝牙|wifi|wi-fi|射频|app联动|遥控|bluetooth|wireless|smart app/i,
  food_contact: /食品接触|厨具|保温杯|水杯|餐具|食盆|饮水机|food contact|tumbler|cookware|cutting board/i,
  children: /儿童|婴幼儿|宝宝|母婴|玩具|baby|toddler|kids|children|infant|toy/i,
  plug_ac: /插头|适配器|小家电|电源|plug|adapter|ac power|110v|220v/i,
  liquid_cosmetic: /液体|膏体|精油|洗剂|清洁液|喷雾|美妆|护肤|liquid|oil|spray|cream|serum|cosmetic/i,
  laser_medical: /激光|红外|理疗|医疗|筋膜枪|美容仪|laser|medical|therapy|infrared/i,
};

const EXCLUSION_LABELS: Record<ProductComplianceAttribute, string> = {
  battery: "锂电池/带电品",
  wireless: "蓝牙/Wi-Fi射频",
  food_contact: "食品接触",
  children: "儿童/母婴",
  plug_ac: "交流电插头",
  liquid_cosmetic: "液体/膏体/美妆",
  laser_medical: "激光/理疗/医疗",
};

export function formatConstraintsSummary(constraints: SourcingConstraints): string {
  const parts: string[] = [];
  if (constraints.minPriceUsd || constraints.maxPriceUsd) {
    const lo = constraints.minPriceUsd ? `$${constraints.minPriceUsd}` : "不限";
    const hi = constraints.maxPriceUsd ? `$${constraints.maxPriceUsd}` : "不限";
    parts.push(`客单价 ${lo}–${hi}`);
  }
  if (constraints.maxWeightKg) {
    parts.push(`单件重量 ≤ ${constraints.maxWeightKg}kg`);
  }
  const excludedLabels: string[] = [];
  for (const attr of constraints.excludedAttrs) {
    if (constraints.hiddenAttrs?.includes(attr)) continue;
    excludedLabels.push(constraints.attrLabelOverrides?.[attr]?.trim() || EXCLUSION_LABELS[attr]);
  }
  for (const item of constraints.customExclusions ?? []) {
    if (item.enabled && item.label.trim()) excludedLabels.push(item.label.trim());
  }
  if (excludedLabels.length > 0) {
    parts.push(`直接排除：${excludedLabels.join("、")}`);
  }
  if (constraints.customNote.trim()) {
    parts.push(constraints.customNote.trim());
  }
  return parts.join("；");
}

export function checkHypothesisAgainstConstraints(
  text: string,
  recommendedPriceUsdCents: number | null,
  constraints: SourcingConstraints,
): string[] {
  const violations: string[] = [];
  for (const attr of constraints.excludedAttrs) {
    if (constraints.hiddenAttrs?.includes(attr)) continue;
    const pattern = EXCLUSION_KEYWORDS[attr];
    if (pattern && pattern.test(text)) {
      const label = constraints.attrLabelOverrides?.[attr]?.trim() || EXCLUSION_LABELS[attr];
      violations.push(`命中排除项「${label}」`);
    }
  }
  const lowerText = text.toLowerCase();
  for (const item of constraints.customExclusions ?? []) {
    if (!item.enabled || !item.label.trim()) continue;
    const tokens = item.label
      .split(/[/／、,，\s]+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 2);
    if (tokens.some((tok) => lowerText.includes(tok))) {
      violations.push(`命中排除项「${item.label.trim()}」`);
    }
  }
  if (recommendedPriceUsdCents && recommendedPriceUsdCents > 0) {
    const priceUsd = recommendedPriceUsdCents / 100;
    if (constraints.minPriceUsd && priceUsd < constraints.minPriceUsd * 0.7) {
      violations.push(`建议售价 $${priceUsd.toFixed(0)} 显著低于下限 $${constraints.minPriceUsd}`);
    }
    if (constraints.maxPriceUsd && priceUsd > constraints.maxPriceUsd * 1.4) {
      violations.push(`建议售价 $${priceUsd.toFixed(0)} 显著高于上限 $${constraints.maxPriceUsd}`);
    }
  }
  return violations;
}

// ============================================================================
// 阶段 1：8 项验证任务收口为 3 组渐进步骤
// ============================================================================

export type TaskGroupKey = "market" | "sourcing" | "sample_risk";

export type GroupedTaskItem = {
  task: AIValidationTask;
  progressText: string;
  currentCount: number;
  actionLabel: string;
  actionHref: string;
};

export type ValidationTaskGroup = {
  key: TaskGroupKey;
  stepNumber: 1 | 2 | 3;
  title: string;
  question: string;
  lockedHint: string;
  items: GroupedTaskItem[];
  doneCount: number;
  totalCount: number;
  isComplete: boolean;
  isActive: boolean;
  isLocked: boolean;
};

export type TaskFlowSummary = {
  activeStepNumber: 1 | 2 | 3;
  activeGroupTitle: string;
  nextActionLabel: string;
  nextActionHref: string;
  groups: ValidationTaskGroup[];
};

const GROUP_DEFS: Array<{
  key: TaskGroupKey;
  stepNumber: 1 | 2 | 3;
  title: string;
  question: string;
  lockedHint: string;
  taskTypes: string[];
}> = [
  {
    key: "market",
    stepNumber: 1,
    title: "市场验证",
    question: "挤得进去吗？",
    lockedHint: "",
    taskTypes: ["competitor_scan"],
  },
  {
    key: "sourcing",
    stepNumber: 2,
    title: "找货报价与差评",
    question: "货靠谱吗？改哪里？",
    lockedHint: "完成市场验证后开放",
    taskTypes: ["review_research", "supplier_shortlist", "rfq_draft", "quote_collection"],
  },
  {
    key: "sample_risk",
    stepNumber: 3,
    title: "拿样与风险",
    question: "能立项吗？",
    lockedHint: "完成找货报价后开放",
    taskTypes: ["sample_order", "patent_check", "logistics_check"],
  },
];

export function groupValidationTasks(
  hypothesis: Pick<AISourcingHypothesisDetail, "id" | "tasks" | "counts" | "quotes" | "evidence" | "competitorQueries">,
  runId: string,
  supplierDraftCount = 0,
): TaskFlowSummary {
  const byType = new Map(hypothesis.tasks.map((t) => [t.taskType, t]));
  const verifiedCompetitors = hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors;
  const samplePassCount = hypothesis.quotes.filter((q) => (q.sampleScore ?? 0) >= 80).length;
  const patentCleared = hypothesis.evidence.some(
    (e) => e.evidenceType === "patent_check" && e.rawSnapshot?.riskLevel === "clear",
  );
  const logisticsCleared = hypothesis.evidence.some(
    (e) => e.evidenceType === "logistics_check" && e.rawSnapshot?.riskLevel === "clear",
  );

  const metaFor = (task: AIValidationTask): { current: number; progressText: string; actionLabel: string; actionHref: string } => {
    const baseHref = `/ai-sourcing/${encodeURIComponent(runId)}`;
    switch (task.taskType) {
      case "competitor_scan":
        return {
          current: verifiedCompetitors,
          progressText: task.status === "done" ? "已完成" : `${verifiedCompetitors}/${task.targetCount}`,
          actionLabel: "导入 Top 20 扫描",
          actionHref: `#fast-screen-market-${hypothesis.id}`,
        };
      case "review_research":
        return {
          current: hypothesis.counts.reviewSamples,
          progressText: task.status === "done" ? "已完成" : `${hypothesis.counts.reviewSamples}/${task.targetCount}`,
          actionLabel: "录差评",
          actionHref: `#entry-review-${hypothesis.id}`,
        };
      case "supplier_shortlist":
        return {
          current: hypothesis.counts.suppliers,
          progressText: task.status === "done" ? "已完成" : `${hypothesis.counts.suppliers}/${task.targetCount}`,
          actionLabel: "找供应商",
          actionHref: `${baseHref}?tab=suppliers&hypothesisId=${encodeURIComponent(hypothesis.id)}#supplier-discovery-${hypothesis.id}`,
        };
      case "rfq_draft":
        return {
          current: supplierDraftCount,
          progressText: task.status === "done" ? "已完成" : `${Math.min(supplierDraftCount, 1)}/1`,
          actionLabel: "生成询盘",
          actionHref: `${baseHref}?tab=quotes&hypothesisId=${encodeURIComponent(hypothesis.id)}#hypothesis-${hypothesis.id}`,
        };
      case "quote_collection":
        return {
          current: hypothesis.counts.quotes,
          progressText: task.status === "done" ? "已完成" : `${hypothesis.counts.quotes}/${task.targetCount}`,
          actionLabel: "录报价",
          actionHref: `${baseHref}?tab=quotes&hypothesisId=${encodeURIComponent(hypothesis.id)}#supplier-quote-${hypothesis.id}`,
        };
      case "sample_order":
        return {
          current: samplePassCount,
          progressText: task.status === "done" ? "已完成" : `${samplePassCount}/${task.targetCount}`,
          actionLabel: "录样品分",
          actionHref: `${baseHref}?tab=quotes&hypothesisId=${encodeURIComponent(hypothesis.id)}#supplier-quote-${hypothesis.id}`,
        };
      case "patent_check":
        return {
          current: patentCleared ? 1 : 0,
          progressText: task.status === "done" ? "已完成" : "待核验",
          actionLabel: "查专利",
          actionHref: `#entry-patent-${hypothesis.id}`,
        };
      case "logistics_check":
        return {
          current: logisticsCleared ? 1 : 0,
          progressText: task.status === "done" ? "已完成" : "待核验",
          actionLabel: "核物流",
          actionHref: `#entry-logistics-${hypothesis.id}`,
        };
      default:
        return {
          current: task.status === "done" ? task.targetCount : 0,
          progressText: task.status === "done" ? "已完成" : "待完成",
          actionLabel: "处理",
          actionHref: `#hypothesis-${hypothesis.id}`,
        };
    }
  };

  let activeStepNumber: 1 | 2 | 3 = 3;
  const rawGroups = GROUP_DEFS.map((def) => {
    const items: GroupedTaskItem[] = def.taskTypes
      .map((type) => byType.get(type))
      .filter((t): t is AIValidationTask => Boolean(t))
      .map((task) => {
        const meta = metaFor(task);
        return {
          task,
          currentCount: meta.current,
          progressText: meta.progressText,
          actionLabel: meta.actionLabel,
          actionHref: meta.actionHref,
        };
      });
    const doneCount = items.filter((i) => i.task.status === "done").length;
    const isComplete = items.length > 0 && doneCount === items.length;
    return { def, items, doneCount, isComplete };
  });

  const firstIncomplete = rawGroups.find((g) => !g.isComplete);
  activeStepNumber = firstIncomplete ? firstIncomplete.def.stepNumber : 3;

  const groups: ValidationTaskGroup[] = rawGroups.map(({ def, items, doneCount, isComplete }) => ({
    key: def.key,
    stepNumber: def.stepNumber,
    title: def.title,
    question: def.question,
    lockedHint: def.lockedHint,
    items,
    doneCount,
    totalCount: items.length,
    isComplete,
    isActive: def.stepNumber === activeStepNumber,
    isLocked: def.stepNumber > activeStepNumber,
  }));

  const activeGroup = groups.find((g) => g.isActive) ?? groups[0]!;
  const nextItem = activeGroup.items.find((i) => i.task.status !== "done") ?? activeGroup.items[0];
  const allDone = groups.every((g) => g.isComplete);

  return {
    activeStepNumber,
    activeGroupTitle: activeGroup.title,
    nextActionLabel: allDone ? "查看立项门禁" : nextItem?.actionLabel ?? "去处理",
    nextActionHref: allDone
      ? `/ai-sourcing/${encodeURIComponent(runId)}?tab=decision&hypothesisId=${encodeURIComponent(hypothesis.id)}#hypothesis-${hypothesis.id}`
      : nextItem?.actionHref ?? `#hypothesis-${hypothesis.id}`,
    groups,
  };
}

// ============================================================================
// 阶段 2：扫市场 + 算利润综合快筛评估
// ============================================================================

export type FunnelSignalStatus = "pass" | "hold" | "fail" | "pending";

export type FastScreenEvaluation = {
  marketStatus: FunnelSignalStatus;
  marketSummary: string;
  marketBlockers: string[];
  competitorCount: number;
  hhi: number | null;
  brandCr3Percent: number | null;
  medianReviews: number | null;
  p50PriceCents: number | null;
  profitStatus: FunnelSignalStatus;
  profitSummary: string;
  marginRate: number | null;
  maxFactoryRmb: number | null;
  complianceStatus: FunnelSignalStatus;
  complianceSummary: string;
  complianceCostUsd: number;
  suggestedEliminationReason: EliminationReason | null;
};

export function evaluateFastScreen(input: {
  marketCode: string;
  platformCode: string;
  currency: string;
  verifiedCompetitorCount: number;
  p50PriceCents: number | null;
  referenceFactoryCostRmb: number | null;
  complianceAttrs: ProductComplianceAttribute[];
  conceptText: string;
  report?: CompetitorComparisonReport | null;
  thresholds?: Partial<SourcingFunnelThresholds>;
}): FastScreenEvaluation {
  const th: SourcingFunnelThresholds = { ...DEFAULT_FUNNEL_THRESHOLDS, ...(input.thresholds ?? {}) };
  const marketBlockers: string[] = [];
  let marketStatus: FunnelSignalStatus = "pending";
  let marketSummary = "尚未导入搜索页 Top 20 扫描";

  const productIndex = input.report?.productIndex ?? null;
  const hhi = productIndex?.pillars.monopolyRivalry.isAvailable ? productIndex.mathEvidence.hhi : null;
  const brandCr3Percent = productIndex?.pillars.monopolyRivalry.isAvailable
    ? productIndex.mathEvidence.brandCr3Percent
    : null;

  let medianReviews: number | null = null;
  if (input.report && input.report.competitors.length > 0) {
    const organic = input.report.competitors.filter((c) => !c.isSponsored);
    const pool = organic.length >= 4 ? organic : input.report.competitors;
    const revValues = pool
      .map((c) => c.reviewCount)
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    if (revValues.length > 0) {
      medianReviews = revValues[Math.floor(revValues.length / 2)]!;
    }
  }

  let suggestedEliminationReason: EliminationReason | null = null;

  if (input.verifiedCompetitorCount > 0 || input.report) {
    const count = Math.max(input.verifiedCompetitorCount, input.report?.competitors.length ?? 0);
    if (hhi !== null && hhi > th.maxHhi) {
      marketBlockers.push(`品牌 HHI=${hhi} > ${th.maxHhi}（寡头垄断）`);
      suggestedEliminationReason ??= "大牌垄断";
    } else if (brandCr3Percent !== null && brandCr3Percent >= th.maxBrandCr3Percent) {
      marketBlockers.push(`Top 3 品牌占比 ${brandCr3Percent}% ≥ ${th.maxBrandCr3Percent}%`);
      suggestedEliminationReason ??= "大牌垄断";
    }
    if (medianReviews !== null && medianReviews >= th.maxMedianReviews) {
      marketBlockers.push(`自然位评论中位数 ${medianReviews.toLocaleString()} ≥ ${th.maxMedianReviews.toLocaleString()}`);
      suggestedEliminationReason ??= "评论壁垒高";
    }
    if (productIndex?.decision === "NO-GO") {
      marketBlockers.push(`竞争力指数 ${productIndex.totalScore} 分（NO-GO）`);
      suggestedEliminationReason ??= "评论壁垒高";
    }

    if (marketBlockers.length > 0) {
      marketStatus = "fail";
      marketSummary = marketBlockers.join("；");
    } else if (count < th.minCompetitorsForPass) {
      marketStatus = "hold";
      marketSummary = `当前 ${count}/${th.minCompetitorsForPass} 个竞品（不足 20 个标 HOLD，建议再抓一页）`;
    } else {
      marketStatus = "pass";
      marketSummary = productIndex
        ? `已扫 ${count} 个竞品 · 指数 ${productIndex.totalScore} 分（${productIndex.grade} 级）`
        : `已扫 ${count} 个真实竞品，格局通过`;
    }
  }

  // ③ 算利润
  const priceCents = input.p50PriceCents && input.p50PriceCents > 0
    ? input.p50PriceCents
    : input.report?.priceStats.p50 && input.report.priceStats.p50 > 0
      ? input.report.priceStats.p50
      : null;

  let profitStatus: FunnelSignalStatus = "pending";
  let profitSummary = priceCents ? "填入 1688 参考价即可反推 18% 净利" : "需先扫市场得到价格带中位数";
  let marginRate: number | null = null;
  let maxFactoryRmb: number | null = null;

  if (priceCents) {
    const defaults = platformEconomicDefaults(input.platformCode, priceCents);
    const defaultFreightCents = 220; // 保守估算单件头程 $2.20
    const target18 = calculateTargetLandedCost({
      currency: input.currency,
      salePriceCents: priceCents,
      ...defaults,
      targetMarginRate: th.minMarginRate,
    });
    if (target18.achievable) {
      const maxPurchaseForeign = Math.max(0, target18.maxLandedCostCents - defaultFreightCents);
      maxFactoryRmb = Number(convertForeignCentsToRmb(maxPurchaseForeign, input.currency).toFixed(1));
    } else {
      maxFactoryRmb = 0;
    }

    if (input.referenceFactoryCostRmb && input.referenceFactoryCostRmb > 0) {
      const purchaseForeign = convertRmbToForeignCents(input.referenceFactoryCostRmb, input.currency);
      const econ = calculateEconomics({
        currency: input.currency,
        salePriceCents: priceCents,
        landedCostCents: purchaseForeign + defaultFreightCents,
        ...defaults,
      });
      marginRate = econ.marginRate;
      const pctStr = `${(econ.marginRate * 100).toFixed(1)}%`;
      if (econ.marginRate < th.minMarginRate || econ.stressProfitCents <= 0) {
        profitStatus = "fail";
        profitSummary = `净利 ${pctStr}（低于 ${Math.round(th.minMarginRate * 100)}% 门禁；拿货需压至 ¥${maxFactoryRmb} 以内）`;
        suggestedEliminationReason ??= "利润不够";
      } else {
        profitStatus = "pass";
        profitSummary = `净利 ${pctStr} · 满足 18% 门禁（采购上限 ¥${maxFactoryRmb}）`;
      }
    } else if (maxFactoryRmb !== null) {
      profitSummary = `18% 净利最高允许 1688 拿货价 ¥${maxFactoryRmb}（待填参考价）`;
    }
  }

  // 合规红线
  const compliance = evaluatePrelaunchCompliance(input.marketCode, input.complianceAttrs, input.conceptText);
  let complianceStatus: FunnelSignalStatus = "pass";
  let complianceSummary = "无高危合规红线";
  if (compliance.riskLevel === "high" || compliance.totalEstimatedCostUsd >= th.maxComplianceCostUsd) {
    complianceStatus = "fail";
    complianceSummary = `命中 ${compliance.certifications.map((c) => c.code).join(" / ")}（预估 $${compliance.totalEstimatedCostUsd}）`;
    suggestedEliminationReason ??= "合规";
  } else if (compliance.riskLevel === "medium") {
    complianceStatus = "hold";
    complianceSummary = `需关注 ${compliance.certifications.map((c) => c.code).join(" / ")}（约 $${compliance.totalEstimatedCostUsd}）`;
  }

  return {
    marketStatus,
    marketSummary,
    marketBlockers,
    competitorCount: Math.max(input.verifiedCompetitorCount, input.report?.competitors.length ?? 0),
    hhi,
    brandCr3Percent,
    medianReviews,
    p50PriceCents: priceCents,
    profitStatus,
    profitSummary,
    marginRate,
    maxFactoryRmb,
    complianceStatus,
    complianceSummary,
    complianceCostUsd: compliance.totalEstimatedCostUsd,
    suggestedEliminationReason,
  };
}

// ============================================================================
// 阶段 3：候选看板 6 列状态纯函数推导
// ============================================================================

export type KanbanStageKey =
  | "candidate"
  | "scanned"
  | "profit_ok"
  | "sampling"
  | "promoted"
  | "eliminated";

export const KANBAN_COLUMNS: Array<{ key: KanbanStageKey; label: string; hint: string }> = [
  { key: "candidate", label: "候选", hint: "待扫搜索页" },
  { key: "scanned", label: "已扫市场", hint: "补齐竞品并核 1688 参考价" },
  { key: "profit_ok", label: "利润通过", hint: "待找厂录报价" },
  { key: "sampling", label: "拿样中", hint: "待打样与终审" },
  { key: "promoted", label: "已立项", hint: "已转商品案卷" },
  { key: "eliminated", label: "已淘汰", hint: "团队避坑清单" },
];

export type KanbanCandidateInput = {
  id: string;
  runId: string;
  productCaseId: string | null;
  eliminatedAt: string | null;
  verifiedCompetitorCount: number;
  comparisonReportId: string | null;
  confirmedPriceCents: number | null;
  referenceFactoryCostRmb: number | null;
  complianceAttrs: ProductComplianceAttribute[];
  quoteCount: number;
  supplierCount: number;
  decision: "GO" | "HOLD" | "NO-GO" | null;
  marketCode: string;
  platformCode: string;
  currency: string;
  concept: string;
};

export type DerivedKanbanState = {
  stage: KanbanStageKey;
  nextActionLabel: string;
  nextActionHref: string;
  metricBadge: string;
};

export function deriveCandidateKanbanStage(c: KanbanCandidateInput): DerivedKanbanState {
  const detailBase = `/ai-sourcing/${encodeURIComponent(c.runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(c.id)}`;

  if (c.eliminatedAt) {
    return {
      stage: "eliminated",
      nextActionLabel: "查看记录",
      nextActionHref: `${detailBase}#hypothesis-${c.id}`,
      metricBadge: "已淘汰",
    };
  }

  if (c.productCaseId) {
    return {
      stage: "promoted",
      nextActionLabel: "打开案卷",
      nextActionHref: `/cases/${encodeURIComponent(c.productCaseId)}`,
      metricBadge: "已立项",
    };
  }

  if (c.quoteCount > 0) {
    return {
      stage: "sampling",
      nextActionLabel: c.decision === "GO" ? "一键立项" : "补样品/报价",
      nextActionHref: c.decision === "GO"
        ? `/ai-sourcing/${encodeURIComponent(c.runId)}?tab=decision&hypothesisId=${encodeURIComponent(c.id)}#hypothesis-${c.id}`
        : `/ai-sourcing/${encodeURIComponent(c.runId)}?tab=quotes&hypothesisId=${encodeURIComponent(c.id)}#hypothesis-${c.id}`,
      metricBadge: `${c.quoteCount}/3 报价 · ${c.supplierCount}/3 厂`,
    };
  }

  const hasMarketScan = Boolean(c.comparisonReportId) || c.verifiedCompetitorCount > 0;
  if (hasMarketScan) {
    // 检查第 ③ 步利润与合规是否已通过
    if (c.referenceFactoryCostRmb && c.referenceFactoryCostRmb > 0 && c.confirmedPriceCents && c.confirmedPriceCents > 0) {
      const check = evaluateFastScreen({
        marketCode: c.marketCode,
        platformCode: c.platformCode,
        currency: c.currency,
        verifiedCompetitorCount: c.verifiedCompetitorCount,
        p50PriceCents: c.confirmedPriceCents,
        referenceFactoryCostRmb: c.referenceFactoryCostRmb,
        complianceAttrs: c.complianceAttrs,
        conceptText: c.concept,
      });
      if (check.profitStatus === "pass" && check.complianceStatus !== "fail") {
        return {
          stage: "profit_ok",
          nextActionLabel: "录报价",
          nextActionHref: `/ai-sourcing/${encodeURIComponent(c.runId)}?tab=suppliers&hypothesisId=${encodeURIComponent(c.id)}#hypothesis-${c.id}`,
          metricBadge: check.marginRate ? `净利 ${(check.marginRate * 100).toFixed(0)}%` : "利润通过",
        };
      }
    }
    return {
      stage: "scanned",
      nextActionLabel: c.verifiedCompetitorCount < 20 ? "补抓竞品" : "填 1688 价",
      nextActionHref: `${detailBase}#fast-screen-profit-${c.id}`,
      metricBadge: `${c.verifiedCompetitorCount}/20 竞品`,
    };
  }

  return {
    stage: "candidate",
    nextActionLabel: "抓搜索页",
    nextActionHref: `${detailBase}#fast-screen-market-${c.id}`,
    metricBadge: "待扫市场",
  };
}

// ============================================================================
// 阶段 4：淘汰历史避坑提醒（轻量分词匹配，零外部依赖）
// ============================================================================

export type EliminatedHistoryRecord = {
  id: string;
  runId: string;
  concept: string;
  category: string;
  marketCode: string;
  competitorQueries: string[];
  eliminationReason: string;
  eliminationNote: string | null;
  eliminatedAt: string;
};

export type EliminationMatchAlert = {
  record: EliminatedHistoryRecord;
  matchedTerms: string[];
};

function tokenizeText(raw: string): string[] {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, " ").trim();
  if (!cleaned) return [];
  const tokens = new Set<string>();
  for (const part of cleaned.split(/\s+/)) {
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 3) tokens.add(part);
    } else if (part.length >= 2) {
      tokens.add(part);
      // 中文 2 字滑窗便于模糊命中核心品类词
      for (let i = 0; i < part.length - 1; i++) {
        tokens.add(part.slice(i, i + 2));
      }
    }
  }
  return [...tokens];
}

export function findEliminationMatches(
  queryText: string,
  category: string,
  history: EliminatedHistoryRecord[],
  excludeHypothesisId?: string,
): EliminationMatchAlert[] {
  const targetTokens = new Set(tokenizeText(`${category} ${queryText}`));
  if (targetTokens.size === 0) return [];

  const matches: Array<{ alert: EliminationMatchAlert; score: number }> = [];
  for (const rec of history) {
    if (excludeHypothesisId && rec.id === excludeHypothesisId) continue;
    const recTokens = tokenizeText(`${rec.category} ${rec.concept} ${rec.competitorQueries.join(" ")}`);
    const overlap = recTokens.filter((t) => targetTokens.has(t));
    const uniqueOverlap = [...new Set(overlap)];
    const exactCategory = category.trim() && rec.category.trim().toLowerCase() === category.trim().toLowerCase();
    if (uniqueOverlap.length >= 2 || (exactCategory && uniqueOverlap.length >= 1)) {
      matches.push({
        alert: { record: rec, matchedTerms: uniqueOverlap.slice(0, 4) },
        score: uniqueOverlap.length + (exactCategory ? 1 : 0),
      });
    }
  }

  return matches
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.alert);
}
