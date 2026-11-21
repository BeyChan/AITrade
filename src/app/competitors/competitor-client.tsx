"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  isVerifiedCompetitorField,
  MAX_COMPARISON_REPORTS,
  type CompetitorComparisonReport,
  type CompetitorProvenance,
  type CompetitorProfile,
} from "@/lib/competitor-compare/types";
import type { AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import type { SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";
import { calculateProductIndex } from "@/lib/competitor-compare/competitiveness";
import { shortDate } from "@/lib/format";
import { CompetitorQuadrantChart } from "@/components/competitor-quadrant-chart";
import { calculateEconomics, type EconomicsAssumptions } from "@/lib/economics";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import { convertRmbToForeignCents, OFFICIAL_FX_CONFIG } from "@/lib/currency";
import {
  applyAntiListingToCaseAction,
  confirmComparisonReportAction,
  convertReportToHypothesisAction,
  deleteComparisonReportAction,
  generateAntiListingAction,
  generateCompetitorConclusionAction,
  generateSupplierRfqAction,
  getAvailableCasesAction,
  promoteCompetitorReportToCaseAction,
  reanalyzeCompetitorReportAction,
  runCompetitorAnalysisAction,
  saveCompetitorItemShippingAction,
  saveCompetitorManualCostAction,
  translateTo1688KeywordAction,
} from "./actions";

type Props = {
  initialReports: CompetitorComparisonReport[];
  initialReportId?: string;
  currentMarket: string;
  currentPlatform: string;
};

const PROVENANCE_LABELS: Record<CompetitorProvenance, string> = {
  captured: "浏览器采集",
  manual: "人工录入",
  ai_generated: "AI 推断",
  template: "本地模板",
  demo: "演示示例",
  unknown: "来源未知",
};

const PROVENANCE_VERIFIED: CompetitorProvenance[] = ["captured", "manual"];

/** 客户端安全：只做字符串统计，不引入服务端专用的文案生成模块 */
function countDraftPlaceholders(result: AntiListingResult | null): number {
  if (!result) return 0;
  const texts = [
    result.antiTitle,
    ...result.bullets.flatMap((b) => [b.headline, b.content, b.counterTarget]),
    ...(result.aplusModules ?? []).flatMap((m) => [m.title, m.description, m.visualSuggestion]),
  ];
  return texts.reduce((sum, text) => sum + (text.split("[VERIFY:").length - 1), 0);
}

/** 计算买家真实总支付额（券后价 + 买家另付单独运费；亚马逊佣金与卖家毛收入均按总支付额核算） */
function getBuyerTotalPriceCents(item: Pick<CompetitorProfile, "priceCents" | "effectivePriceCents" | "shippingCents">): number {
  const base =
    item.effectivePriceCents && item.effectivePriceCents > 0 && item.effectivePriceCents < item.priceCents
      ? item.effectivePriceCents
      : item.priceCents;
  if (!base || base <= 0) return 0;
  return base + (item.shippingCents && item.shippingCents > 0 ? item.shippingCents : 0);
}

/** 基于权威财务内核 calculateEconomics，按 18% 净利率硬门禁倒推该单品的 1688 采购上限 (RMB) */
function estimateMaxPurchaseRmb(
  salePriceCents: number,
  currency: string,
  platformCode: string,
  targetMargin = 0.18,
): number {
  if (!salePriceCents || salePriceCents <= 0) return 0;
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const checkMargin = (rmb: number) => {
    const purchaseCents = convertRmbToForeignCents(rmb, currency);
    const landedCostCents = Math.round(purchaseCents * 1.25);
    return calculateEconomics({
      currency,
      salePriceCents,
      landedCostCents,
      ...defaults,
    }).marginRate;
  };
  if (checkMargin(0.5) < targetMargin) return 0;
  let lo = 0;
  let hi = 2000;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (checkMargin(mid) >= targetMargin) lo = mid;
    else hi = mid;
  }
  return Math.max(0, Math.round(lo * 10) / 10);
}

/** 计算单品在指定拿货价 (RMB) 下的毛利率与单件净利润（外币 + 人民币） */
function calcItemProfitEstimate(
  salePriceCents: number,
  purchaseRmb: number,
  currency: string,
  platformCode: string,
): { marginPct: number; netProfitCents: number; netProfitRmb: number } {
  if (!salePriceCents || salePriceCents <= 0 || !purchaseRmb || purchaseRmb <= 0) {
    return { marginPct: 0, netProfitCents: 0, netProfitRmb: 0 };
  }
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const purchaseCents = convertRmbToForeignCents(purchaseRmb, currency);
  const landedCostCents = Math.round(purchaseCents * 1.25);
  const econ = calculateEconomics({
    currency,
    salePriceCents,
    landedCostCents,
    ...defaults,
  });
  const fxRate = (OFFICIAL_FX_CONFIG[currency] || OFFICIAL_FX_CONFIG.USD).rateToRmb;
  return {
    marginPct: Number((econ.marginRate * 100).toFixed(1)),
    netProfitCents: econ.netProfitCents,
    netProfitRmb: Number(((econ.netProfitCents / 100) * fxRate).toFixed(1)),
  };
}

/** 计算单品在指定 1688 实采进价 (RMB) 下的真实净利率 */
function calcItemRealMarginPct(
  salePriceCents: number,
  actualCny: number,
  currency: string,
  platformCode: string,
): number {
  if (!salePriceCents || salePriceCents <= 0 || !actualCny || actualCny <= 0) return 0;
  const defaults = platformEconomicDefaults(platformCode || "amazon", salePriceCents);
  const purchaseCents = convertRmbToForeignCents(actualCny, currency);
  const landedCostCents = Math.round(purchaseCents * 1.25);
  const econ = calculateEconomics({
    currency,
    salePriceCents,
    landedCostCents,
    ...defaults,
  });
  return Number((econ.marginRate * 100).toFixed(1));
}

const SAMPLE_PRESETS = [
  {
    name: "车载吸尘器三强横向对比",
    inputs: `https://www.amazon.com/dp/B08CZ8K652 (Fanttik V8 Apex 19000Pa High Power)
https://www.amazon.com/dp/B09M87J11L (Baseus A2 Pro Car Vacuum 6000Pa)
https://www.amazon.com/dp/B0875X3V95 (Anker eufy HomeVac H11 Cordless Pure)`,
  },
  {
    name: "口袋便携筋膜枪对标",
    inputs: `https://www.amazon.com/dp/B0B5D982K7 (TheraGun Mini 2.0 Ultra-Portable)
https://www.amazon.com/dp/B09V7N86G5 (Renpho Active Pocket Massage Gun)`,
  },
];

export function CompetitorClient({ initialReports, initialReportId, currentMarket, currentPlatform }: Props) {
  const [reports, setReports] = useState<CompetitorComparisonReport[]>(initialReports);
  const siteReports = reports.filter((report) =>
    report.marketCode.toUpperCase() === currentMarket.toUpperCase()
    && report.platformCode.toLowerCase() === currentPlatform.toLowerCase(),
  );
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    initialReportId || siteReports[0]?.id || null,
  );

  const [rawInputs, setRawInputs] = useState("");
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [convertBatchId, setConvertBatchId] = useState<string | null>(null);
  const [showIndexHelp, setShowIndexHelp] = useState(false);
  const [antiListing, setAntiListing] = useState<AntiListingResult | null>(null);
  const [isGeneratingListing, setIsGeneratingListing] = useState(false);
  const [bulletsCopied, setBulletsCopied] = useState(false);
  const [rfqData, setRfqData] = useState<SupplierRfqDraft | null>(null);
  const [isGeneratingRfq, setIsGeneratingRfq] = useState(false);
  const [rfqCopied, setRfqCopied] = useState(false);
  const [availableCases, setAvailableCases] = useState<Array<{ id: string; title: string; asin: string; status: string }>>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [isApplyingCase, setIsApplyingCase] = useState(false);
  const [appliedSuccessCaseId, setAppliedSuccessCaseId] = useState<string | null>(null);
  const [applyFindings, setApplyFindings] = useState<Array<{ severity: string; message: string }>>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [quoteCostRmb, setQuoteCostRmb] = useState<number>(25);
  const [costSource, setCostSource] = useState<"estimated" | "manual" | "captured_1688">("estimated");
  const [targetPriceVal, setTargetPriceVal] = useState<number>(39.99);
  const [benchmarkAsin, setBenchmarkAsin] = useState<string | null>(null);
  const [isReanalyzing, setIsReanalyzing] = useState(false);
  const [removingAsin, setRemovingAsin] = useState<string | null>(null);
  const [translatingKey, setTranslatingKey] = useState<string | null>(null);
  const [translatedKwMap, setTranslatedKwMap] = useState<Record<string, { keyword: string; searchUrl: string }>>({});
  const [editingCostAsin, setEditingCostAsin] = useState<string | null>(null);
  const [editingCostVal, setEditingCostVal] = useState<string>("");
  const [isSavingItemCost, setIsSavingItemCost] = useState(false);
  const [editingShippingAsin, setEditingShippingAsin] = useState<string | null>(null);
  const [editingShippingVal, setEditingShippingVal] = useState<string>("");
  const [isSavingShipping, setIsSavingShipping] = useState(false);
  const [isGeneratingConclusion, setIsGeneratingConclusion] = useState(false);
  const [isPromoting, setIsPromoting] = useState(false);
  const [promotedCaseId, setPromotedCaseId] = useState<string | null>(null);
  const [showPromotionSuccess, setShowPromotionSuccess] = useState(false);

  useEffect(() => {
    getAvailableCasesAction(currentMarket, currentPlatform).then((cases) => {
      setAvailableCases(cases);
      if (cases[0]) setSelectedCaseId(cases[0].id);
    });
  }, [currentMarket, currentPlatform]);

  const currentReport =
    siteReports.find((r) => r.id === selectedReportId)
    || reports.find((r) => r.id === selectedReportId)
    || siteReports[0]
    || null;
  const isConfirmed = currentReport?.reviewStatus === "confirmed";
  const isEstimated = (currentReport?.priceStats.verifiedSampleCount ?? 0) === 0;

  const handleRunAnalysis = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawInputs.trim()) {
      setStatusMsg({ type: "error", text: "请在输入框填入至少一个商品链接或 ASIN" });
      return;
    }

    setStatusMsg(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("rawInputs", rawInputs);
      formData.set("marketCode", currentMarket);
      formData.set("platformCode", currentPlatform);
      formData.set("currency", currentMarket === "GB" ? "GBP" : currentMarket === "DE" ? "EUR" : currentMarket === "JP" ? "JPY" : "USD");

      const res = await runCompetitorAnalysisAction(formData);
      if (res.success && res.report) {
        setReports((prev) => [res.report!, ...prev]);
        setSelectedReportId(res.report.id);
        setStatusMsg({ type: "success", text: "AI 竞品研报已生成！" });
      } else {
        setStatusMsg({ type: "error", text: res.error || "对比分析失败，请稍后重试" });
      }
    });
  };

  const handleDeleteReport = (id: string) => {
    if (!confirm("确定要删除这条对比研报吗？")) return;
    startTransition(async () => {
      await deleteComparisonReportAction(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      if (selectedReportId === id) {
        setSelectedReportId(siteReports.find((r) => r.id !== id)?.id || null);
      }
    });
  };

  const handleConfirmReport = async (reportId: string) => {
    const actor = reviewer.trim()
      || (typeof window !== "undefined" ? window.prompt("请填写核对人（用于留痕）", "")?.trim() || "" : "");
    if (!actor) {
      setStatusMsg({ type: "error", text: "请填写核对人后再确认" });
      return;
    }
    setIsConfirming(true);
    setStatusMsg(null);
    try {
      const res = await confirmComparisonReportAction(reportId, actor);
      if (res.success) {
        setReviewer(actor);
        setReports((prev) => prev.map((r) => (
          r.id === reportId ? { ...r, reviewStatus: "confirmed" as const } : r
        )));
        setStatusMsg({
          type: "success",
          text: "已记录人工核对。AI / 模板推断的数值仍属待核实，请在选品验证中补录真实证据。",
        });
      } else {
        setStatusMsg({ type: "error", text: res.error || "确认失败" });
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const handleConvertToHypothesis = (reportId: string) => {
    setStatusMsg(null);
    startTransition(async () => {
      const res = await convertReportToHypothesisAction(reportId);
      if (res.success && res.batchId) {
        setConvertBatchId(res.batchId);
        setStatusMsg({
          type: "success",
          text: `已成功将该竞品研报转入选品池！批次 ID: ${res.batchId.slice(0, 8)}...`,
        });
      } else {
        setStatusMsg({ type: "error", text: res.error || "转入选品失败" });
      }
    });
  };

  const handleGenerateAntiListing = async (reportId: string) => {
    setIsGeneratingListing(true);
    setStatusMsg(null);
    try {
      const res = await generateAntiListingAction(reportId);
      if (res.success && res.data) {
        setAntiListing(res.data);
        setStatusMsg({ type: "success", text: "AI 已成功生成针对竞品差评漏洞的反制五点描述！" });
      } else {
        setStatusMsg({ type: "error", text: res.error || "生成反制五点失败" });
      }
    } finally {
      setIsGeneratingListing(false);
    }
  };

  const handleGenerateRfq = async (reportId: string) => {
    setIsGeneratingRfq(true);
    setStatusMsg(null);
    try {
      const res = await generateSupplierRfqAction(reportId);
      if (res.success && res.data) {
        setRfqData(res.data);
        setStatusMsg({ type: "success", text: "已成功生成 1688 定制改良询价单 (RFQ)！" });
      } else {
        setStatusMsg({ type: "error", text: res.error || "生成询价单失败" });
      }
    } finally {
      setIsGeneratingRfq(false);
    }
  };

  const handleCopyRfqText = (rfq: SupplierRfqDraft) => {
    navigator.clipboard.writeText(rfq.formattedText).then(() => {
      setRfqCopied(true);
      setTimeout(() => setRfqCopied(false), 2500);
    });
  };

  const handleApplyToCase = async () => {
    if (!selectedCaseId || !antiListing || !currentReport) return;
    setIsApplyingCase(true);
    setApplyFindings([]);
    try {
      const res = await applyAntiListingToCaseAction(
        selectedCaseId,
        currentReport.id,
        antiListing,
        reviewer.trim() || "竞品研报工作台",
      );
      if (res.success) {
        setAppliedSuccessCaseId(selectedCaseId);
        const findings = res.findings || [];
        setApplyFindings(findings);
        const blocking = findings.filter((f) => f.severity === "error");
        setStatusMsg({
          type: blocking.length > 0 ? "error" : "success",
          text: blocking.length > 0
            ? `已写入草稿 v${res.version}，但发布预检发现 ${blocking.length} 项阻断问题，请到内容工作台修正`
            : `已写入草稿 v${res.version}（品牌与搜索词沿用原草稿），发布预检结果见下方`,
        });
      } else {
        setStatusMsg({ type: "error", text: res.error || "回填 Listing 失败" });
      }
    } finally {
      setIsApplyingCase(false);
    }
  };

  const singleItem = currentReport?.competitors.length === 1 ? currentReport.competitors[0] : null;
  const singleItemActualCny = singleItem?.sourcingCost?.actualCny ?? null;

  useEffect(() => {
    if (!currentReport) return;
    // 单品研报且已回补/手工录入了进价：自动联动顶部核算面板，零手工重复填写
    if (singleItem && singleItem.sourcingCost?.actualCny && singleItem.sourcingCost.actualCny > 0) {
      setQuoteCostRmb(singleItem.sourcingCost.actualCny);
      setCostSource(singleItem.sourcingCost.bestSupplierName === "手工录入" ? "manual" : "captured_1688");
    } else if (currentReport.sourcingAction?.suggestedCostCents) {
      setQuoteCostRmb(Number((currentReport.sourcingAction.suggestedCostCents / 100).toFixed(1)));
      setCostSource("estimated");
    } else {
      setCostSource("estimated");
    }
    if (singleItem && singleItem.priceCents > 0) {
      setTargetPriceVal(Number((getBuyerTotalPriceCents(singleItem) / 100).toFixed(2)));
    } else if (currentReport.priceStats?.p50) {
      setTargetPriceVal(Number((currentReport.priceStats.p50 / 100).toFixed(2)));
    }
  }, [currentReport?.id, singleItemActualCny]);

  // 查看「尚未回补进价」的单品研报时自动静默登记为当前 1688 回补目标；已有进价后不再重复加入待回补列表
  useEffect(() => {
    if (!currentReport || !singleItem || singleItem.sourcingCost?.actualCny) return;
    const maxCny = estimateMaxPurchaseRmb(
      getBuyerTotalPriceCents(singleItem),
      singleItem.currency || currentReport.currency,
      currentReport.platformCode,
    );
    fetch("/api/competitors/sourcing-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId: currentReport.id,
        asin: singleItem.asin,
        title: singleItem.title,
        marketCode: currentReport.marketCode,
        targetMaxCny: maxCny,
        competitorCount: 1,
      }),
    }).catch(() => {});
  }, [currentReport?.id, singleItem?.asin]);

  const currency = currentReport?.currency || "USD";
  const fxDef = OFFICIAL_FX_CONFIG[currency] || OFFICIAL_FX_CONFIG.USD;
  const currentFx = fxDef.rateToRmb;

  const isSingleProduct = (currentReport?.competitors.length ?? 0) <= 1;

  const handleGenerateConclusion = async () => {
    if (!currentReport || isGeneratingConclusion) return;
    setIsGeneratingConclusion(true);
    setStatusMsg(null);
    try {
      const res = await generateCompetitorConclusionAction(currentReport.id);
      if (res.success && res.report) {
        const updatedReport = res.report;
        setReports((prev) => prev.map((r) => (r.id === updatedReport.id ? updatedReport : r)));
        setStatusMsg({ type: "success", text: "AI 综合结论已生成并保存！" });
      } else {
        setStatusMsg({ type: "error", text: res.error || "生成 AI 结论失败" });
      }
    } catch {
      setStatusMsg({ type: "error", text: "生成 AI 结论失败，请稍后重试" });
    } finally {
      setIsGeneratingConclusion(false);
    }
  };

  const handleClearManualItemCost = async (asin: string) => {
    if (!currentReport || isSavingItemCost) return;
    setIsSavingItemCost(true);
    try {
      const res = await saveCompetitorManualCostAction(currentReport.id, asin, null);
      if (res.success && res.report) {
        const updatedReport = res.report;
        setReports((prev) => prev.map((r) => (r.id === updatedReport.id ? updatedReport : r)));
        setEditingCostAsin(null);
        setStatusMsg({ type: "success", text: `已清空 ${asin} 的实采/手工进价，恢复为 18% 门禁倒推预估上限。` });
      }
    } finally {
      setIsSavingItemCost(false);
    }
  };

  const handleSaveManualItemCost = async (asin: string) => {
    if (!currentReport || isSavingItemCost) return;
    const parsed = Number(editingCostVal);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatusMsg({ type: "error", text: "请输入大于 0 的有效人民币进价" });
      return;
    }
    setIsSavingItemCost(true);
    try {
      const res = await saveCompetitorManualCostAction(currentReport.id, asin, parsed);
      if (res.success && res.report) {
        const updatedReport = res.report;
        setReports((prev) => prev.map((r) => (r.id === updatedReport.id ? updatedReport : r)));
        setEditingCostAsin(null);
        setEditingCostVal("");
        setStatusMsg({ type: "success", text: `已保存 ${asin} 拿货进价 ¥${parsed.toFixed(2)}，实算净利率已更新！` });
      } else {
        setStatusMsg({ type: "error", text: res.error || "保存进价失败" });
      }
    } catch {
      setStatusMsg({ type: "error", text: "保存进价失败，请稍后重试" });
    } finally {
      setIsSavingItemCost(false);
    }
  };

  const handleSaveItemShipping = async (asin: string, amountOverride?: number | null) => {
    if (!currentReport || isSavingShipping) return;
    const nextVal = amountOverride !== undefined ? amountOverride : Number(editingShippingVal);
    if (nextVal !== null && (!Number.isFinite(nextVal) || nextVal < 0)) {
      setStatusMsg({ type: "error", text: "请输入不小于 0 的运费金额" });
      return;
    }
    setIsSavingShipping(true);
    try {
      const res = await saveCompetitorItemShippingAction(currentReport.id, asin, nextVal);
      if (res.success && res.report) {
        const updatedReport = res.report;
        setReports((prev) => prev.map((r) => (r.id === updatedReport.id ? updatedReport : r)));
        setEditingShippingAsin(null);
        setEditingShippingVal("");
        setStatusMsg({
          type: "success",
          text:
            nextVal && nextVal > 0
              ? `已记录 ${asin} 单独运费 ${nextVal.toFixed(2)} ${currentReport.currency}，毛利率、净利润与进价上限已按含运费实付价重算！`
              : `已清除 ${asin} 的单独运费，恢复按免邮口径核算。`,
        });
      } else {
        setStatusMsg({ type: "error", text: res.error || "保存运费失败" });
      }
    } catch {
      setStatusMsg({ type: "error", text: "保存运费失败，请稍后重试" });
    } finally {
      setIsSavingShipping(false);
    }
  };

  const registerSourcingBackfillTarget = (item: CompetitorProfile, targetMaxCny: number) => {
    if (!currentReport) return;
    fetch("/api/competitors/sourcing-target", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportId: currentReport.id,
        asin: item.asin,
        title: item.title,
        marketCode: currentReport.marketCode,
        targetMaxCny,
        competitorCount: currentReport.competitors.length,
      }),
    }).catch(() => {});
  };

  const handleSearch1688Translated = async (
    item: CompetitorProfile,
    targetMaxCny: number,
    fallbackKeywords?: string[],
  ) => {
    const cacheKey = `item_${item.asin}`;
    registerSourcingBackfillTarget(item, targetMaxCny);
    const cached = translatedKwMap[cacheKey];
    if (cached) {
      window.open(cached.searchUrl, "_blank", "noopener,noreferrer");
      setStatusMsg({
        type: "success",
        text: `已用中文词「${cached.keyword}」打开 1688（已自动锁定 ${item.asin} 为回补目标，在 1688 点扩展采集即可回填进价）`,
      });
      return;
    }
    // 同步预开空白标签页，避免 await 翻译后被浏览器拦截弹窗
    const popup = window.open("about:blank", "_blank");
    setTranslatingKey(cacheKey);
    try {
      const genericFallback = /^(跨境源头工厂|外贸现货批发|跨境现货批发)$/;
      const chineseFallback = (fallbackKeywords || []).find((k) => {
        if (genericFallback.test(k.trim())) return false;
        const stripped = k.replace(/(源头工厂|外贸批发|工厂)$/g, "").trim();
        return /[\u4e00-\u9fa5]{2,}/.test(stripped);
      });
      const { keyword, searchUrl } = await translateTo1688KeywordAction(item.title, chineseFallback);
      setTranslatedKwMap((prev) => ({ ...prev, [cacheKey]: { keyword, searchUrl } }));
      if (popup) popup.location.href = searchUrl;
      else window.open(searchUrl, "_blank", "noopener,noreferrer");
      setStatusMsg({
        type: "success",
        text: `已翻译为「${keyword}」并打开 1688（GBK 无乱码）；在 1688 页面点 Chrome 扩展一键采集后将自动回补 ${item.asin} 真实进价！`,
      });
    } catch {
      if (popup) popup.close();
      setStatusMsg({ type: "error", text: "关键词翻译失败，请稍后重试" });
    } finally {
      setTranslatingKey(null);
    }
  };

  const handleDownloadImageAndOpen1688 = (item: CompetitorProfile, targetMaxCny: number) => {
    if (!item.imageUrl) return;
    registerSourcingBackfillTarget(item, targetMaxCny);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(item.imageUrl).catch(() => {});
    }
    window.open("https://www.1688.com/", "_blank", "noopener,noreferrer");
    setStatusMsg({
      type: "success",
      text: `已复制 ${item.asin} 主图链接并锁定回补目标：在 1688 点相机图标搜同款后，用扩展一键采集即可自动回填该商品进价！`,
    });
  };

  const handleReanalyze = async (excludeAsin?: string) => {
    if (!currentReport || isReanalyzing) return;
    setIsReanalyzing(true);
    if (excludeAsin) setRemovingAsin(excludeAsin);
    setStatusMsg(null);
    try {
      const res = await reanalyzeCompetitorReportAction(currentReport.id, excludeAsin);
      if (res.success && res.report) {
        const updatedReport = res.report;
        setReports((prev) => prev.map((r) => (r.id === updatedReport.id ? updatedReport : r)));
        setStatusMsg({
          type: "success",
          text: excludeAsin
            ? `已移除干扰竞品 ${excludeAsin}，并基于剩余 ${updatedReport.competitors.length} 款真实数据重新计算分位与研报！`
            : "已基于本地采集的真实数据原地重新分析完成！",
        });
      } else {
        setStatusMsg({ type: "error", text: res.error || "重新分析失败" });
      }
    } catch {
      setStatusMsg({ type: "error", text: "重新分析失败，请稍后重试" });
    } finally {
      setIsReanalyzing(false);
      setRemovingAsin(null);
    }
  };

  const handleSelectBenchmark = (comp: CompetitorProfile | null) => {
    if (!comp) {
      setBenchmarkAsin(null);
      if (currentReport?.priceStats?.p50 && currentReport.priceStats.p50 > 0) {
        setTargetPriceVal(Number((currentReport.priceStats.p50 / 100).toFixed(2)));
      }
      setStatusMsg({
        type: "success",
        text: "已取消主攻标杆设置，已恢复默认 P50 拟定价。",
      });
      return;
    }
    setBenchmarkAsin(comp.asin);
    const effCents = comp.effectivePriceCents && comp.effectivePriceCents > 0
      ? comp.effectivePriceCents
      : comp.priceCents;
    if (effCents > 0) {
      setTargetPriceVal(Number((effCents / 100).toFixed(2)));
    }
    setStatusMsg({
      type: "success",
      text: `已将 ${comp.brand ? `${comp.brand} · ` : ""}${comp.asin} 设为主攻标杆，并自动带入券后拟定价。`,
    });
  };

  // 1. 到岸成本计算（采购单价按官方权威汇率折算外币 + 25% 头程海运预估）
  const purchaseCostCents = convertRmbToForeignCents(quoteCostRmb, currency);
  const estFreightCents = Math.round(purchaseCostCents * 0.25);
  const landedCostCents = purchaseCostCents + estFreightCents;
  const targetPriceCents = Math.round(targetPriceVal * 100);

  // 2. 彻底拔除客户端并行算法！直接调用系统唯一的 platformEconomicDefaults + calculateEconomics 权威同源内核！
  const defaults = platformEconomicDefaults(currentReport?.platformCode || "amazon", targetPriceCents);
  const assumptions: EconomicsAssumptions = {
    currency,
    salePriceCents: targetPriceCents,
    landedCostCents,
    ...defaults,
  };
  const economics = calculateEconomics(assumptions);

  const landedCostInCurr = landedCostCents / 100;
  const estNetProfit = economics.netProfitCents / 100;
  const estMarginRate = economics.marginRate;

  // 权威机会分，与案卷详情模型完全保持一致
  const calcOppScore = Math.min(100, Math.max(0, Math.round(
    Math.min(45, (estMarginRate / 0.20) * 45) +
    Math.min(25, (Math.max(0, economics.netProfitCents) / (targetPriceCents * 0.18 || 1)) * 25) +
    (economics.isProfitable ? 20 : 0) +
    10
  )));

  const handlePromoteToCase = async () => {
    if (!currentReport) return;
    setIsPromoting(true);
    setStatusMsg(null);
    try {
      const res = await promoteCompetitorReportToCaseAction({
        reportId: currentReport.id,
        quoteCostRmb,
        targetPriceCents: Math.round(targetPriceVal * 100),
        antiListing,
        rfqDraft: rfqData,
      });
      if (res.success && res.caseId) {
        setPromotedCaseId(res.caseId);
        setShowPromotionSuccess(true);
        setStatusMsg({ type: "success", text: "已成功正式立项为新商品 (Case)！数据已同步至商品案卷库。" });
      } else {
        setStatusMsg({ type: "error", text: res.error || "立项失败" });
      }
    } finally {
      setIsPromoting(false);
    }
  };

  const handleCopyBulletsText = (data: AntiListingResult) => {
    const text = [
      `TITLE: ${data.antiTitle}`,
      "",
      "BULLET POINTS:",
      ...data.bullets.map((b, i) => `${i + 1}. ${b.headline} ${b.content}`),
    ].join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setBulletsCopied(true);
      setTimeout(() => setBulletsCopied(false), 2500);
    });
  };

  const handleCopyMarkdown = (report: CompetitorComparisonReport) => {
    const md = [
      `# ${report.title}`,
      `**国家/平台**: ${report.marketCode} · ${report.platformCode} | **币种**: ${report.currency} | **分析时间**: ${new Date(report.createdAt).toLocaleString()}`,
      `**来源**: ${PROVENANCE_LABELS[report.provenance]} | **核对状态**: ${report.reviewStatus === "confirmed" ? "已人工核对" : "待人工核对"} | **真实价格样本**: ${report.priceStats.verifiedSampleCount} 条`,
      report.priceStats.verifiedSampleCount === 0
        ? "> 警告：下列价格分位为 AI / 模板示意值，无真实采集样本，不可用于定价或选品门禁。"
        : "> 价格分位仅使用浏览器采集 / 人工录入的真实售价；其余数值仍可能含 AI 推断，需按字段核实。",
      "",
      "## 一、价格分位与大盘分布",
      `- 最低价 (Min): ${(report.priceStats.min / 100).toFixed(2)} ${report.currency}`,
      `- P25 分位: ${(report.priceStats.p25 / 100).toFixed(2)} ${report.currency}`,
      `- 中位价 (P50): ${(report.priceStats.p50 / 100).toFixed(2)} ${report.currency}`,
      `- P75 分位: ${(report.priceStats.p75 / 100).toFixed(2)} ${report.currency}`,
      `- P90 分位: ${(report.priceStats.p90 / 100).toFixed(2)} ${report.currency}`,
      `- 最高价 (Max): ${(report.priceStats.max / 100).toFixed(2)} ${report.currency}`,
      "",
      "## 二、竞品横向 PK 详情",
      ...report.competitors.map((c, i) => [
        `### ${i + 1}. [${c.brand}] ${c.title}`,
        `- **ASIN/链接**: [${c.asin}](${c.sourceUrl})`,
        `- **价格**: ${(c.priceCents / 100).toFixed(2)} ${c.currency} (${c.pricePosition})`,
        `- **评分/评论**: ${c.rating}★ (${c.reviewCount.toLocaleString()} 评论) | 预估月销: ${c.monthlySalesEst.toLocaleString()} 件`,
        "- **核心亮点/卖点**:",
        ...c.features.map((f) => `  - [优势] ${f}`),
        "- **致命缺点/差评痛点**:",
        ...c.drawbacks.map((d) => `  - [痛点] ${d}`),
        `- **目标客群**: ${c.targetAudience}`,
        `- **AI 裁决**: ${c.verdict}`,
        "",
      ].join("\n")),
      "## 三、AI 综合破局战略",
      `> 行业通病与缺口：${report.summary.commonWeaknesses.join("；")}`,
      `> 市场空白点：${report.summary.marketVacuum}`,
      `> 进攻破局策略建议：${report.summary.attackVector}`,
      "",
      "## 四、供应链 1688 货源线索",
      `- 推荐搜索词: ${report.sourcingAction.recommendedKeywords1688.join(", ")}`,
      `- 建议到岸目标采购价: ¥${(report.sourcingAction.suggestedCostCents / 100).toFixed(2)} (目标毛利率: ${report.sourcingAction.targetMarginPercent}%)`,
    ].join("\n");

    navigator.clipboard.writeText(md).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const formatPrice = (cents: number, cur: string) => `${(cents / 100).toFixed(2)} ${cur}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* 状态通知 */}
      {statusMsg && (
        <div
          className={`notice ${statusMsg.type === "error" ? "warn" : ""}`}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <div>
            <strong>{statusMsg.type === "success" ? "已完成：" : "提示："}</strong>
            {statusMsg.text}
          </div>
          {convertBatchId && (
            <Link
              href={`/ai-sourcing?market=${currentReport?.marketCode}&platform=${currentReport?.platformCode}`}
              className="button secondary"
              style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
            >
              前往选品验证 &rarr;
            </Link>
          )}
        </div>
      )}

      {/* 顶部输入面板 */}
      <section className="panel" style={{ padding: "24px" }}>
        <div className="panel-header" style={{ marginBottom: "18px" }}>
          <div>
            <div className="eyebrow" style={{ color: "var(--green)" }}>多维竞品解析</div>
            <h2 style={{ fontSize: "20px", margin: "4px 0 6px 0", color: "var(--ink)" }}>
              输入链接，自动生成竞品研报
            </h2>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
              输入 1~4 个竞品链接或 ASIN（当前站点 {currentMarket} · {currentPlatform}）。AI 只辅助整理特点与差评线索；
              价格、评分、评论数等会标注来源，推断值需人工核实后才可用于定价与选品判断。
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>填入示例：</span>
            {SAMPLE_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="button secondary"
                style={{ fontSize: "12px", padding: "4px 10px", height: "30px", borderRadius: "10px" }}
                onClick={() => setRawInputs(p.inputs)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleRunAnalysis}>
          <div style={{ marginBottom: "16px" }}>
            <textarea
              value={rawInputs}
              onChange={(e) => setRawInputs(e.target.value)}
              placeholder={"https://www.amazon.com/dp/B08CZ8K652\nhttps://www.amazon.com/dp/B09M87J11L\nB0875X3V95"}
              rows={3}
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                color: "var(--ink)",
                fontSize: "13px",
                lineHeight: "1.5",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                resize: "vertical",
              }}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
              💡 换行可批量录入多个竞品；支持完整商品 URL 或 10 位 ASIN 编码。
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="button primary"
              style={{ minWidth: "150px" }}
            >
              {isPending ? "AI 深度对比中..." : "开始对比分析"}
            </button>
          </div>
        </form>
      </section>

      {/* 历史对比记录胶囊切换条 */}
      {reports.length > 0 && (
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "2px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 600 }}>
            对比历史（{currentMarket} · {currentPlatform}）:
          </span>
          {siteReports.length === 0 && (
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              当前站点暂无研报；本地最多保留最近 {MAX_COMPARISON_REPORTS} 条。
            </span>
          )}
          {siteReports.map((r) => {
            const isSelected = selectedReportId === r.id;
            return (
              <div
                key={r.id}
                onClick={() => setSelectedReportId(r.id)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "5px 12px",
                  borderRadius: "14px",
                  fontSize: "12px",
                  background: isSelected ? "var(--deep)" : "var(--paper)",
                  border: isSelected ? "1px solid var(--deep)" : "1px solid var(--line)",
                  color: isSelected ? "var(--deep-fg)" : "var(--ink)",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <span>{r.title.slice(0, 22)}...</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteReport(r.id);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: isSelected ? "var(--deep-fg)" : "var(--muted)",
                    opacity: isSelected ? 0.75 : 1,
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "14px",
                    lineHeight: "1",
                  }}
                  title="删除此研报"
                >
                  &times;
                </button>
              </div>
            );
          })}
          {reports.length >= MAX_COMPARISON_REPORTS && (
            <span style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap" }}>
              仅保留最近 {MAX_COMPARISON_REPORTS} 条，更早的研报会被覆盖
            </span>
          )}
        </div>
      )}

      {/* 研报展示主体 */}
      {currentReport ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* 研报标题与动作栏 */}
          <section
            className="panel"
            style={{
              padding: "16px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <h3 style={{ margin: 0, fontSize: "17px", color: "var(--ink)", fontWeight: 700 }}>
                  {currentReport.title}
                </h3>
                <span className="badge badge-neutral" style={{ fontSize: "12px" }}>
                  {currentReport.marketCode} · {currentReport.platformCode.toUpperCase()}
                </span>
                {isSingleProduct ? (
                  <span className="badge badge-neutral" style={{ fontSize: "12px" }}>
                    单品深挖模式
                  </span>
                ) : null}
                <span
                  className={`badge ${PROVENANCE_VERIFIED.includes(currentReport.provenance) ? "badge-success" : "badge-warn"}`}
                  style={{ fontSize: "12px" }}
                  title="报告整体来源"
                >
                  {PROVENANCE_LABELS[currentReport.provenance]}
                </span>
                <span className={`badge ${isConfirmed ? "badge-success" : "badge-warn"}`} style={{ fontSize: "12px" }}>
                  {isConfirmed ? "已人工核对" : "待人工核对"}
                </span>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {shortDate(currentReport.createdAt)}
                </span>
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
                真实采集价格样本 {currentReport.priceStats.verifiedSampleCount} 条 / 共 {currentReport.competitors.length} 款
                {isEstimated ? "；当前无真实价格样本，分位仅为示意值" : "；分位仅使用真实采集价格"}
                {isConfirmed ? "" : "。请核对后再转入选品池或写入商品草稿"}
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              {!isConfirmed && (
                <button
                  type="button"
                  className="button primary"
                  disabled={isConfirming}
                  onClick={() => handleConfirmReport(currentReport.id)}
                  style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px" }}
                  title="记录核对人后，才允许把研报转入选品池或写入商品草稿"
                >
                  {isConfirming ? "记录中..." : "我已核对，确认可用"}
                </button>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={isGeneratingListing}
                onClick={() => handleGenerateAntiListing(currentReport.id)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px", borderColor: "var(--green)", color: "var(--green)", fontWeight: 600 }}
              >
                {isGeneratingListing ? "AI 创作反制五点中..." : "✍️ 生成反制五点描述"}
              </button>

              <button
                type="button"
                className="button secondary"
                disabled={isGeneratingRfq}
                onClick={() => handleGenerateRfq(currentReport.id)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px", borderColor: "var(--line)", color: "var(--ink)", fontWeight: 600 }}
              >
                {isGeneratingRfq ? "生成 RFQ 中..." : "🏭 1688 改良询价单"}
              </button>

              <button
                type="button"
                className="button secondary"
                disabled={isReanalyzing}
                onClick={() => handleReanalyze()}
                title="保留已采集的真实价格/月销/差评/主图，原地重跑 AI 洞察与指标计算（如需最新前台价格请用 Chrome 扩展重抓）"
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px", fontWeight: 600 }}
              >
                {isReanalyzing && !removingAsin ? "重新分析中..." : "🔄 重新分析"}
              </button>

              <button
                type="button"
                className="button secondary"
                onClick={() => handleCopyMarkdown(currentReport)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px" }}
              >
                {copied ? "已复制 Markdown" : "复制研报"}
              </button>

              <button
                type="button"
                className="button primary"
                disabled={isPending || !isConfirmed}
                title={isConfirmed ? "转入选品池" : "请先点击「我已核对，确认可用」"}
                onClick={() => handleConvertToHypothesis(currentReport.id)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px" }}
              >
                沉淀为选品假设
              </button>
            </div>
          </section>

          {/* 反制 Listing 创作面板 */}
          {antiListing && (
            <section className="panel" style={{ padding: "24px", background: "var(--surface-subtle)", border: "1.5px solid var(--green)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <div className="eyebrow" style={{ color: "var(--green)" }}>ANTI-COMPETITOR LISTING STUDIO · 反制竞品内容</div>
                  <h4 style={{ margin: "4px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
                    规避差评痛点 · 差异化五点描述草稿 (Bullet Points)
                  </h4>
                  <p style={{ margin: "4px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
                    针对买家差评给出改良方向草稿；认证、测试次数、性能倍数、保修等一律以占位呈现，须在打样与检测后据实替换才可发布。
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => handleCopyBulletsText(antiListing)}
                    style={{ fontSize: "12px", padding: "5px 12px", height: "32px", borderRadius: "8px" }}
                  >
                    {bulletsCopied ? "✅ 已复制五点文案" : "📋 复制完整五点描述"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAntiListing(null)}
                    style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "16px", cursor: "pointer", padding: "0 6px" }}
                    title="收起"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {countDraftPlaceholders(antiListing) > 0 && (
                <div
                  className="result-box warning"
                  role="status"
                  style={{ marginBottom: "16px", fontSize: "12px", lineHeight: "1.5" }}
                >
                  <strong>待核实占位：{countDraftPlaceholders(antiListing)} 处。</strong>{" "}
                  这是一份文案骨架，不是可直接发布的成品。所有 [VERIFY: …] 需按打样实测、检测报告与平台合规要求填实；含占位的文案只能作为内部草稿保存，不得直接上架或对外投放。
                </div>
              )}

              {/* 反制标题 */}
              <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
                  ✦ 推荐差异化商品标题 (Anti-Title):
                </div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--ink)", lineHeight: "1.4" }}>
                  {antiListing.antiTitle}
                </div>
              </div>

              {/* 5 条靶向反制五点 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>五点描述靶向拆解：</div>
                {antiListing.bullets.map((b, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--paper)",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "12px", color: "var(--green)" }}>{b.headline}</strong>
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          background: "var(--red-soft)",
                          color: "var(--red)",
                          fontWeight: 600,
                        }}
                      >
                        🎯 {b.counterTarget}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: "1.5" }}>
                      {b.content}
                    </div>
                  </div>
                ))}
              </div>

              {/* 3 个 A+ 差异化对比模块 */}
              {antiListing.aplusModules && antiListing.aplusModules.length > 0 && (
                <div style={{ background: "var(--surface-subtle)", padding: "14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
                    🖼️ A+ 页面差异化模块构想（只描述本品，不贬损竞品）：
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                    {antiListing.aplusModules.map((m, mi) => (
                      <div key={mi} style={{ background: "var(--paper)", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}>
                        <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: "3px" }}>{m.title}</div>
                        <div style={{ color: "var(--muted)", marginBottom: "4px" }}>{m.description}</div>
                        <div style={{ color: "var(--green)", fontStyle: "italic" }}>💡 构图: {m.visualSuggestion}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 业务打通：一键写入选品商品 Listing 草稿 */}
              <div
                style={{
                  background: "var(--paper)",
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "2px" }}>
                    📥 一键写入商品 Listing 草稿
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                    将本套反制文案直接沉淀到商品库（自动生成新的文案版本，可随时在商品详情页微调与导出）：
                  </div>
                </div>

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  {availableCases.length > 0 ? (
                    <>
                      <select
                        value={selectedCaseId}
                        onChange={(e) => setSelectedCaseId(e.target.value)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: "8px",
                          border: "1px solid var(--line)",
                          fontSize: "12px",
                          background: "var(--surface-subtle)",
                          color: "var(--ink)",
                          maxWidth: "260px",
                        }}
                      >
                        {availableCases.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title} ({c.asin || "新产品"})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="button primary"
                        disabled={isApplyingCase || !selectedCaseId || !isConfirmed}
                        title={isConfirmed ? "写入商品草稿（保留原品牌与搜索词）" : "请先在研报标题栏点击「我已核对，确认可用」"}
                        onClick={handleApplyToCase}
                        style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "8px" }}
                      >
                        {isApplyingCase ? "写入中..." : isConfirmed ? "确认写入商品" : "需先核对研报"}
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>当前站点暂无已立项商品</span>
                  )}
                  {appliedSuccessCaseId && (
                    <Link
                      href={`/cases/${appliedSuccessCaseId}/content`}
                      className="button secondary"
                      style={{ fontSize: "12px", padding: "6px 12px", height: "34px", borderRadius: "8px", color: "var(--green)" }}
                    >
                      前往商品详情 &rarr;
                    </Link>
                  )}
                </div>
                {applyFindings.length > 0 && (
                  <div
                    className="result-box warning"
                    style={{ marginTop: "12px", fontSize: "12px", lineHeight: "1.5" }}
                    role="status"
                  >
                    <strong>发布预检结果（写入的是草稿，尚未发布）：</strong>
                    <ul style={{ margin: "6px 0 0 0", paddingLeft: "18px" }}>
                      {applyFindings.map((finding, i) => (
                        <li key={i} style={{ color: finding.severity === "error" ? "var(--red)" : "var(--ink)" }}>
                          [{finding.severity === "error" ? "阻断" : "提示"}] {finding.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* 1688 定制改良询价单 (RFQ) 面板 */}
          {rfqData && (
            <section className="panel" style={{ padding: "24px", background: "var(--surface-subtle)", border: "1.5px solid #28543f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <div className="eyebrow" style={{ color: "var(--green)" }}>SUPPLIER SOURCING RFQ · 1688 工业改良询价单</div>
                  <h4 style={{ margin: "4px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
                    🏭 针对竞品痛点的工厂开模/打样采购定制单 ({rfqData.productName})
                  </h4>
                  <p style={{ margin: "4px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
                    把买家差评转成工程问询项；MOQ、认证、测试与验收参数均由工厂回填，不预设既成事实。
                  </p>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => handleCopyRfqText(rfqData)}
                    style={{ fontSize: "12px", padding: "5px 12px", height: "32px", borderRadius: "8px", background: "#28543f" }}
                  >
                    {rfqCopied ? "✅ 已复制旺旺话术" : "📋 复制旺旺询价话术"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRfqData(null)}
                    style={{ background: "none", border: "none", color: "var(--muted)", fontSize: "16px", cursor: "pointer", padding: "0 6px" }}
                    title="收起"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* 核心指标胶囊 */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <div style={{ background: "var(--paper)", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>目标采购单价: </span>
                  <strong style={{ fontSize: "14px", color: "var(--green)" }}>¥{rfqData.targetPriceRmb.toFixed(2)}</strong>
                </div>
                <div style={{ background: "var(--paper)", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>建议试单 MOQ: </span>
                  <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{rfqData.suggestedMoq}</strong>
                </div>
              </div>

              {!rfqData.priceBasisVerified && (
                <div
                  className="result-box warning"
                  role="status"
                  style={{ marginBottom: "16px", fontSize: "12px", lineHeight: "1.5" }}
                >
                  <strong>目标采购单价仅作议价起点。</strong>{" "}
                  当前研报的竞品售价未经人工核实（真实价格样本 0 条），该价格由示意分位推导，不代表市场行情；正式询价前请先补录或采集真实竞品售价。
                </div>
              )}

              {/* 改良部件与工业标准列表 */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
                  🛠️ 待工厂确认的改良项与工艺要求：
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {rfqData.criticalImprovements.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: "var(--paper)",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                          {idx + 1}. 部件：{item.component}
                        </span>
                        <span style={{ color: "var(--red)", fontSize: "12px", background: "var(--red-soft)", padding: "1px 6px", borderRadius: "4px" }}>
                          靶向痛点: {item.painPointTargeted}
                        </span>
                      </div>
                      <div style={{ color: "var(--green)", fontWeight: 600 }}>
                        ⚙️ 工业工艺标准: <span style={{ color: "var(--ink)", fontWeight: 400 }}>{item.manufacturingStandard}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 质检验货标准 */}
              {rfqData.qualityStandard && rfqData.qualityStandard.length > 0 && (
                <div style={{ background: "var(--surface-subtle)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "6px" }}>
                    🧪 打样与出货质检验收要求：
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--ink)", lineHeight: "1.5" }}>
                    {rfqData.qualityStandard.map((q, idx) => (
                      <li key={idx}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 阿里旺旺完整文本 */}
              <div style={{ background: "var(--paper)", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>阿里旺旺 / 微信工厂对接话术预览：</span>
                  <button
                    type="button"
                    onClick={() => handleCopyRfqText(rfqData)}
                    style={{ background: "none", border: "none", color: "var(--green)", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
                  >
                    {rfqCopied ? "已复制" : "复制文本"}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: "12px",
                    lineHeight: "1.5",
                    color: "var(--ink)",
                    fontFamily: "ui-monospace, monospace",
                    background: "var(--surface-subtle)",
                    padding: "10px",
                    borderRadius: "6px",
                  }}
                >
                  {rfqData.formattedText}
                </pre>
              </div>
            </section>
          )}

          {/* 业务大动脉闭环：采购成本核算、机会分测算与一键正式立项 */}
          <section id="section-launch" className="panel" style={{ padding: "20px 24px", background: "var(--surface-subtle)", border: "1.5px solid var(--green)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--green)" }}>PIPELINE PROMOTION · 业务闭环立项</div>
                <h4 style={{ margin: "2px 0 0 0", fontSize: "16px", color: "var(--ink)", fontWeight: 800 }}>
                  ⚡ 拿货成本试算 & 快速立项为商品案卷 (New Case)
                </h4>
                <p style={{ margin: "2px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
                  默认按中位售价 25% 倒推预估拿货价（非工厂实报）；手工填入 1688 真实报价或由下方单品实采回补后，实时测算净利与财务「机会分」。
                </p>
              </div>
              {promotedCaseId && (
                <Link
                  href={`/cases/${promotedCaseId}`}
                  className="button primary"
                  style={{ fontSize: "12px", padding: "6px 14px", height: "32px", borderRadius: "8px" }}
                >
                  ✅ 查看已创建商品案卷 &rarr;
                </Link>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 2fr", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexWrap: "wrap" }}>
                  <span>
                    {costSource === "captured_1688"
                      ? "1688 实采进价 (RMB)"
                      : costSource === "manual"
                        ? "手工输入拿货价 (RMB)"
                        : "预估拿货单价 (RMB)"}
                  </span>
                  <span
                    className={`badge ${costSource === "captured_1688" ? "badge-success" : costSource === "manual" ? "badge-neutral" : "badge-warn"}`}
                    style={{ fontSize: "10px", padding: "1px 6px" }}
                  >
                    {costSource === "captured_1688" ? "1688 实采" : costSource === "manual" ? "手工试算" : "倒推预估 · 非实报"}
                  </span>
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "14px", color: "var(--muted)" }}>¥</span>
                  <input
                    type="number"
                    value={quoteCostRmb}
                    onChange={(e) => {
                      setQuoteCostRmb(Number(e.target.value));
                      setCostSource("manual");
                    }}
                    step="0.5"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "14px", fontWeight: 700, background: "var(--paper)" }}
                  />
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                  折合到岸约: {landedCostInCurr.toFixed(2)} {currentReport.currency} (含25%海运)
                </div>
              </div>

              <div>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
                  计划销售售价 ({currentReport.currency})
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "14px", color: "var(--muted)" }}>$</span>
                  <input
                    type="number"
                    value={targetPriceVal}
                    onChange={(e) => setTargetPriceVal(Number(e.target.value))}
                    step="0.5"
                    style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "14px", fontWeight: 700, background: "var(--paper)" }}
                  />
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                  竞品中位价: {(currentReport.priceStats.p50 / 100).toFixed(2)} {currentReport.currency}
                </div>
              </div>

              {/* 实时财务指标看板 */}
              <div
                style={{
                  background: "var(--paper)",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  textAlign: "center",
                  gap: "6px",
                }}
              >
                <div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>测算毛利率</div>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: estMarginRate >= 0.2 ? "var(--green)" : "var(--red)" }}>
                    {(estMarginRate * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>单件净利润</div>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: estNetProfit > 0 ? "var(--green)" : "var(--red)" }}>
                    {estNetProfit.toFixed(2)} {currentReport.currency}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>财务机会分</div>
                  <div style={{ fontSize: "16px", fontWeight: 900, color: calcOppScore >= 65 ? "var(--green)" : "var(--amber)" }}>
                    {calcOppScore} <span style={{ fontSize: "12px", fontWeight: 600 }}>分</span>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px", background: "var(--surface-subtle)", padding: "6px 12px", borderRadius: "6px" }}>
              💡 <strong>与正式成本模型 100% 同源核算（零偏差）：</strong>
              已扣除：到岸采购运费 ({(economics.landedCostCents / 100).toFixed(2)}) · FBA 履约派送 ({(economics.fbaFeeCents / 100).toFixed(2)}) · 平台佣金 ({(economics.referralFeeCents / 100).toFixed(2)}) · PPC 广告 12% ({(economics.adCostCents / 100).toFixed(2)}) · 退货损耗 ({(economics.returnLossCents / 100).toFixed(2)}) · 优惠券仓储杂费 ({((economics.couponCents + economics.storageCents + economics.otherCostCents) / 100).toFixed(2)})。
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderTop: "1px dashed var(--line)", paddingTop: "12px" }}>
              <div style={{ fontSize: "12px", color: "var(--ink)" }}>
                {calcOppScore >= 65 ? (
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>
                    🎯 财务指标达标 (GO)：毛利率 {(estMarginRate * 100).toFixed(1)}% 满足要求，可正式立项！
                  </span>
                ) : (
                  <span style={{ color: "var(--amber)", fontWeight: 600 }}>
                    ⚠️ 利润偏薄 (HOLD)：机会分 {calcOppScore} 分，建议与工厂争取降价或优化包装体积。
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                {currentReport.promotedCaseId || promotedCaseId ? (
                  <Link
                    href={`/cases/${currentReport.promotedCaseId || promotedCaseId}`}
                    className="button primary"
                    style={{ fontSize: "13px", padding: "7px 18px", height: "36px", borderRadius: "8px", fontWeight: 700 }}
                  >
                    ✅ 已立项为商品案卷 (前往案卷工作台 &rarr;)
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="button primary"
                    disabled={isPromoting || !isConfirmed}
                    title={isConfirmed ? "一键建立正式商品案卷并关联竞品与文案" : "请先在上方点击「我已核对，确认可用」"}
                    onClick={handlePromoteToCase}
                    style={{ fontSize: "13px", padding: "7px 18px", height: "36px", borderRadius: "8px", fontWeight: 700 }}
                  >
                    {isPromoting ? "正在创建商品案卷..." : isConfirmed ? "🚀 一键正式立项 (New Case)" : "需先核对研报"}
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* 视角快捷导航条（单品 / 多品自适应标签） */}
          <nav
            aria-label="研报视角导航"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "10px",
              padding: "10px 16px",
              borderRadius: "12px",
              background: "var(--surface-subtle)",
              border: "1px solid var(--line)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>视角直达：</span>
              <a href="#section-overview" className="button ghost" style={{ fontSize: "12px", padding: "4px 10px", height: "28px" }}>
                {isSingleProduct ? "① 单品诊断" : "① 格局总览"}
              </a>
              <a href="#section-pk" className="button ghost" style={{ fontSize: "12px", padding: "4px 10px", height: "28px" }}>
                {isSingleProduct ? "② 卖点与差评拆解" : "② 横向 PK 矩阵"}
              </a>
              <a href="#section-launch" className="button ghost" style={{ fontSize: "12px", padding: "4px 10px", height: "28px" }}>
                ③ 财务测算与立项
              </a>
              <a href="#section-conclusion" className="button ghost" style={{ fontSize: "12px", padding: "4px 10px", height: "28px" }}>
                ④ AI 结论
              </a>
            </div>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              {isSingleProduct
                ? "单品深挖模式：已自动隐藏多品格局图与价格分位噪声"
                : `多品对标模式 · 共 ${currentReport.competitors.length} 款竞品`}
            </span>
          </nav>

          {/* -0.5 快照版本异动预警（同站点/同赛道再次采集时自动触发） */}
          {currentReport.snapshotDiff && (currentReport.snapshotDiff.alerts.length > 0 || currentReport.snapshotDiff.avgPriceDeltaPercent !== null) ? (
            <section
              className="panel"
              style={{
                padding: "16px 20px",
                borderLeft: "4px solid var(--amber)",
                background: "var(--amber-soft)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "6px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                  ⚡ 快照对比异动预警（对比上次采集 {shortDate(currentReport.snapshotDiff.previousCapturedAt)}）
                </div>
                {currentReport.snapshotDiff.avgPriceDeltaPercent !== null ? (
                  <span className="badge badge-warn mono" style={{ fontSize: "12px" }}>
                    均价变动 {currentReport.snapshotDiff.avgPriceDeltaPercent > 0 ? "+" : ""}{currentReport.snapshotDiff.avgPriceDeltaPercent}%
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "12px", color: "var(--ink)" }}>
                {currentReport.snapshotDiff.alerts.map((alert, idx) => (
                  <span key={idx} className="badge badge-neutral" style={{ background: "var(--panel)" }}>
                    {alert}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* 0. 科学量化：商品指数 (Product Index, 0~100 分) */}
          {(() => {
            const liveMarginPct = Number((estMarginRate * 100).toFixed(1));
            const index = calculateProductIndex(currentReport, {
              overrideMarginPercent: targetPriceCents > 0 ? liveMarginPct : null,
            });
            const signals = currentReport.marketSignals;
            const isS = index.grade === "S";
            const isA = index.grade === "A";
            const isB = index.grade === "B";

            const themeColor = isS
              ? "var(--green)"
              : isA
              ? "var(--green)"
              : isB
              ? "var(--amber)"
              : "var(--red)";
            const themeBg = isS
              ? "var(--green-soft)"
              : isA
              ? "var(--green-soft)"
              : isB
              ? "var(--amber-soft)"
              : "var(--red-soft)";

            return (
              <section id="section-overview" className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                  <div>
                    <div className="eyebrow" style={{ color: themeColor }}>
                      QUANTITATIVE RETAIL MODEL · 观测值驱动量化判定
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", flexWrap: "wrap" }}>
                      <h4 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
                        商品指数 (Product Index)
                      </h4>
                      <span
                        className={`badge ${index.evidenceCompleteness >= 70 ? "badge-success" : index.evidenceCompleteness >= 45 ? "badge-warn" : "badge-danger"}`}
                        style={{ fontSize: "12px" }}
                      >
                        证据完整度 {index.evidenceCompleteness}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowIndexHelp((prev) => !prev)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--muted)",
                          fontSize: "12px",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: "2px 4px",
                        }}
                      >
                        {showIndexHelp ? "收起说明 ▲" : "ℹ️ 与机会分(Opportunity Score)的区别说明 ▼"}
                      </button>
                    </div>
                  </div>
                  <span
                    className={`badge ${isS ? "badge-success" : isA ? "badge-success" : isB ? "badge-warn" : "badge-danger"}`}
                    style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px" }}
                  >
                    参考评级（非选品门禁）: {index.decision}
                  </span>
                </div>

                {/* 市场微观信号条（仅多品模式展示，单品分析自动隐藏） */}
                {signals && !isSingleProduct ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                      gap: "10px",
                      marginBottom: "16px",
                    }}
                  >
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Top 3 品牌占比 (CR3)</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.brandCr3Percent > 60 ? "var(--red)" : "var(--ink)", marginTop: "2px" }}>
                        {signals.brandCr3Percent}%
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>首页广告位密度</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.sponsoredRatioPercent >= 45 ? "var(--amber)" : "var(--ink)", marginTop: "2px" }}>
                        {signals.sponsoredRatioPercent}% ({signals.sponsoredCount}款)
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Coupon 隐藏折扣</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                        {signals.couponCount > 0 ? `${signals.couponCount}款 (均省 ${signals.avgDiscountPercent}%)` : "0 款"}
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>官方月销实证</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.verifiedSalesCount > 0 ? "var(--green)" : "var(--muted)", marginTop: "2px" }}>
                        {signals.verifiedSalesCount} / {currentReport.competitors.length} 款
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Amazon 自营 / 黑马新品</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                        1P: {signals.amazon1pCount} · 黑马: {signals.darkHorseAsins.length}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* 指标关系说明抽屉 */}
                {showIndexHelp && (
                  <div
                    style={{
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      marginBottom: "16px",
                      fontSize: "12px",
                      lineHeight: "1.6",
                      color: "var(--ink)",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "4px", color: "var(--green)" }}>
                      📌 双指标分工与业务漏斗流转说明：
                    </div>
                    <div>
                      <strong>1. 商品指数 (本页面，0~100 分)：</strong>
                      面向外部赛道与竞品攻防，衡量 <em>赛道垄断度(HHI)、评论阻力、价格战内卷度与真实差评改良胜算</em>。回答“这品类对手弱不弱、有没有切入机会”。
                    </div>
                    <div>
                      <strong>2. 机会分 (选品工作台，0~100 分)：</strong>
                      面向内部财务可行性，需在拿到 <em>1688 源头采购报价、FBA 头程与关税</em> 后，对到岸成本、净利率和压力测试利润进行确定性核验。回答“拿到这批货能否真赚钱”。
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: "4px" }}>
                      💡 <strong>边界：</strong>商品指数只描述赛道竞争格局，<strong>不参与 GO / HOLD / NO-GO 门禁</strong>；GO 由选品验证链路的真实报价、真实竞品证据与确定性成本规则共同决定。若本报告数值来自 AI 或模板，评级仅作示意。
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: "4px" }}>
                      <strong>建议工作流：</strong>先用浏览器扩展采集真实售价与差评，人工核对后再点击【沉淀为选品假设】，前往 1688 询价并核算财务「机会分」。
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "280px 1fr",
                    gap: "24px",
                    alignItems: "center",
                    background: "var(--surface-subtle)",
                    padding: "20px",
                    borderRadius: "14px",
                    border: "1px solid var(--line)",
                  }}
                >
                  {/* 左侧：大分值与总评 */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      borderRight: "1px solid var(--line)",
                      paddingRight: "20px",
                    }}
                  >
                    <div
                      style={{
                        width: "96px",
                        height: "96px",
                        borderRadius: "50%",
                        background: themeBg,
                        border: `3px solid ${themeColor}`,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
                        marginBottom: "12px",
                      }}
                    >
                      <span style={{ fontSize: "32px", fontWeight: 900, color: themeColor, lineHeight: 1 }}>
                        {index.totalScore}
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: themeColor, marginTop: "2px" }}>
                        {index.grade} 级 · 得分
                      </span>
                    </div>

                    <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--ink)", marginBottom: "6px" }}>
                      {index.headline}
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
                      {index.summaryText}
                    </p>
                  </div>

                  {/* 右侧：量化支柱得分明细（单品模式自动隐藏无意义的品牌 HHI 垄断支柱） */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {Object.values(index.pillars)
                      .filter((p) => !(isSingleProduct && p.key === "hhi"))
                      .map((p) => {
                      const available = p.isAvailable !== false;
                      const percent = available ? Math.round((p.score / p.max) * 100) : 0;
                      return (
                        <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: "4px", opacity: available ? 1 : 0.65 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <strong style={{ color: "var(--ink)" }}>{p.label}</strong>
                              <span
                                style={{
                                  fontSize: "12px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  background: "var(--panel)",
                                  border: "1px solid var(--line)",
                                  color: "var(--muted)",
                                  fontFamily: "ui-monospace, monospace",
                                }}
                              >
                                {p.metricValue}
                              </span>
                            </div>
                            <div>
                              {available ? (
                                <>
                                  <strong style={{ color: themeColor }}>{p.score}</strong>
                                  <span style={{ color: "var(--muted)" }}> / {p.max} 分</span>
                                </>
                              ) : (
                                <span style={{ color: "var(--muted)", fontSize: "12px" }}>未采集 · 不计分</span>
                              )}
                            </div>
                          </div>

                          {/* 进度条 */}
                          <div
                            style={{
                              width: "100%",
                              height: "6px",
                              background: "var(--line)",
                              borderRadius: "3px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                background: available ? themeColor : "var(--muted)",
                                borderRadius: "3px",
                                transition: "width 0.4s ease",
                              }}
                            />
                          </div>

                          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.35" }}>
                            {p.explanation}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })()}

          {/* 1. 价格分位数带与大盘基准（单品模式自动隐藏，1 款商品不需要分位带） */}
          {!isSingleProduct ? (
          <section className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div>
                <span className="eyebrow" style={{ color: "var(--green)" }}>价格格局</span>
                <h4 style={{ margin: "2px 0 0 0", fontSize: "15px", color: "var(--ink)" }}>价格分位数带与统计基准</h4>
              </div>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                真实采集样本: <strong>{currentReport.priceStats.verifiedSampleCount}</strong> 款
                / 共 {currentReport.competitors.length} 款对标商品
              </span>
            </div>

            {isEstimated ? (
              <div
                className="notice warn"
                style={{ marginBottom: 0, fontSize: "13px", lineHeight: "1.6", display: "block" }}
                role="status"
              >
                <span>
                  <strong>暂无真实售价样本，已隐藏价格分位：</strong>
                  直接粘贴纯 URL 时系统不会后台抓取亚马逊，也不编造假 P50 中位价。请在 Amazon 搜索页（Top 20）或详情页点击 <strong>Chrome 二合一扩展</strong> 一键采集真实价格与差评。
                </span>
              </div>
            ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "12px",
              }}
            >
              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>最低售价 (Min)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.min, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P25 分位价</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p25, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--green-soft)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid rgba(31, 122, 85, 0.3)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
                  黄金中位价 (P50)
                </div>
                <div style={{ fontSize: "19px", fontWeight: 800, color: "var(--green)" }}>
                  {formatPrice(currentReport.priceStats.p50, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P75 分位价</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p75, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P90 溢价门槛</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p90, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>最高售价 (Max)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.max, currentReport.currency)}
                </div>
              </div>
            </div>
            )}
          </section>
          ) : null}

          {/* 1.5 市场格局四象限气泡图（单品模式自动隐藏） */}
          {!isSingleProduct ? (
            <CompetitorQuadrantChart
              competitors={currentReport.competitors}
              currency={currentReport.currency}
              p50PriceCents={currentReport.priceStats.p50}
              targetPriceCents={Math.round(targetPriceVal * 100)}
              darkHorseAsins={currentReport.marketSignals?.darkHorseAsins ?? []}
              benchmarkAsin={benchmarkAsin ?? currentReport.targetBenchmarkAsin ?? null}
              onSelectBenchmark={handleSelectBenchmark}
            />
          ) : null}

          {/* 1.7 差评可改良性分级矩阵（Actionable Pain Matrix） */}
          {currentReport.painPointMatrix && currentReport.painPointMatrix.length > 0 ? (
            <section className="panel" style={{ padding: "20px 24px" }}>
              <div style={{ marginBottom: "14px" }}>
                <div className="eyebrow" style={{ color: "var(--amber)" }}>差评攻防分级</div>
                <h4 style={{ margin: "2px 0 4px 0", fontSize: "16px", color: "var(--ink)" }}>
                  差评可改良性矩阵（区分改模 / 快赢包装 / 预期管理 / 物理限制）
                </h4>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                {currentReport.painPointMatrix.map((item, idx) => {
                  const catMap = {
                    structural_design: { label: "结构/材质可改", badge: "badge-success" },
                    packaging_accessories: { label: "配件包装快赢", badge: "badge-success" },
                    expectation_mgmt: { label: "预期管理降退货", badge: "badge-warn" },
                    physical_limit: { label: "物理限制 · 避坑", badge: "badge-danger" },
                  } as const;
                  const meta = catMap[item.category] || catMap.structural_design;
                  const costLabel = item.costToFix === "low" ? "低成本快赢" : item.costToFix === "medium" ? "中等改良成本" : item.costToFix === "high" ? "高成本改模" : "不可解决";
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "14px",
                        borderRadius: "12px",
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span className={`badge ${meta.badge}`} style={{ fontSize: "11px" }}>{meta.label}</span>
                        <span className="badge badge-neutral" style={{ fontSize: "11px" }}>{costLabel}</span>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", lineHeight: 1.4 }}>{item.pain}</div>
                      <div style={{ fontSize: "12px", color: "var(--green)", lineHeight: 1.45 }}>
                        → {item.solution}
                      </div>
                      {item.sourceQuote ? (
                        <div style={{ fontSize: "11px", color: "var(--muted)", borderLeft: "2px solid var(--line)", paddingLeft: "8px", marginTop: "2px", lineHeight: 1.4 }}>
                          原评依据：{item.sourceQuote}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* 2. 竞品多维横向 PK 矩阵 / 单品深度拆解 */}
          <section id="section-pk" className="panel" style={{ padding: "24px" }}>
            <div style={{ marginBottom: "18px" }}>
              <div className="eyebrow" style={{ color: "var(--green)" }}>
                {isSingleProduct ? "单品深度拆解" : "横向 PK 对标"}
              </div>
              <h4 style={{ margin: "2px 0 4px 0", fontSize: "16px", color: "var(--ink)" }}>
                {isSingleProduct ? "核心卖点与买家差评拆解" : "竞品核心卖点与差评痛点对决"}
              </h4>
              <p style={{ margin: 0, color: "var(--muted)", fontSize: "13px" }}>
                透视各款竞品的长处（买家满意因子）与死穴（高频退货/差评诱因），精准确立改良切入点。
              </p>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${Math.min(currentReport.competitors.length, 3)}, minmax(280px, 1fr))`,
                gap: "16px",
                overflowX: "auto",
              }}
            >
              {currentReport.competitors.map((item: CompetitorProfile, idx: number) => {
                const isBudget = item.pricePosition === "budget";
                const isPremium = item.pricePosition === "premium";

                return (
                  <div
                    key={item.id || idx}
                    style={{
                      background: "var(--paper)",
                      borderRadius: "14px",
                      border: "1px solid var(--line)",
                      padding: "18px",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      boxShadow: "0 4px 14px rgba(24, 44, 32, 0.03)",
                    }}
                  >
                    <div>
                      {/* 标头段位与外链 */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span
                            className={`badge ${isBudget ? "badge-neutral" : isPremium ? "badge-warn" : "badge-success"}`}
                            style={{ fontSize: "12px" }}
                          >
                            {isBudget ? "低价入门" : isPremium ? "高端溢价" : "中端主力"}
                          </span>
                          {item.isSponsored ? <span className="badge badge-warn" style={{ fontSize: "11px" }}>广告位</span> : null}
                          {item.fulfillmentType === "amazon_1p" ? <span className="badge badge-danger" style={{ fontSize: "11px" }}>1P 自营</span> : null}
                          {item.boughtPastMonth && item.boughtPastMonth > 0 ? (
                            <span className="badge badge-success mono" style={{ fontSize: "11px" }}>
                              月销 {item.boughtPastMonth.toLocaleString()}+
                            </span>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              fontSize: "12px",
                              color: "var(--green)",
                              fontFamily: "monospace",
                              textDecoration: "underline",
                              fontWeight: 600,
                            }}
                          >
                            {item.asin}
                          </a>
                          {!isSingleProduct ? (
                            <button
                              type="button"
                              disabled={isReanalyzing}
                              onClick={() => handleReanalyze(item.asin)}
                              title="移除这条干扰竞品并基于剩余竞品重新计算分位与四象限"
                              style={{
                                background: "none",
                                border: "1px solid var(--line)",
                                borderRadius: "6px",
                                padding: "1px 6px",
                                fontSize: "11px",
                                color: "var(--muted)",
                                cursor: "pointer",
                              }}
                            >
                              {removingAsin === item.asin ? "移除中..." : "移除"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            style={{ width: "52px", height: "52px", objectFit: "contain", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--panel)", flexShrink: 0 }}
                          />
                        ) : null}
                        <h5
                          style={{
                            margin: 0,
                            fontSize: "14px",
                            lineHeight: "1.4",
                            color: "var(--ink)",
                            fontWeight: 700,
                          }}
                        >
                          [{item.brand}] {item.title}
                        </h5>
                      </div>

                      {/* 价格与销售表现（含单独运费录入与实付总价） */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          paddingBottom: "12px",
                          marginBottom: "14px",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                          {(() => {
                            const sell = item.priceCents;
                            const list = item.listPriceCents && item.listPriceCents > sell ? item.listPriceCents : 0;
                            const listOffPct = list > 0 && sell > 0 ? Math.round(((list - sell) / list) * 100) : 0;
                            const eff = item.effectivePriceCents && item.effectivePriceCents > 0 && item.effectivePriceCents < sell
                              ? item.effectivePriceCents
                              : 0;
                            const couponPct = eff > 0 && sell > 0 ? Math.round(((sell - eff) / sell) * 100) : 0;
                            return (
                              <>
                                <span style={{ fontSize: "20px", fontWeight: 800, color: sell > 0 ? "var(--ink)" : "var(--muted)" }}>
                                  {sell > 0 ? formatPrice(sell, item.currency) : "待采集售价"}
                                </span>
                                {list > 0 ? (
                                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                                    <span style={{ textDecoration: "line-through" }}>{formatPrice(list, item.currency)}</span>
                                    {listOffPct > 0 ? <strong style={{ color: "var(--red)", marginLeft: "4px" }}>-{listOffPct}%</strong> : null}
                                  </span>
                                ) : null}
                                {eff > 0 ? (
                                  <span className="badge badge-warn" style={{ fontSize: "11px" }}>
                                    券后 {formatPrice(eff, item.currency)} (-{couponPct}%)
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                          {item.rating > 0 ? (
                            <span style={{ fontSize: "12px", color: "var(--amber)", fontWeight: 700 }}>
                              ★ {item.rating}
                            </span>
                          ) : null}
                          {item.reviewCount > 0 || item.monthlySalesEst > 0 ? (
                            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                              ({item.reviewCount > 0 ? `${item.reviewCount.toLocaleString()} 评` : "评论待采集"}
                              {item.monthlySalesEst > 0 ? ` · 约 ${item.monthlySalesEst} 件/月` : ""})
                            </span>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                              评分与评论数待采集
                            </span>
                          )}
                        </div>

                        {/* 买家另付单独运费行 */}
                        {item.priceCents > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "11.5px" }}>
                            {item.shippingCents && item.shippingCents > 0 ? (
                              <>
                                <span className="badge badge-warn" style={{ fontSize: "11px" }}>
                                  + 单独运费 {formatPrice(item.shippingCents, item.currency)} · 买家实付 {formatPrice(getBuyerTotalPriceCents(item), item.currency)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingShippingAsin(item.asin);
                                    setEditingShippingVal((item.shippingCents! / 100).toFixed(2));
                                  }}
                                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                >
                                  改运费
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingShipping}
                                  onClick={() => handleSaveItemShipping(item.asin, 0)}
                                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                >
                                  清零
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingShippingAsin(editingShippingAsin === item.asin ? null : item.asin);
                                  setEditingShippingVal("");
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--muted)",
                                  cursor: "pointer",
                                  padding: 0,
                                  textDecoration: "underline",
                                  fontSize: "11px",
                                }}
                              >
                                {editingShippingAsin === item.asin ? "取消运费录入" : "+ 买家另付运费（如不包邮点此补录）"}
                              </button>
                            )}
                          </div>
                        ) : null}

                        {editingShippingAsin === item.asin ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                            <span style={{ fontSize: "11.5px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                              运费 ({item.currency || currentReport.currency})
                            </span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder="如 9.99"
                              value={editingShippingVal}
                              onChange={(e) => setEditingShippingVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveItemShipping(item.asin);
                                }
                              }}
                              style={{
                                width: "92px",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--line)",
                                background: "var(--paper)",
                                color: "var(--ink)",
                                fontSize: "12px",
                                fontWeight: 700,
                              }}
                            />
                            <button
                              type="button"
                              disabled={isSavingShipping}
                              onClick={() => handleSaveItemShipping(item.asin)}
                              className="button primary"
                              style={{ fontSize: "11px", padding: "3px 10px", height: "26px" }}
                            >
                              {isSavingShipping ? "保存中" : "重算利润"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingShippingAsin(null)}
                              className="button ghost"
                              style={{ fontSize: "11px", padding: "3px 6px", height: "26px" }}
                            >
                              取消
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!isVerifiedCompetitorField(item, "priceCents") && (
                        <div style={{ fontSize: "12px", color: "var(--amber)", marginTop: "-8px", marginBottom: "12px" }}>
                          尚未采集到前台真实售价，请使用 Chrome 二合一扩展在 Amazon 页面一键采集
                        </div>
                      )}

                      {/* 核心卖点 */}
                      <div style={{ marginBottom: "14px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "6px" }}>
                          ✓ 核心特点与亮点
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                          {item.features.map((f, fi) => (
                            <div
                              key={fi}
                              style={{
                                fontSize: "12px",
                                color: "var(--ink)",
                                background: "var(--green-soft)",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                lineHeight: "1.35",
                              }}
                            >
                              {f}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 致命缺点与差评 */}
                      <div style={{ marginBottom: "14px" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--red)", marginBottom: "6px" }}>
                          ✕ 致命缺点与差评痛点
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
                          {item.drawbacks.map((d, di) => (
                            <div
                              key={di}
                              style={{
                                fontSize: "12px",
                                color: "var(--red)",
                                background: "var(--red-soft)",
                                padding: "4px 8px",
                                borderRadius: "6px",
                                lineHeight: "1.35",
                              }}
                            >
                              {d}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 核心参数 */}
                      {item.specifications && Object.keys(item.specifications).length > 0 && (
                        <div
                          style={{
                            background: "var(--surface-subtle)",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            marginBottom: "12px",
                            fontSize: "12px",
                          }}
                        >
                          <div style={{ color: "var(--muted)", marginBottom: "4px", fontWeight: 600 }}>参数对标：</div>
                          {Object.entries(item.specifications).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--ink)", padding: "2px 0" }}>
                              <span style={{ color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{k}:</span>
                              <span style={{ fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 单品毛利率与单件利润估算（按券后价 + 买家另付运费总实付口径重算） */}
                      {item.priceCents > 0 ? (() => {
                        const itemCurr = item.currency || currentReport.currency;
                        const fxRate = (OFFICIAL_FX_CONFIG[itemCurr] || OFFICIAL_FX_CONFIG.USD).rateToRmb;
                        const totalBuyerCents = getBuyerTotalPriceCents(item);
                        const hasRealCost = Boolean(item.sourcingCost?.actualCny && item.sourcingCost.actualCny > 0);
                        // 有实录/实采进价用真实进价算；未录进价时按实付总价 25% 折算人民币做参考估算并明确标注
                        const basisRmb = hasRealCost
                          ? item.sourcingCost!.actualCny
                          : Number((((totalBuyerCents / 100) * 0.25) * fxRate).toFixed(1));
                        const est = calcItemProfitEstimate(totalBuyerCents, basisRmb, itemCurr, currentReport.platformCode);
                        const isHealthy = est.marginPct >= 18;
                        const hasShipping = Boolean(item.shippingCents && item.shippingCents > 0);
                        return (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "8px",
                              marginBottom: "12px",
                              padding: "8px 10px",
                              borderRadius: "8px",
                              background: "var(--surface-subtle)",
                              border: "1px solid var(--line)",
                              fontSize: "12px",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {hasRealCost ? "实算毛利率" : "预估毛利率"}
                                <span style={{ marginLeft: "4px", fontSize: "10px" }}>
                                  ({hasRealCost ? `按 ¥${basisRmb}` : `按 25% ≈ ¥${basisRmb}`})
                                </span>
                              </div>
                              <div className="mono" style={{ fontSize: "15px", fontWeight: 800, color: isHealthy ? "var(--green)" : "var(--red)", marginTop: "2px" }}>
                                {est.marginPct}%
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {hasRealCost ? "单件净利润" : "预估单件利润"}
                                {hasShipping ? <span style={{ marginLeft: "4px", fontSize: "10px", color: "var(--amber)" }}>含运费口径</span> : null}
                              </div>
                              <div className="mono" style={{ fontSize: "15px", fontWeight: 800, color: est.netProfitCents > 0 ? "var(--ink)" : "var(--red)", marginTop: "2px" }}>
                                {est.netProfitCents >= 0 ? "+" : ""}{(est.netProfitCents / 100).toFixed(2)} {itemCurr}
                                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted)", marginLeft: "4px" }}>
                                  (≈¥{est.netProfitRmb})
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })() : null}
                    </div>

                    {/* AI 单品简评 + 1688 搜同款入口 */}
                    <div
                      style={{
                        borderTop: "1px dashed var(--line)",
                        paddingTop: "8px",
                        fontSize: "12px",
                        color: "var(--muted)",
                        lineHeight: "1.4",
                      }}
                    >
                      <div>
                        <strong>诊断:</strong> {item.verdict}
                      </div>
                      {(() => {
                        const key = `item_${item.asin}`;
                        const cached = translatedKwMap[key];
                        const totalBuyerCents = getBuyerTotalPriceCents(item);
                        const maxPurchaseRmb = estimateMaxPurchaseRmb(
                          totalBuyerCents,
                          item.currency || currentReport.currency,
                          currentReport.platformCode,
                        );
                        const cost = item.sourcingCost;
                        const realMarginPct = cost?.actualCny
                          ? calcItemRealMarginPct(
                              totalBuyerCents,
                              cost.actualCny,
                              item.currency || currentReport.currency,
                              currentReport.platformCode,
                            )
                          : null;
                        const passedGate = realMarginPct !== null && realMarginPct >= 18;

                        return (
                          <>
                            {/* 单品预估进价上限 / 1688 实采回补进价条 */}
                            {item.priceCents > 0 ? (
                              <div
                                style={{
                                  marginTop: "10px",
                                  padding: "8px 10px",
                                  borderRadius: "8px",
                                  background: "var(--surface-subtle)",
                                  border: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                {cost?.actualCny ? (
                                  <>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                      <span style={{ color: "var(--ink)", fontWeight: 700 }}>
                                        1688 实采进价：<span className="mono" style={{ color: "var(--green)" }}>¥{cost.actualCny}</span>
                                      </span>
                                      <span className={`badge ${passedGate ? "badge-success" : "badge-danger"} mono`} style={{ fontSize: "11px" }}>
                                        净利 {realMarginPct}% {passedGate ? "✓ 过 18% 门禁" : "✕ 低于 18%"}
                                      </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: "11px", color: "var(--muted)" }}>
                                      <span>
                                        {cost.bestSupplierName === "手工录入"
                                          ? "手工录入"
                                          : cost.bestOfferUrl
                                            ? (
                                              <>
                                                <a href={cost.bestOfferUrl} target="_blank" rel="noreferrer" style={{ color: "var(--green)", textDecoration: "underline" }}>
                                                  {cost.bestSupplierName || "1688 货源"}
                                                </a>
                                                {` · 采自 ${cost.sampleCount} 家${cost.minCny ? ` (最低 ¥${cost.minCny})` : ""}`}
                                              </>
                                            )
                                            : `采自 ${cost.sampleCount} 家${cost.minCny ? ` · 最低 ¥${cost.minCny}` : ""}`}
                                        {maxPurchaseRmb > 0 ? ` · 上限 ≤ ¥${maxPurchaseRmb}` : ""}
                                      </span>
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCostAsin(item.asin);
                                            setEditingCostVal(String(cost.actualCny));
                                          }}
                                          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                        >
                                          改价
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingItemCost}
                                          onClick={() => handleClearManualItemCost(item.asin)}
                                          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                        >
                                          清空
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setQuoteCostRmb(cost.actualCny);
                                            setCostSource(cost.bestSupplierName === "手工录入" ? "manual" : "captured_1688");
                                            setTargetPriceVal(Number((totalBuyerCents / 100).toFixed(2)));
                                            setBenchmarkAsin(item.asin);
                                            document.getElementById("section-launch")?.scrollIntoView({ behavior: "smooth" });
                                            setStatusMsg({
                                              type: "success",
                                              text: `已将 ${item.asin} 的进价 ¥${cost.actualCny} 与售价带入立项核算面板！`,
                                            });
                                          }}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            color: "var(--green)",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            padding: 0,
                                            textDecoration: "underline",
                                            fontSize: "11px",
                                          }}
                                        >
                                          按此实价立项 →
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <span style={{ color: "var(--ink)" }}>
                                      预估进价上限：
                                      <strong className="mono" style={{ color: maxPurchaseRmb > 0 ? "var(--amber)" : "var(--red)" }}>
                                        {maxPurchaseRmb > 0 ? `≤ ¥${maxPurchaseRmb}` : "客单过低难达 18%"}
                                      </strong>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCostAsin(item.asin);
                                        setEditingCostVal(maxPurchaseRmb > 0 ? String(Math.round(maxPurchaseRmb * 0.7)) : "");
                                      }}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "var(--green)",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        padding: 0,
                                        textDecoration: "underline",
                                        fontSize: "11px",
                                      }}
                                    >
                                      + 手动填进价
                                    </button>
                                  </div>
                                )}
                                {editingCostAsin === item.asin ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>¥</span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0.1"
                                      placeholder="输入人民币进价"
                                      value={editingCostVal}
                                      onChange={(e) => setEditingCostVal(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleSaveManualItemCost(item.asin);
                                        }
                                      }}
                                      style={{
                                        flex: 1,
                                        minWidth: "70px",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        border: "1px solid var(--line)",
                                        background: "var(--paper)",
                                        color: "var(--ink)",
                                        fontSize: "12px",
                                        fontWeight: 700,
                                      }}
                                    />
                                    <button
                                      type="button"
                                      disabled={isSavingItemCost}
                                      onClick={() => handleSaveManualItemCost(item.asin)}
                                      className="button primary"
                                      style={{ fontSize: "11px", padding: "3px 10px", height: "26px" }}
                                    >
                                      {isSavingItemCost ? "保存中" : "保存"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingCostAsin(null)}
                                      className="button ghost"
                                      style={{ fontSize: "11px", padding: "3px 6px", height: "26px" }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                disabled={translatingKey === key}
                                onClick={() => handleSearch1688Translated(item, maxPurchaseRmb, currentReport.sourcingAction?.recommendedKeywords1688)}
                                className="button secondary"
                                style={{ flex: 1, minWidth: "130px", fontSize: "12px", padding: "6px 10px", height: "32px", justifyContent: "center" }}
                                title={cached ? `在 1688 搜索「${cached.keyword}」（GBK 无乱码）` : "自动翻译为中文采购词并在 1688 搜索同款（GBK 编码不乱码）"}
                              >
                                {translatingKey === key
                                  ? "翻译中..."
                                  : cached
                                    ? `🔍 1688搜「${cached.keyword.slice(0, 8)}」`
                                    : "🔍 翻译搜 1688 同款"}
                              </button>
                              {item.imageUrl ? (
                                <button
                                  type="button"
                                  className="button ghost"
                                  style={{ fontSize: "12px", padding: "6px 10px", height: "32px", border: "1px solid var(--line)" }}
                                  title="复制主图链接并打开 1688，点击相机图标粘贴图片链接即可搜同款"
                                  onClick={() => handleDownloadImageAndOpen1688(item, maxPurchaseRmb)}
                                >
                                  📷 复制图链搜同款
                                </button>
                              ) : null}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 4. AI 综合结论（默认无结果，需手动点击触发） */}
          <section id="section-conclusion" className="panel" style={{ padding: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--green)" }}>AI DECISION CONCLUSION · 手动触发</div>
                <h4 style={{ margin: "2px 0 0 0", fontSize: "17px", color: "var(--ink)", fontWeight: 800 }}>
                  AI 综合结论与立项裁决
                </h4>
              </div>
              <button
                type="button"
                className={currentReport.aiConclusion ? "button secondary" : "button primary"}
                disabled={isGeneratingConclusion}
                onClick={handleGenerateConclusion}
                style={{ fontSize: "12px", padding: "7px 14px", height: "34px", borderRadius: "10px" }}
              >
                {isGeneratingConclusion
                  ? "AI 正在综合研判中..."
                  : currentReport.aiConclusion
                    ? "🔄 重新生成 AI 结论"
                    : "✨ 生成 AI 综合结论"}
              </button>
            </div>

            {!currentReport.aiConclusion ? (
              <div
                style={{
                  padding: "20px",
                  borderRadius: "12px",
                  background: "var(--surface-subtle)",
                  border: "1px dashed var(--line)",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "13px",
                  lineHeight: 1.6,
                }}
              >
                当前暂无 AI 综合结论（默认不自动生成，避免无意义消耗额度）。<br />
                建议补齐 1688 进价与买家差评后，点击右上角 <strong>「✨ 生成 AI 综合结论」</strong> 获取最终 GO / HOLD / NO-GO 研判。
              </div>
            ) : (() => {
              const c = currentReport.aiConclusion;
              const verdictBadge =
                c.verdict === "GO"
                  ? "badge-success"
                  : c.verdict === "NO-GO"
                    ? "badge-danger"
                    : "badge-warn";
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: "12px",
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "8px" }}>
                      <span className={`badge ${verdictBadge}`} style={{ fontSize: "13px", fontWeight: 800, padding: "3px 10px" }}>
                        AI 裁决：{c.verdict}
                      </span>
                      <strong style={{ fontSize: "15px", color: "var(--ink)" }}>{c.headline}</strong>
                      {c.bestCandidateAsin ? (
                        <span className="badge badge-neutral mono" style={{ fontSize: "11px" }}>
                          推荐对标：{c.bestCandidateAsin}
                        </span>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--ink)", lineHeight: 1.65 }}>
                      {c.summary}
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                    {c.keyRisks.length > 0 ? (
                      <div style={{ padding: "14px 16px", borderRadius: "12px", background: "var(--red-soft)", border: "1px solid rgba(161, 61, 57, 0.2)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--red)", marginBottom: "6px" }}>
                          ⚠️ 核心风险与证据缺口
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--ink)", lineHeight: 1.55 }}>
                          {c.keyRisks.map((risk, idx) => (
                            <li key={idx} style={{ marginBottom: "3px" }}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {c.recommendedActions.length > 0 ? (
                      <div style={{ padding: "14px 16px", borderRadius: "12px", background: "var(--green-soft)", border: "1px solid rgba(31, 122, 85, 0.25)" }}>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "6px" }}>
                          ✅ 下一步可执行动作
                        </div>
                        <ol style={{ margin: 0, paddingLeft: "18px", fontSize: "12px", color: "var(--ink)", lineHeight: 1.55 }}>
                          {c.recommendedActions.map((act, idx) => (
                            <li key={idx} style={{ marginBottom: "3px" }}>{act}</li>
                          ))}
                        </ol>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--muted)", textAlign: "right" }}>
                    生成模型：{c.modelUsed} · {shortDate(c.generatedAt)}
                  </div>
                </div>
              );
            })()}
          </section>
        </div>
      ) : (
        <section className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
            当前站点暂无竞品研报。系统不会自动生成示例数据 —— 请在上方输入链接、点击「填入示例」，或用浏览器扩展采集真实商品页。
          </p>
        </section>
      )}

      {/* 正式立项成功承接模态弹窗 */}
      {showPromotionSuccess && (promotedCaseId || currentReport?.promotedCaseId) && (
        <div className="promotion-modal-overlay" role="dialog" aria-modal="true">
          <div className="promotion-modal-card">
            <div className="promotion-modal-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3>🎉 正式商品立项成功！</h3>
            <p>
              已从竞品研报建立全新商品案卷。竞品 ASIN 矩阵、反制五点文案与 1688 询价草案均已安全沉淀至案卷档案。
            </p>
            <div className="promotion-modal-meta">
              <div><span>目标售价</span><strong>${targetPriceVal}</strong></div>
              <div><span>1688 实报</span><strong>¥{quoteCostRmb}</strong></div>
              <div><span>机会分</span><strong>{calcOppScore} 分</strong></div>
            </div>
            <div className="promotion-modal-actions">
              <Link
                href={`/cases/${promotedCaseId || currentReport?.promotedCaseId}/sourcing`}
                className="button primary"
                style={{ justifyContent: "center" }}
              >
                立即前往 1688 询价与定标
              </Link>
              <Link
                href={`/cases/${promotedCaseId || currentReport?.promotedCaseId}`}
                className="button secondary"
                style={{ justifyContent: "center" }}
              >
                查看商品案卷与财务模型
              </Link>
              <button
                type="button"
                onClick={() => setShowPromotionSuccess(false)}
                className="button ghost"
              >
                留在当前研报
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
