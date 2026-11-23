import test from "node:test";
import assert from "node:assert/strict";
import { deriveCaseWorkflowSnapshot, isContentApprovedStatus } from "./case-stage.ts";

test("无成本模型时停留在阶段 1 并引导完成选品与利润", () => {
  const snap = deriveCaseWorkflowSnapshot({
    caseId: "case-1",
    status: "review_pending",
    hasCostModel: false,
  });
  assert.equal(snap.key, "stage1_screening");
  assert.equal(snap.primaryAction.label, "完成选品与利润");
  assert.equal(snap.permissions.canRecordQuote, false);
});

test("NO-GO 未例外审批时阻断普通报价与定标", () => {
  const snap = deriveCaseWorkflowSnapshot({
    caseId: "case-nogo",
    status: "review_pending",
    recommendation: "NO-GO",
    hasNoGoException: false,
    hasCostModel: true,
    quoteCount: 0,
  });
  assert.equal(snap.tradeGate, "NO-GO");
  assert.equal(snap.key, "stage1_screening");
  assert.equal(snap.primaryAction.label, "查看原因 / 申请例外");
  assert.equal(snap.permissions.canRecordQuote, false);
  assert.equal(snap.permissions.canSelectSupplier, false);
});

test("NO-GO 例外审批通过后放行寻源并保留例外标识", () => {
  const snap = deriveCaseWorkflowSnapshot({
    caseId: "case-nogo-ex",
    status: "review_pending",
    recommendation: "NO-GO",
    hasNoGoException: true,
    hasCostModel: true,
    quoteCount: 0,
  });
  assert.equal(snap.tradeGate, "NO-GO_EXCEPTION");
  assert.equal(snap.tradeGateLabel, "NO-GO 例外通过");
  assert.equal(snap.key, "stage2_sourcing");
  assert.equal(snap.primaryAction.label, "录入第一家工厂报价");
  assert.equal(snap.permissions.canRecordQuote, true);
});

test("有报价但未定标时进入阶段 3（人工定标），不再显示待录入报价", () => {
  const snap = deriveCaseWorkflowSnapshot({
    caseId: "case-quoted",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 2,
    hasSupplierSelection: false,
  });
  assert.equal(snap.key, "stage3_financial");
  assert.equal(snap.stepProgress.sourcingQuotes, true);
  assert.equal(snap.stepProgress.supplierAwarded, false);
  assert.equal(snap.primaryAction.label, "对比并定标");
  assert.match(snap.subName, /2 份报价/);
});

test("已定标但未终审时按主图情况给出唯一下一步", () => {
  const missingImg = deriveCaseWorkflowSnapshot({
    caseId: "case-img",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 2,
    hasSupplierSelection: true,
    approvedMainImageCount: 0,
    hasApprovedContent: false,
  });
  assert.equal(missingImg.key, "stage4_content");
  assert.equal(missingImg.primaryAction.label, "去视觉工坊");
  assert.equal(missingImg.permissions.canExportDeliveryPack, false);

  const readyToReview = deriveCaseWorkflowSnapshot({
    caseId: "case-review",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 2,
    hasSupplierSelection: true,
    approvedMainImageCount: 1,
    hasApprovedContent: false,
  });
  assert.equal(readyToReview.key, "stage4_content");
  assert.equal(readyToReview.primaryAction.label, "前往人工终审");
  assert.equal(readyToReview.permissions.canExportDeliveryPack, false);
});

test("内容终审同时兼容 content_approved 与 published，第五阶段按两项交付完整度推进且不显示已发布", () => {
  assert.equal(isContentApprovedStatus("content_approved"), true);
  assert.equal(isContentApprovedStatus("published"), true);
  assert.equal(isContentApprovedStatus("draft"), false);

  const step5a = deriveCaseWorkflowSnapshot({
    caseId: "case-5a",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 3,
    hasSupplierSelection: true,
    listingStatus: "published",
    hasFlatFileExported: false,
    hasMediaPackExported: false,
  });
  assert.equal(step5a.key, "stage5_channels");
  assert.equal(step5a.deliveryState, "content_approved");
  assert.equal(step5a.primaryAction.label, "导出 Flat File");
  assert.equal(step5a.permissions.canExportDeliveryPack, true);

  const step5b = deriveCaseWorkflowSnapshot({
    caseId: "case-5b",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 3,
    hasSupplierSelection: true,
    hasApprovedContent: true,
    hasFlatFileExported: true,
    hasMediaPackExported: false,
  });
  assert.equal(step5b.deliveryState, "flatfile_exported");
  assert.equal(step5b.deliveryLabel, "已导出 Flat File，待导出素材包");
  assert.equal(step5b.primaryAction.label, "导出素材包");

  const step5c = deriveCaseWorkflowSnapshot({
    caseId: "case-5c",
    status: "approved",
    recommendation: "GO",
    hasCostModel: true,
    quoteCount: 3,
    hasSupplierSelection: true,
    hasApprovedContent: true,
    hasFlatFileExported: true,
    hasMediaPackExported: true,
  });
  assert.equal(step5c.deliveryState, "complete");
  assert.equal(step5c.deliveryLabel, "交付资料已齐");
  assert.equal(step5c.subName, "交付资料已齐");
  assert.equal(step5c.deliveryLabel.includes("已发布"), false);
});
