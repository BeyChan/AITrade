"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppMode } from "@/lib/app-mode";
import {
  attachCostSheetToHypothesis,
  confirmCostSheet,
  createCostSheet,
  createCostSheetVersion,
  createHypothesisFromCostSheet,
  getCostSheet,
  isLatestCostSheetVersion,
  updateCostSheetDraft,
  type CostSheetAssumptions,
  type CreateCostSheetInput,
} from "@/lib/cost-sheets-repository";

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

function withQuery(path: string, key: "notice" | "error", value: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${key}=${encodeURIComponent(value)}`;
}

function numberValue(value: FormDataEntryValue | null) {
  const raw = String(value ?? "").replace(/[$,%\s]/g, "");
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cents(value: FormDataEntryValue | null) {
  return Math.round(numberValue(value) * 100);
}

function rate(value: FormDataEntryValue | null) {
  return Math.min(1, Math.max(0, numberValue(value) / 100));
}

function buildInput(formData: FormData): CreateCostSheetInput {
  const assumptions: CostSheetAssumptions = {
    productTitle: String(formData.get("productTitle") || "").trim(),
    marketCode: String(formData.get("marketCode") || "US").trim().toUpperCase(),
    platformCode: String(formData.get("platformCode") || "amazon").trim().toLowerCase(),
    currency: String(formData.get("currency") || "USD").trim().toUpperCase(),
    salePriceCents: cents(formData.get("salePrice")),
    purchasePriceCents: cents(formData.get("purchasePrice")),
    freightPerUnitCents: cents(formData.get("freightPerUnit")),
    dutyRate: rate(formData.get("dutyRate")),
    landedCostCents: 0,
    fbaFeeCents: cents(formData.get("fbaFee")),
    referralRate: rate(formData.get("referralRate")),
    adRate: rate(formData.get("adRate")),
    returnRate: rate(formData.get("returnRate")),
    returnProcessingCents: cents(formData.get("returnProcessing")),
    returnRecoveryRate: rate(formData.get("returnRecoveryRate")),
    couponCents: cents(formData.get("coupon")),
    storageCents: cents(formData.get("storage")),
    otherCostCents: cents(formData.get("otherCost")),
    oneTimeFixedCostCents: cents(formData.get("oneTimeFixedCost")),
    initialOrderUnits: Math.max(0, Math.round(numberValue(formData.get("initialOrderUnits")))),
  };
  return {
    title: String(formData.get("title") || assumptions.productTitle).trim(),
    marketCode: assumptions.marketCode,
    platformCode: assumptions.platformCode,
    currency: assumptions.currency ?? "USD",
    assumptions,
    actor: String(formData.get("actor") || "选品负责人").trim(),
  };
}

function revalidateCosting(hypothesisId?: string | null) {
  revalidatePath("/costing");
  revalidatePath("/discover");
  revalidatePath("/ai-sourcing");
  if (hypothesisId) {
    revalidatePath("/ai-sourcing");
    revalidatePath("/ai-sourcing/[runId]", "page");
  }
}

function costingPath(
  sheetId?: string,
  hypothesisId?: string | null,
  marketCode?: string,
  platformCode?: string,
) {
  const params = new URLSearchParams();
  if (sheetId) params.set("id", sheetId);
  if (hypothesisId) {
    params.set("hypothesisId", hypothesisId);
    if (marketCode) params.set("market", marketCode);
    if (platformCode) params.set("platform", platformCode);
  }
  const query = params.toString();
  return `/costing${query ? `?${query}` : ""}`;
}

function candidateProfitPath(
  runId: string,
  hypothesisId: string,
  key: "notice" | "error",
  value: string,
) {
  const params = new URLSearchParams({ tab: "profit", hypothesisId, [key]: value });
  return `/ai-sourcing/${encodeURIComponent(runId)}?${params.toString()}#hypothesis-${encodeURIComponent(hypothesisId)}`;
}

async function saveCostSheetFromForm(formData: FormData, sheetId: string) {
  const input = buildInput(formData);
  if (!sheetId) return (await createCostSheet(input)).id;
  const existing = await getCostSheet(sheetId);
  if (!existing) throw new Error("成本核算单不存在");
  const saved =
    existing.status === "draft"
      ? await updateCostSheetDraft(sheetId, input)
      : await createCostSheetVersion(sheetId, input);
  return saved.id;
}

