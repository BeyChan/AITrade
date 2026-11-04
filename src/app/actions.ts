"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EconomicsAssumptions } from "@/lib/economics";
import {
  approveChannelListing,
  approveListingContent,
  createAssetRecord,
  createChannelTarget,
  createCostModelVersion,
  createListingDraft,
  createSupplierAndQuote,
  decideCase,
  reviewMainImageAsset,
  saveChannelListingVersion,
  selectSupplierQuote,
  upsertProductDefinition,
} from "@/lib/repository";
import { deleteStoredImage, saveImageUpload } from "@/lib/storage";

export async function decideCaseAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "");
  const decision = String(formData.get("decision") || "");
  const reviewer = String(formData.get("reviewer") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  if (decision !== "approved" && decision !== "rejected") throw new Error("无效审批结论");
  await decideCase(caseId, decision, reviewer, notes);
  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath(`/cases/${caseId}`);
  redirect(`/cases/${caseId}`);
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
  revalidatePath("/approvals");
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
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("内容草稿已通过人工审核；系统不会自动发布到平台")}`);
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
      "渠道内容已通过人工审核，仅限内部门禁；连接器未配置，平台未发布",
    )}`,
  );
}

function revalidateChannels(caseId: string, channelListingId?: string) {
  revalidatePath("/");
  revalidatePath("/approvals");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/content`);
  revalidatePath(`/cases/${caseId}/channels`);
  if (channelListingId) revalidatePath(`/cases/${caseId}/channels/${channelListingId}`);
}
