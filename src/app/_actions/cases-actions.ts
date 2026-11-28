"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAuditLog } from "@/lib/audit-logs";
import type { EconomicsAssumptions } from "@/lib/economics";
import { isSupportedImageSlot } from "@/lib/image-skills";
import {
  approveListingContent,
  createAssetRecord,
  createCostModelVersion,
  createListingDraft,
  createSupplierAndQuote,
  createSupplierDirectoryEntry,
  recordCaseNoGoException,
  reviewMainImageAsset,
  selectSupplierQuote,
  setCaseLifecycle,
  upsertProductDefinition,
} from "@/lib/repository";
import { deleteStoredImage, saveImageUpload } from "@/lib/storage";
import {
  dollarsToCents,
  errorMessage,
  integerFrom,
  percentToRate,
  safeReturnPath,
  withQuery,
} from "./helpers";

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

export async function approveNoGoExceptionAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const riskNote = String(formData.get("riskNote") || "").trim();
  const approver = String(formData.get("approver") || "").trim();
  const returnPath = safeReturnPath(formData.get("returnPath")) || `/cases/${caseId}`;
  if (!caseId) redirect(withQuery(returnPath, "error", "缺少商品标识"));

  try {
    await recordCaseNoGoException({ caseId, reason, riskNote, approver });
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }
  revalidatePath("/");
  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/sourcing`);
  redirect(withQuery(returnPath, "notice", "NO-GO 例外审批已记录并留存审计，现在可继续寻源与打样"));
}


export async function updateCostModelAction(formData: FormData) {
  const caseId = String(formData.get("caseId") || "").trim();
  const fallback = `/cases/${encodeURIComponent(caseId)}?tab=economics#cost-assumptions`;
  const returnPath = formData.get("returnPath") ? safeReturnPath(formData.get("returnPath")) : fallback;
  if (!caseId) redirect(withQuery(returnPath, "error", "缺少商品标识"));

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
  if (assumptions.salePriceCents <= 0) {
    redirect(withQuery(returnPath, "error", "售价必须大于 0"));
  }

  try {
    await createCostModelVersion(caseId, assumptions, String(formData.get("actor") || "运营人员"));
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }
  revalidatePath("/");
  revalidatePath("/cases");
  revalidatePath(`/cases/${caseId}`);
  redirect(withQuery(returnPath, "notice", "成本模型已更新并生成新版本"));
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
  const rawType = String(formData.get("assetType") || "main_image").trim();
  const assetType = isSupportedImageSlot(rawType) ? rawType : "main_image";
  let storageKey = "";
  try {
    if (!actor) throw new Error("请输入上传人");
    const file = formData.get("image");
    if (!(file instanceof File)) throw new Error("请选择图片文件");
    const saved = await saveImageUpload(file);
    storageKey = saved.storageKey;
    await createAssetRecord(caseId, { ...saved, assetType }, actor);
  } catch (error) {
    if (storageKey) await deleteStoredImage(storageKey);
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("图片素材已上传，等待人工检查")}`);
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
      matchesPhysicalProduct: formData.get("matchesPhysicalProduct") === "on",
    });
  } catch (error) {
    redirect(`/cases/${encodeURIComponent(caseId)}/content?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateContent(caseId);
  redirect(`/cases/${encodeURIComponent(caseId)}/content?notice=${encodeURIComponent("图片素材人工检查已通过")}`);
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

export async function createSupplierDirectoryEntryAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const platform = String(formData.get("platform") ?? "1688").trim();
  const url = String(formData.get("url") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const country = String(formData.get("country") ?? "CN").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const ratingStr = String(formData.get("rating") ?? "4.8").trim();

  let failure = "";
  try {
    const created = await createSupplierDirectoryEntry({
      name,
      platform,
      url: url || undefined,
      contact: contact || undefined,
      country: country || "CN",
      rating: parseFloat(ratingStr) || 4.8,
      notes,
    });
    await recordAuditLog({
      actor: "采购人员",
      action: "supplier.created",
      entityType: "supplier",
      entityId: typeof created === "string" ? created : (created && typeof created === "object" && "id" in created ? String((created as { id: unknown }).id) : name),
      details: { supplierName: name, platform, country: country || "CN" },
    }).catch(() => {});
  } catch (error) {
    failure = errorMessage(error);
  }

  revalidatePath("/sourcing");
  if (failure) {
    redirect(`/sourcing?error=${encodeURIComponent(failure)}`);
  }
  redirect(`/sourcing?notice=${encodeURIComponent(`已成功录入供应商「${name}」至工厂资产池`)}`);
}

