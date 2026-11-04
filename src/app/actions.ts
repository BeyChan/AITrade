"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { EconomicsAssumptions } from "@/lib/economics";
import { clearStoredAIProviderKey, saveAIProviderSettings } from "@/lib/app-settings";
import { testAIProviderConnection } from "@/lib/ai-provider";
import {
  createAISourcingBatch,
  promoteHypothesisToProductCase,
  recordAISupplierQuote,
  recordCompetitorEvidence,
  recordOpportunityEvidence,
  selectHypothesisForValidation,
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
  upsertProductDefinition,
} from "@/lib/repository";
import { deleteStoredImage, saveImageUpload } from "@/lib/storage";

export async function createAISourcingBatchAction(formData: FormData) {
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase();
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase();
  const returnPath = `/?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`;
  try {
    const outcome = await createAISourcingBatch({
      marketCode,
      platformCode,
      category: String(formData.get("category") || ""),
      brief: String(formData.get("brief") || ""),
      actor: String(formData.get("actor") || ""),
      fxRateToUsd: numberOrNull(formData.get("fxRateToUsd")),
      fxSourceUrl: String(formData.get("fxSourceUrl") || "") || null,
    });
    revalidateAISourcing(outcome.runId);
    redirect(`/ai-sourcing/${encodeURIComponent(outcome.runId)}?notice=${encodeURIComponent("已生成 5 个选品假设；下一步请用真实竞品、评论和供应商报价验证")}`);
  } catch (error) {
    redirect(`${returnPath}&error=${encodeURIComponent(errorMessage(error))}`);
  }
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
  redirect(aiSourcingDetailPath(runId, "notice", "已加入验证并生成 8 项证据任务；系统不会自动联系供应商"));
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
  redirect(aiSourcingDetailPath(runId, "notice", "真实竞品快照已记录并重新计算门禁"));
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

export async function promoteHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  try {
    const outcome = await promoteHypothesisToProductCase(hypothesisId, String(formData.get("actor") || ""));
    revalidateAISourcing(runId);
    revalidatePath("/");
    revalidatePath(`/cases/${outcome.caseId}`);
    revalidatePath(`/cases/${outcome.caseId}/sourcing`);
    redirect(`/cases/${encodeURIComponent(outcome.caseId)}/sourcing?notice=${encodeURIComponent("GO 机会已转入商品立项，全部真实报价已带入供应商比价与定标")}`);
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
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
  try {
    const outcome = await recordChannelLaunchReadinessCheck(caseId, channelListingId, actor);
    revalidateChannels(caseId, channelListingId);
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?notice=${encodeURIComponent(
        `发布准备检查已记录：${outcome.readiness.label}；外部写入仍为 none`,
      )}`,
    );
  } catch (error) {
    redirect(
      `/cases/${encodeURIComponent(caseId)}/channels/${encodeURIComponent(channelListingId)}?error=${encodeURIComponent(errorMessage(error))}`,
    );
  }
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
