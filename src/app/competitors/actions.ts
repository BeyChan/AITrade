"use server";

import { revalidatePath } from "next/cache";
import { analyzeCompetitors } from "@/lib/competitor-compare/engine";
import {
  confirmComparisonReport,
  deleteComparisonReport,
  getComparisonReportById,
  markComparisonReportPromoted,
  saveComparisonReport,
} from "@/lib/competitor-compare/storage";
import { createAISourcingBatch } from "@/lib/ai-sourcing-repository";
import { countVerifyPlaceholders, generateAntiListingContent, type AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import { generateSupplierRfqFromCompetitors, type SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";
import { createListingDraft, createProductCaseFromCompetitors, getContentDetail, listCasesForSite } from "@/lib/repository";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import { convertRmbToForeignCents, getFxRate } from "@/lib/currency";
import type { ListingDraftContent } from "@/lib/listing";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";

export type AnalysisActionResult = {
  success: boolean;
  report?: CompetitorComparisonReport;
  error?: string;
};

export async function runCompetitorAnalysisAction(
  formData: FormData,
): Promise<AnalysisActionResult> {
  const rawInputs = String(formData.get("rawInputs") || "").trim();
  const marketCode = String(formData.get("marketCode") || "US").trim().toUpperCase();
  const platformCode = String(formData.get("platformCode") || "amazon").trim().toLowerCase();
  const currency = String(formData.get("currency") || "USD").trim().toUpperCase();

  if (!rawInputs) {
    return { success: false, error: "请输入至少一个竞品链接、ASIN 或商品标题" };
  }

  try {
    const report = await analyzeCompetitors({
      rawInputs,
      marketCode,
      platformCode,
      currency,
    });

    await saveComparisonReport(report);
    revalidatePath("/competitors");
    return { success: true, report };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "竞品分析过程中发生未知错误",
    };
  }
}

export async function deleteComparisonReportAction(reportId: string) {
  if (!reportId) return { success: false };
  try {
    await deleteComparisonReport(reportId);
    revalidatePath("/competitors");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "删除失败" };
  }
}

/** 显式人审：确认后才允许把研报转入选品池或写入商品草稿 */
export async function confirmComparisonReportAction(
  reportId: string,
  actor: string,
): Promise<{ success: boolean; error?: string; provenance?: string }> {
  if (!actor.trim()) return { success: false, error: "请填写核对人" };
  const report = await getComparisonReportById(reportId);
  if (!report) return { success: false, error: "未找到对应的竞品对比报告" };
  const updated = await confirmComparisonReport(reportId);
  if (!updated) return { success: false, error: "确认失败，请刷新后重试" };
  revalidatePath("/competitors");
  return { success: true, provenance: updated.provenance };
}

export async function convertReportToHypothesisAction(reportId: string) {
  try {
    const report = await getComparisonReportById(reportId);
    if (!report) {
      return { success: false, error: "未找到对应的竞品对比报告" };
    }
    if (report.reviewStatus !== "confirmed") {
      return { success: false, error: "请先在研报中点击「我已核对，确认可用」，再转入选品池" };
    }

    const bridge = report.hypothesisBridge;
    const category = bridge?.category || report.title || "家居个护";
    const brief = [
      `【竞品对标改良品】${bridge?.concept || report.title}`,
      `核心痛点：${bridge?.painPoint || report.summary.commonWeaknesses.join("；")}`,
      `差异化切入：${bridge?.differentiator || report.summary.attackVector}`,
      `对标竞品数：${report.competitors.length} 款，价格带 P50：${((report.priceStats.p50 || 2999) / 100).toFixed(2)} ${report.currency}`,
      `来源：${report.provenance}；已由人工核对。其中 AI / 模板推断的价格、评分与评论数仍属待核实字段，需在选品验证中补录真实证据。`,
      `价格分位真实样本：${report.priceStats.verifiedSampleCount} 条（其余为示意值，不作为定价依据）`,
    ].join("\n");

    const result = await createAISourcingBatch({
      marketCode: report.marketCode,
      platformCode: report.platformCode,
      category,
      brief,
      actor: "竞品对比",
    });

    revalidatePath("/ai-sourcing");
    return {
      success: true,
      batchId: result.runId,
      marketCode: report.marketCode,
      platformCode: report.platformCode,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "转入选品池失败",
    };
  }
}

export async function generateAntiListingAction(
  reportId: string,
): Promise<{ success: boolean; data?: AntiListingResult; error?: string }> {
  try {
    const report = await getComparisonReportById(reportId);
    if (!report) {
      return { success: false, error: "未找到对应的竞品对比报告" };
    }

    const content = await generateAntiListingContent(report);
    return { success: true, data: content };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "生成反制 Listing 文案失败",
    };
  }
}

export async function generateSupplierRfqAction(
  reportId: string,
): Promise<{ success: boolean; data?: SupplierRfqDraft; error?: string }> {
  try {
    const report = await getComparisonReportById(reportId);
    if (!report) {
      return { success: false, error: "未找到对应的竞品对比报告" };
    }

    const rfq = await generateSupplierRfqFromCompetitors(report);
    return { success: true, data: rfq };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "生成 1688 RFQ 询价单失败",
    };
  }
}

export async function getAvailableCasesAction(
  marketCode: string,
  platformCode: string,
): Promise<Array<{ id: string; title: string; asin: string; status: string }>> {
  try {
    const cases = await listCasesForSite(marketCode, platformCode);
    return cases.map((c) => ({
      id: c.id,
      title: c.title,
      asin: c.asin,
      status: c.status,
    }));
  } catch {
    return [];
  }
}

