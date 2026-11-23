export type {
  AICompetitorSnapshot,
  AIOpportunityEvidence,
  AIReviewInsight,
  AISelectionDecision,
  AISourcingBatchDetail,
  AISourcingBatchSummary,
  AISourcingHypothesis,
  AISourcingHypothesisDetail,
  AISupplierCandidate,
  AISupplierDiscoveryRun,
  AISupplierQuote,
  AISupplierShortlist,
  AIValidationTask,
} from "./ai-sourcing-repo/types.ts";

export {
  createAISourcingBatch,
  createQuickCandidateBatch,
  deleteAISourcingBatch,
  deleteHypothesis,
  eliminateHypothesis,
  getAISourcingBatch,
  getBatchSiteLabel,
  listAISourcingBatches,
  listEliminatedHypotheses,
  listKanbanCandidates,
  restoreHypothesis,
  saveHypothesisProfitCheck,
  selectHypothesisForValidation,
  toggleValidationTaskStatus,
  type KanbanCandidateItem,
} from "./ai-sourcing-repo/batches.ts";

export {
  attachComparisonReportToHypothesis,
  autoImportSiteCompetitors,
  confirmHypothesisPrice,
  loadCaseCompetitorBenchmark,
  recordCompetitorEvidence,
  recordOpportunityEvidence,
  type CaseBenchmarkLookupResult,
} from "./ai-sourcing-repo/competitors.ts";

export {
  recordAISupplierQuote,
  recordSupplierCandidates,
  rejectSupplierCandidate,
  shortlistSupplierCandidate,
} from "./ai-sourcing-repo/suppliers.ts";

export {
  promoteHypothesisToProductCase,
  refreshAISelectionDecision,
} from "./ai-sourcing-repo/decisions.ts";
