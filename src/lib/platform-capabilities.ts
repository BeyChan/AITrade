import type {
  ChannelAccountRow,
  ChannelLaunchValidationRow,
  ConnectorHealthCheckRow,
} from "./types.ts";

export type CapabilityState = "available" | "blocked" | "unsupported";

export type ValidationEvidenceState =
  | "missing"
  | "passed"
  | "failed"
  | "unsupported"
  | "expired";

export type PlatformCapabilityCheck = {
  code: "READ_ONLY" | "VALIDATION_PREVIEW" | "DRAFT_WRITE" | "LIVE_PUBLISH";
  label: string;
  state: CapabilityState;
  detail: string;
};

export type PlatformCapabilityResult = {
  platformCode: string;
  connectorCode: string | null;
  adapterCode: string | null;
  accountEligible: boolean;
  adapterConfigured: boolean;
  readOnly: PlatformCapabilityCheck;
  validationPreview: PlatformCapabilityCheck & {
    adapterSupported: boolean;
    evidenceState: ValidationEvidenceState;
    currentVersionVerified: boolean;
  };
  draftWrite: PlatformCapabilityCheck;
  livePublish: PlatformCapabilityCheck;
  checks: PlatformCapabilityCheck[];
};

type AdapterDefinition = {
  code: string;
  readOnlySupported: boolean;
  validationPreviewSupported: boolean;
  draftWriteSupported: boolean;
  livePublishSupported: boolean;
};

const validationAdapterEnv: Record<string, string[]> = {
  amazon: [
    "AMAZON_SP_API_CLIENT_ID",
    "AMAZON_SP_API_CLIENT_SECRET",
    "AMAZON_SP_API_REFRESH_TOKEN",
    "AMAZON_SP_API_SELLER_ID",
    "AMAZON_SP_API_REGION",
  ],
};

const adapterDefinitions: Record<string, AdapterDefinition> = {
  amazon: {
    code: "amazon_sp_api_listings_v2021",
    readOnlySupported: true,
    validationPreviewSupported: true,
    draftWriteSupported: false,
    livePublishSupported: false,
  },
  shopify: {
    code: "shopify_admin_graphql",
    readOnlySupported: true,
    validationPreviewSupported: false,
    draftWriteSupported: false,
    livePublishSupported: false,
  },
  ebay: {
    code: "ebay_sell_inventory",
    readOnlySupported: false,
    validationPreviewSupported: false,
    draftWriteSupported: false,
    livePublishSupported: false,
  },
  tiktok_shop: {
    code: "tiktok_shop_partner",
    readOnlySupported: false,
    validationPreviewSupported: false,
    draftWriteSupported: false,
    livePublishSupported: false,
  },
  alibaba_1688: {
    code: "alibaba_1688_open",
    readOnlySupported: false,
    validationPreviewSupported: false,
    draftWriteSupported: false,
    livePublishSupported: false,
  },
};

const connectorCodes: Record<string, string> = {
  amazon: "amazon_sp_api",
  shopify: "shopify",
  ebay: "ebay",
  tiktok_shop: "tiktok_shop",
  alibaba_1688: "alibaba_1688",
};

export function getConnectorCodeForPlatform(platformCode: string) {
  return connectorCodes[platformCode] ?? null;
}

export function resolveValidationAdapterConfiguration(
  platformCode: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const adapter = adapterDefinitions[platformCode] ?? null;
  if (!adapter?.validationPreviewSupported) {
    return {
      configured: false,
      detail: "该平台没有已实现的 Validation Preview Adapter。",
    };
  }

  const requiredEnv = validationAdapterEnv[platformCode] ?? [];
  const missing = requiredEnv.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    return {
      configured: false,
      detail: `Validation Preview 缺少配置：${missing.join("、")}。不会发起平台请求。`,
    };
  }

  return {
    configured: true,
    detail: "Validation Preview 配置已就绪；只会发送当前 Listing 版本做校验。",
  };
}

export function findCurrentVersionValidation(
  validations: ChannelLaunchValidationRow[],
  channelVersionId: string | null,
): ChannelLaunchValidationRow | null {
  if (!channelVersionId) return null;
  return (
    validations
      .filter((validation) => validation.channel_version_id === channelVersionId)
      .sort((left, right) => Date.parse(right.executed_at) - Date.parse(left.executed_at))[0] ?? null
  );
}

