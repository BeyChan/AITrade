"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { CompetitorComparisonReport, CompetitorProfile } from "@/lib/competitor-compare/types";
import { calculateProductIndex } from "@/lib/competitor-compare/competitiveness";
import {
  convertReportToHypothesisAction,
  deleteComparisonReportAction,
  runCompetitorAnalysisAction,
} from "./actions";

type Props = {
  initialReports: CompetitorComparisonReport[];
  currentMarket: string;
  currentPlatform: string;
};

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

export function CompetitorClient({ initialReports, currentMarket, currentPlatform }: Props) {
  const [reports, setReports] = useState<CompetitorComparisonReport[]>(initialReports);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(
    initialReports[0]?.id || null,
  );

  const [rawInputs, setRawInputs] = useState("");
  const [isPending, startTransition] = useTransition();
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [convertBatchId, setConvertBatchId] = useState<string | null>(null);
  const [showIndexHelp, setShowIndexHelp] = useState(false);

  const currentReport = reports.find((r) => r.id === selectedReportId) || reports[0] || null;

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
        setSelectedReportId(reports.find((r) => r.id !== id)?.id || null);
      }
    });
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

  const handleCopyMarkdown = (report: CompetitorComparisonReport) => {
    const md = [
      `# ${report.title}`,
      `**国家/平台**: ${report.marketCode} · ${report.platformCode} | **币种**: ${report.currency} | **分析时间**: ${new Date(report.createdAt).toLocaleString()}`,
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
              输入 1~4 个竞品链接或 ASIN。系统结合当前右上角选定站点（{currentMarket} · {currentPlatform}），
              由 AI 提取核心特点、挖掘真实差评痛点并计算价格分位数矩阵。
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
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "2px", alignItems: "center" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)", whiteSpace: "nowrap", fontWeight: 600 }}>
            对比历史:
          </span>
          {reports.map((r) => {
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
                <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                  {new Date(currentReport.createdAt).toLocaleDateString()}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
                disabled={isPending}
                onClick={() => handleConvertToHypothesis(currentReport.id)}
                style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "10px" }}
              >
                沉淀为选品假设
              </button>
            </div>
          </section>

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
                    决策建议: {index.decision}
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
                      💡 <strong>建议工作流：</strong>当前竞品对比「商品指数」评级达到 A/S 级时，点击右上方【沉淀为选品假设】，系统将自动带入竞品数据前往 1688 询价并核算最终的财务「机会分」。
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
                样本覆盖: <strong>{currentReport.competitors.length}</strong> 款有效对标竞品
              </span>
            </div>

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
            暂无已生成的竞品对比报告。请在上方输入链接或点击“填入示例”，即可生成多维横向 PK 报告。
          </p>
        </section>
      )}
    </div>
  );
}
