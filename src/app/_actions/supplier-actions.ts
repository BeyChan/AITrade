"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createSupplierDraft,
  reviewSupplierDraft,
} from "@/lib/ai-supplier-assistant/repository";
import { isSupplierDraftType } from "@/lib/ai-supplier-assistant/schema";
import {
  promoteHypothesisToProductCase,
  recordSupplierCandidates,
  rejectSupplierCandidate,
  shortlistSupplierCandidate,
} from "@/lib/ai-sourcing-repository";
import {
  aiSourcingDetailPath,
  errorMessage,
  revalidateAISourcing,
} from "./helpers";

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
  const provisional = String(formData.get("mode") || "") === "provisional";
  let outcome: Awaited<ReturnType<typeof promoteHypothesisToProductCase>>;
  try {
    outcome = await promoteHypothesisToProductCase(
      hypothesisId,
      String(formData.get("actor") || ""),
      { provisional },
    );
  } catch (error) {
    redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=decision&hypothesisId=${encodeURIComponent(hypothesisId)}&error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateAISourcing(runId);
  revalidatePath("/");
  revalidatePath(`/cases/${outcome.caseId}`);
  revalidatePath(`/cases/${outcome.caseId}/sourcing`);
  const noticeMsg = provisional
    ? "已创建待验证案卷，后续可继续锁厂定标与完善文案视觉"
    : "已正式立项，全部报价与样品数据已自动带入商品开发";
  redirect(`/cases/${encodeURIComponent(outcome.caseId)}/sourcing?notice=${encodeURIComponent(noticeMsg)}`);
}

