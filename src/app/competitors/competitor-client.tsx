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
import {
  applyAntiListingToCaseAction,
  confirmComparisonReportAction,
  convertReportToHypothesisAction,
  deleteComparisonReportAction,
  generateAntiListingAction,
  generateSupplierRfqAction,
  getAvailableCasesAction,
  runCompetitorAnalysisAction,
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

  useEffect(() => {
    getAvailableCasesAction(currentMarket, currentPlatform).then((cases) => {
      setAvailableCases(cases);
      if (cases[0]) setSelectedCaseId(cases[0].id);
    });
  }, [currentMarket, currentPlatform]);

  const currentReport = siteReports.find((r) => r.id === selectedReportId) || siteReports[0] || null;
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
        setStatusMsg({ type: "success", text: "AI 竞品对比分析已完成！" });
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
          text: `已成功将该竞品对比转入选品池！批次 ID: ${res.batchId.slice(0, 8)}...`,
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
        reviewer.trim() || "竞品对比工作台",
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
              输入链接，自动生成竞品对比研报
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
                background: "#fbfcfa",
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
                  color: isSelected ? "var(--lime)" : "var(--ink)",
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
                    color: isSelected ? "rgba(255,255,255,0.6)" : "var(--muted)",
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
            <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>
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
                <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
                  {currentReport.marketCode} · {currentReport.platformCode.toUpperCase()}
                </span>
                <span
                  className={`badge ${PROVENANCE_VERIFIED.includes(currentReport.provenance) ? "badge-success" : "badge-warn"}`}
                  style={{ fontSize: "11px" }}
                  title="报告整体来源"
                >
                  {PROVENANCE_LABELS[currentReport.provenance]}
                </span>
                <span className={`badge ${isConfirmed ? "badge-success" : "badge-warn"}`} style={{ fontSize: "11px" }}>
                  {isConfirmed ? "已人工核对" : "待人工核对"}
                </span>
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {new Date(currentReport.createdAt).toLocaleDateString()}
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
            <section className="panel" style={{ padding: "24px", background: "#fbfdfc", border: "1.5px solid var(--green)" }}>
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
              <div style={{ background: "#ffffff", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
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
                      background: "#ffffff",
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "12px", color: "var(--green)" }}>{b.headline}</strong>
                      <span
                        style={{
                          fontSize: "11px",
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
                <div style={{ background: "#f5f8f5", padding: "14px", borderRadius: "10px", border: "1px solid var(--line)", marginBottom: "16px" }}>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", marginBottom: "8px" }}>
                    🖼️ A+ 页面差异化模块构想（只描述本品，不贬损竞品）：
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "10px" }}>
                    {antiListing.aplusModules.map((m, mi) => (
                      <div key={mi} style={{ background: "#ffffff", padding: "10px 12px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "11px" }}>
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
                  background: "#ffffff",
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
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>
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
                          background: "#fbfcfa",
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
            <section className="panel" style={{ padding: "24px", background: "#fbfcfc", border: "1.5px solid #28543f" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <div className="eyebrow" style={{ color: "#28543f" }}>SUPPLIER SOURCING RFQ · 1688 工业改良询价单</div>
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
                <div style={{ background: "#ffffff", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>目标采购单价: </span>
                  <strong style={{ fontSize: "14px", color: "var(--green)" }}>¥{rfqData.targetPriceRmb.toFixed(2)}</strong>
                </div>
                <div style={{ background: "#ffffff", padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>建议试单 MOQ: </span>
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
                        background: "#ffffff",
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
                        <span style={{ color: "var(--red)", fontSize: "11px", background: "var(--red-soft)", padding: "1px 6px", borderRadius: "4px" }}>
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
                <div style={{ background: "#f5f8f5", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)", marginBottom: "16px" }}>
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
              <div style={{ background: "#ffffff", padding: "12px 14px", borderRadius: "8px", border: "1px solid var(--line)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--muted)" }}>阿里旺旺 / 微信工厂对接话术预览：</span>
                  <button
                    type="button"
                    onClick={() => handleCopyRfqText(rfqData)}
                    style={{ background: "none", border: "none", color: "var(--green)", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}
                  >
                    {rfqCopied ? "已复制" : "复制文本"}
                  </button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: "11px",
                    lineHeight: "1.5",
                    color: "var(--ink)",
                    fontFamily: "ui-monospace, monospace",
                    background: "#fbfcfb",
                    padding: "10px",
                    borderRadius: "6px",
                  }}
                >
                  {rfqData.formattedText}
                </pre>
              </div>
            </section>
          )}

          {/* 0. 科学量化：商品指数 (Product Index, 0~100 分) */}
          {(() => {
            const index = currentReport.productIndex || calculateProductIndex(currentReport);
            const isS = index.grade === "S";
            const isA = index.grade === "A";
            const isB = index.grade === "B";

            const themeColor = isS
              ? "var(--green)"
              : isA
              ? "#1d6a3a"
              : isB
              ? "var(--amber)"
              : "var(--red)";
            const themeBg = isS
              ? "var(--green-soft)"
              : isA
              ? "#edf7f1"
              : isB
              ? "var(--amber-soft)"
              : "var(--red-soft)";

            return (
              <section className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                  <div>
                    <div className="eyebrow" style={{ color: themeColor }}>
                      QUANTITATIVE RETAIL MODEL · 科学量化判定
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px" }}>
                      <h4 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
                        商品指数 (Product Index)
                      </h4>
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

                {/* 指标关系说明抽屉 */}
                {showIndexHelp && (
                  <div
                    style={{
                      background: "#f0f4f1",
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
                    background: "#f8faf8",
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
                      <span style={{ fontSize: "11px", fontWeight: 700, color: themeColor, marginTop: "2px" }}>
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

                  {/* 右侧：5 大量化支柱得分明细 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {Object.values(index.pillars).map((p) => {
                      const percent = Math.round((p.score / p.max) * 100);
                      return (
                        <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <strong style={{ color: "var(--ink)" }}>{p.label}</strong>
                              <span
                                style={{
                                  fontSize: "11px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  background: "#e8ede9",
                                  color: "var(--muted)",
                                  fontFamily: "ui-monospace, monospace",
                                }}
                              >
                                {p.metricValue}
                              </span>
                            </div>
                            <div>
                              <strong style={{ color: themeColor }}>{p.score}</strong>
                              <span style={{ color: "var(--muted)" }}> / {p.max} 分</span>
                            </div>
                          </div>

                          {/* 进度条 */}
                          <div
                            style={{
                              width: "100%",
                              height: "6px",
                              background: "#e5eae6",
                              borderRadius: "3px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                background: themeColor,
                                borderRadius: "3px",
                                transition: "width 0.4s ease",
                              }}
                            />
                          </div>

                          <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: "1.35" }}>
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

          {/* 1. 价格分位数带与大盘基准 */}
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

            {isEstimated && (
              <div
                className="notice warn"
                style={{ marginBottom: "14px", fontSize: "12px", lineHeight: "1.5" }}
                role="status"
              >
                <strong>待核实 · 不可用于定价判断：</strong>
                当前没有任何浏览器采集或人工录入的真实售价，下列分位来自 AI / 本地模板的示意值，也不会计入选品门禁。请用扩展采集真实价格或在此研报基础上人工补录。
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "12px",
              }}
            >
              <div
                style={{
                  background: "#f8faf8",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>最低售价 (Min)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.min, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "#f8faf8",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>P25 分位价</div>
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
                <div style={{ fontSize: "11px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
                  黄金中位价 (P50)
                </div>
                <div style={{ fontSize: "19px", fontWeight: 800, color: "var(--green)" }}>
                  {formatPrice(currentReport.priceStats.p50, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "#f8faf8",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>P75 分位价</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p75, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "#f8faf8",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>P90 溢价门槛</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p90, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "#f8faf8",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "4px" }}>最高售价 (Max)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.max, currentReport.currency)}
                </div>
              </div>
            </div>
          </section>

          {/* 2. 竞品多维横向 PK 矩阵 */}
          <section className="panel" style={{ padding: "24px" }}>
            <div style={{ marginBottom: "18px" }}>
              <div className="eyebrow" style={{ color: "var(--green)" }}>横向 PK 对标</div>
              <h4 style={{ margin: "2px 0 4px 0", fontSize: "16px", color: "var(--ink)" }}>
                竞品核心卖点与差评痛点对决
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
                      background: "#ffffff",
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span
                          className={`badge ${isBudget ? "badge-neutral" : isPremium ? "badge-warn" : "badge-success"}`}
                          style={{ fontSize: "11px" }}
                        >
                          {isBudget ? "低价入门" : isPremium ? "高端溢价" : "中端主力"}
                        </span>
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
                          {item.asin} ↗
                        </a>
                      </div>

                      <h5
                        style={{
                          margin: "0 0 10px 0",
                          fontSize: "14px",
                          lineHeight: "1.4",
                          color: "var(--ink)",
                          fontWeight: 700,
                        }}
                      >
                        [{item.brand}] {item.title}
                      </h5>

                      {/* 价格与销售表现 */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "8px",
                          paddingBottom: "12px",
                          marginBottom: "14px",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        <span style={{ fontSize: "20px", fontWeight: 800, color: "var(--ink)" }}>
                          {formatPrice(item.priceCents, item.currency)}
                        </span>
                        <span style={{ fontSize: "12px", color: "var(--amber)", fontWeight: 700 }}>
                          ★ {item.rating}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                          ({item.reviewCount.toLocaleString()} 评 · 约 {item.monthlySalesEst} 件/月)
                        </span>
                      </div>
                      {!isVerifiedCompetitorField(item, "priceCents") && (
                        <div style={{ fontSize: "11px", color: "var(--amber)", marginTop: "-8px", marginBottom: "12px" }}>
                          售价、评分、评论数、销量为推断值（待核实），不计入价格分位与选品门禁
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
                            background: "#f8faf8",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            marginBottom: "12px",
                            fontSize: "11px",
                          }}
                        >
                          <div style={{ color: "var(--muted)", marginBottom: "4px", fontWeight: 600 }}>参数对标：</div>
                          {Object.entries(item.specifications).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", color: "var(--ink)", padding: "1px 0" }}>
                              <span style={{ color: "var(--muted)" }}>{k}:</span>
                              <span style={{ fontWeight: 600 }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 目标人群 */}
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "12px", lineHeight: "1.4" }}>
                        <strong style={{ color: "var(--ink)" }}>主要受众:</strong> {item.targetAudience}
                      </div>
                    </div>

                    {/* AI 单品简评 */}
                    <div
                      style={{
                        borderTop: "1px dashed var(--line)",
                        paddingTop: "8px",
                        fontSize: "11px",
                        color: "var(--muted)",
                        lineHeight: "1.4",
                      }}
                    >
                      <strong>诊断:</strong> {item.verdict}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. 操盘手破局建议与 1688 货源线索 */}
          <section className="panel" style={{ padding: "24px" }}>
            <div style={{ marginBottom: "16px" }}>
              <div className="eyebrow" style={{ color: "var(--green)" }}>破局推演</div>
              <h4 style={{ margin: "2px 0 0 0", fontSize: "16px", color: "var(--ink)" }}>
                综合进攻策略与供应链线索
              </h4>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
              {/* 左侧：打法分析 */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: "12px",
                    background: "var(--red-soft)",
                    border: "1px solid rgba(161, 61, 57, 0.2)",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--red)", marginBottom: "6px" }}>
                    🎯 行业通病与差评机会缺口
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "var(--ink)", lineHeight: "1.5" }}>
                    {currentReport.summary.commonWeaknesses.map((w, idx) => (
                      <li key={idx} style={{ marginBottom: "2px" }}>{w}</li>
                    ))}
                  </ul>
                </div>

                <div
                  style={{
                    padding: "14px 16px",
                    borderRadius: "12px",
                    background: "var(--green-soft)",
                    border: "1px solid rgba(31, 122, 85, 0.3)",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", marginBottom: "6px" }}>
                    🚀 推荐进攻切入策略 (Attack Vector)
                  </div>
                  <p style={{ margin: 0, fontSize: "13px", lineHeight: "1.5", color: "var(--ink)" }}>
                    {currentReport.summary.attackVector}
                  </p>
                </div>
              </div>

              {/* 右侧：1688 货源线索 */}
              <div
                style={{
                  padding: "16px",
                  borderRadius: "12px",
                  background: "#f8faf8",
                  border: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "10px" }}>
                    1688 货源搜索词
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "16px" }}>
                    {currentReport.sourcingAction.recommendedKeywords1688.map((kw, i) => (
                      <a
                        key={i}
                        href={`https://s.1688.com/youxuan.html?keywords=${encodeURIComponent(kw)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="button secondary"
                        style={{ fontSize: "12px", padding: "4px 10px", height: "auto", borderRadius: "8px" }}
                      >
                        🔍 {kw} ↗
                      </a>
                    ))}
                  </div>

                  <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.6" }}>
                    <div>
                      建议到岸采购上限:{" "}
                      <strong style={{ color: "var(--ink)" }}>
                        ¥{(currentReport.sourcingAction.suggestedCostCents / 100).toFixed(2)}
                      </strong>
                    </div>
                    <div>
                      目标毛利率基准:{" "}
                      <strong style={{ color: "var(--green)" }}>
                        {currentReport.sourcingAction.targetMarginPercent}%
                      </strong>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <Link
                    href={`/sourcing?query=${encodeURIComponent(
                      currentReport.sourcingAction.recommendedKeywords1688[0] || "",
                    )}`}
                    className="button secondary"
                    style={{ width: "100%", justifyContent: "center", fontSize: "12px" }}
                  >
                    前往供应商找货 &rarr;
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <section className="panel" style={{ padding: "48px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
            当前站点暂无竞品对比报告。系统不会自动生成示例数据 —— 请在上方输入链接、点击「填入示例」，或用浏览器扩展采集真实商品页。
          </p>
        </section>
      )}
    </div>
  );
}
