import { isContentApprovedStatus } from "./case-stage.ts";
import { opportunityScore, recommendationFor, type EconomicsResults } from "./economics.ts";

export type ExportGateCheckResult =
  | { allowed: true }
  | { allowed: false; status: 409; code: string; error: string };

/**
 * Flat File (TSV) 服务端导出门禁：
 * 必须已有正式 Listing 且已通过人工终审（兼容 content_approved / published）。
 */
export function evaluateFlatFileExportGate(input: {
  caseStatus: string;
  hasSelection: boolean;
  hasListing: boolean;
  listingStatus?: string | null;
}): ExportGateCheckResult {
  if (input.caseStatus === "archived" || input.caseStatus === "rejected") {
    return {
      allowed: false,
      status: 409,
      code: "CASE_TERMINATED",
      error: "当前案卷已归档或已否决，不能导出正式交付包",
    };
  }
  if (!input.hasSelection) {
    return {
      allowed: false,
      status: 409,
      code: "SUPPLIER_NOT_SELECTED",
      error: "尚未完成供应商人工定标，当前不能导出正式交付包",
    };
  }
  if (!input.hasListing || !isContentApprovedStatus(input.listingStatus)) {
    return {
      allowed: false,
      status: 409,
      code: "CONTENT_NOT_APPROVED",
      error: "内容尚未通过人工终审，当前不能导出正式交付包",
    };
  }
  return { allowed: true };
}

/**
 * 上架素材包 (ZIP) 服务端导出门禁：
 * 必须通过内容人工终审，且满足最低素材要求（至少 1 张已审核主图或已绑定视觉素材）。
 */
export function evaluateMediaPackExportGate(input: {
  caseStatus: string;
  hasSelection: boolean;
  hasListing: boolean;
  listingStatus?: string | null;
  approvedMainImageCount: number;
  boundMediaCount: number;
}): ExportGateCheckResult {
  const base = evaluateFlatFileExportGate(input);
  if (!base.allowed) return base;

  if (input.approvedMainImageCount <= 0 && input.boundMediaCount <= 0) {
    return {
      allowed: false,
      status: 409,
      code: "MEDIA_ASSETS_MISSING",
      error: "缺少已审核主图或已绑定视觉素材，暂不满足正式素材包导出要求",
    };
  }
  return { allowed: true };
}

export type WizardGateRoutingResult = {
  score: number;
  evidenceScore: number;
  recommendation: "GO" | "HOLD" | "NO-GO";
  caseStatus: "approved" | "review_pending";
  requiresException: boolean;
  isProvisionalEstimate: boolean;
};

/**
 * 选品向导服务端重算与门禁分流：
 * - 不信任客户端硬编码的证据分和推荐结论
 * - 估算快筛（无真实供应商报价）时：
 *   - NO-GO：要求填写原因、风险与审批人走例外审批
 *   - HOLD：创建待验证案卷 (review_pending)
 *   - GO（有真实竞品研报且盈利达标）：创建正式推进案卷 (approved)；若无竞品研报纯估算，则落入待验证 (review_pending)
 */
export function evaluateWizardServerGate(input: {
  results: EconomicsResults;
  monthlySalesEstimate: number;
  reviewCount: number;
  competitorCount: number;
  hasSourceReport: boolean;
}): WizardGateRoutingResult {
  const safeSales = Math.max(0, Math.round(input.monthlySalesEstimate));
  const safeReviews = Math.max(0, Math.round(input.reviewCount));
  // 服务端按真实竞品证据计算证据分（无竞品研报的纯估算最多 35 分，不再硬编码 60/65）
  const evidenceScore = input.hasSourceReport
    ? Math.min(80, 40 + Math.min(input.competitorCount, 8) * 5)
    : 30;
  const score = opportunityScore(input.results, safeSales, safeReviews, evidenceScore);
  const recommendation = recommendationFor(input.results, score);

  if (recommendation === "NO-GO") {
    return {
      score,
      evidenceScore,
      recommendation,
      caseStatus: "review_pending",
      requiresException: true,
      isProvisionalEstimate: true,
    };
  }

  // 估算快筛无真实工厂报价，只有“具备竞品研报证据且财务模型达标 GO”才直接进入正式推进，其余一律创建待验证案卷
  const caseStatus = recommendation === "GO" && input.hasSourceReport ? "approved" : "review_pending";

  return {
    score,
    evidenceScore,
    recommendation,
    caseStatus,
    requiresException: false,
    isProvisionalEstimate: true,
  };
}
