/**
 * 单一工作流真源：全系统唯一确定商品案卷的“三层状态 + 真实阶段 + 唯一下一步”。
 * 详情页、供应商页、内容页、战报页、首页看板、案卷列表、顶部对象条与步骤条必须全部消费此快照。
 */

export type CaseStageKey =
  | "stage1_screening"   // 1. 选品与利润（估算快筛 / 无成本模型 / NO-GO 拦截）
  | "stage2_sourcing"    // 2. 供应商报价与打样（待录入真实工厂报价）
  | "stage3_financial"   // 3. 人工定标（已有真实报价，等待对比定标）
  | "stage4_content"     // 4. 文案与视觉（已定标，待生图或待人工终审）
  | "stage5_channels";   // 5. 上架交付（内容已终审，按交付完整度追踪导出）

/** 维度 1：案卷工作区状态 */
export type CaseLifecycleState =
  | "candidate"            // 候选
  | "pending_verification" // 待验证
  | "active"               // 正式推进
  | "archived";            // 已归档

/** 维度 2：贸易门禁结论 */
export type TradeGateVerdict =
  | "GO"
  | "HOLD"
  | "NO-GO"
  | "NO-GO_EXCEPTION";

/** 维度 3：上架交付状态（绝不声称平台已发布） */
export type DeliveryReadinessState =
  | "not_ready"            // 未就绪（内容未终审）
  | "content_approved"     // 内容已终审，待导出交付包
  | "flatfile_exported"    // 已导出 Flat File，待导出素材包
  | "media_pack_exported"  // 已导出素材包，待导出 Flat File
  | "complete";            // 交付资料已齐

export type WorkflowActionKind = "link" | "download" | "none";

export type CaseWorkflowAction = {
  label: string;
  href: string;
  kind: WorkflowActionKind;
};

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
    financialReview: boolean; // 成本模型已建
    sourcingQuotes: boolean;  // 已有真实工厂报价（quoteCount > 0）
    supplierAwarded: boolean; // 已完成人工定标
    contentApproved: boolean; // 内容已通过人工终审（兼容 content_approved / published）
    channelReady: boolean;    // 交付资料已齐（Flat File 与素材包均已导出）
  };
};

export type CaseWorkflowSnapshot = CaseStageDetail & {
  caseLifecycle: CaseLifecycleState;
  caseLifecycleLabel: string;
  tradeGate: TradeGateVerdict;
  tradeGateLabel: string;
  deliveryState: DeliveryReadinessState;
  deliveryLabel: string;
  blocker: string | null;
  primaryAction: CaseWorkflowAction;
  facts: {
    hasCostModel: boolean;
    quoteCount: number;
    validQuoteCount: number;
    hasSupplierSelection: boolean;
    approvedMainImageCount: number;
    hasApprovedContent: boolean;
    hasFlatFileExported: boolean;
    hasMediaPackExported: boolean;
    hasNoGoException: boolean;
  };
  permissions: {
    canRecordQuote: boolean;
    canSelectSupplier: boolean;
    canEditContent: boolean;
    canExportDeliveryPack: boolean;
  };
};

export type CaseStageInput = {
  caseId: string;
  status: string; // "draft" | "researching" | "review_pending" | "approved" | "archived" | "rejected"
  recommendation?: "GO" | "HOLD" | "NO-GO" | null;
  hasNoGoException?: boolean;
  hasCostModel?: boolean;
  quoteCount?: number;
  validQuoteCount?: number;
  hasSelection?: boolean;
  hasSupplierSelection?: boolean;
  approvedMainImageCount?: number;
  hasApprovedContent?: boolean;
  listingStatus?: string | null;
  hasFlatFileExported?: boolean;
  hasMediaPackExported?: boolean;
  /** @deprecated 请改用 hasFlatFileExported / hasMediaPackExported */
  hasChannelTargets?: boolean;
};

export type CaseActionQueueStage = "stage1" | "stage2" | "stage3" | "stage4" | "stage5";

export type CaseActionQueueSource = CaseStageInput & {
  title: string;
  asin?: string | null;
  category?: string | null;
};

