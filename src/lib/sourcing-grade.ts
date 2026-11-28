import type { CostSheet } from "./cost-sheets-repository.ts";
import type { AISourcingHypothesisDetail } from "./ai-sourcing-repo/types.ts";
import type { evaluateFastScreen, SourcingFunnelThresholds } from "./sourcing-funnel.ts";

type FastScreenResult = ReturnType<typeof evaluateFastScreen>;

/**
 * 自动选品与手动选品统一的立项前五级分级。
 * 人工补齐真实报价并定标后，才由决策门禁另行签发正式 GO / NO-GO。
 */
export type SourcingGrade = "S" | "A" | "B" | "HOLD" | "ELIMINATED";

export type SourcingGradeMeta = {
  grade: SourcingGrade;
  shortLabel: string;
  fullLabel: string;
  badgeClass: string;
};

export const SOURCING_GRADE_META: Record<SourcingGrade, SourcingGradeMeta> = {
  S: { grade: "S", shortLabel: "S 级", fullLabel: "S 级 · 优先找厂", badgeClass: "badge-success" },
  A: { grade: "A", shortLabel: "A 级", fullLabel: "A 级 · 复核报价", badgeClass: "status-review_pending" },
  B: { grade: "B", shortLabel: "B 级", fullLabel: "B 级 · 补扫竞品", badgeClass: "badge-warn" },
  HOLD: { grade: "HOLD", shortLabel: "HOLD", fullLabel: "HOLD · 待观察", badgeClass: "badge-neutral" },
  ELIMINATED: { grade: "ELIMINATED", shortLabel: "已淘汰", fullLabel: "已淘汰", badgeClass: "badge-danger" },
};

export type SourcingGradeThresholds = {
  sGradeMinMargin: number;
  sGradeMinScore: number;
  aGradeMinMargin: number;
  aGradeMinScore: number;
  minMarginRate: number;
};

export const DEFAULT_SOURCING_GRADE_THRESHOLDS: SourcingGradeThresholds = {
  sGradeMinMargin: 0.24,
  sGradeMinScore: 75,
  aGradeMinMargin: 0.18,
  aGradeMinScore: 60,
  minMarginRate: 0.18,
};

/**
 * 自动选品与手动选品共用的核心评级函数。
 */
export function resolveSourcingGrade(input: {
  hardFail: boolean;
  hasRealEvidence: boolean;
  marketStatus: "pass" | "hold" | "fail" | "pending";
  marginRate: number | null;
  score: number;
  thresholds?: Partial<SourcingGradeThresholds>;
}): SourcingGrade {
  const th: SourcingGradeThresholds = {
    ...DEFAULT_SOURCING_GRADE_THRESHOLDS,
    ...input.thresholds,
  };

  if (input.hardFail) return "ELIMINATED";
  if (!input.hasRealEvidence) return "HOLD";

  const margin = input.marginRate;
  if (
    input.marketStatus === "pass" &&
    margin !== null &&
    margin >= th.sGradeMinMargin &&
    input.score >= th.sGradeMinScore
  ) {
    return "S";
  }

  if (
    input.marketStatus === "pass" &&
    margin !== null &&
    margin >= th.aGradeMinMargin &&
    input.score >= th.aGradeMinScore
  ) {
    return "A";
  }

  if (
    (input.marketStatus === "hold" && margin !== null && margin >= th.minMarginRate) ||
    (input.marketStatus === "pass" && margin === null && input.score >= th.aGradeMinScore)
  ) {
    return "B";
  }

  return "HOLD";
}

/**
 * 为手动选品（/ai-sourcing）的候选方向计算与自动选品完全一致的立项前分级。
 */
export function gradeManualHypothesis(input: {
  hypothesis: AISourcingHypothesisDetail;
  fastScreen: FastScreenResult;
  costSheet?: CostSheet | null;
  funnelThresholds?: Partial<SourcingFunnelThresholds>;
}): SourcingGradeMeta {
  const { hypothesis, fastScreen, costSheet, funnelThresholds } = input;
  const minMargin = funnelThresholds?.minMarginRate ?? DEFAULT_SOURCING_GRADE_THRESHOLDS.minMarginRate;
  const marginRate =
    costSheet?.results.marginRate ??
    hypothesis.decision?.marginRate ??
    null;

  const verifiedCompetitors = hypothesis.counts.verifiedCompetitors ?? hypothesis.counts.competitors;
  const hasRealEvidence = verifiedCompetitors > 0 || Boolean(hypothesis.comparisonReportId);

  const hardFail =
    Boolean(hypothesis.eliminatedAt) ||
    hypothesis.decision?.decision === "NO-GO" ||
    fastScreen.marketStatus === "fail" ||
    fastScreen.complianceStatus === "fail" ||
    (marginRate !== null && marginRate < minMargin * 0.5);

  const grade = resolveSourcingGrade({
    hardFail,
    hasRealEvidence,
    marketStatus: fastScreen.marketStatus,
    marginRate,
    score: hypothesis.priorityScore,
    thresholds: {
      minMarginRate: minMargin,
      aGradeMinMargin: minMargin,
      sGradeMinMargin: Math.max(0.24, minMargin + 0.06),
    },
  });

  return SOURCING_GRADE_META[grade];
}
