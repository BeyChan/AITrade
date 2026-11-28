"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAuditLog } from "@/lib/audit-logs";
import { getAppMode } from "@/lib/app-mode";
import { convertRmbToForeignCents } from "@/lib/currency";
import { getFxRatesSnapshot } from "@/lib/fx-rates";
import { getSiteOptions } from "@/lib/repository";
import { confirmComparisonReport, getComparisonReportById } from "@/lib/competitor-compare/storage";
import {
  attachComparisonReportToHypothesis,
  autoImportSiteCompetitors,
  createAISourcingBatch,
  createQuickCandidateBatch,
  deleteAISourcingBatch,
  deleteHypothesis,
  eliminateHypothesis,
  recordAISupplierQuote,
  recordCompetitorEvidence,
  recordOpportunityEvidence,
  restoreHypothesis,
  saveHypothesisComplianceAttrs,
  selectHypothesisForValidation,
  toggleValidationTaskStatus,
} from "@/lib/ai-sourcing-repository";
import { saveFunnelThresholds, saveSourcingConstraints } from "@/lib/app-settings";
import type { ProductComplianceAttribute } from "@/lib/prelaunch-compliance";
import type { SourcingConstraints } from "@/lib/sourcing-funnel";
import {
  aiSourcingDetailPath,
  dollarsToCents,
  errorMessage,
  integerFrom,
  numberOrNull,
  percentToRate,
  positiveIntegerOrNull,
  revalidateAISourcing,
  safeReturnPath,
  withQuery,
} from "./helpers";

