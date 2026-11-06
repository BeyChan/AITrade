"use server";

import { revalidatePath } from "next/cache";
import { analyzeCompetitors } from "@/lib/competitor-compare/engine";
import {
  deleteComparisonReport,
  getComparisonReportById,
  saveComparisonReport,
} from "@/lib/competitor-compare/storage";
import { createAISourcingBatch } from "@/lib/ai-sourcing-repository";
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
