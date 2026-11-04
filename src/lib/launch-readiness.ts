export type LaunchReadinessStatus =
  | "blocked"
  | "local_ready"
  | "dry_run_unsupported"
  | "approval_pending"
  | "approved_for_publish";

export type LaunchCheckState = "pass" | "fail" | "pending" | "unsupported";

export type LaunchReadinessCheck = {
  code:
    | "LATEST_VERSION"
    | "LOCAL_PREFLIGHT"
    | "CONTENT_APPROVED"
    | "MAIN_IMAGE_APPROVED"
    | "PRODUCTION_ACCOUNT"
    | "WRITE_ADAPTER"
    | "PLATFORM_DRY_RUN"
    | "VERSION_LAUNCH_APPROVAL";
  label: string;
  state: LaunchCheckState;
  detail: string;
  scope: "local" | "connector" | "approval";
};

export type LaunchReadinessBlocker = {
  code: LaunchReadinessCheck["code"];
  label: string;
  detail: string;
  state: Exclude<LaunchCheckState, "pass">;
};

export type LaunchReadinessInput = {
  latestVersion: {
    id: string;
    version: number;
    status: string;
    preflightPassed: boolean;
  } | null;
  approvedMainImageCount: number;
  account: {
    status: string;
    isDemo: boolean;
  };
  writeAdapterAvailable: boolean;
  dryRunSupported: boolean;
  approvedLaunchReview: {
    channelVersionId: string;
    decision: string;
  } | null;
};

export type LaunchReadinessResult = {
  status: LaunchReadinessStatus;
  label: string;
  description: string;
  checks: LaunchReadinessCheck[];
  blockers: LaunchReadinessBlocker[];
  canApproveForLaunchQueue: boolean;
  externalActions: "none";
  published: false;
};

const statusCopy: Record<LaunchReadinessStatus, { label: string; description: string }> = {
  blocked: {
    label: "本地门禁未完成",
    description: "最新版本、预检、内容批准或主图审核仍有缺口，不能进入发布队列。",
  },
  local_ready: {
    label: "本地内容已就绪",
    description: "本地内容门禁已完成；正式店铺或外部发布能力仍未满足。",
  },
  dry_run_unsupported: {
    label: "平台 dry-run 不支持",
    description: "本地和店铺条件已满足，但官方写 Adapter 或真实平台 dry-run 尚未接入。",
  },
  approval_pending: {
    label: "等待发布队列审批",
    description: "全部前置检查通过，等待人工批准进入内部发布队列；审批仍不代表平台发布。",
  },
  approved_for_publish: {
    label: "已批准进入发布队列",
    description: "当前版本已人工批准进入内部发布队列；尚未向平台发布。",
  },
};

export function evaluateLaunchReadiness(input: LaunchReadinessInput): LaunchReadinessResult {
  const { latestVersion } = input;
  const localPreflightPassed = Boolean(latestVersion?.preflightPassed);
  const contentApproved = latestVersion?.status === "content_approved";
  const mainImageApproved = input.approvedMainImageCount > 0;
  const productionAccountReady = input.account.status === "connected" && !input.account.isDemo;
  const currentVersionApproved = Boolean(
    latestVersion &&
      input.approvedLaunchReview?.decision === "approved" &&
      input.approvedLaunchReview.channelVersionId === latestVersion.id,
  );

  const checks: LaunchReadinessCheck[] = [
    {
      code: "LATEST_VERSION",
      label: "最新本地版本",
      state: latestVersion ? "pass" : "fail",
      detail: latestVersion ? `当前 v${latestVersion.version}` : "尚未保存渠道 Listing 版本",
      scope: "local",
    },
    {
      code: "LOCAL_PREFLIGHT",
      label: "确定性本地预检",
      state: localPreflightPassed ? "pass" : "fail",
      detail: latestVersion
        ? localPreflightPassed
          ? "最新版本预检无错误"
          : "最新版本预检未通过"
        : "保存版本后才能预检",
      scope: "local",
    },
    {
      code: "CONTENT_APPROVED",
      label: "人工内容批准",
      state: contentApproved ? "pass" : "fail",
      detail: contentApproved ? "最新版本已通过人工内容门禁" : "最新版本尚未通过人工内容门禁",
      scope: "local",
    },
    {
      code: "MAIN_IMAGE_APPROVED",
      label: "主图人工审核",
      state: mainImageApproved ? "pass" : "fail",
      detail: mainImageApproved ? `${input.approvedMainImageCount} 张主图已通过人工检查` : "没有已通过人工检查的主图",
      scope: "local",
    },
    {
      code: "PRODUCTION_ACCOUNT",
      label: "正式平台店铺",
      state: productionAccountReady ? "pass" : "fail",
      detail: productionAccountReady
        ? "店铺已连接且不是演示店铺"
        : input.account.isDemo
          ? `当前为演示店铺，状态 ${input.account.status}`
          : `店铺状态 ${input.account.status}，尚未连接正式店铺`,
      scope: "connector",
    },
    {
      code: "WRITE_ADAPTER",
      label: "官方写 Adapter",
      state: input.writeAdapterAvailable ? "pass" : "unsupported",
      detail: input.writeAdapterAvailable ? "官方写 Adapter 已实现" : "没有官方写 Adapter，外部写入保持关闭",
      scope: "connector",
    },
    {
      code: "PLATFORM_DRY_RUN",
      label: "真实平台 dry-run",
      state: input.dryRunSupported ? "pass" : "unsupported",
      detail: input.dryRunSupported ? "平台 dry-run 能力可用" : "真实平台 dry-run 未实现，不能用本地预检代替",
      scope: "connector",
    },
    {
      code: "VERSION_LAUNCH_APPROVAL",
      label: "当前版本发布队列审批",
      state: currentVersionApproved ? "pass" : "pending",
      detail: currentVersionApproved ? "当前版本已人工批准进入发布队列，仍未发布" : "当前版本尚无发布队列人工批准",
      scope: "approval",
    },
  ];

  const localContentReady =
    Boolean(latestVersion) && localPreflightPassed && contentApproved && mainImageApproved;

  let status: LaunchReadinessStatus;
  if (!localContentReady) {
    status = "blocked";
  } else if (!productionAccountReady) {
    status = "local_ready";
  } else if (!input.writeAdapterAvailable || !input.dryRunSupported) {
    status = "dry_run_unsupported";
  } else if (!currentVersionApproved) {
    status = "approval_pending";
  } else {
    status = "approved_for_publish";
  }

  const blockers = checks
    .filter((check): check is LaunchReadinessCheck & { state: Exclude<LaunchCheckState, "pass"> } => check.state !== "pass")
    .map((check) => ({
      code: check.code,
      label: check.label,
      detail: check.detail,
      state: check.state,
    }));

  return {
    status,
    ...statusCopy[status],
    checks,
    blockers,
    canApproveForLaunchQueue: status === "approval_pending",
    externalActions: "none",
    published: false,
  };
}
