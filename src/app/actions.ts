"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EconomicsAssumptions } from "@/lib/economics";
import { clearStoredAIProviderKey, saveAIProviderSettings } from "@/lib/app-settings";
import { testAIProviderConnection } from "@/lib/ai-provider";
import { applyAiInboxTask, reviewAiInboxField } from "@/lib/ai-inbox/apply";
import {
  createAiInboxTask,
  getAiInboxTaskTarget,
  inferSourceKind,
  type AiInboxSourceKind,
} from "@/lib/ai-inbox/repository";
import { retryAiInboxTask, runAiInboxTask } from "@/lib/ai-inbox/worker";
import {
  createSupplierDraft,
  reviewSupplierDraft,
} from "@/lib/ai-supplier-assistant/repository";
import { isSupplierDraftType } from "@/lib/ai-supplier-assistant/schema";
import {
  autoImportSiteCompetitors,
  confirmHypothesisPrice,
  createAISourcingBatch,
  deleteAISourcingBatch,
  promoteHypothesisToProductCase,
  recordAISupplierQuote,
  recordCompetitorEvidence,
  recordOpportunityEvidence,
  recordSupplierCandidates,
  rejectSupplierCandidate,
  selectHypothesisForValidation,
  shortlistSupplierCandidate,
} from "@/lib/ai-sourcing-repository";
import {
  approveChannelLaunchQueue,
  approveChannelListing,
  approveListingContent,
  createAssetRecord,
  createChannelTarget,
  createCostModelVersion,
  createListingDraft,
  createSupplierAndQuote,
  recordChannelLaunchReadinessCheck,
  reviewMainImageAsset,
  saveChannelListingVersion,
  selectSupplierQuote,
  setCaseLifecycle,
  upsertProductDefinition,
} from "@/lib/repository";
import { deleteStoredImage, saveImageUpload } from "@/lib/storage";

/** 只接受站内相对路径，避免 returnPath 被用作开放重定向 */
function safeReturnPath(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\r\n]/.test(raw)) return "/";
  return raw;
}

function withQuery(path: string, key: "notice" | "error", message: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(message)}`;
}

export async function archiveCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();
  const returnPath = safeReturnPath(formData.get("returnPath"));
  if (!caseId) redirect(withQuery(returnPath, "error", "缺少商品标识"));

  try {
    await setCaseLifecycle({ caseId, action: "archive", actor, reason });
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }
  revalidatePath("/");
  revalidatePath("/content");
  revalidatePath(`/cases/${caseId}`);
  redirect(withQuery(returnPath, "notice", "商品已终止并归档，证据与报价全部保留；可在「已终止」中恢复"));
}

export async function restoreCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();
  const returnPath = safeReturnPath(formData.get("returnPath"));
  if (!caseId) redirect(withQuery(returnPath, "error", "缺少商品标识"));

  try {
    await setCaseLifecycle({ caseId, action: "restore", actor });
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }
  revalidatePath("/");
  revalidatePath("/content");
  revalidatePath(`/cases/${caseId}`);
  redirect(withQuery(returnPath, "notice", "商品已恢复为已立项，重新出现在进度与内容工作台"));
}

export async function createAISourcingBatchAction(formData: FormData) {
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase();
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase();
  const returnPath = `/?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`;
  let outcome: Awaited<ReturnType<typeof createAISourcingBatch>>;
  try {
    outcome = await createAISourcingBatch({
      marketCode,
      platformCode,
      category: String(formData.get("category") || ""),
      brief: String(formData.get("brief") || ""),
      actor: String(formData.get("actor") || ""),
      fxRateToUsd: numberOrNull(formData.get("fxRateToUsd")),
      fxSourceUrl: String(formData.get("fxSourceUrl") || "") || null,
      requestKey: String(formData.get("requestKey") || "") || null,
    });
  } catch (error) {
    redirect(`${returnPath}&error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateAISourcing(outcome.runId);
  redirect(`/ai-sourcing/${encodeURIComponent(outcome.runId)}?notice=${encodeURIComponent("已生成 5 个选品假设；下一步请用真实竞品、评论和供应商报价验证")}`);
}