export type CaseActionQueueItem = {
  caseId: string;
  title: string;
  asin: string | null;
  category: string | null;
  stage: CaseActionQueueStage;
  stageNumber: number;
  stageName: string;
  stageSubName: string;
  blocker: string | null;
  actionLabel: string;
  shortAction: string;
  href: string;
  actionKind: WorkflowActionKind;
  tradeGate: TradeGateVerdict;
  deliveryState: DeliveryReadinessState;
  priority: number;
};

export type CaseActionQueueTask = {
  stage: CaseActionQueueStage;
  label: string;
  value: number;
  detail: string;
  href: string;
  action: string;
};

const ACTION_QUEUE_STAGE_META: Record<
  CaseActionQueueStage,
  { label: string; shortAction: string; priority: number }
> = {
  stage1: { label: "待补选品与门禁", shortAction: "处理门禁", priority: 1 },
  stage2: { label: "待录入工厂报价", shortAction: "录入报价", priority: 2 },
  stage3: { label: "待对比定标", shortAction: "对比定标", priority: 3 },
  stage4: { label: "待完成内容与视觉", shortAction: "制作内容", priority: 4 },
  stage5: { label: "待导出交付资料", shortAction: "导出交付", priority: 5 },
};

function actionQueueStageFor(stage: CaseStageKey): CaseActionQueueStage {
  switch (stage) {
    case "stage2_sourcing":
      return "stage2";
    case "stage3_financial":
      return "stage3";
    case "stage4_content":
      return "stage4";
    case "stage5_channels":
      return "stage5";
    case "stage1_screening":
    default:
      return "stage1";
  }
}

/** 将案卷对象统一转换为工作流快照输入，避免各页面自行拼字段后漂移。 */
export function caseStageInputFromCase(caseItem: {
  id: string;
  status: string;
  recommendation?: "GO" | "HOLD" | "NO-GO" | null;
  hasNoGoException?: boolean;
  costModel?: unknown;
  hasCostModel?: boolean;
  quoteCount?: number;
  validQuoteCount?: number;
  hasSupplierSelection?: boolean;
  approvedMainImageCount?: number;
  hasApprovedContent?: boolean;
  hasFlatFileExported?: boolean;
  hasMediaPackExported?: boolean;
}): CaseStageInput {
  return {
    caseId: caseItem.id,
    status: caseItem.status,
    recommendation: caseItem.recommendation,
    hasNoGoException: Boolean(caseItem.hasNoGoException),
    hasCostModel: caseItem.hasCostModel ?? Boolean(caseItem.costModel),
    quoteCount: caseItem.quoteCount ?? 0,
    validQuoteCount: caseItem.validQuoteCount,
    hasSupplierSelection: Boolean(caseItem.hasSupplierSelection),
    approvedMainImageCount: caseItem.approvedMainImageCount,
    hasApprovedContent: Boolean(caseItem.hasApprovedContent),
    hasFlatFileExported: Boolean(caseItem.hasFlatFileExported),
    hasMediaPackExported: Boolean(caseItem.hasMediaPackExported),
  };
}

/** 单一待办队列：每个活跃案卷按快照只出现一次，完成交付或已归档后自动移出。 */
export function deriveCaseActionQueue(cases: CaseActionQueueSource[]): CaseActionQueueItem[] {
  const queue: CaseActionQueueItem[] = [];
  for (const caseItem of cases) {
    const snapshot = deriveCaseWorkflowSnapshot(caseItem);
    if (snapshot.caseLifecycle === "archived" || snapshot.deliveryState === "complete") continue;

    const stage = actionQueueStageFor(snapshot.key);
    const meta = ACTION_QUEUE_STAGE_META[stage];
    queue.push({
      caseId: caseItem.caseId,
      title: caseItem.title,
      asin: caseItem.asin ?? null,
      category: caseItem.category ?? null,
      stage,
      stageNumber: snapshot.stepNumber,
      stageName: snapshot.name,
      stageSubName: snapshot.subName,
      blocker: snapshot.blocker,
      actionLabel: snapshot.primaryAction.label,
      shortAction: meta.shortAction,
      href: snapshot.primaryAction.href,
      actionKind: snapshot.primaryAction.kind,
      tradeGate: snapshot.tradeGate,
      deliveryState: snapshot.deliveryState,
      priority: snapshot.tradeGate === "NO-GO" ? 0 : meta.priority,
    });
  }
  return queue.sort(
    (a, b) => a.priority - b.priority || a.stageNumber - b.stageNumber || a.title.localeCompare(b.title, "zh-CN"),
  );
}

