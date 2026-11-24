"use server";

import iconv from "iconv-lite";
import { revalidatePath } from "next/cache";
import { recordAuditLog } from "@/lib/audit-logs";
import { analyzeCompetitors, reanalyzeExistingReport } from "@/lib/competitor-compare/engine";
import {
  confirmComparisonReport,
  deleteComparisonReport,
  getComparisonReportById,
  saveComparisonReport,
} from "@/lib/competitor-compare/storage";
import {
  attachComparisonReportToHypothesis,
  createQuickCandidateBatch,
} from "@/lib/ai-sourcing-repository";
import { countVerifyPlaceholders, generateAntiListingContent, type AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import { generateSupplierRfqFromCompetitors, type SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";
import { createListingDraft, getContentDetail, listCasesForSite, listSupplierDirectory } from "@/lib/repository";
import { getDb } from "@/lib/db";
import { generateStructuredJSON } from "@/lib/ai-provider";
import { loadAIProviderConfig } from "@/lib/app-settings";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import { convertRmbToForeignCents, getFxRate } from "@/lib/currency";
import type { ListingDraftContent } from "@/lib/listing";
import type { CompetitorAIConclusion, CompetitorComparisonReport } from "@/lib/competitor-compare/types";

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
    await recordAuditLog({
      actor: "竞品操盘手",
      action: "competitor.report_created",
      entityType: "competitor_report",
      entityId: report.id,
      details: { title: report.title, marketplace: marketCode, count: report.competitors.length },
    }).catch(() => {});
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
    // 同步清理已删除研报在 1688 扩展回补列表中的残留目标
    const db = await getDb();
    await db.query(`DELETE FROM competitor_sourcing_targets WHERE report_id = $1`, [reportId]).catch(() => {});
    await recordAuditLog({
      actor: "竞品操盘手",
      action: "competitor.report_deleted",
      entityType: "competitor_report",
      entityId: reportId,
    }).catch(() => {});
    revalidatePath("/competitors");
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "删除失败" };
  }
}

/** 手工录入、修改或清空（传 null）某款竞品的 1688 进价 (RMB) 并持久化到研报 */
export async function saveCompetitorManualCostAction(
  reportId: string,
  asin: string,
  actualCny: number | null,
): Promise<AnalysisActionResult> {
  if (!reportId || !asin) return { success: false, error: "缺少研报 ID 或 ASIN" };
  if (actualCny !== null && (!Number.isFinite(actualCny) || actualCny <= 0)) {
    return { success: false, error: "请输入大于 0 的人民币进价" };
  }
  try {
    const existing = await getComparisonReportById(reportId);
    if (!existing) return { success: false, error: "未找到对应的竞品研报" };

    const targetAsin = asin.trim().toUpperCase();
    let matched = false;
    const updatedCompetitors = existing.competitors.map((c) => {
      if ((c.asin || "").toUpperCase() !== targetAsin) return c;
      matched = true;
      if (actualCny === null) {
        const { sourcingCost: _removed, ...rest } = c;
        return rest;
      }
      const rounded = Number(actualCny.toFixed(2));
      return {
        ...c,
        sourcingCost: {
          actualCny: rounded,
          minCny: rounded,
          maxCny: rounded,
          sampleCount: 1,
          bestSupplierName: "手工录入",
          updatedAt: new Date().toISOString(),
        },
      };
    });
    if (!matched) return { success: false, error: `研报中未找到竞品 ${targetAsin}` };

    const updated: CompetitorComparisonReport = {
      ...existing,
      competitors: updatedCompetitors,
    };
    await saveComparisonReport(updated);
    if (actualCny !== null) {
      const db = await getDb();
      await db.query(
        `DELETE FROM competitor_sourcing_targets WHERE id = $1`,
        [`${reportId}:${targetAsin}`],
      ).catch(() => {});
    }
    revalidatePath("/competitors");
    return { success: true, report: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "保存单品进价失败",
    };
  }
}