export async function deleteAISourcingBatchAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  let deleted: Awaited<ReturnType<typeof deleteAISourcingBatch>>;
  try {
    deleted = await deleteAISourcingBatch(runId, String(formData.get("actor") || "运营人员"));
  } catch (error) {
    redirect(`/ai-sourcing?error=${encodeURIComponent(errorMessage(error))}`);
  }

  revalidatePath("/");
  revalidatePath("/ai-sourcing");
  revalidatePath(`/ai-sourcing/${encodeURIComponent(deleted.runId)}`);
  const preserved = deleted.preservedProductCaseCount > 0
    ? `；${deleted.preservedProductCaseCount} 个已立项商品及后续数据已保留`
    : "";
  redirect(`/ai-sourcing?notice=${encodeURIComponent(`已删除研究批次「${deleted.category}」${preserved}`)}`);
}

export async function createAiInboxTaskAction(formData: FormData) {
  const contentInput = String(formData.get("content") || "");
  const actor = String(formData.get("actor") || "").trim();
  const targetHypothesisId = String(formData.get("targetHypothesisId") || "").trim();
  const upload = formData.get("evidenceFile");
  let sourceKind = normalizeAiInboxSourceKind(String(formData.get("sourceKind") || "paste"));
  let content = contentInput;
  let fileName: string | null = null;
  let mimeType: string | null = null;

  try {
    if (upload instanceof File && upload.size > 0) {
      fileName = upload.name;
      mimeType = upload.type || null;
      sourceKind = inferSourceKind(upload.name, sourceKind);
      if (upload.size > 300_000) throw new Error("证据文件不能超过 300 KB");
      content = await upload.text();
    }
  } catch (error) {
    redirect(aiInboxPath(null, "error", errorMessage(error)));
  }

  let created: Awaited<ReturnType<typeof createAiInboxTask>>;
  try {
    created = await createAiInboxTask({
      content,
      sourceKind,
      fileName,
      mimeType,
      targetHypothesisId,
      requestedBy: actor,
    });
  } catch (error) {
    redirect(aiInboxPath(null, "error", errorMessage(error)));
  }
  if (!created) redirect(aiInboxPath(null, "error", "AI 证据任务创建失败"));

  let result: Awaited<ReturnType<typeof runAiInboxTask>>;
  try {
    result = await runAiInboxTask(created.task.id, { actor: created.task.requestedBy });
  } catch (error) {
    revalidateAiInbox(created.task.id);
    redirect(aiInboxPath(created.task.id, "error", errorMessage(error)));
  }

  revalidateAiInbox(result.task.id);
  const notice = result.task.status === "failed"
    ? "任务已创建，但提取失败；可查看原因后重试"
    : result.task.status === "ready"
      ? "证据已提取并通过确定性校验，请再次确认后应用"
      : `证据已提取，${result.task.extractionSummary.needsReviewCount ?? 0} 个字段需要人工审核`;
  redirect(aiInboxPath(result.task.id, "notice", notice));
}

export async function reviewAiInboxFieldAction(formData: FormData) {
  const taskId = String(formData.get("taskId") || "");
  const fieldId = String(formData.get("fieldId") || "");
  const requestedAction = String(formData.get("reviewAction") || "");
  const action = requestedAction === "accept" || requestedAction === "correct" || requestedAction === "reject"
    ? requestedAction
    : null;
  if (!action) redirect(aiInboxPath(taskId, "error", "审核动作无效"));

  try {
    await reviewAiInboxField({
      taskId,
      fieldId,
      action,
      actor: String(formData.get("actor") || ""),
      value: action === "correct" ? String(formData.get("value") || "") : undefined,
      notes: String(formData.get("notes") || ""),
    });
  } catch (error) {
    redirect(aiInboxPath(taskId, "error", errorMessage(error)));
  }
  revalidateAiInbox(taskId);
  redirect(aiInboxPath(taskId, "notice", action === "reject" ? "字段已拒绝，门禁状态已重算" : "字段已人工确认，门禁状态已重算"));
}