export async function createAISourcingBatchAction(formData: FormData) {
  const marketCode = String(formData.get("marketCode") || "").trim().toUpperCase();
  const platformCode = String(formData.get("platformCode") || "").trim().toLowerCase();
  const returnPath = `/discover?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}&entry=ai`;
  let outcome: Awaited<ReturnType<typeof createAISourcingBatch>>;
  try {
    let fxRateToUsd = numberOrNull(formData.get("fxRateToUsd"));
    let fxSourceUrl = String(formData.get("fxSourceUrl") || "").trim() || null;

    if (!fxRateToUsd) {
      const [siteOpts, fxSnapshot] = await Promise.all([getSiteOptions(), getFxRatesSnapshot()]);
      const market = siteOpts.markets.find((m) => m.code.toUpperCase() === marketCode);
      const currency = (market?.currency || "USD").toUpperCase();
      if (currency !== "USD") {
        const usdToRmb = fxSnapshot.byCurrency.USD?.rateToRmb ?? 7.22;
        const targetToRmb = fxSnapshot.byCurrency[currency]?.rateToRmb;
        if (targetToRmb && targetToRmb > 0) {
          fxRateToUsd = Number((usdToRmb / targetToRmb).toFixed(4));
          fxSourceUrl = fxSourceUrl || "https://open.er-api.com/v6/latest/CNY";
        }
      }
    }

    const hasStructuredConstraints =
      formData.has("minPriceUsd") ||
      formData.has("maxPriceUsd") ||
      formData.has("maxWeightKg") ||
      formData.has("excludedAttr") ||
      formData.has("customExclusionsJson");

    let constraints: SourcingConstraints | null = null;
    if (hasStructuredConstraints) {
      const parseJsonField = <T,>(key: string, fallback: T): T => {
        const raw = formData.get(key);
        if (typeof raw !== "string" || !raw.trim()) return fallback;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return fallback;
        }
      };
      constraints = {
        minPriceUsd: numberOrNull(formData.get("minPriceUsd")),
        maxPriceUsd: numberOrNull(formData.get("maxPriceUsd")),
        maxWeightKg: numberOrNull(formData.get("maxWeightKg")),
        excludedAttrs: formData
          .getAll("excludedAttr")
          .map((v) => String(v).trim())
          .filter(Boolean) as ProductComplianceAttribute[],
        customExclusions: parseJsonField("customExclusionsJson", []),
        hiddenAttrs: parseJsonField("hiddenAttrsJson", []),
        attrLabelOverrides: parseJsonField("attrLabelOverridesJson", {}),
        customNote: String(formData.get("brief") || "").trim().slice(0, 600),
      };
      await saveSourcingConstraints(constraints, String(formData.get("actor") || "选品负责人"));
    }

    outcome = await createAISourcingBatch({
      marketCode,
      platformCode,
      category: String(formData.get("category") || ""),
      brief: String(formData.get("brief") || ""),
      actor: String(formData.get("actor") || ""),
      fxRateToUsd,
      fxSourceUrl,
      requestKey: String(formData.get("requestKey") || "") || null,
      constraints,
    });
  } catch (error) {
    redirect(`${returnPath}&error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidateAISourcing(outcome.runId);
  const filteredHint =
    "filteredOutCount" in outcome && outcome.filteredOutCount > 0
      ? `（已按约束自动剔除 ${outcome.filteredOutCount} 个不合规方向）`
      : "";
  redirect(`/ai-sourcing/${encodeURIComponent(outcome.runId)}?tab=hypotheses&notice=${encodeURIComponent(`已生成候选方向${filteredHint}；下一步：扫搜索页 Top 20 快筛`)}`);
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

export async function toggleValidationTaskAction(formData: FormData) {
  const taskId = String(formData.get("taskId") || "");
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const status = formData.get("status") ? (String(formData.get("status")) as "done" | "todo") : undefined;
  const actor = String(formData.get("actor") || "运营人员");

  let resultStatus = "已更新";
  let targetHypothesisId = hypothesisId;
  try {
    const res = await toggleValidationTaskStatus(taskId, status, actor);
    resultStatus = res?.status === "done" ? "已完成" : "待处理";
    if (res?.hypothesisId) {
      targetHypothesisId = res.hypothesisId;
    }
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  const hash = targetHypothesisId ? `#hypothesis-${encodeURIComponent(targetHypothesisId)}` : "";
  const tabParam = targetHypothesisId ? `&tab=hypotheses&hypothesisId=${encodeURIComponent(targetHypothesisId)}` : "";
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?notice=${encodeURIComponent(`验证任务状态已更新为「${resultStatus}」`)}${tabParam}${hash}`);
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

export async function recordAISupplierQuoteAction(formData: FormData) {
  const runId = String(formData.get("runId") || "");
  const hypothesisId = String(formData.get("hypothesisId") || "");
  const score = numberOrNull(formData.get("sampleScore"));
  const currency = String(formData.get("currency") || "USD").trim().toUpperCase();
  const unitPriceRmb = numberOrNull(formData.get("unitPriceRmb"));
  const unitPriceCents =
    unitPriceRmb && unitPriceRmb > 0
      ? convertRmbToForeignCents(unitPriceRmb, currency)
      : dollarsToCents(formData.get("unitPrice"));
  const supplierUrlRaw = String(formData.get("supplierUrl") || "").trim();
  const quoteUrlRaw = String(formData.get("quoteUrl") || "").trim();
  const supplierName = String(formData.get("supplierName") || "").trim();
  const fallback1688Url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(supplierName || "工厂")}`;
  try {
    await recordAISupplierQuote({
      hypothesisId,
      supplierName,
      supplierPlatform: String(formData.get("supplierPlatform") || "1688"),
      supplierUrl: supplierUrlRaw || fallback1688Url,
      contact: String(formData.get("contact") || ""),
      country: String(formData.get("country") || "CN"),
      productMatch: String(formData.get("productMatch") || ""),
      unitPriceCents,
      freightPerUnitCents: dollarsToCents(formData.get("freightPerUnit")),
      dutyRate: percentToRate(formData.get("dutyRate")),
      moq: integerFrom(formData.get("moq")),
      leadTimeDays: integerFrom(formData.get("leadTimeDays")),
      sampleScore: score === null ? null : Math.min(100, Math.max(0, score)),
      sampleFeeCents: dollarsToCents(formData.get("sampleFee")),
      certifications: String(formData.get("certifications") || ""),
      paymentTerms: String(formData.get("paymentTerms") || ""),
      incoterm: String(formData.get("incoterm") || ""),
      quoteUrl: quoteUrlRaw || supplierUrlRaw || fallback1688Url,
      observedAt: String(formData.get("observedAt") || new Date().toISOString()),
      actor: String(formData.get("actor") || "采购人员"),
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }
  revalidateAISourcing(runId);
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=quotes&hypothesisId=${encodeURIComponent(hypothesisId)}&notice=${encodeURIComponent("供应商真实报价已记录并重新计算到岸成本、利润和门禁")}#hypothesis-${encodeURIComponent(hypothesisId)}`);
}

export async function eliminateHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const reason = String(formData.get("reason") || "").trim();
  const note = String(formData.get("note") || "").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();
  const returnPath = formData.get("returnPath") ? safeReturnPath(formData.get("returnPath")) : null;

  try {
    await eliminateHypothesis({ hypothesisId, reason, note, actor });
  } catch (error) {
    if (returnPath) redirect(withQuery(returnPath, "error", errorMessage(error)));
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  revalidatePath("/discover");
  const msg = `已淘汰该方向（原因：${reason}），已沉淀至团队避坑清单`;
  if (returnPath) redirect(withQuery(returnPath, "notice", msg));
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesisId)}&notice=${encodeURIComponent(msg)}#hypothesis-${encodeURIComponent(hypothesisId)}`);
}

export async function restoreHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();
  const returnPath = formData.get("returnPath") ? safeReturnPath(formData.get("returnPath")) : null;

  try {
    await restoreHypothesis(hypothesisId, actor);
  } catch (error) {
    if (returnPath) redirect(withQuery(returnPath, "error", errorMessage(error)));
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  revalidatePath("/discover");
  const msg = "已恢复该候选方向为验证中";
  if (returnPath) redirect(withQuery(returnPath, "notice", msg));
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=hypotheses&hypothesisId=${encodeURIComponent(hypothesisId)}&notice=${encodeURIComponent(msg)}#hypothesis-${encodeURIComponent(hypothesisId)}`);
}

export async function deleteHypothesisAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const tab = String(formData.get("tab") || "hypotheses").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();

  let deleted: Awaited<ReturnType<typeof deleteHypothesis>>;
  try {
    deleted = await deleteHypothesis(hypothesisId, actor);
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(deleted.runId);
  revalidatePath("/discover");
  const preserved = deleted.preservedProductCase ? "（已立项案卷保留）" : "";
  const msg = `已删除候选方向「${deleted.concept}」${preserved}`;
  if (deleted.remainingCount === 0) {
    redirect(`/ai-sourcing?notice=${encodeURIComponent(msg)}`);
  }
  redirect(`/ai-sourcing/${encodeURIComponent(deleted.runId)}?tab=${encodeURIComponent(tab)}&notice=${encodeURIComponent(msg)}`);
}

export async function attachComparisonReportAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const reportId = String(formData.get("reportId") || "").trim();
  const actor = String(formData.get("actor") || "运营人员").trim();
  const returnTabRaw = String(formData.get("returnTab") || "hypotheses").trim();
  const returnTab =
    returnTabRaw === "profit" || returnTabRaw === "suppliers" || returnTabRaw === "decision"
      ? returnTabRaw
      : "hypotheses";
  const returnPath = `/ai-sourcing/${encodeURIComponent(runId)}?tab=${returnTab}&hypothesisId=${encodeURIComponent(hypothesisId)}#hypothesis-${encodeURIComponent(hypothesisId)}`;

  let res: Awaited<ReturnType<typeof attachComparisonReportToHypothesis>>;
  let demoMode = false;
  let autoConfirmedTitle = "";
  try {
    demoMode = (await getAppMode()) === "sandbox";
    if (demoMode) {
      const report = await getComparisonReportById(reportId);
      if (report && report.reviewStatus !== "confirmed") {
        await confirmComparisonReport(reportId, { allowUnverified: true });
        autoConfirmedTitle = report.title;
      }
    }
    res = await attachComparisonReportToHypothesis({ hypothesisId, reportId, actor });
    if (autoConfirmedTitle) {
      await recordAuditLog({
        actor,
        action: "competitor.report_confirmed",
        entityType: "competitor_report",
        entityId: reportId,
        details: { title: autoConfirmedTitle, demoBypass: true, source: "candidate_bind" },
      }).catch(() => {});
    }
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  const parts = [`已从扫描导入 ${res.addedCompetitors} 条真实竞品`];
  if (res.addedReviewSamples > 0) parts.push(`${res.addedReviewSamples} 条真实差评`);
  if (res.p50PriceCents) parts.push("并带入参考售价");
  if (demoMode) parts.push("演示模式已自动确认研报");
  redirect(withQuery(returnPath, "notice", parts.join("，")));
}

export async function saveHypothesisComplianceAttrsAction(formData: FormData) {
  const runId = String(formData.get("runId") || "").trim();
  const hypothesisId = String(formData.get("hypothesisId") || "").trim();
  const returnTabRaw = String(formData.get("returnTab") || "profit").trim();
  const returnTab =
    returnTabRaw === "hypotheses" || returnTabRaw === "suppliers" || returnTabRaw === "decision"
      ? returnTabRaw
      : "profit";
  const hasComplianceField = formData.has("updateCompliance");
  const complianceAttrs = hasComplianceField
    ? formData.getAll("complianceAttr").map((v) => String(v).trim()).filter(Boolean)
    : undefined;
  const actor = String(formData.get("actor") || "运营人员").trim();

  try {
    await saveHypothesisComplianceAttrs({
      hypothesisId,
      complianceAttrs,
      actor,
    });
  } catch (error) {
    redirect(aiSourcingDetailPath(runId, "error", errorMessage(error)));
  }

  revalidateAISourcing(runId);
  const msg = hasComplianceField ? "已保存商品合规属性排查" : "已保存候选信息";
  redirect(`/ai-sourcing/${encodeURIComponent(runId)}?tab=${encodeURIComponent(returnTab)}&hypothesisId=${encodeURIComponent(hypothesisId)}&notice=${encodeURIComponent(msg)}#hypothesis-${encodeURIComponent(hypothesisId)}`);
}

export async function createQuickCandidateAction(formData: FormData) {
  const marketCode = String(formData.get("marketCode") || "US").trim().toUpperCase();
  const platformCode = String(formData.get("platformCode") || "amazon").trim().toLowerCase();
  const category = String(formData.get("category") || "跨境候选").trim();
  const concept = String(formData.get("concept") || "").trim();
  const sourceKindRaw = String(formData.get("sourceKind") || "manual_idea");
  const sourceKind =
    sourceKindRaw === "asin_scan" || sourceKindRaw === "quick_calc" ? sourceKindRaw : "manual_idea";
  const comparisonReportId = String(formData.get("comparisonReportId") || "").trim() || null;
  const costSheetId = String(formData.get("costSheetId") || "").trim() || null;
  const recommendedPriceRaw = numberOrNull(formData.get("recommendedPrice"));
  const recommendedPriceCents =
    recommendedPriceRaw && recommendedPriceRaw > 0 ? Math.round(recommendedPriceRaw * 100) : null;
  const complianceAttrs = formData.getAll("complianceAttr").map((v) => String(v).trim()).filter(Boolean);
  const eliminationReason = String(formData.get("eliminationReason") || "").trim() || null;
  const eliminationNote = String(formData.get("eliminationNote") || "").trim() || null;
  const actor = String(formData.get("actor") || "选品负责人").trim();

  let created: { runId: string; hypothesisId: string };
  try {
    let reportReferencePriceCents: number | null = null;
    if (comparisonReportId) {
      const report = await getComparisonReportById(comparisonReportId);
      if (!report) throw new Error("未找到对应的竞品研报");
      if (report.reviewStatus !== "confirmed") throw new Error("研报尚未人工确认，不能建立正式候选");
      reportReferencePriceCents = report.priceStats.p50 > 0 ? Math.round(report.priceStats.p50) : null;
    }
    created = await createQuickCandidateBatch({
      marketCode,
      platformCode,
      category,
      concept: concept || `${category} 候选方向`,
      sourceKind,
      searchKeyword: String(formData.get("searchKeyword") || concept).trim(),
      recommendedPriceCents: recommendedPriceCents ?? reportReferencePriceCents,
      complianceAttrs,
      comparisonReportId,
      costSheetId,
      eliminationReason,
      eliminationNote,
      actor,
    });
    if (comparisonReportId) {
      await attachComparisonReportToHypothesis({
        hypothesisId: created.hypothesisId,
        reportId: comparisonReportId,
        actor,
      });
    }
  } catch (error) {
    redirect(`/discover?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}&error=${encodeURIComponent(errorMessage(error))}`);
  }

  const targetTabRaw = String(formData.get("targetTab") || "hypotheses").trim();
  const targetTab =
    targetTabRaw === "profit" || targetTabRaw === "suppliers" || targetTabRaw === "decision"
      ? targetTabRaw
      : "hypotheses";

  revalidateAISourcing(created.runId);
  revalidatePath("/discover");
  if (eliminationReason) {
    redirect(`/ai-sourcing?notice=${encodeURIComponent(`已将「${concept || category}」记入淘汰避坑清单（原因：${eliminationReason}）`)}`);
  }
  redirect(`/ai-sourcing/${encodeURIComponent(created.runId)}?tab=${encodeURIComponent(targetTab)}&hypothesisId=${encodeURIComponent(created.hypothesisId)}&notice=${encodeURIComponent("已纳入统一选品工作台，按 4 步推进验证")}#hypothesis-${encodeURIComponent(created.hypothesisId)}`);
}

export async function saveFunnelThresholdsAction(formData: FormData) {
  const returnPath = safeReturnPath(formData.get("returnPath") || "/ai-sourcing");
  try {
    const saved = await saveFunnelThresholds({
      minCompetitorsForPass: numberOrNull(formData.get("minCompetitorsForPass")) ?? undefined,
      maxHhi: numberOrNull(formData.get("maxHhi")) ?? undefined,
      maxBrandCr3Percent: numberOrNull(formData.get("maxBrandCr3Percent")) ?? undefined,
      maxMedianReviews: numberOrNull(formData.get("maxMedianReviews")) ?? undefined,
      minMarginRate: (() => {
        const pct = numberOrNull(formData.get("minMarginPct"));
        return pct ? pct / 100 : undefined;
      })(),
      maxComplianceCostUsd: numberOrNull(formData.get("maxComplianceCostUsd")) ?? undefined,
    });
    const [{ resolvePersistedSiteScope }, { upsertPlatformConfig }] = await Promise.all([
      import("@/lib/site-scope"),
      import("@/lib/auto-pipeline/repository"),
    ]);
    const scope = await resolvePersistedSiteScope();
    await upsertPlatformConfig({
      platformCode: scope.platformCode,
      marketCode: scope.marketCode,
      economicsDefaults: { targetMarginRate: saved.minMarginRate },
      thresholds: {
        minCompetitorsForPass: saved.minCompetitorsForPass,
        maxHhi: saved.maxHhi,
        maxBrandCr3Percent: saved.maxBrandCr3Percent,
        maxMedianReviews: saved.maxMedianReviews,
        minMarginRate: saved.minMarginRate,
        maxComplianceCostUsd: saved.maxComplianceCostUsd,
      },
    }).catch(() => {});
  } catch (error) {
    redirect(withQuery(returnPath, "error", errorMessage(error)));
  }
  revalidatePath("/ai-sourcing");
  revalidatePath("/auto-pipeline");
  redirect(withQuery(returnPath, "notice", "已更新统一选品红灯阈值，并同步至选品初筛"));
}


export async function saveSourcingConstraintsAction(input: SourcingConstraints) {
  await saveSourcingConstraints(input, "选品负责人");
  revalidatePath("/discover");
  return { ok: true };
}

