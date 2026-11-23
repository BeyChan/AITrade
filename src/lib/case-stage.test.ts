import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveCaseActionQueue,
  deriveCaseWorkflowSnapshot,
  groupCaseActionQueue,
  isContentApprovedStatus,
} from "./case-stage.ts";

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

test("行动队列按唯一工作流阶段归类，NO-GO 优先且不会被算作待报价", () => {
  const queue = deriveCaseActionQueue([
    {
      caseId: "nogo",
      title: "被门禁拦截的宠物饮水机",
      status: "approved",
      recommendation: "NO-GO",
      hasCostModel: true,
      quoteCount: 0,
    },
    {
      caseId: "quote",
      title: "待录入报价的宠物梳",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 0,
    },
    {
      caseId: "award",
      title: "已有报价待定标的猫砂盆",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 2,
    },
    {
      caseId: "content",
      title: "已定标待终审的猫抓板",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 2,
      hasSupplierSelection: true,
      approvedMainImageCount: 1,
    },
  ]);

  assert.deepEqual(queue.map((item) => item.caseId), ["nogo", "quote", "award", "content"]);
  assert.equal(queue[0].stage, "stage1");
  assert.equal(queue[0].actionLabel, "查看原因 / 申请例外");
  assert.equal(queue[1].stage, "stage2");
  assert.equal(queue[2].stage, "stage3");
  assert.equal(queue[3].stage, "stage4");
  assert.equal(queue.some((item) => item.caseId === "nogo" && item.stage === "stage2"), false);
});

test("行动队列排除已归档与交付完成案卷，阶段任务计数和明细同源", () => {
  const queue = deriveCaseActionQueue([
    {
      caseId: "archived",
      title: "已归档案卷",
      status: "archived",
      recommendation: "GO",
      hasCostModel: true,
    },
    {
      caseId: "complete",
      title: "交付完成案卷",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 2,
      hasSupplierSelection: true,
      hasApprovedContent: true,
      hasFlatFileExported: true,
      hasMediaPackExported: true,
    },
    {
      caseId: "delivery-a",
      title: "待导出 Flat File A",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 2,
      hasSupplierSelection: true,
      hasApprovedContent: true,
    },
    {
      caseId: "delivery-b",
      title: "待导出素材包 B",
      status: "approved",
      recommendation: "GO",
      hasCostModel: true,
      quoteCount: 2,
      hasSupplierSelection: true,
      hasApprovedContent: true,
      hasFlatFileExported: true,
    },
  ]);

  assert.deepEqual(queue.map((item) => item.caseId), ["delivery-a", "delivery-b"]);
  assert.equal(queue.every((item) => item.stage === "stage5"), true);

  const tasks = groupCaseActionQueue(queue);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].stage, "stage5");
  assert.equal(tasks[0].value, queue.length);
  assert.match(tasks[0].detail, /2 款/);
});

test("review_pending 的可推进案卷进入行动队列，已否决案卷不进入", () => {
  const queue = deriveCaseActionQueue([
    {
      caseId: "review",
      title: "待验证但可询价",
      status: "review_pending",
      recommendation: "HOLD",
      hasCostModel: true,
      quoteCount: 0,
    },
    {
      caseId: "rejected",
      title: "已否决",
      status: "rejected",
      recommendation: "NO-GO",
      hasCostModel: true,
    },
  ]);

  assert.deepEqual(queue.map((item) => item.caseId), ["review"]);
  assert.equal(queue[0].stage, "stage2");
});