export async function applyAiInboxTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") || "");
  const actor = String(formData.get("actor") || "");
  let target: Awaited<ReturnType<typeof getAiInboxTaskTarget>> = null;
  try {
    target = await getAiInboxTaskTarget(taskId);
    await applyAiInboxTask({ taskId, actor });
  } catch (error) {
    redirect(aiInboxPath(taskId, "error", errorMessage(error)));
  }
  revalidateAiInbox(taskId);
  if (target?.runId && target.hypothesisId) {
    revalidateAISourcing(target.runId);
    const hash = `#hypothesis-${encodeURIComponent(target.hypothesisId)}`;
    redirect(aiSourcingDetailPath(
      target.runId,
      "notice",
      `AI 证据已写入「${target.concept ?? "当前机会"}」并重新计算确定性门禁；未产生外部动作`,
    ) + hash);
  }
  redirect(aiInboxPath(taskId, "notice", "已审核证据已事务写入业务表，并重新计算确定性门禁；未产生外部动作"));
}

export async function retryAiInboxTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") || "");
  try {
    await retryAiInboxTask(taskId, String(formData.get("actor") || ""));
  } catch (error) {
    redirect(aiInboxPath(taskId, "error", errorMessage(error)));
  }
  revalidateAiInbox(taskId);
  redirect(aiInboxPath(taskId, "notice", "已重新提取原始证据；历史调用和审核记录仍保留"));
}

function normalizeAiInboxSourceKind(value: string): AiInboxSourceKind {
  return value === "csv" || value === "json" || value === "text" || value === "markdown"
    ? value
    : "paste";
}

function revalidateAiInbox(taskId?: string) {
  revalidatePath("/");
  revalidatePath("/ai-inbox");
  if (taskId) revalidatePath(`/ai-inbox/${taskId}`);
}

function aiInboxPath(taskId: string | null, key: "notice" | "error", message: string) {
  const path = taskId ? `/ai-inbox/${encodeURIComponent(taskId)}` : "/ai-inbox";
  return `${path}?${key}=${encodeURIComponent(message)}`;
}

export async function selectHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  try {
    await selectHypothesisForValidation(hypothesisId, String(formData.get("actor") || ""));
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "已开始找供应商并生成 8 项验证任务；系统不会自动联系供应商"));
}

export async function recordOpportunityEvidenceAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const requestedType = String(formData.get("evidenceType") || "review_insight");
  const evidenceType = requestedType === "patent_check" || requestedType === "logistics_check"
    ? requestedType
    : "review_insight";
  const requestedRisk = String(formData.get("riskLevel") || "review");
  const riskLevel = requestedRisk === "clear" || requestedRisk === "found" ? requestedRisk : "review";
  try {
    await recordOpportunityEvidence({
      hypothesisId,
      evidenceType,
      sourceType: String(formData.get("sourceType") || "manual_verified"),
      sourceUrl: String(formData.get("sourceUrl") || ""),
      title: String(formData.get("title") || ""),
      summary: String(formData.get("summary") || ""),
      observedAt: String(formData.get("observedAt") || ""),
      reviewSampleSize: evidenceType === "review_insight" ? integerFrom(formData.get("reviewSampleSize")) : undefined,
      representativeQuote: String(formData.get("representativeQuote") || ""),
      sentiment: "negative",
      riskLevel: evidenceType === "review_insight" ? undefined : riskLevel,
      actor: String(formData.get("actor") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", evidenceType === "review_insight" ? "差评证据已记录并重新计算门禁" : "风险证据已记录并重新计算门禁"));
}

export async function recordCompetitorAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const ratingValue = numberOrNull(formData.get("rating"));
  try {
    await recordCompetitorEvidence({
      hypothesisId,
      asin: String(formData.get("asin") || ""),
      title: String(formData.get("title") || ""),
      sourceUrl: String(formData.get("sourceUrl") || ""),
      priceCents: dollarsToCents(formData.get("price")),
      rating: ratingValue === null ? null : Math.min(5, Math.max(0, ratingValue)),
      reviewCount: Math.max(0, integerFrom(formData.get("reviewCount"))),
      bsr: positiveIntegerOrNull(formData.get("bsr")),
      monthlySalesMin: positiveIntegerOrNull(formData.get("monthlySalesMin")),
      monthlySalesMax: positiveIntegerOrNull(formData.get("monthlySalesMax")),
      sellerCount: positiveIntegerOrNull(formData.get("sellerCount")),
      variationCount: positiveIntegerOrNull(formData.get("variationCount")),
      observedAt: String(formData.get("observedAt") || ""),
      actor: String(formData.get("actor") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "已核实竞品证据已记录并重新计算门禁"));
}

export async function autoImportCompetitorsAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const targetCount = positiveIntegerOrNull(formData.get("targetCount")) ?? 20;
  let outcome: Awaited<ReturnType<typeof autoImportSiteCompetitors>>;
  try {
    outcome = await autoImportSiteCompetitors({
      hypothesisId,
      query: String(formData.get("query") || ""),
      targetCount,
      includeReviews: formData.get("includeReviews") !== "false",
      rawPayload: String(formData.get("rawPayload") || ""),
      actor: String(formData.get("actor") || "运营人员"),
    });
  } catch (error) {
    redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesisId)}&error=${encodeURIComponent(errorMessage(error))}#hypothesis-${encodeURIComponent(hypothesisId)}`);
  }
  revalidateAISourcing(runId);
  const reviewNote = outcome.insertedReviews > 0 ? `、${outcome.insertedReviews} 组差评洞察` : "";
  const dupNote = outcome.skippedDuplicateCompetitors > 0 ? `（跳过重复 ${outcome.skippedDuplicateCompetitors} 条）` : "";
  const message = `已基于 ${outcome.marketName}站 · ${outcome.platformName} (${outcome.currency}) 自动导入 ${outcome.insertedCompetitors} 个竞品快照${reviewNote}${dupNote}，竞品画像与门禁已更新`;
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesisId)}&notice=${encodeURIComponent(message)}#hypothesis-${encodeURIComponent(hypothesisId)}`);
}

