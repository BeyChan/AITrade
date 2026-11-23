"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  isVerifiedCompetitorField,
  MAX_COMPARISON_REPORTS,
  type CompetitorComparisonReport,
  type CompetitorProfile,
} from "@/lib/competitor-compare/types";
import type { AntiListingResult } from "@/lib/competitor-compare/anti-listing";
import type { SupplierRfqDraft } from "@/lib/competitor-compare/supplier-rfq";
import { shortDate } from "@/lib/format";
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
  reanalyzeCompetitorReportAction,
  runCompetitorAnalysisAction,
  saveCompetitorItemShippingAction,
  saveCompetitorManualCostAction,
  translateTo1688KeywordAction,
} from "./actions";
import {
  PROVENANCE_LABELS,
  PROVENANCE_VERIFIED,
  SAMPLE_PRESETS,
  estimateMaxPurchaseRmb,
  getBuyerTotalPriceCents,
} from "./_components/helpers";
import { AntiListingPanel } from "./_components/anti-listing-panel";
import { SupplierRfqPanel } from "./_components/supplier-rfq-panel";
import { MarketOverviewSection } from "./_components/market-overview-section";
import { CompetitorPkMatrix } from "./_components/competitor-pk-matrix";
import { AiConclusionSection } from "./_components/ai-conclusion-section";

type Props = {
  initialReports: CompetitorComparisonReport[];
  initialReportId?: string;
  currentMarket: string;
  currentPlatform: string;
};

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
  const estMarginRate = economics.marginRate;

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
              href={`/ai-sourcing/${encodeURIComponent(convertBatchId)}?tab=profit`}
              className="button secondary"
              style={{ padding: "4px 10px", fontSize: "12px", height: "auto" }}
            >
              进入选品工作台算毛利 &rarr;
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
                title={isConfirmed ? "加入选品看板，进入第 2 步利润测算" : "请先点击「我已核对，确认可用」"}
                onClick={() => handleConvertToHypothesis(currentReport.id)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px" }}
              >
                加入选品看板（去算毛利）→
              </button>
            </div>
          </section>


          {/* 反制 Listing 创作面板 */}
          {antiListing && (
            <AntiListingPanel
              antiListing={antiListing}
              bulletsCopied={bulletsCopied}
              availableCases={availableCases}
              selectedCaseId={selectedCaseId}
              isApplyingCase={isApplyingCase}
              isConfirmed={isConfirmed}
              appliedSuccessCaseId={appliedSuccessCaseId}
              applyFindings={applyFindings}
              onCopyBulletsText={handleCopyBulletsText}
              onClose={() => setAntiListing(null)}
              onSelectCaseId={setSelectedCaseId}
              onApplyToCase={handleApplyToCase}
            />
          )}

          {/* 1688 定制改良询价单 (RFQ) 面板 */}
          {rfqData && (
            <SupplierRfqPanel
              rfqData={rfqData}
              rfqCopied={rfqCopied}
              onCopyRfqText={handleCopyRfqText}
              onClose={() => setRfqData(null)}
            />
          )}

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
              <a href="#section-conclusion" className="button ghost" style={{ fontSize: "12px", padding: "4px 10px", height: "28px" }}>
                ③ AI 结论
              </a>
            </div>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
              {isSingleProduct
                ? "单品深挖模式：已自动隐藏多品格局图与价格分位噪声"
                : `多品对标模式 · 共 ${currentReport.competitors.length} 款竞品`}
            </span>
          </nav>


          <MarketOverviewSection
            currentReport={currentReport}
            isEstimated={isEstimated}
            isSingleProduct={isSingleProduct}
            showIndexHelp={showIndexHelp}
            setShowIndexHelp={setShowIndexHelp}
            benchmarkAsin={benchmarkAsin}
            targetPriceVal={targetPriceVal}
            targetPriceCents={targetPriceCents}
            estMarginRate={estMarginRate}
            formatPrice={formatPrice}
            handleSelectBenchmark={handleSelectBenchmark}
          />

          <CompetitorPkMatrix
            currentReport={currentReport}
            currency={currency}
            isSingleProduct={isSingleProduct}
            isReanalyzing={isReanalyzing}
            removingAsin={removingAsin}
            translatingKey={translatingKey}
            translatedKwMap={translatedKwMap}
            editingCostAsin={editingCostAsin}
            setEditingCostAsin={setEditingCostAsin}
            editingCostVal={editingCostVal}
            setEditingCostVal={setEditingCostVal}
            isSavingItemCost={isSavingItemCost}
            editingShippingAsin={editingShippingAsin}
            setEditingShippingAsin={setEditingShippingAsin}
            editingShippingVal={editingShippingVal}
            setEditingShippingVal={setEditingShippingVal}
            isSavingShipping={isSavingShipping}
            setQuoteCostRmb={setQuoteCostRmb}
            setCostSource={setCostSource}
            setTargetPriceVal={setTargetPriceVal}
            setBenchmarkAsin={setBenchmarkAsin}
            setStatusMsg={setStatusMsg}
            formatPrice={formatPrice}
            handleClearManualItemCost={handleClearManualItemCost}
            handleSaveManualItemCost={handleSaveManualItemCost}
            handleSaveItemShipping={handleSaveItemShipping}
            handleSearch1688Translated={handleSearch1688Translated}
            handleDownloadImageAndOpen1688={handleDownloadImageAndOpen1688}
            handleReanalyze={handleReanalyze}
          />

          <AiConclusionSection
            currentReport={currentReport}
            isGeneratingConclusion={isGeneratingConclusion}
            handleGenerateConclusion={handleGenerateConclusion}
          />
        </div>
      ) : (
        <section className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
            当前站点暂无竞品研报。系统不会自动生成示例数据 —— 请在上方输入链接、点击「填入示例」，或用浏览器扩展采集真实商品页。
          </p>
        </section>
      )}
    </div>
  );
}

