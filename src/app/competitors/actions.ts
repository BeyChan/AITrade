"use server";

import { revalidatePath } from "next/cache";
import { analyzeCompetitors } from "@/lib/competitor-compare/engine";
import {
  deleteComparisonReport,
  getComparisonReportById,
  saveComparisonReport,
} from "@/lib/competitor-compare/storage";
import { createAISourcingBatch } from "@/lib/ai-sourcing-repository";
import { generateAntiListingContent, type AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import { generateSupplierRfqFromCompetitors, type SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";
import { createListingDraft, listCasesForSite } from "@/lib/repository";
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

export async function convertReportToHypothesisAction(reportId: string) {
  try {
    const report = await getComparisonReportById(reportId);
    if (!report) {
      return { success: false, error: "未找到对应的竞品对比报告" };
    }

    const bridge = report.hypothesisBridge;
    const category = bridge?.category || report.title || "家居个护";
    const brief = [
      `【竞品对标改良品】${bridge?.concept || report.title}`,
      `核心痛点：${bridge?.painPoint || report.summary.commonWeaknesses.join("；")}`,
      `差异化切入：${bridge?.differentiator || report.summary.attackVector}`,
      `对标竞品数：${report.competitors.length} 款，价格带 P50：${((report.priceStats.p50 || 2999) / 100).toFixed(2)} ${report.currency}`,
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
  antiListing: AntiListingResult,
  brand?: string,
): Promise<{ success: boolean; caseId?: string; version?: number; error?: string }> {
  try {
    const bullets = antiListing.bullets.map((b) => `${b.headline} ${b.content}`);
    const description = antiListing.aplusModules && antiListing.aplusModules.length > 0
      ? antiListing.aplusModules.map((m) => `### ${m.title}\n${m.description}`).join("\n\n")
      : antiListing.antiTitle;

    const result = await createListingDraft(
      caseId,
      {
        brand: brand || "Brand",
        title: antiListing.antiTitle,
        bullets,
        description,
        searchTerms: "",
      },
      "竞品对比工作台",
    );

    revalidatePath(`/cases/${caseId}/content`);
    return { success: true, caseId, version: result.version };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "写入商品 Listing 失败",
    };
  }
}