export async function confirmHypothesisPriceAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  let outcome: Awaited<ReturnType<typeof confirmHypothesisPrice>>;
  try {
    outcome = await confirmHypothesisPrice({
      hypothesisId: String(formData.get("hypothesisId") || ""),
      priceCents: dollarsToCents(formData.get("price")),
      sourceUrl: String(formData.get("sourceUrl") || ""),
      actor: String(formData.get("actor") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  const message = outcome.priceAdvisory
    ? `已确认售价已记录并重新计算门禁；提示：${outcome.priceAdvisory}`
    : "已确认售价已记录并重新计算门禁";
  redirect(aiSourcingDetailPath(runId, "notice", message));
}

export async function recordAISupplierQuoteAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const score = numberOrNull(formData.get("sampleScore"));
  try {
    await recordAISupplierQuote({
      hypothesisId,
      supplierName: String(formData.get("supplierName") || ""),
      supplierPlatform: String(formData.get("supplierPlatform") || ""),
      supplierUrl: String(formData.get("supplierUrl") || ""),
      contact: String(formData.get("contact") || ""),
      country: String(formData.get("country") || ""),
      productMatch: String(formData.get("productMatch") || ""),
      unitPriceCents: dollarsToCents(formData.get("unitPrice")),
      freightPerUnitCents: dollarsToCents(formData.get("freightPerUnit")),
      dutyRate: percentToRate(formData.get("dutyRate")),
      moq: integerFrom(formData.get("moq")),
      leadTimeDays: integerFrom(formData.get("leadTimeDays")),
      sampleScore: score === null ? null : Math.min(100, Math.max(0, score)),
      sampleFeeCents: dollarsToCents(formData.get("sampleFee")),
      certifications: String(formData.get("certifications") || ""),
      paymentTerms: String(formData.get("paymentTerms") || ""),
      incoterm: String(formData.get("incoterm") || ""),
      quoteUrl: String(formData.get("quoteUrl") || ""),
      observedAt: String(formData.get("observedAt") || ""),
      actor: String(formData.get("actor") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "供应商真实报价已记录并重新计算到岸成本、利润和门禁"));
}

export async function recordSupplierCandidatesAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  let outcome: Awaited<ReturnType<typeof recordSupplierCandidates>>;
  try {
    outcome = await recordSupplierCandidates({
      hypothesisId,
      query: String(formData.get("query") || ""),
      payload: String(formData.get("payload") || ""),
      actor: String(formData.get("actor") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  const message = outcome.newCount > 0
    ? `已解析当前页候选并更新 TOP 10：新增 ${outcome.newCount} 个，候选池现有结果需人工核验后才进入短名单`
    : `当前页候选均已存在于候选池；本次识别 ${outcome.parsedCount} 个，未重复写入`;
  redirect(aiSourcingDetailPath(runId, "notice", message));
}

export async function shortlistSupplierCandidateAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  try {
    await shortlistSupplierCandidate({
      candidateId: String(formData.get("candidateId") || ""),
      supplierName: String(formData.get("supplierName") || ""),
      productMatch: String(formData.get("productMatch") || ""),
      actor: String(formData.get("actor") || ""),
      verified: formData.get("verified") === "true",
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "候选已人工核验并加入短名单；下一步可生成 RFQ 草稿"));
}

export async function rejectSupplierCandidateAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  let outcome: Awaited<ReturnType<typeof rejectSupplierCandidate>>;
  try {
    outcome = await rejectSupplierCandidate({
      candidateId: String(formData.get("candidateId") || ""),
      actor: String(formData.get("actor") || ""),
      reason: String(formData.get("reason") || ""),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", `候选已排除：${outcome.reason}。排除记录已写入审计日志`));
}

export async function generateSupplierDraftAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const draftType = String(formData.get("draftType") || "").trim();
  if (!isSupplierDraftType(draftType)) {
    redirect(aiSourcingDetailPath(runId, "error", "供应商草稿类型无效"));
  }

  try {
    await createSupplierDraft({
      hypothesisId,
      draftType,
      supplierShortlistId: String(formData.get("supplierShortlistId") || "").trim() || null,
      quoteValidUntil: String(formData.get("quoteValidUntil") || "").trim() || null,
      actor: String(formData.get("actor") || "").trim(),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "供应商内部草稿已生成；尚未发送，请人工核对后复制到你的沟通渠道"));
}

export async function reviewSupplierDraftAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const draftId = String(formData.get("draftId") || "").trim();
  try {
    await reviewSupplierDraft({
      draftId,
      actor: String(formData.get("actor") || "").trim(),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  redirect(aiSourcingDetailPath(runId, "notice", "供应商草稿已标记为人工审阅；仍未发送，也未产生任何外部动作"));
}

export async function promoteHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  let outcome: Awaited<ReturnType<typeof promoteHypothesisToProductCase>>;
  try {
    outcome = await promoteHypothesisToProductCase(hypothesisId, String(formData.get("actor") || ""));
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  revalidatePath("/");
  revalidatePath(`/cases/${outcome.caseId}`);
  revalidatePath(`/cases/${outcome.caseId}/sourcing`);
  redirect(`/cases/${encodeURIComponent(outcome.caseId)}/sourcing?notice=${encodeURIComponent("GO 机会已转入商品立项，全部真实报价已带入供应商比价与定标")}`);
}

function revalidateAISourcing(runId: string) {
  revalidatePath("/");
  revalidatePath("/ai-sourcing");
  revalidatePath(`/ai-sourcing/${runId}`);
}

function aiSourcingDetailPath(runId: string, key: "notice" | "error", message: string) {
  return `/ai-sourcing/${encodeURIComponent(runId)}?${key}=${encodeURIComponent(message)}`;
}

function numberOrNull(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").replace(/[$,%\s]/g, "");
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function positiveIntegerOrNull(value: FormDataEntryValue | null) {
  const number = integerFrom(value);
  return number > 0 ? number : null;
}

export async function updateCostModelAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const assumptions: EconomicsAssumptions = {
    salePriceCents: dollarsToCents(formData.get("salePrice")),
    landedCostCents: dollarsToCents(formData.get("landedCost")),
    fbaFeeCents: dollarsToCents(formData.get("fbaFee")),
    referralRate: percentToRate(formData.get("referralRate")),
    adRate: percentToRate(formData.get("adRate")),
    returnRate: percentToRate(formData.get("returnRate")),
    returnProcessingCents: dollarsToCents(formData.get("returnProcessing")),
    returnRecoveryRate: percentToRate(formData.get("returnRecoveryRate")),
    couponCents: dollarsToCents(formData.get("coupon")),
    storageCents: dollarsToCents(formData.get("storageCost")),
    otherCostCents: dollarsToCents(formData.get("otherCost")),
  };
  if (assumptions.salePriceCents <= 0) throw new Error("售价必须大于 0");
  await createCostModelVersion(caseId, assumptions, String(formData.get("actor") || "运营人员"));
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
}

function dollarsToCents(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[$,%\s]/g, ""));
  return Math.round((Number.isFinite(number) ? number : 0) * 100);
}

function percentToRate(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[%\s]/g, ""));
  return Math.min(1, Math.max(0, (Number.isFinite(number) ? number : 0) / 100));
}


export async function createSupplierQuoteAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const actor = String(formData.get("actor") || "采购人员").trim();
  try {
    await createSupplierAndQuote(
      caseId,
      {
        supplierName: String(formData.get("supplierName") || ""),
        supplierPlatform: String(formData.get("supplierPlatform") || ""),
        supplierUrl: String(formData.get("supplierUrl") || ""),
        contact: String(formData.get("contact") || ""),
        country: String(formData.get("country") || ""),
        supplierNotes: String(formData.get("supplierNotes") || ""),
        unitPriceCents: dollarsToCents(formData.get("unitPrice")),
        freightPerUnitCents: dollarsToCents(formData.get("freightPerUnit")),
        dutyRate: percentToRate(formData.get("dutyRate")),
        qualityScore: integerFrom(formData.get("qualityScore")),
        moq: integerFrom(formData.get("moq")),
        leadTimeDays: integerFrom(formData.get("leadTimeDays")),
        paymentTerms: String(formData.get("paymentTerms") || ""),
        incoterm: String(formData.get("incoterm") || ""),
        certifications: String(formData.get("certifications") || ""),
        sampleFeeCents: dollarsToCents(formData.get("sampleFee")),
      },
      actor,
    );
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/sourcing?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath("/");
  revalidatePath("/sourcing");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/sourcing`);
  redirect(`/cases/${encodeURIComponent(caseId)}/sourcing?notice=${encodeURIComponent("供应商报价已录入，并已加入对比")}`);
}

export async function selectSupplierQuoteAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const quoteId = String(formData.get("quoteId") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const exceptionReason = String(formData.get("exceptionReason") || "").trim();
  try {
    await selectSupplierQuote(caseId, quoteId, reviewer, exceptionReason);
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/sourcing?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath("/");
  revalidatePath("/sourcing");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/sourcing`);
  redirect(`/cases/${encodeURIComponent(caseId)}/sourcing?notice=${encodeURIComponent("已完成人工定标，到岸成本已写入新的成本模型版本")}`);
}

function integerFrom(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "0").replace(/[,\s]/g, ""));
  return Math.round(Number.isFinite(number) ? number : 0);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请检查输入";
}

export async function saveProductDefinitionAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const actor = String(formData.get("actor") || "").trim();
  try {
    await upsertProductDefinition(
      caseId,
      {
        productName: String(formData.get("productName") || ""),
        targetCustomer: String(formData.get("targetCustomer") || ""),
        coreDifferentiator: String(formData.get("coreDifferentiator") || ""),
        specifications: String(formData.get("specifications") || ""),
        packageContents: String(formData.get("packageContents") || ""),
        claimsToAvoid: String(formData.get("claimsToAvoid") || ""),
      },
      actor,
    );
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("商品定义已保存")}`);
}

export async function uploadMainImageAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const actor = String(formData.get("actor") || "").trim();
  let storageKey = "";
  try {
    if (!actor) throw new Error("请输入上传人");
    const file = formData.get("image");
    if (!(file instanceof File)) throw new Error("请选择主图文件");
    const saved = await saveImageUpload(file);
    storageKey = saved.storageKey;
    await createAssetRecord(caseId, saved, actor);
  } catch (error) {
    if (storageKey) await deleteStoredImage(storageKey);
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("主图已上传，等待人工检查")}`);
}

export async function reviewMainImageAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const assetId = String(formData.get("assetId") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  try {
    await reviewMainImageAsset(caseId, assetId, reviewer, notes, {
      whiteBackground: formData.get("whiteBackground") === "on",
      productComplete: formData.get("productComplete") === "on",
      noTextWatermark: formData.get("noTextWatermark") === "on",
      resolutionConfirmed: formData.get("resolutionConfirmed") === "on",
    });
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("主图人工检查已通过")}`);
}

export async function saveListingDraftAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const actor = String(formData.get("actor") || "").trim();
  try {
    await createListingDraft(
      caseId,
      {
        brand: String(formData.get("brand") || ""),
        title: String(formData.get("title") || ""),
        bullets: formData.getAll("bullet").map(String),
        description: String(formData.get("description") || ""),
        searchTerms: String(formData.get("searchTerms") || ""),
      },
      actor,
    );
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("Listing 新版本已保存，并已运行确定性发布预检")}`);
}

export async function approveListingContentAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  try {
    await approveListingContent(caseId, reviewer, notes);
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("内容草稿已通过人工检查；系统不会自动发布到平台")}`);
}

function revalidateContent(caseId: string) {
  revalidatePath("/");
  revalidatePath("/sourcing");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/sourcing`);
  revalidatePath(`/cases/${caseId}/content`);
}