export async function saveCostSheetAction(formData: FormData) {
  const sheetId = String(formData.get("sheetId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim() || null;
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase() || undefined;
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase() || undefined;
  let savedId: string;
  try {
    savedId = await saveCostSheetFromForm(formData, sheetId);
  } catch (error) {
    redirect(withQuery(costingPath(sheetId, hypothesisId, marketCode, platformCode), "error", message(error)));
  }
  revalidateCosting(hypothesisId);
  redirect(withQuery(costingPath(savedId, hypothesisId, marketCode, platformCode), "notice", "成本核算单已保存"));
}

/** 演示模式专用：保存本次表单、确认核算单，并在候选上下文内直接绑定。 */
export async function saveAndConfirmCostSheetAction(formData: FormData) {
  const sheetId = String(formData.get("sheetId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim() || null;
  const runId = String(formData.get("runId") || "").trim();
  const actor = String(formData.get("actor") || "演示模式").trim() || "演示模式";
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase() || undefined;
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase() || undefined;
  const demoMode = (await getAppMode()) === "sandbox";
  if (!demoMode) {
    redirect(withQuery(costingPath(sheetId, hypothesisId, marketCode, platformCode), "error", "正式模式必须单独人工确认核算单"));
  }

  let savedId = sheetId;
  try {
    savedId = await saveCostSheetFromForm(formData, sheetId);
    const confirmed = await confirmCostSheet(savedId, actor, { demoBypass: true });
    if (hypothesisId) {
      await attachCostSheetToHypothesis({ hypothesisId, costSheetId: confirmed.id, actor });
    }
  } catch (error) {
    redirect(withQuery(costingPath(savedId || sheetId, hypothesisId, marketCode, platformCode), "error", message(error)));
  }

  revalidateCosting(hypothesisId);
  const notice = hypothesisId ? "演示模式已保存、确认并绑定核算单" : "演示模式已保存并确认核算单";
  redirect(
    hypothesisId && runId
      ? candidateProfitPath(runId, hypothesisId, "notice", notice)
      : withQuery(costingPath(savedId, hypothesisId, marketCode, platformCode), "notice", notice),
  );
}

export async function createCostSheetVersionAction(formData: FormData) {
  const sheetId = String(formData.get("sheetId") || "").trim();
  if (!sheetId) redirect(withQuery("/costing", "error", "缺少原核算单标识"));
  const hypothesisId = String(formData.get("hypothesisId") || "").trim() || null;
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase() || undefined;
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase() || undefined;
  let createdId = "";
  try {
    const input = buildInput(formData);
    const created = await createCostSheetVersion(sheetId, input);
    createdId = created.id;
  } catch (error) {
    redirect(withQuery(costingPath(sheetId, hypothesisId, marketCode, platformCode), "error", message(error)));
  }
  revalidateCosting(hypothesisId);
  redirect(withQuery(costingPath(createdId, hypothesisId, marketCode, platformCode), "notice", "已生成新版本，旧版本已锁定保留"));
}

export async function confirmCostSheetAction(formData: FormData) {
  const sheetId = String(formData.get("sheetId") || "").trim();
  const actor = String(formData.get("actor") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim() || null;
  const runId = String(formData.get("runId") || "").trim();
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase() || undefined;
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase() || undefined;
  if (!sheetId) redirect(withQuery("/costing", "error", "缺少核算单标识"));
  try {
    const existing = await getCostSheet(sheetId);
    if (existing?.status === "draft") await updateCostSheetDraft(sheetId, buildInput(formData));
    const demoMode = (await getAppMode()) === "sandbox";
    const confirmed = await confirmCostSheet(sheetId, actor, { demoBypass: demoMode });
    if (hypothesisId) {
      await attachCostSheetToHypothesis({ hypothesisId, costSheetId: confirmed.id, actor });
    }
  } catch (error) {
    redirect(withQuery(costingPath(sheetId, hypothesisId, marketCode, platformCode), "error", message(error)));
  }
  revalidateCosting(hypothesisId);
  const notice = hypothesisId
    ? "核算单已确认并绑定当前候选"
    : "核算单已人工确认，可用于候选 GO 门禁";
  redirect(
    hypothesisId && runId
      ? candidateProfitPath(runId, hypothesisId, "notice", notice)
      : withQuery(costingPath(sheetId, hypothesisId, marketCode, platformCode), "notice", notice),
  );
}

export async function createHypothesisFromCostSheetAction(formData: FormData) {
  const sheetId = String(formData.get("sheetId") || "").trim();
  if (!sheetId) redirect(withQuery("/costing", "error", "缺少核算单标识"));
  const actor = String(formData.get("actor") || "选品负责人").trim();
  let created: Awaited<ReturnType<typeof createHypothesisFromCostSheet>>;
  try {
    created = await createHypothesisFromCostSheet({
      costSheetId: sheetId,
      actor,
      concept: String(formData.get("concept") || "").trim() || undefined,
      category: String(formData.get("category") || "").trim() || undefined,
    });
  } catch (error) {
    redirect(withQuery(`/costing?id=${encodeURIComponent(sheetId)}`, "error", message(error)));
  }
  revalidateCosting(created.hypothesisId);
  redirect(
    `/ai-sourcing/${encodeURIComponent(created.runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(created.hypothesisId)}&notice=${encodeURIComponent("已从已确认核算单建立候选，请继续补齐竞品研报与选厂证据")}`,
  );
}

export async function attachCostSheetAction(formData: FormData) {
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const costSheetId = String(formData.get("costSheetId") || "").trim();
  const runId = String(formData.get("runId") || "").trim();
  const actor = String(formData.get("actor") || "选品负责人").trim();
  if (!hypothesisId || !costSheetId) {
    redirect(withQuery(`/ai-sourcing/${encodeURIComponent(runId)}?tab=profit&hypothesisId=${encodeURIComponent(hypothesisId)}`, "error", "请选择核算单"));
  }
  let demoConfirmed = false;
  try {
    const demoMode = (await getAppMode()) === "sandbox";
    const sheet = await getCostSheet(costSheetId);
    if (!sheet) throw new Error("成本核算单不存在");
    if (demoMode && sheet.status !== "confirmed") {
      if (!(await isLatestCostSheetVersion(sheet.id))) throw new Error("该核算单已有新版本，不能绑定旧版本");
      await confirmCostSheet(sheet.id, actor, { demoBypass: true });
      demoConfirmed = true;
    }
    await attachCostSheetToHypothesis({ hypothesisId, costSheetId, actor });
  } catch (error) {
    redirect(withQuery(`/ai-sourcing/${encodeURIComponent(runId)}?tab=profit&hypothesisId=${encodeURIComponent(hypothesisId)}`, "error", message(error)));
  }
  revalidateCosting(hypothesisId);
  redirect(withQuery(
    `/ai-sourcing/${encodeURIComponent(runId)}?tab=profit&hypothesisId=${encodeURIComponent(hypothesisId)}`,
    "notice",
    demoConfirmed ? "演示模式已自动确认并绑定核算单" : "已更换绑定的成本核算单",
  ));
}