export async function applyAntiListingToCaseAction(
  caseId: string,
  reportId: string,
  antiListing: AntiListingResult,
  actor: string,
): Promise<{
  success: boolean;
  caseId?: string;
  version?: number;
  findings?: Array<{ severity: string; message: string }>;
  error?: string;
}> {
  try {
    const report = await getComparisonReportById(reportId);
    if (!report) return { success: false, error: "未找到对应的竞品对比报告" };
    if (report.reviewStatus !== "confirmed") {
      return { success: false, error: "请先在研报中点击「我已核对，确认可用」，再写入商品草稿" };
    }

    const detail = await getContentDetail(caseId);
    if (!detail) return { success: false, error: "目标商品不存在" };
    // 只覆盖标题、五点与描述；品牌与搜索词沿用现有草稿，避免被空值洗掉
    const existing = (detail.listing?.content ?? {}) as Partial<ListingDraftContent>;
    const bullets = antiListing.bullets.map((b) => `${b.headline} ${b.content}`);
    const description = antiListing.aplusModules && antiListing.aplusModules.length > 0
      ? antiListing.aplusModules.map((m) => `### ${m.title}\n${m.description}`).join("\n\n")
      : antiListing.antiTitle;

    const result = await createListingDraft(
      caseId,
      {
        brand: String(existing.brand ?? "").trim(),
        title: antiListing.antiTitle,
        bullets,
        description,
        searchTerms: String(existing.searchTerms ?? "").trim(),
      },
      actor.trim() || "竞品对比工作台",
    );

    const placeholders = countVerifyPlaceholders(antiListing);
    const draftWarnings: Array<{ severity: string; message: string }> = placeholders > 0
      ? [{
          severity: "warning",
          message: `本次写入含 ${placeholders} 处 [VERIFY: …] 待核实占位，属于内部草稿；请按打样实测与检测报告填实后再发布，不得直接上架。`,
        }]
      : [];

    revalidatePath(`/cases/${caseId}/content`);
    return {
      success: true,
      caseId,
      version: result.version,
      findings: [
        ...draftWarnings,
        ...(result.preflight?.findings ?? []).map((f) => ({
          severity: f.severity,
          message: f.message,
        })),
      ],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "写入商品 Listing 失败",
    };
  }
}

export async function promoteCompetitorReportToCaseAction(params: {
  reportId: string;
  quoteCostRmb: number;
  targetPriceCents: number;
  antiListing?: AntiListingResult | null;
  rfqDraft?: SupplierRfqDraft | null;
  actor?: string;
}): Promise<{ success: boolean; caseId?: string; error?: string }> {
  try {
    const report = await getComparisonReportById(params.reportId);
    if (!report) {
      return { success: false, error: "未找到对应的竞品对比报告" };
    }

    // 幂等防重门禁：若该研报此前已经正式立项过，直接返回已有 caseId，绝不重复生成多条案卷
    if (report.promotedCaseId) {
      return {
        success: true,
        caseId: report.promotedCaseId,
      };
    }

    // 严谨立项门禁 1：研报必须经过人工复核确认
    if (report.reviewStatus !== "confirmed") {
      return {
        success: false,
        error: "竞品研报尚未人工核对确认！请在研报顶部核实竞品价格真实性，并点击「我已核对，确认可用」后再立项。",
      };
    }

    // 严谨立项门禁 2：研报必须有至少 1 款以上真实竞品
    if (!report.competitors || report.competitors.length === 0) {
      return {
        success: false,
        error: "研报中缺少竞品对比数据，无法建立正式商品案卷！",
      };
    }

    const currency = report.currency || "USD";
    const purchaseCostCents = convertRmbToForeignCents(params.quoteCostRmb, currency);
    const estFreightCents = Math.round(purchaseCostCents * 0.25);
    const landedCostCents = purchaseCostCents + estFreightCents;

    const defaults = platformEconomicDefaults(report.platformCode, params.targetPriceCents);
    const assumptions = {
      currency,
      salePriceCents: params.targetPriceCents,
      landedCostCents,
      ...defaults,
    };

    const monthlySales = Math.round(
      report.competitors.reduce((acc, c) => acc + (c.monthlySalesEst || 300), 0) /
        Math.max(1, report.competitors.length),
    );
    const medianReview = Math.round(
      report.competitors.reduce((acc, c) => acc + (c.reviewCount || 100), 0) /
        Math.max(1, report.competitors.length),
    );
    const medianRating =
      report.competitors.reduce((acc, c) => acc + (c.rating || 4.2), 0) /
      Math.max(1, report.competitors.length);

    const competitorAsins = report.competitors.map((c) => c.asin).filter(Boolean);

    const result = await createProductCaseFromCompetitors(
      {
        title: report.hypothesisBridge?.concept || report.title,
        category: report.hypothesisBridge?.category || report.title,
        marketplace: report.marketCode,
        platform: report.platformCode,
        currency,
        competitorPriceCents: params.targetPriceCents,
        monthlySalesEstimate: monthlySales,
        reviewCount: medianReview,
        rating: medianRating,
        notes: `由竞品对比报告 ${report.title} 直接立项。1688 询价底价 ¥${params.quoteCostRmb}，测算到岸成本 ${(landedCostCents / 100).toFixed(2)} ${currency}。`,
        assumptions,
        antiListing: params.antiListing,
        rfqDraft: params.rfqDraft,
        competitorAsins,
        reportId: report.id,
      },
      params.actor || "竞品操盘手",
    );

    // 回写研报状态，实现已立项闭环与幂等绑定
    await markComparisonReportPromoted(report.id, result.caseId);

    revalidatePath("/");
    revalidatePath("/cases");
    revalidatePath("/competitors");
    return { success: true, caseId: result.caseId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "正式立项失败",
    };
  }
}