/** 手工录入、修改或清空（传 null / 0）某款竞品的买家另付单独运费（外币金额，如 9.99 AUD）并持久化 */
export async function saveCompetitorItemShippingAction(
  reportId: string,
  asin: string,
  shippingAmount: number | null,
): Promise<AnalysisActionResult> {
  if (!reportId || !asin) return { success: false, error: "缺少研报 ID 或 ASIN" };
  if (shippingAmount !== null && (!Number.isFinite(shippingAmount) || shippingAmount < 0)) {
    return { success: false, error: "请输入不小于 0 的运费金额" };
  }
  try {
    const existing = await getComparisonReportById(reportId);
    if (!existing) return { success: false, error: "未找到对应的竞品研报" };

    const targetAsin = asin.trim().toUpperCase();
    const shippingCents = shippingAmount && shippingAmount > 0 ? Math.round(shippingAmount * 100) : 0;
    let matched = false;
    const updatedCompetitors = existing.competitors.map((c) => {
      if ((c.asin || "").toUpperCase() !== targetAsin) return c;
      matched = true;
      if (shippingCents <= 0) {
        const { shippingCents: _removed, ...rest } = c;
        return rest;
      }
      return {
        ...c,
        shippingCents,
      };
    });
    if (!matched) return { success: false, error: `研报中未找到竞品 ${targetAsin}` };

    const updated: CompetitorComparisonReport = {
      ...existing,
      competitors: updatedCompetitors,
    };
    await saveComparisonReport(updated);
    revalidatePath("/competitors");
    return { success: true, report: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "保存单品运费失败",
    };
  }
}

/** 手动触发：基于研报内所有已采集的真实数据与 1688 进价生成 AI 综合结论（默认无，必须手动点击） */
export async function generateCompetitorConclusionAction(
  reportId: string,
): Promise<AnalysisActionResult> {
  if (!reportId) return { success: false, error: "缺少研报 ID" };
  try {
    const existing = await getComparisonReportById(reportId);
    if (!existing) return { success: false, error: "未找到对应的竞品研报" };

    const config = await loadAIProviderConfig();
    if (config.provider === "template") {
      return {
        success: false,
        error: "当前未配置 AI 模型，请先前往「系统设置」配置大模型 API Key 后再点击生成 AI 结论。",
      };
    }

    const systemPrompt = `你是跨境电商资深选品总监，请基于这份竞品研报里的真实观测数据，给出一份直截了当、反亏钱导向的「综合结论与立项裁决」。
【硬性要求】
1. 只能引用输入中真实存在的售价、评分、评论数、官方月销、1688 进价、差评痛点与市场信号，严禁编造任何未给出的数值。
2. 如果缺少真实售价、缺少 1688 实采进价或缺少买家差评，必须在 keyRisks 中明确点出证据缺口，且不可盲目给 GO。
3. 语言精炼、可执行，避免空泛套话。

只输出合法 JSON：
{
  "verdict": "GO" | "HOLD" | "NO-GO",
  "headline": "一句话核心结论（20字以内）",
  "summary": "3~4 句综合判断，结合价格带、竞争壁垒、差评机会与 1688 成本空间说明理由",
  "bestCandidateAsin": "多品时最推荐切入对标的单个 ASIN（单品或无明显标的则 null）",
  "keyRisks": ["核心风险1", "核心风险2"],
  "recommendedActions": ["下一步具体动作1", "下一步具体动作2", "下一步具体动作3"]
}`;

    const aiResp = await generateStructuredJSON({
      systemPrompt,
      userPrompt: JSON.stringify({
        title: existing.title,
        marketCode: existing.marketCode,
        platformCode: existing.platformCode,
        currency: existing.currency,
        competitorCount: existing.competitors.length,
        priceStats: existing.priceStats,
        marketSignals: existing.marketSignals ?? null,
        productIndex: existing.productIndex
          ? {
              totalScore: existing.productIndex.totalScore,
              grade: existing.productIndex.grade,
              evidenceCompleteness: existing.productIndex.evidenceCompleteness,
              mathEvidence: existing.productIndex.mathEvidence,
            }
          : null,
        competitors: existing.competitors.slice(0, 15).map((c) => ({
          asin: c.asin,
          brand: c.brand,
          title: c.title.slice(0, 100),
          priceCents: c.priceCents,
          listPriceCents: c.listPriceCents ?? null,
          effectivePriceCents: c.effectivePriceCents ?? null,
          shippingCents: c.shippingCents ?? null,
          rating: c.rating,
          reviewCount: c.reviewCount,
          boughtPastMonth: c.boughtPastMonth ?? null,
          isSponsored: c.isSponsored ?? null,
          fulfillmentType: c.fulfillmentType ?? null,
          sourcingCostCny: c.sourcingCost?.actualCny ?? null,
          drawbacks: c.drawbacks.slice(0, 3),
        })),
        painPointMatrix: (existing.painPointMatrix || []).slice(0, 6),
      }),
      timeoutMs: 60_000,
      maxTokens: 4_096,
    });

    const parsed = JSON.parse(aiResp.content) as Partial<CompetitorAIConclusion>;
    const verdict: CompetitorAIConclusion["verdict"] =
      parsed.verdict === "GO" || parsed.verdict === "NO-GO" ? parsed.verdict : "HOLD";

    const conclusion: CompetitorAIConclusion = {
      verdict,
      headline: (parsed.headline || "建议补齐真实成本与差评后再决断").trim(),
      summary: (parsed.summary || "").trim(),
      bestCandidateAsin: parsed.bestCandidateAsin || null,
      keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks.filter(Boolean).slice(0, 5) : [],
      recommendedActions: Array.isArray(parsed.recommendedActions) ? parsed.recommendedActions.filter(Boolean).slice(0, 5) : [],
      generatedAt: new Date().toISOString(),
      modelUsed: aiResp.model || config.model || config.provider,
    };

    const updated: CompetitorComparisonReport = {
      ...existing,
      aiConclusion: conclusion,
    };
    await saveComparisonReport(updated);
    await recordAuditLog({
      actor: "竞品操盘手",
      action: "competitor.conclusion_generated",
      entityType: "competitor_report",
      entityId: existing.id,
      details: { verdict: conclusion.verdict, model: conclusion.modelUsed },
    }).catch(() => {});
    revalidatePath("/competitors");
    return { success: true, report: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "AI 结论生成失败",
    };
  }
}

