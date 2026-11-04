import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLaunchReadiness, type LaunchReadinessInput } from "./launch-readiness.ts";

const readyInput: LaunchReadinessInput = {
  latestVersion: {
    id: "version-2",
    version: 2,
    status: "content_approved",
    preflightPassed: true,
  },
  approvedMainImageCount: 1,
  account: { status: "connected", isDemo: false },
  writeAdapter: { implemented: true },
  validationPreview: {
    adapterImplemented: true,
    status: "passed",
    currentVersionBound: true,
    expired: false,
    requestId: "request-1",
    submissionId: "submission-1",
    executedAt: "2026-11-04T04:00:00.000Z",
  },
  approvedLaunchReview: null,
};

test("launch readiness blocks a target without a saved version", () => {
  const result = evaluateLaunchReadiness({ ...readyInput, latestVersion: null });
  assert.equal(result.status, "blocked");
  assert.equal(result.canApproveForLaunchQueue, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "LATEST_VERSION"));
});

test("launch readiness does not treat local preflight as platform validation", () => {
  const result = evaluateLaunchReadiness({
    ...readyInput,
    validationPreview: {
      ...readyInput.validationPreview,
      status: null,
      currentVersionBound: false,
      requestId: null,
      submissionId: null,
      executedAt: null,
    },
  });
  assert.equal(result.status, "dry_run_unsupported");
  assert.ok(result.checks.some((check) => check.code === "PLATFORM_DRY_RUN" && check.state === "pending"));
  assert.equal(result.canApproveForLaunchQueue, false);
});

test("expired, failed or old-version validation evidence cannot unlock the launch queue", () => {
  const expired = evaluateLaunchReadiness({
    ...readyInput,
    validationPreview: { ...readyInput.validationPreview, expired: true },
  });
  assert.equal(expired.status, "dry_run_unsupported");
  assert.ok(expired.checks.some((check) => check.code === "PLATFORM_DRY_RUN" && check.state === "fail"));
  assert.match(expired.blockers.find((blocker) => blocker.code === "PLATFORM_DRY_RUN")?.detail ?? "", /过期/);

  const failed = evaluateLaunchReadiness({
    ...readyInput,
    validationPreview: { ...readyInput.validationPreview, status: "failed" },
  });
  assert.equal(failed.status, "dry_run_unsupported");
  assert.ok(failed.checks.some((check) => check.code === "PLATFORM_DRY_RUN" && check.state === "fail"));

  const oldVersion = evaluateLaunchReadiness({
    ...readyInput,
    validationPreview: { ...readyInput.validationPreview, currentVersionBound: false },
  });
  assert.equal(oldVersion.status, "dry_run_unsupported");
  assert.ok(oldVersion.checks.some((check) => check.code === "PLATFORM_DRY_RUN" && check.state === "pending"));
  assert.match(oldVersion.blockers.find((blocker) => blocker.code === "PLATFORM_DRY_RUN")?.detail ?? "", /尚无/);
});

test("a validation receipt still cannot bypass the missing official write adapter", () => {
  const result = evaluateLaunchReadiness({ ...readyInput, writeAdapter: { implemented: false } });
  assert.equal(result.status, "dry_run_unsupported");
  assert.ok(result.checks.some((check) => check.code === "WRITE_ADAPTER" && check.state === "unsupported"));
  assert.equal(result.canApproveForLaunchQueue, false);
});

test("an unconfigured or demo account stops at local_ready", () => {
  const unconfigured = evaluateLaunchReadiness({
    ...readyInput,
    account: { status: "unconfigured", isDemo: true },
  });
  assert.equal(unconfigured.status, "local_ready");

  const demoConnected = evaluateLaunchReadiness({
    ...readyInput,
    account: { status: "connected", isDemo: true },
  });
  assert.equal(demoConnected.status, "local_ready");
  assert.equal(demoConnected.canApproveForLaunchQueue, false);
});

test("launch approval is pending only after content, account, adapter and dry-run pass", () => {
  const result = evaluateLaunchReadiness(readyInput);
  assert.equal(result.status, "approval_pending");
  assert.equal(result.canApproveForLaunchQueue, true);
  assert.equal(result.published, false);
  assert.equal(result.externalActions, "none");
});

test("a launch approval from an older version cannot be reused", () => {
  const result = evaluateLaunchReadiness({
    ...readyInput,
    approvedLaunchReview: { channelVersionId: "version-1", decision: "approved" },
  });
  assert.equal(result.status, "approval_pending");
  assert.equal(result.canApproveForLaunchQueue, true);
});

test("a matching approval records a release-queue state, never published", () => {
  const result = evaluateLaunchReadiness({
    ...readyInput,
    approvedLaunchReview: { channelVersionId: "version-2", decision: "approved" },
  });
  assert.equal(result.status, "approved_for_publish");
  assert.match(result.label, /发布队列/);
  assert.equal(result.published, false);
  assert.equal(result.externalActions, "none");
});

test("missing content approval, image or preflight blocks local readiness", () => {
  const noImage = evaluateLaunchReadiness({ ...readyInput, approvedMainImageCount: 0 });
  assert.equal(noImage.status, "blocked");

  const preflightFailed = evaluateLaunchReadiness({
    ...readyInput,
    latestVersion: { ...readyInput.latestVersion!, preflightPassed: false },
  });
  assert.equal(preflightFailed.status, "blocked");

  const contentDraft = evaluateLaunchReadiness({
    ...readyInput,
    latestVersion: { ...readyInput.latestVersion!, status: "draft" },
  });
  assert.equal(contentDraft.status, "blocked");
});