export async function createChannelTargetAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const platformCode = String(formData.get("platformCode") || "");
  const marketCode = String(formData.get("marketCode") || "");
  const actor = String(formData.get("actor") || "").trim();
  const outcome = await createChannelTarget(caseId, platformCode, marketCode, actor).catch((error) => {
    redirect(`/cases/${encodeURIComponent(caseId)}/channels?error=${encodeURIComponent(errorMessage(error))}`);
  });
  revalidateChannels(caseId, outcome.channelListingId);
  redirect(
    `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(outcome.channelListingId)}?notice=${encodeURIComponent(
      outcome.created ? "渠道目标已创建；连接器仍未配置，不会发布" : "该国家 × 平台目标已存在，已打开现有记录",
    )}`,
  );
}

export async function saveChannelListingVersionAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const channelListingId = String(formData.get("channelListingId") || "");
  const actor = String(formData.get("actor") || "").trim();
  try {
    await saveChannelListingVersion(
      caseId,
      channelListingId,
      {
        brand: String(formData.get("brand") || ""),
        title: String(formData.get("title") || ""),
        bullets: formData.getAll("bullet").map(String),
        description: String(formData.get("description") || ""),
        searchTerms: String(formData.get("searchTerms") || ""),
      },
      actor,
    );
  } catch (error) {
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  }
  revalidateChannels(caseId, channelListingId);
  redirect(
    `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?notice=${encodeURIComponent(
      "渠道版本已保存并运行本地映射预检；未调用任何外部平台",
    )}`,
  );
}