/** 将队列收敛成看板/首页共用的阶段任务，计数与明细来自同一份队列。 */
export function groupCaseActionQueue(items: CaseActionQueueItem[]): CaseActionQueueTask[] {
  const stageOrder: CaseActionQueueStage[] = ["stage1", "stage2", "stage3", "stage4", "stage5"];
  return stageOrder.flatMap((stage) => {
    const stageItems = items.filter((item) => item.stage === stage);
    if (stageItems.length === 0) return [];
    const first = stageItems[0];
    const meta = ACTION_QUEUE_STAGE_META[stage];
    return [{
      stage,
      label: meta.label,
      value: stageItems.length,
      detail: stageItems.length > 1 ? `${first.title} 等 ${stageItems.length} 款` : first.title,
      href: first.href,
      action: meta.shortAction,
    }];
  });
}

/** 统一判断内容终审状态：同时兼容 content_approved 与历史 published */
export function isContentApprovedStatus(status: string | null | undefined): boolean {
  return status === "content_approved" || status === "published";
}

function resolveLifecycle(status: string): { state: CaseLifecycleState; label: string } {
  switch (status) {
    case "draft":
    case "researching":
      return { state: "candidate", label: "候选" };
    case "review_pending":
      return { state: "pending_verification", label: "待验证" };
    case "approved":
      return { state: "active", label: "正式推进" };
    case "archived":
    case "rejected":
    default:
      return { state: "archived", label: "已归档" };
  }
}

function resolveTradeGate(
  recommendation: "GO" | "HOLD" | "NO-GO" | null | undefined,
  hasNoGoException: boolean,
  lifecycle: CaseLifecycleState,
): { verdict: TradeGateVerdict; label: string } {
  if (recommendation === "NO-GO") {
    return hasNoGoException
      ? { verdict: "NO-GO_EXCEPTION", label: "NO-GO 例外通过" }
      : { verdict: "NO-GO", label: "NO-GO" };
  }
  if (recommendation === "GO") {
    return { verdict: "GO", label: "GO" };
  }
  if (recommendation === "HOLD") {
    return { verdict: "HOLD", label: "HOLD" };
  }
  // 未显式传入 recommendation 时按案卷状态保守降级
  return lifecycle === "active"
    ? { verdict: "GO", label: "GO" }
    : { verdict: "HOLD", label: "HOLD" };
}

function resolveDeliveryState(
  hasApprovedContent: boolean,
  hasFlatFileExported: boolean,
  hasMediaPackExported: boolean,
): { state: DeliveryReadinessState; label: string } {
  if (!hasApprovedContent) {
    return { state: "not_ready", label: "待终审" };
  }
  if (hasFlatFileExported && hasMediaPackExported) {
    return { state: "complete", label: "交付资料已齐" };
  }
  if (hasFlatFileExported) {
    return { state: "flatfile_exported", label: "已导出 Flat File，待导出素材包" };
  }
  if (hasMediaPackExported) {
    return { state: "media_pack_exported", label: "已导出素材包，待导出 Flat File" };
  }
  return { state: "content_approved", label: "待导出交付包" };
}

