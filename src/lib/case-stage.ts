/**
 * 单一阶段真源：全系统唯一确定商品案卷处于生命周期的哪一阶段。
 * 首页看板 (Pipeline Kanban)、案卷步骤条 (CaseStepper)、顶栏在办条 (WorkContextBar) 必须全部遵循此统一口径。
 */

export type CaseStageKey =
  | "stage1_screening"   // 1. 竞品初筛 (仅存在于未立项研报)
  | "stage2_sourcing"    // 2. 寻源询价 (已立项，尚无报价)
  | "stage3_financial"   // 3. 财务核准 (待评审，或有多家报价待定标)
  | "stage4_content"     // 4. 内容打磨 (已定标，Listing 未通过终审)
  | "stage5_channels";   // 5. 渠道就绪 (内容终审通过，可导出 Flat File 批量发布)

export type CaseStageDetail = {
  key: CaseStageKey;
  stepNumber: number;
  name: string;
  subName: string;
  badge: {
    label: string;
    className: string;
  };
  nextAction: {
    label: string;
    href: string;
  };
  // 供 Stepper 显示各步骤是否完成（客观事实）
  stepProgress: {
    financialReview: boolean; // 财务基准模型已建
    sourcingQuotes: boolean;  // 寻源询价完成（报价数 > 0）
    supplierAwarded: boolean; // 财务定标完成（已选择中标工厂）
    contentApproved: boolean; // 内容打磨完成（通过 content_approved 终审）
    channelReady: boolean;    // 渠道就绪（已生成渠道版本并通过本地映射）
  };
};

export type CaseStageInput = {
  caseId: string;
  status: string; // "review_pending" | "approved" | "archived" | "rejected"
  hasCostModel?: boolean;
  quoteCount?: number;
  hasSelection?: boolean;
  hasSupplierSelection?: boolean;
  hasApprovedContent?: boolean;
  hasChannelTargets?: boolean;
};

export function deriveCaseStage(input: CaseStageInput): CaseStageDetail {
  const {
    caseId,
    status,
    hasCostModel,
    quoteCount = 0,
    hasSelection = false,
    hasSupplierSelection = false,
    hasApprovedContent = false,
    hasChannelTargets = false,
  } = input;

  const isSelected = Boolean(hasSelection || hasSupplierSelection);
  const hasCost = hasCostModel !== undefined ? hasCostModel : (status === "approved" || status === "review_pending");

  const stepProgress = {
    financialReview: hasCost,
    sourcingQuotes: quoteCount > 0,
    supplierAwarded: isSelected,
    contentApproved: Boolean(hasApprovedContent),
    channelReady: Boolean(hasApprovedContent && hasChannelTargets),
  };

  // 1. 待立项审核的初始案卷（由竞品初筛转入，未通过人工立项门禁）
  if (status === "review_pending") {
    return {
      key: "stage3_financial",
      stepNumber: 3,
      name: "财务核准",
      subName: "待立项评审",
      badge: { label: "待立项评审", className: "status-review_pending" },
      nextAction: { label: "评审立项", href: `/cases/${caseId}` },
      stepProgress,
    };
  }

  // 2. 已立项，但尚无任何 1688/源头工厂报价
  if (status === "approved" && quoteCount === 0) {
    return {
      key: "stage2_sourcing",
      stepNumber: 2,
      name: "寻源询价",
      subName: "待录入报价",
      badge: { label: "待录入报价", className: "badge-neutral" },
      nextAction: { label: "录入报价", href: `/cases/${caseId}/sourcing` },
      stepProgress,
    };
  }

  // 3. 已有多家报价，等待人工对比定标与成本核准
  if (status === "approved" && quoteCount > 0 && !isSelected) {
    return {
      key: "stage3_financial",
      stepNumber: 3,
      name: "财务核准",
      subName: "待对比定标",
      badge: { label: "待对比定标", className: "status-review_pending" },
      nextAction: { label: "对比定标", href: `/cases/${caseId}/sourcing` },
      stepProgress,
    };
  }

  // 4. 已定标供应商，但 Listing 尚未通过人工终审
  if (status === "approved" && isSelected && !hasApprovedContent) {
    return {
      key: "stage4_content",
      stepNumber: 4,
      name: "内容打磨",
      subName: "制作与终审",
      badge: { label: "待制作内容", className: "badge-success" },
      nextAction: { label: "制作内容", href: `/cases/${caseId}/content` },
      stepProgress,
    };
  }

  // 5. 渠道就绪：已定标且真实通过人工内容终审，可导出 Flat File 批量发布
  if (status === "approved" && isSelected && hasApprovedContent) {
    return {
      key: "stage5_channels",
      stepNumber: 5,
      name: "渠道就绪",
      subName: "Flat File 导出",
      badge: { label: "渠道就绪", className: "badge-success" },
      nextAction: { label: "导出 Flat File", href: `/cases/${caseId}/channels` },
      stepProgress,
    };
  }

  // 降级与终止状态处理
  return {
    key: "stage3_financial",
    stepNumber: 3,
    name: status === "archived" ? "已终止" : "已否决",
    subName: "流程中止",
    badge: { label: status === "archived" ? "已终止" : "已否决", className: "badge-neutral" },
    nextAction: { label: "查看案卷", href: `/cases/${caseId}` },
    stepProgress,
  };
}
