import test from "node:test";
import assert from "node:assert/strict";
import {
  findCurrentVersionValidation,
  getValidationEvidenceState,
  resolvePlatformCapabilities,
  resolveValidationAdapterConfiguration,
} from "./platform-capabilities.ts";
import type { ChannelLaunchValidationRow } from "./types.ts";

const verifiedAmazon = {
  status: "verified" as const,
  verification_level: "seller_read" as const,
  message: "Amazon 自有店铺授权已验证。",
};

const baseInput = {
  platformCode: "amazon",
  account: { status: "connected" as const, is_demo: false },
  latestConnectorCheck: verifiedAmazon,
  currentVersionId: "version-2",
  validation: null,
  adapterConfigured: true,
  adapterConfigurationDetail: "配置完整",
  now: new Date("2026-11-04T05:00:00.000Z"),
};

function validation(overrides: Partial<ChannelLaunchValidationRow> = {}): ChannelLaunchValidationRow {
  return {
    id: "validation-1",
    channel_listing_id: "listing-1",
    channel_version_id: "version-2",
    channel_account_id: "account-1",
    platform_code: "amazon",
    market_code: "US",
    operation: "validation_preview",
    status: "passed",
    platform_request_id: "request-1",
    platform_submission_id: "submission-1",
    response_summary: {},
    error_summary: {},
    executed_by: "运营人员",
    executed_at: "2026-11-04T04:00:00.000Z",
    expires_at: "2026-11-05T04:00:00.000Z",
    external_actions: "validation_only",
    published: false,
    ...overrides,
  };
}

test("a demo account never receives account-level platform capabilities", () => {
  const result = resolvePlatformCapabilities({
    ...baseInput,
    account: { status: "connected", is_demo: true },
  });
  assert.equal(result.accountEligible, false);
  assert.equal(result.readOnly.state, "blocked");
  assert.equal(result.validationPreview.state, "blocked");
  assert.equal(result.draftWrite.state, "unsupported");
  assert.equal(result.livePublish.state, "unsupported");
});

test("validation preview becomes runnable only with seller authorization and adapter configuration", () => {
  const result = resolvePlatformCapabilities(baseInput);
  assert.equal(result.readOnly.state, "available");
  assert.equal(result.validationPreview.state, "available");
  assert.equal(result.validationPreview.currentVersionVerified, false);

  const missingConfig = resolvePlatformCapabilities({
    ...baseInput,
    adapterConfigured: false,
    adapterConfigurationDetail: "缺少 AMAZON_SP_API_SELLER_ID",
  });
  assert.equal(missingConfig.validationPreview.state, "blocked");
  assert.match(missingConfig.validationPreview.detail, /SELLER_ID/);
});

test("application-only eBay credentials do not count as a seller read connection", () => {
  const result = resolvePlatformCapabilities({
    ...baseInput,
    platformCode: "ebay",
    latestConnectorCheck: {
      status: "credentials_valid",
      verification_level: "application_credentials",
      message: "应用凭证通过",
    },
  });
  assert.equal(result.accountEligible, false);
  assert.equal(result.readOnly.state, "unsupported");
  assert.equal(result.validationPreview.state, "unsupported");
});

test("expired or old-version validation receipts cannot verify the current version", () => {
  const passed = resolvePlatformCapabilities({ ...baseInput, validation: validation() });
  assert.equal(passed.validationPreview.currentVersionVerified, true);

  const expired = resolvePlatformCapabilities({
    ...baseInput,
    validation: validation({ expires_at: "2026-11-04T04:30:00.000Z" }),
  });
  assert.equal(expired.validationPreview.evidenceState, "expired");
  assert.equal(expired.validationPreview.currentVersionVerified, false);

  const oldVersion = resolvePlatformCapabilities({
    ...baseInput,
    validation: validation({ channel_version_id: "version-1" }),
  });
  assert.equal(oldVersion.validationPreview.evidenceState, "missing");
  assert.equal(oldVersion.validationPreview.currentVersionVerified, false);
});

test("the latest validation attempt for the current version is selected", () => {
  const older = validation({ id: "older", executed_at: "2026-11-04T03:00:00.000Z" });
  const newer = validation({ id: "newer", status: "failed", executed_at: "2026-11-04T04:30:00.000Z" });
  const selected = findCurrentVersionValidation([older, newer], "version-2");
  assert.equal(selected?.id, "newer");
  assert.equal(getValidationEvidenceState(selected, "version-2", baseInput.now), "failed");
});


test("validation adapter configuration exposes missing variable names only", () => {
  const result = resolveValidationAdapterConfiguration("amazon", {
    AMAZON_SP_API_CLIENT_ID: "client-secret-value",
    AMAZON_SP_API_CLIENT_SECRET: "client-secret",
    AMAZON_SP_API_REFRESH_TOKEN: "refresh-secret",
    AMAZON_SP_API_REGION: "na",
  });
  assert.equal(result.configured, false);
  assert.match(result.detail, /AMAZON_SP_API_SELLER_ID/);
  assert.doesNotMatch(result.detail, /client-secret-value|refresh-secret/);
});

test("validation adapter configuration never echoes configured secrets", () => {
  const result = resolveValidationAdapterConfiguration("amazon", {
    AMAZON_SP_API_CLIENT_ID: "client-id-value",
    AMAZON_SP_API_CLIENT_SECRET: "client-secret-value",
    AMAZON_SP_API_REFRESH_TOKEN: "refresh-token-value",
    AMAZON_SP_API_SELLER_ID: "seller-id-value",
    AMAZON_SP_API_REGION: "na",
  });
  assert.equal(result.configured, true);
  assert.doesNotMatch(result.detail, /client-id-value|client-secret-value|refresh-token-value|seller-id-value/);
});

test("platforms without a validation adapter stay explicitly unsupported", () => {
  const result = resolveValidationAdapterConfiguration("ebay", {
    EBAY_CLIENT_ID: "value",
  });
  assert.equal(result.configured, false);
  assert.match(result.detail, /没有已实现的 Validation Preview Adapter/);
});
