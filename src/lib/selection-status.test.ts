import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SELECTION_STATUS,
  canTransitionSelectionStatus,
  deriveAutoCandidateSelectionStatus,
  getSelectionActionCapabilities,
  getSelectionStatusMeta,
  kanbanStageToSelectionStatus,
} from "./selection-status.ts";

test("deriveAutoCandidateSelectionStatus enforces strict downstream-first priority", () => {
  // 已立项案卷优先级最高（即使同时存在 adoptedHypothesisId 或 grade）
  assert.equal(
    deriveAutoCandidateSelectionStatus({
      grade: "S",
      promotedCaseId: "case-1",
      adoptedRunId: "run-1",
      adoptedHypothesisId: "hyp-1",
    }),
    SELECTION_STATUS.PROMOTED_CASE,
  );

  // 已淘汰优先于采纳关联（如淘汰入避坑库后关联了避坑记录）
  assert.equal(
    deriveAutoCandidateSelectionStatus({
      grade: "ELIMINATED",
      adoptedRunId: "run-bl",
      adoptedHypothesisId: "hyp-bl",
    }),
    SELECTION_STATUS.ELIMINATED,
  );

  // 已采纳入看板时，透传看板精确阶段
  assert.equal(
    deriveAutoCandidateSelectionStatus({
      grade: "A",
      adoptedRunId: "run-1",
      adoptedHypothesisId: "hyp-1",
      kanbanStage: "profitable",
    }),
    SELECTION_STATUS.KANBAN_PROFITABLE,
  );

  // 默认待分诊
  assert.equal(
    deriveAutoCandidateSelectionStatus({ grade: "S" }),
    SELECTION_STATUS.TRIAGE_PENDING,
  );
});

test("state machine transitions and action capabilities stay mutually exclusive", () => {
  // 已进商品案卷不允许倒流回看板或直接淘汰
  assert.equal(
    canTransitionSelectionStatus(SELECTION_STATUS.PROMOTED_CASE, SELECTION_STATUS.KANBAN_CANDIDATE),
    false,
  );
  assert.equal(
    canTransitionSelectionStatus(SELECTION_STATUS.PROMOTED_CASE, SELECTION_STATUS.ELIMINATED),
    false,
  );

  const promotedCaps = getSelectionActionCapabilities(SELECTION_STATUS.PROMOTED_CASE);
  assert.equal(promotedCaps.canViewCase, true);
  assert.equal(promotedCaps.canAdopt, false);
  assert.equal(promotedCaps.canViewKanban, false);
  assert.equal(promotedCaps.canEliminate, false);

  const kanbanCaps = getSelectionActionCapabilities(kanbanStageToSelectionStatus("sampling"));
  assert.equal(kanbanCaps.canViewKanban, true);
  assert.equal(kanbanCaps.canUnadopt, true);
  assert.equal(kanbanCaps.canAdopt, false);
  assert.equal(kanbanCaps.canPromoteFastTrack, false);
  assert.equal(getSelectionStatusMeta(SELECTION_STATUS.KANBAN_SAMPLING).shortLabel, "看板·待定标");

  const pendingCaps = getSelectionActionCapabilities(SELECTION_STATUS.TRIAGE_PENDING);
  assert.equal(pendingCaps.canAdopt, true);
  assert.equal(pendingCaps.canPromoteFastTrack, true);
  assert.equal(pendingCaps.canEliminate, true);
  assert.equal(pendingCaps.isProcessed, false);
});