export async function approveChannelListingAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const channelListingId = String(formData.get("channelListingId") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  try {
    await approveChannelListing(caseId, channelListingId, reviewer, notes);
  } catch (error) {
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  }
  revalidateChannels(caseId, channelListingId);
  redirect(
    `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?notice=${encodeURIComponent(
      "渠道内容已通过人工检查，仅限内部门禁；连接器未配置，平台未发布",
    )}`,
  );
}

export async function checkChannelLaunchReadinessAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const channelListingId = String(formData.get("channelListingId") || "");
  const actor = String(formData.get("actor") || "").trim();
  let outcome: Awaited<ReturnType<typeof recordChannelLaunchReadinessCheck>>;
  try {
    outcome = await recordChannelLaunchReadinessCheck(caseId, channelListingId, actor);
  } catch (error) {
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  }
  revalidateChannels(caseId, channelListingId);
  redirect(
    `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?notice=${encodeURIComponent(
      `发布准备检查已记录：${outcome.readiness.label}；外部写入仍为 none`,
    )}`,
  );
}

export async function approveChannelLaunchQueueAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const channelListingId = String(formData.get("channelListingId") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  try {
    await approveChannelLaunchQueue(caseId, channelListingId, reviewer, notes);
  } catch (error) {
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  }
  revalidateChannels(caseId, channelListingId);
  redirect(
    `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?notice=${encodeURIComponent(
      "当前版本已人工确认进入内部发布队列；尚未调用平台，published=false",
    )}`,
  );
}