export function deriveCaseWorkflowSnapshot(input: CaseStageInput): CaseWorkflowSnapshot {
  const {
    caseId,
    status,
    recommendation,
    hasNoGoException = false,
    hasCostModel,
    quoteCount = 0,
    validQuoteCount,
    hasSelection = false,
    hasSupplierSelection = false,
    approvedMainImageCount,
    hasApprovedContent = false,
    listingStatus,
    hasFlatFileExported = false,
    hasMediaPackExported = false,
  } = input;

  const encodedId = encodeURIComponent(caseId);
  const lifecycle = resolveLifecycle(status);
  const isTerminated = lifecycle.state === "archived";
  const isSelected = Boolean(hasSelection || hasSupplierSelection);
  const effectiveValidQuoteCount = validQuoteCount ?? quoteCount;
  const contentApproved = Boolean(hasApprovedContent || isContentApprovedStatus(listingStatus));
  const hasCost = hasCostModel !== undefined ? hasCostModel : !isTerminated;
  const tradeGate = resolveTradeGate(recommendation, hasNoGoException, lifecycle.state);
  const delivery = resolveDeliveryState(contentApproved, hasFlatFileExported, hasMediaPackExported);

  const isNoGoBlocked = tradeGate.verdict === "NO-GO";
  const canRecordQuote = !isTerminated && hasCost && !isNoGoBlocked && !isSelected;
  const canSelectSupplier = !isTerminated && hasCost && !isNoGoBlocked && quoteCount > 0 && !isSelected;
  const canEditContent = !isTerminated && isSelected && !isNoGoBlocked;
  const canExportDeliveryPack = !isTerminated && isSelected && contentApproved;

  const stepProgress = {
    financialReview: hasCost && !isNoGoBlocked,
    sourcingQuotes: quoteCount > 0,
    supplierAwarded: isSelected,
    contentApproved,
    channelReady: delivery.state === "complete",
  };

  const facts = {
    hasCostModel: hasCost,
    quoteCount,
    validQuoteCount: effectiveValidQuoteCount,
    hasSupplierSelection: isSelected,
    approvedMainImageCount: approvedMainImageCount ?? (contentApproved ? 1 : 0),
    hasApprovedContent: contentApproved,
    hasFlatFileExported,
    hasMediaPackExported,
    hasNoGoException,
  };

  const permissions = {
    canRecordQuote,
    canSelectSupplier,
    canEditContent,
    canExportDeliveryPack,
  };

  const base = {
    caseLifecycle: lifecycle.state,
    caseLifecycleLabel: lifecycle.label,
    tradeGate: tradeGate.verdict,
    tradeGateLabel: tradeGate.label,
    deliveryState: delivery.state,
    deliveryLabel: delivery.label,
    stepProgress,
    facts,
    permissions,
  };

  // 0. 归档/终止状态
  if (isTerminated) {
    const primaryAction: CaseWorkflowAction = {
      label: "查看归档记录",
      href: `/cases/${encodedId}`,
      kind: "link",
    };
    return {
      ...base,
      key: "stage1_screening",
      stepNumber: 1,
      name: "已归档",
      subName: status === "rejected" ? "已否决" : "流程已终止",
      badge: { label: status === "rejected" ? "已否决" : "已归档", className: "badge-neutral" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: "当前案卷已归档，如需继续推进请先恢复。",
    };
  }

  // 1. 无成本模型
  if (!hasCost) {
    const primaryAction: CaseWorkflowAction = {
      label: "完成选品与利润",
      href: `/cases/${encodedId}?tab=economics#cost-assumptions`,
      kind: "link",
    };
    return {
      ...base,
      key: "stage1_screening",
      stepNumber: 1,
      name: "选品与利润",
      subName: "待建成本模型",
      badge: { label: "待建成本模型", className: "status-review_pending" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: "尚未建立单位经济成本模型，请先补充售价与成本假设。",
    };
  }

  // 2. NO-GO 且未通过例外审批 → 阻断普通寻源与定标
  if (isNoGoBlocked) {
    const primaryAction: CaseWorkflowAction = {
      label: "查看原因 / 申请例外",
      href: `/cases/${encodedId}?tab=sourcing#gate-exception`,
      kind: "link",
    };
    return {
      ...base,
      key: "stage1_screening",
      stepNumber: 1,
      name: "选品与利润",
      subName: "NO-GO 已拦截",
      badge: { label: "NO-GO 拦截", className: "recommendation-no-go" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: "基准或压力情景不盈利（NO-GO），普通报价与定标已停止；如需例外推进必须审批并留审计。",
    };
  }

  // 3. 尚未录入任何真实工厂报价
  if (quoteCount === 0 && !isSelected) {
    const primaryAction: CaseWorkflowAction = {
      label: "录入第一家工厂报价",
      href: `/cases/${encodedId}/sourcing?openQuote=1#quote-entry`,
      kind: "link",
    };
    return {
      ...base,
      key: "stage2_sourcing",
      stepNumber: 2,
      name: "供应商报价与打样",
      subName: lifecycle.state === "pending_verification" ? "待验证 · 录入报价" : "待录入报价",
      badge: { label: "待录入报价", className: "badge-neutral" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: "尚无真实工厂报价，当前仅基于估算到岸成本。",
    };
  }

  // 4. 已有真实报价，等待人工对比定标
  if (!isSelected) {
    const primaryAction: CaseWorkflowAction = {
      label: "对比并定标",
      href: `/cases/${encodedId}/sourcing#supplier-award`,
      kind: "link",
    };
    return {
      ...base,
      key: "stage3_financial",
      stepNumber: 3,
      name: "人工定标",
      subName: `已有 ${quoteCount} 份报价待定标`,
      badge: { label: "待人工定标", className: "status-review_pending" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: `已录入 ${quoteCount} 份工厂报价，尚未完成人工定标；定标后才解锁内容与视觉。`,
    };
  }

  // 5. 已定标，但内容尚未通过人工终审
  if (!contentApproved) {
    const needsVisuals = approvedMainImageCount !== undefined && approvedMainImageCount === 0;
    const primaryAction: CaseWorkflowAction = needsVisuals
      ? {
          label: "去视觉工坊",
          href: `/studio?tab=image&caseId=${encodedId}`,
          kind: "link",
        }
      : {
          label: "前往人工终审",
          href: `/cases/${encodedId}/content#human-content-review`,
          kind: "link",
        };
    return {
      ...base,
      key: "stage4_content",
      stepNumber: 4,
      name: "文案与视觉",
      subName: needsVisuals ? "待补主图素材" : "待人工终审",
      badge: { label: needsVisuals ? "待补主图" : "内容待终审", className: "status-review_pending" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: needsVisuals
        ? "缺少已审核主图素材，请先到视觉工坊生成或上传并审核主图。"
        : "Listing 尚未通过人工终审，暂不可导出正式交付包。",
    };
  }

  // 6. 内容已终审 → 进入上架交付（按两项交付资料完整度判定）
  if (!hasFlatFileExported) {
    const primaryAction: CaseWorkflowAction = {
      label: "导出 Flat File",
      href: `/api/cases/${encodedId}/flatfile`,
      kind: "download",
    };
    return {
      ...base,
      key: "stage5_channels",
      stepNumber: 5,
      name: "上架交付",
      subName: hasMediaPackExported ? "已导出素材包，待导出 Flat File" : "待导出交付包",
      badge: { label: hasMediaPackExported ? "待导出 Flat File" : "待导出交付包", className: "badge-success" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: hasMediaPackExported
        ? "素材包已导出，还差导出 Amazon Flat File (TSV)。"
        : "内容已终审，请导出 Flat File 与上架素材包。",
    };
  }

  if (!hasMediaPackExported) {
    const primaryAction: CaseWorkflowAction = {
      label: "导出素材包",
      href: `/api/cases/${encodedId}/media-pack`,
      kind: "download",
    };
    return {
      ...base,
      key: "stage5_channels",
      stepNumber: 5,
      name: "上架交付",
      subName: "已导出 Flat File，待导出素材包",
      badge: { label: "待导出素材包", className: "badge-success" },
      nextAction: { label: primaryAction.label, href: primaryAction.href },
      primaryAction,
      blocker: "Flat File 已导出，还差打包下载上架素材 ZIP。",
    };
  }

  // 两项都已导出 → 交付资料已齐（不声称平台已发布）
  const primaryAction: CaseWorkflowAction = {
    label: "查看交付资料",
    href: `/cases/${encodedId}/content#launch-ready`,
    kind: "link",
  };
  return {
    ...base,
    key: "stage5_channels",
    stepNumber: 5,
    name: "上架交付",
    subName: "交付资料已齐",
    badge: { label: "交付资料已齐", className: "badge-success" },
    nextAction: { label: primaryAction.label, href: primaryAction.href },
    primaryAction,
    blocker: null,
  };
}
