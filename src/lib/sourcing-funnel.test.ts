import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkHypothesisAgainstConstraints,
  DEFAULT_SOURCING_CONSTRAINTS,
  deriveCandidateKanbanStage,
  evaluateFastScreen,
  findEliminationMatches,
  formatConstraintsSummary,
  groupValidationTasks,
  type EliminatedHistoryRecord,
} from "./sourcing-funnel.ts";
import type { AIValidationTask } from "./ai-sourcing-repo/types.ts";

function makeTask(taskType: string, title: string, targetCount: number, status: "todo" | "done" = "todo"): AIValidationTask {
  return {
    id: `task-${taskType}`,
    hypothesisId: "hyp-1",
    taskType,
    title,
    description: `${title} 说明`,
    targetCount,
    status,
    owner: "运营人员",
    dueAt: null,
  };
}

test("groupValidationTasks collapses 8 tasks into 3 groups and highlights active step", () => {
  const tasks = [
    makeTask("competitor_scan", "采集 20 个真实竞品", 20, "done"),
    makeTask("review_research", "整理 15 条差评样本", 15, "todo"),
    makeTask("supplier_shortlist", "建立 3 家供应商短名单", 3, "todo"),
    makeTask("rfq_draft", "生成并人工确认询盘", 1, "todo"),
    makeTask("quote_collection", "收集 3 份真实报价", 3, "todo"),
    makeTask("sample_order", "完成 2 家样品测试", 2, "todo"),
    makeTask("patent_check", "完成专利与合规初筛", 1, "todo"),
    makeTask("logistics_check", "确认包装与物流可执行", 1, "todo"),
  ];

  const flow = groupValidationTasks(
    {
      id: "hyp-1",
      tasks,
      counts: {
        competitors: 20,
        verifiedCompetitors: 20,
        reviewSamples: 8,
        suppliers: 1,
        supplierCandidates: 3,
        quotes: 0,
        completedTasks: 1,
        totalTasks: 8,
      },
      quotes: [],
      evidence: [],
      competitorQueries: ["corner shower caddy"],
    },
    "run-1",
    0,
  );

  assert.equal(flow.activeStepNumber, 2);
  assert.equal(flow.activeGroupTitle, "找货报价与差评");
  assert.equal(flow.nextActionLabel, "录差评");
  assert.equal(flow.groups.length, 3);
  assert.equal(flow.groups[0]?.isComplete, true);
  assert.equal(flow.groups[1]?.isActive, true);
  assert.equal(flow.groups[1]?.items[0]?.progressText, "8/15");
  assert.equal(flow.groups[1]?.items[1]?.progressText, "1/3");
  assert.equal(flow.groups[2]?.isLocked, true);
});

test("evaluateFastScreen flags market HOLD/FAIL and compliance risk without inventing profit", () => {
  const holdResult = evaluateFastScreen({
    marketCode: "US",
    verifiedCompetitorCount: 12,
    p50PriceCents: 3500,
    complianceAttrs: [],
    conceptText: "corner shower caddy",
  });
  assert.equal(holdResult.marketStatus, "hold");
  assert.equal(holdResult.complianceStatus, "pass");

  const failCompliance = evaluateFastScreen({
    marketCode: "US",
    verifiedCompetitorCount: 20,
    p50PriceCents: 1999,
    complianceAttrs: ["battery"],
    conceptText: "battery lamp",
  });
  assert.equal(failCompliance.marketStatus, "pass");
  assert.equal(failCompliance.complianceStatus, "fail");
  assert.equal(failCompliance.suggestedEliminationReason, "合规");
});

test("deriveCandidateKanbanStage derives all 6 columns cleanly from real evidence", () => {
  const base = {
    id: "h1",
    runId: "r1",
    productCaseId: null,
    eliminatedAt: null,
    verifiedCompetitorCount: 0,
    comparisonReportId: null,
    comparisonReportConfirmed: false,
    costSheetId: null,
    costSheetStatus: null,
    costSheetMarginRate: null,
    costSheetVersion: null,
    costSheetIsLatest: false,
    costSheetScopeMatches: false,
    complianceAttrs: [],
    quoteCount: 0,
    supplierCount: 0,
    decision: null,
    marketCode: "US",
    platformCode: "amazon",
    currency: "USD",
    concept: "不锈钢淋浴架",
  };

  assert.equal(deriveCandidateKanbanStage(base).stage, "candidate");
  assert.equal(deriveCandidateKanbanStage({ ...base, verifiedCompetitorCount: 10 }).stage, "scanned");
  assert.equal(
    deriveCandidateKanbanStage({
      ...base,
      verifiedCompetitorCount: 20,
      comparisonReportId: "report-1",
      comparisonReportConfirmed: true,
      costSheetId: "sheet-1",
      costSheetStatus: "confirmed",
      costSheetMarginRate: 0.22,
      costSheetVersion: 1,
      costSheetIsLatest: true,
      costSheetScopeMatches: true,
    }).stage,
    "costed",
  );
  assert.equal(deriveCandidateKanbanStage({ ...base, quoteCount: 1, supplierCount: 2 }).stage, "candidate");
  assert.equal(
    deriveCandidateKanbanStage({
      ...base,
      verifiedCompetitorCount: 20,
      comparisonReportId: "report-1",
      comparisonReportConfirmed: true,
      costSheetId: "sheet-1",
      costSheetStatus: "confirmed",
      costSheetMarginRate: 0.22,
      costSheetVersion: 1,
      costSheetIsLatest: true,
      costSheetScopeMatches: true,
      quoteCount: 1,
      supplierCount: 2,
    }).stage,
    "sampling",
  );
  assert.equal(deriveCandidateKanbanStage({ ...base, productCaseId: "case-1" }).stage, "promoted");
  assert.equal(deriveCandidateKanbanStage({ ...base, eliminatedAt: "2026-11-23T00:00:00Z" }).stage, "eliminated");
});

test("structured constraints filter excluded products and elimination history alerts on similar terms", () => {
  const summary = formatConstraintsSummary(DEFAULT_SOURCING_CONSTRAINTS);
  assert.match(summary, /客单价 \$20–\$60/);
  assert.match(summary, /单件重量 ≤ 1kg/);

  const violations = checkHypothesisAgainstConstraints(
    "便携式锂电池充电宝露营灯",
    3500,
    DEFAULT_SOURCING_CONSTRAINTS,
  );
  assert.ok(violations.length >= 1);

  const history: EliminatedHistoryRecord[] = [
    {
      id: "old-1",
      runId: "r0",
      concept: "免打孔浴室三角淋浴架",
      category: "家居收纳",
      marketCode: "US",
      competitorQueries: ["adhesive corner shower caddy"],
      eliminationReason: "评论壁垒高",
      eliminationNote: "前 5 名全部超 5000 评",
      eliminatedAt: "2026-11-20T00:00:00Z",
    },
  ];
  const matches = findEliminationMatches("shower caddy 淋浴架", "家居收纳", history);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.record.eliminationReason, "评论壁垒高");
});
