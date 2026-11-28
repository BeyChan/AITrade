import { isContentApprovedStatus } from "./case-stage.ts";

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