export function getValidationEvidenceState(
  validation: ChannelLaunchValidationRow | null,
  channelVersionId: string | null,
  now: Date = new Date(),
): ValidationEvidenceState {
  if (!validation || !channelVersionId || validation.channel_version_id !== channelVersionId) return "missing";
  if (validation.expires_at) {
    const expiresAt = Date.parse(validation.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return "expired";
  }
  return validation.status;
}

export function resolvePlatformCapabilities(input: {
  platformCode: string;
  account: Pick<ChannelAccountRow, "status" | "is_demo">;
  latestConnectorCheck: Pick<ConnectorHealthCheckRow, "status" | "verification_level" | "message"> | null;
  currentVersionId: string | null;
  validation: ChannelLaunchValidationRow | null;
  adapterConfigured: boolean;
  adapterConfigurationDetail: string;
  now?: Date;
}): PlatformCapabilityResult {
  const adapter = adapterDefinitions[input.platformCode] ?? null;
  const connectorCode = getConnectorCodeForPlatform(input.platformCode);
  const accountEligible = Boolean(
    input.account.status === "connected" &&
      !input.account.is_demo &&
      input.latestConnectorCheck?.status === "verified" &&
      input.latestConnectorCheck.verification_level === "seller_read",
  );
  const evidenceState = getValidationEvidenceState(input.validation, input.currentVersionId, input.now);
  const currentVersionVerified = evidenceState === "passed";

  const readOnly: PlatformCapabilityCheck = adapter?.readOnlySupported
    ? accountEligible
      ? {
          code: "READ_ONLY",
          label: "只读授权",
          state: "available",
          detail: "正式店铺只读授权已验证；不允许用该能力发布、改价或写库存。",
        }
      : {
          code: "READ_ONLY",
          label: "只读授权",
          state: "blocked",
          detail: !input.latestConnectorCheck
            ? "尚未运行平台只读连接检查。"
            : input.account.is_demo
              ? "当前是演示店铺，不能复用真实连接能力。"
              : input.account.status !== "connected"
                ? `店铺状态为 ${input.account.status}，尚未连接正式店铺。`
                : `最近连接检查未提供卖家级只读授权：${input.latestConnectorCheck.message}`,
        }
    : {
        code: "READ_ONLY",
        label: "只读授权",
        state: "unsupported",
        detail: "该平台尚未实现卖家级只读连接诊断。",
      };

  const validationState: CapabilityState = !adapter?.validationPreviewSupported
    ? "unsupported"
    : !accountEligible
      ? "blocked"
      : !input.adapterConfigured
        ? "blocked"
        : "available";
  const validationPreview = {
    code: "VALIDATION_PREVIEW" as const,
    label: "平台 Validation Preview",
    state: validationState,
    detail: !adapter?.validationPreviewSupported
      ? "该平台尚无已实现的 Validation Preview Adapter。"
      : !accountEligible
        ? "需要正式且只读授权已验证的店铺，才能执行平台校验。"
        : !input.adapterConfigured
          ? input.adapterConfigurationDetail
          : passwordFreeConfigurationDetail(input.adapterConfigurationDetail),
    adapterSupported: Boolean(adapter?.validationPreviewSupported),
    evidenceState,
    currentVersionVerified,
  };

  const draftWrite: PlatformCapabilityCheck = {
    code: "DRAFT_WRITE",
    label: "草稿写入",
    state: adapter?.draftWriteSupported ? "available" : "unsupported",
    detail: adapter?.draftWriteSupported ? "草稿写入 Adapter 已实现。" : "官方草稿写入 Adapter 未实现，外部写入保持关闭。",
  };
  const livePublish: PlatformCapabilityCheck = {
    code: "LIVE_PUBLISH",
    label: "正式发布",
    state: adapter?.livePublishSupported ? "available" : "unsupported",
    detail: adapter?.livePublishSupported ? "正式发布 Adapter 已实现。" : "正式发布、外部回执与下架权限未接入。",
  };

  return {
    platformCode: input.platformCode,
    connectorCode,
    adapterCode: adapter?.code ?? null,
    accountEligible,
    adapterConfigured: input.adapterConfigured,
    readOnly,
    validationPreview,
    draftWrite,
    livePublish,
    checks: [readOnly, validationPreview, draftWrite, livePublish],
  };
}

function passwordFreeConfigurationDetail(detail: string) {
  return detail || "Validation Preview 配置已就绪；仅发送当前 Listing 版本做校验。";
}
