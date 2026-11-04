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
  writeAdapterAvailable: true,
  dryRunSupported: true,
  approvedLaunchReview: null,
};

test("launch readiness blocks a target without a saved version", () => {
  const result = evaluateLaunchReadiness({ ...readyInput, latestVersion: null });
  assert.equal(result.status, "blocked");
  assert.equal(result.canApproveForLaunchQueue, false);
  assert.ok(result.blockers.some((blocker) => blocker.code === "LATEST_VERSION"));
});

test("launch readiness does not treat local preflight as platform dry-run", () => {
  const result = evaluateLaunchReadiness({ ...readyInput, dryRunSupported: false });
  assert.equal(result.status, "dry_run_unsupported");
  assert.ok(result.checks.some((check) => check.code === "PLATFORM_DRY_RUN" && check.state === "unsupported"));
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