export async function saveAISettingsAction(formData: FormData) {
  const actor = String(formData.get("actor") || "").trim() || "本机管理员";
  const apiKey = String(formData.get("apiKey") || "").trim();
  let failure: string | null = null;
  let savedProvider = "";

  try {
    const saved = await saveAIProviderSettings({
      provider: String(formData.get("provider") || "template"),
      baseUrl: String(formData.get("baseUrl") || ""),
      model: String(formData.get("model") || ""),
      apiKey,
      actor,
    });
    savedProvider = saved.provider;
  } catch (error) {
    failure = settingsErrorMessage(error, apiKey);
  }

  if (failure) redirect(`/settings?error=${encodeURIComponent(failure)}`);
  revalidatePath("/");
  revalidatePath("/settings");
  redirect(`/settings?notice=${encodeURIComponent(`大模型设置已保存：${savedProvider}。API Key 未回显到页面。`)}`);
}

export async function testAISettingsAction(formData: FormData) {
  const apiKey = String(formData.get("apiKey") || "").trim();
  let failure: string | null = null;
  let result: Awaited<ReturnType<typeof testAIProviderConnection>> | null = null;

  try {
    result = await testAIProviderConnection({
      provider: String(formData.get("provider") || "template"),
      baseUrl: String(formData.get("baseUrl") || ""),
      model: String(formData.get("model") || ""),
      apiKey,
    });
  } catch (error) {
    failure = settingsErrorMessage(error, apiKey);
  }

  if (failure) redirect(`/settings?error=${encodeURIComponent(failure)}`);
  if (!result) redirect(`/settings?error=${encodeURIComponent("连接测试没有返回结果")}`);
  redirect(
    `/settings?notice=${encodeURIComponent(
      `${result.message} ${result.model} · ${result.latencyMs} ms。测试使用当前表单值，不保存配置。`,
    )}`,
  );
}

export async function clearAIProviderKeyAction(formData: FormData) {
  const actor = String(formData.get("actor") || "").trim() || "本机管理员";
  let failure: string | null = null;
  try {
    await clearStoredAIProviderKey(actor);
  } catch (error) {
    failure = settingsErrorMessage(error, "");
  }

  if (failure) redirect(`/settings?error=${encodeURIComponent(failure)}`);
  revalidatePath("/");
  revalidatePath("/settings");
  redirect(`/settings?notice=${encodeURIComponent("已清除页面保存的 API Key；模型生成会自动回退模板模式。")}`);
}

function settingsErrorMessage(error: unknown, apiKey: string) {
  let message = errorMessage(error);
  if (apiKey) message = message.replaceAll(apiKey, "[REDACTED]");
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 300);
}

function revalidateChannels(caseId: string, channelListingId?: string) {
  revalidatePath("/");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/content`);
  revalidatePath(`/cases/${caseId}/channels`);
  if (channelListingId) revalidatePath(`/cases/${caseId}/channels/${channelListingId}`);
}