/** 复用已采集的真实证据原地重新分析（可选剔除单条干扰竞品 ASIN） */
export async function reanalyzeCompetitorReportAction(
  reportId: string,
  excludeAsin?: string,
): Promise<AnalysisActionResult> {
  if (!reportId) return { success: false, error: "缺少研报 ID" };
  try {
    const existing = await getComparisonReportById(reportId);
    if (!existing) return { success: false, error: "未找到对应的竞品研报" };

    const updated = await reanalyzeExistingReport(existing, {
      excludeAsins: excludeAsin ? [excludeAsin] : undefined,
    });
    await saveComparisonReport(updated);
    await recordAuditLog({
      actor: "竞品操盘手",
      action: excludeAsin ? "competitor.report_item_removed_reanalyzed" : "competitor.report_reanalyzed",
      entityType: "competitor_report",
      entityId: updated.id,
      details: {
        title: updated.title,
        marketplace: updated.marketCode,
        count: updated.competitors.length,
        ...(excludeAsin ? { excludedAsin: excludeAsin } : {}),
      },
    }).catch(() => {});
    revalidatePath("/competitors");
    return { success: true, report: updated };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "重新分析失败",
    };
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
  await recordAuditLog({
    actor: actor.trim(),
    action: "competitor.report_confirmed",
    entityType: "competitor_report",
    entityId: reportId,
    details: { title: report.title, provenance: updated.provenance },
  }).catch(() => {});
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
    if (!(report.priceStats.p50 > 0)) {
      return { success: false, error: "研报缺少可用的 P50 参考售价，请补录真实价格样本" };
    }

    const result = await createQuickCandidateBatch({
      marketCode: report.marketCode,
      platformCode: report.platformCode,
      category,
      concept: bridge?.concept || report.title,
      sourceKind: "asin_scan",
      searchKeyword: bridge?.concept || report.title,
      recommendedPriceCents: Math.round(report.priceStats.p50),
      comparisonReportId: report.id,
      actor: "竞品对比",
    });
    await attachComparisonReportToHypothesis({
      hypothesisId: result.hypothesisId,
      reportId: report.id,
      actor: "竞品对比",
    });

    revalidatePath("/ai-sourcing");
    revalidatePath("/discover");
    return {
      success: true,
      runId: result.runId,
      hypothesisId: result.hypothesisId,
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

export type SupplierPickerOption = {
  id: string;
  name: string;
  platform: string;
  url: string | null;
  priceCny: number | null;
  moq: number | null;
  notes: string;
};

const COMMON_EN_TO_ZH_TERMS: Array<[RegExp, string]> = [
  [/\bsponge\s+mop\b/gi, "海绵拖把"],
  [/\bflat\s+mop\b/gi, "平板拖把"],
  [/\bspin\s+mop\b/gi, "旋转拖把"],
  [/\bspray\s+mop\b/gi, "喷水拖把"],
  [/\bmop\b/gi, "拖把"],
  [/\bpva\b/gi, "胶棉"],
  [/\bfolding|foldable\b/gi, "折叠"],
  [/\bsqueeze|wringer|self[- ]?wringing\b/gi, "免手洗挤水"],
  [/\brefill|replacement\s+head\b/gi, "替换头"],
  [/\bvacuum\s+cleaner|car\s+vacuum\b/gi, "吸尘器"],
  [/\bmassage\s+gun\b/gi, "筋膜枪"],
  [/\bwater\s+fountain\b/gi, "宠物饮水机"],
  [/\bumbrella\b/gi, "雨伞"],
  [/\bwindproof\b/gi, "防风"],
  [/\bautomatic\b/gi, "全自动"],
  [/\bcordless|wireless\b/gi, "无线"],
  [/\bportable|mini|pocket\b/gi, "便携"],
  [/\bstainless\s+steel\b/gi, "不锈钢"],
  [/\bsilicone\b/gi, "硅胶"],
  [/\bstorage|organizer\b/gi, "收纳"],
  [/\bkitchen\b/gi, "厨房"],
  [/\bbathroom\b/gi, "浴室"],
  [/\bbrush\b/gi, "清洁刷"],
  [/\bbottle\b/gi, "水杯"],
  [/\bcharger\b/gi, "充电器"],
  [/\bled\s+light|lamp\b/gi, "LED灯"],
  [/\bpet|dog|cat\b/gi, "宠物"],
];

function fallbackTranslateTo1688Zh(text: string): string {
  const hits: string[] = [];
  for (const [re, zh] of COMMON_EN_TO_ZH_TERMS) {
    if (re.test(text) && !hits.includes(zh)) {
      hits.push(zh);
    }
    if (hits.length >= 4) break;
  }
  if (hits.length > 0) return hits.join(" ");
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 4)
    .join(" ");
}

/** 1688 搜索页 (s.1688.com) 要求 GBK 百分号编码，UTF-8 编码会直接乱码 */
function encode1688GbkSearchUrl(keyword: string): string {
  const clean = keyword.trim();
  const buf = iconv.encode(clean, "gbk");
  let encoded = "";
  for (const byte of buf) {
    // 保留安全 ASCII 字母数字，其余统一转为 %XX
    if (
      (byte >= 0x30 && byte <= 0x39)
      || (byte >= 0x41 && byte <= 0x5a)
      || (byte >= 0x61 && byte <= 0x7a)
      || byte === 0x2d
      || byte === 0x5f
      || byte === 0x2e
    ) {
      encoded += String.fromCharCode(byte);
    } else if (byte === 0x20) {
      encoded += "%20";
    } else {
      encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encoded}`;
}

/** 将英文 Amazon 商品标题翻译为适合 1688 搜索同款源头工厂的精炼中文关键词，并返回 GBK 编码的无乱码搜索链接 */
export async function translateTo1688KeywordAction(
  title: string,
  fallbackKeyword?: string,
): Promise<{ keyword: string; searchUrl: string; translated: boolean }> {
  const raw = (title || "").trim();
  const genericFallback = /^(跨境源头工厂|外贸现货批发|跨境现货批发)$/;
  if (fallbackKeyword && !genericFallback.test(fallbackKeyword.trim())) {
    const cleaned = fallbackKeyword.replace(/(源头工厂|外贸批发|工厂)$/g, "").trim();
    // 必须去掉「源头工厂/工厂」后缀后仍然包含中文，才算有效中文采购词，避免把 "Folding Sponge Mop 源头工厂" 误判为已翻译！
    if (cleaned && /[\u4e00-\u9fa5]{2,}/.test(cleaned)) {
      return { keyword: cleaned, searchUrl: encode1688GbkSearchUrl(cleaned), translated: true };
    }
  }
  if (/[\u4e00-\u9fa5]{2,}/.test(raw)) {
    const kw = raw.slice(0, 20);
    return { keyword: kw, searchUrl: encode1688GbkSearchUrl(kw), translated: true };
  }

  try {
    const config = await loadAIProviderConfig();
    if (config.provider !== "template" && raw) {
      const res = await generateStructuredJSON({
        systemPrompt: `你是 1688 跨境采购选品专家。将英文亚马逊商品标题翻译为最适合在 1688 搜同款工厂的精炼中文关键词（6~14个汉字，保留核心品类词+关键结构/材质词，去掉品牌名、数量词与英文废话）。只输出 JSON：{"keyword":"中文搜索词"}`,
        userPrompt: raw,
        timeoutMs: 12_000,
        maxTokens: 120,
      });
      const parsed = JSON.parse(res.content) as { keyword?: string };
      if (parsed.keyword && /[\u4e00-\u9fa5]/.test(parsed.keyword)) {
        const kw = parsed.keyword.trim().slice(0, 24);
        return { keyword: kw, searchUrl: encode1688GbkSearchUrl(kw), translated: true };
      }
    }
  } catch {
    // 回退本地词典翻译
  }

  const localZh = fallbackTranslateTo1688Zh(raw);
  const finalKw = localZh || raw.slice(0, 30);
  return {
    keyword: finalKw,
    searchUrl: encode1688GbkSearchUrl(finalKw),
    translated: /[\u4e00-\u9fa5]/.test(localZh),
  };
}

/** 从 1688 工厂库拉取可用工厂与参考人民币单价，供竞品研报核算面板一键回填 */
export async function getSupplierQuotesForPickerAction(): Promise<SupplierPickerOption[]> {
  try {
    const { suppliers } = await listSupplierDirectory();
    const db = await getDb();
    const quoteRes = await db.query<{
      supplier_id: string;
      unit_price_cents: number;
      currency: string;
      moq: number | null;
      raw_payload: Record<string, unknown> | null;
    }>(
      `SELECT r.supplier_id, q.unit_price_cents, q.currency, q.moq, q.raw_payload
       FROM quotes q
       JOIN rfqs r ON r.id = q.rfq_id
       WHERE r.supplier_id IS NOT NULL
       ORDER BY q.created_at DESC`,
    );

    const latestBySupplier = new Map<string, { priceCny: number | null; moq: number | null }>();
    for (const row of quoteRes.rows) {
      if (latestBySupplier.has(row.supplier_id)) continue;
      const rawCny = Number(row.raw_payload?.priceCny);
      const fx = Number(row.raw_payload?.fxRate) || 7.25;
      let priceCny: number | null = null;
      if (Number.isFinite(rawCny) && rawCny > 0) {
        priceCny = Number(rawCny.toFixed(2));
      } else if (row.unit_price_cents > 0) {
        priceCny = row.currency === "CNY"
          ? Number((row.unit_price_cents / 100).toFixed(2))
          : Number(((row.unit_price_cents / 100) * fx).toFixed(2));
      }
      latestBySupplier.set(row.supplier_id, {
        priceCny,
        moq: row.moq && row.moq > 0 ? row.moq : null,
      });
    }

    return suppliers.slice(0, 30).map((s) => {
      const profile = (s as unknown as { profile?: Record<string, unknown> }).profile;
      const profileCny = Number(profile?.priceCny);
      const profileMoq = Number(profile?.moq);
      const fromQuote = latestBySupplier.get(s.id);
      const noteMatch = (s.notes || "").match(/¥\s*(\d+(?:\.\d{1,2})?)/);
      const fromNote = noteMatch ? Number(noteMatch[1]) : null;
      const priceCny = (Number.isFinite(profileCny) && profileCny > 0 ? profileCny : null)
        ?? fromQuote?.priceCny
        ?? (fromNote && Number.isFinite(fromNote) ? fromNote : null);
      const moq = (Number.isFinite(profileMoq) && profileMoq > 0 ? Math.round(profileMoq) : null)
        ?? fromQuote?.moq
        ?? null;
      return {
        id: s.id,
        name: s.name,
        platform: s.platform || "1688",
        url: s.url || null,
        priceCny,
        moq,
        notes: (s.notes || "").slice(0, 80),
      };
    });
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

    await recordAuditLog({
      actor: actor.trim() || "竞品对比工作台",
      action: "competitor.anti_listing_applied",
      entityType: "product_case",
      entityId: caseId,
      details: { reportId, version: result.version, placeholders },
    }).catch(() => {});

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
