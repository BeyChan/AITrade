"use client";

import Link from "next/link";
import { useState } from "react";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import type { EnrichedCase, SourcingCaseSummary } from "@/lib/types";
import { money, percent } from "@/lib/format";

export type AttentionTask = {
  label: string;
  value: number;
  detail: string;
  href: string;
  action: string;
};

type Props = {
  marketCode: string;
  platformCode: string;
  currency: string;
  competitorReports: CompetitorComparisonReport[];
  cases: EnrichedCase[];
  sourcingCases: SourcingCaseSummary[];
  attentionTasks?: AttentionTask[];
  proposalsTotal?: number;
};

export function DashboardPipelineKanban({
  marketCode,
  platformCode,
  currency,
  competitorReports,
  cases,
  sourcingCases,
  attentionTasks = [],
  proposalsTotal = 0,
}: Props) {
  const [activeTab, setActiveTab] = useState<"kanban" | "list">("kanban");

  const sourcingMap = new Map(sourcingCases.map((s) => [s.productCase.id, s]));

  // 1. 竞品初筛阶段（只过滤当前站点的初筛研报）
  const stage1Items = competitorReports.filter(
    (r) => r.marketCode === marketCode && r.platformCode === platformCode,
  );

  // 严格互斥状态机：过滤已否决案卷，确保每个商品案卷在 Stage 2~5 有且仅归属于一个唯一阶段
  const activeCases = cases.filter((c) => c.status !== "rejected");

  // 2. 寻源询价阶段：已立项但尚无任何 1688/源头工厂报价
  const stage2Items = activeCases.filter((c) => {
    const s = sourcingMap.get(c.id);
    return c.status === "approved" && (!s || s.quoteCount === 0);
  });

  // 3. 财务与立项核准阶段：待立项评审 (review_pending) 或 已有多家报价但尚未定标决标
  const stage3Items = activeCases.filter((c) => {
    const s = sourcingMap.get(c.id);
    if (c.status === "review_pending") return true;
    return c.status === "approved" && s && s.quoteCount > 0 && !s.selection;
  });

  // 4. 内容制作打磨阶段：已定标供应商，但 Listing 文案/主图尚未最终锁定就绪
  const stage4Items = activeCases.filter((c) => {
    const s = sourcingMap.get(c.id);
    const hasSelectedSupplier = Boolean(s?.selection);
    const isLaunchReady = c.notes?.includes("[READY_FOR_LAUNCH]") || c.evidence_score >= 75;
    return c.status === "approved" && hasSelectedSupplier && !isLaunchReady;
  });

  // 5. 渠道就绪阶段：已定标工厂且内容合规完成，准备导出 Flat File / 铺货发布
  const stage5Items = activeCases.filter((c) => {
    const s = sourcingMap.get(c.id);
    const hasSelectedSupplier = Boolean(s?.selection);
    const isLaunchReady = c.notes?.includes("[READY_FOR_LAUNCH]") || c.evidence_score >= 75;
    return c.status === "approved" && hasSelectedSupplier && isLaunchReady;
  });

  // 将外层待办精准映射到各业务阶段列头
  const taskMap = new Map((attentionTasks || []).map((t) => [t.label, t]));
  const stage1Task = taskMap.get("待确认 AI 提案") || taskMap.get("待补证据");
  const stage2Task = taskMap.get("待录入报价") || taskMap.get("待审 RFQ 草稿");
  const stage3Task = taskMap.get("待决策门禁") || taskMap.get("待对比定标");
  const stage4Task = taskMap.get("待制作内容");

  const columns = [
    {
      id: "stage1",
      stepNum: "1",
      title: "竞品初筛",
      subtitle: "链接采集 · 指数测算",
      count: stage1Items.length,
      focusTask: stage1Task,
      badgeColor: "#3766a6",
      badgeBg: "#e8f0fc",
      items: stage1Items.slice(0, 6).map((r) => ({
        id: r.id,
        title: r.title,
        tag: `${r.competitors.length} 款竞品`,
        metricLabel: "价格中位",
        metricVal: r.priceStats.p50 ? `${(r.priceStats.p50 / 100).toFixed(1)} ${r.currency}` : "待采集",
        href: `/competitors?reportId=${r.id}`,
        actionText: "竞品 PK 研报 →",
      })),
      emptyText: "暂无初筛研报，可在侧边栏「竞品对比」录入链接",
    },
    {
      id: "stage2",
      stepNum: "2",
      title: "寻源询价",
      subtitle: "1688 RFQ · 样品询价",
      count: stage2Items.length,
      focusTask: stage2Task,
      badgeColor: "#a96610",
      badgeBg: "#fff3d9",
      items: stage2Items.slice(0, 6).map((c) => ({
        id: c.id,
        title: c.title,
        tag: c.category || "待分类",
        metricLabel: "预估售价",
        metricVal: money(c.competitor_price_cents),
        href: `/cases/${c.id}/sourcing`,
        actionText: "录入工厂报价 →",
      })),
      emptyText: "所有商品均已录入供应商报价",
    },
    {
      id: "stage3",
      stepNum: "3",
      title: "财务核准",
      subtitle: "压力测试 · 机会分保本",
      count: stage3Items.length,
      focusTask: stage3Task,
      badgeColor: "#9333ea",
      badgeBg: "#f3e8ff",
      items: stage3Items.slice(0, 6).map((c) => {
        const res = c.costModel?.results;
        return {
          id: c.id,
          title: c.title,
          tag: `机会分 ${c.opportunityScore}`,
          metricLabel: "测算净利",
          metricVal: res ? money(res.netProfitCents) : "—",
          href: `/cases/${c.id}/sourcing`,
          actionText: "定标审批 →",
        };
      }),
      emptyText: "无待审批商品",
    },
    {
      id: "stage4",
      stepNum: "4",
      title: "内容打磨",
      subtitle: "反制五点 · A+ 视觉",
      count: stage4Items.length,
      focusTask: stage4Task,
      badgeColor: "#1f7a55",
      badgeBg: "#e2f5ea",
      items: stage4Items.slice(0, 6).map((c) => ({
        id: c.id,
        title: c.title,
        tag: `已立项 · ${c.asin}`,
        metricLabel: "选品分",
        metricVal: `${c.opportunityScore} 分`,
        href: `/cases/${c.id}/content`,
        actionText: "打磨 Listing →",
      })),
      emptyText: "暂无进行中的内容任务",
    },
    {
      id: "stage5",
      stepNum: "5",
      title: "渠道就绪",
      subtitle: "合规检测 · 渠道推送",
      count: stage5Items.length,
      focusTask: undefined,
      badgeColor: "#10251c",
      badgeBg: "#dfe6e0",
      items: stage5Items.slice(0, 6).map((c) => ({
        id: c.id,
        title: c.title,
        tag: "SP-API / CSV",
        metricLabel: "置信度",
        metricVal: `${c.evidence_score}%`,
        href: `/content`,
        actionText: "查看上架矩阵 →",
      })),
      emptyText: "暂无已完成准备的商品",
    },
  ];

  const totalActive = stage1Items.length + stage2Items.length + stage3Items.length + stage4Items.length + stage5Items.length;

  return (
    <section className="panel" style={{ padding: "24px", marginBottom: "24px" }}>
      {/* 头部标题与视图切换 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <span className="eyebrow" style={{ color: "var(--green)", margin: 0, lineHeight: 1 }}>
              LIFECYCLE PIPELINE · 操盘手业务大盘
            </span>
            <span className="badge badge-success" style={{ fontSize: "11px", margin: 0, lineHeight: 1, display: "inline-flex", alignItems: "center" }}>
              活跃管道: {totalActive} 项
            </span>
          </div>
          <h2 style={{ margin: "2px 0 0 0", fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
            全生命周期业务推进看板 ({marketCode} 站 · {platformCode.toUpperCase()})
          </h2>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div
            style={{
              display: "inline-flex",
              background: "#edf2ee",
              borderRadius: "8px",
              padding: "2px",
            }}
          >
            <button
              type="button"
              onClick={() => setActiveTab("kanban")}
              style={{
                border: "none",
                background: activeTab === "kanban" ? "#ffffff" : "transparent",
                color: activeTab === "kanban" ? "var(--ink)" : "var(--muted)",
                fontWeight: activeTab === "kanban" ? 700 : 500,
                fontSize: "12px",
                padding: "4px 10px",
                borderRadius: "6px",
                boxShadow: activeTab === "kanban" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              5 阶漏斗看板
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("list")}
              style={{
                border: "none",
                background: activeTab === "list" ? "#ffffff" : "transparent",
                color: activeTab === "list" ? "var(--ink)" : "var(--muted)",
                fontWeight: activeTab === "list" ? 700 : 500,
                fontSize: "12px",
                padding: "4px 10px",
                borderRadius: "6px",
                boxShadow: activeTab === "list" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              紧凑列表
            </button>
          </div>
        </div>
      </div>

      {activeTab === "kanban" ? (
        /* 5 阶段水平看板泳道 */
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: "14px",
            alignItems: "stretch",
          }}
        >
          {columns.map((col) => (
            <div
              key={col.id}
              style={{
                background: "#fbfcfb",
                borderRadius: "12px",
                border: "1px solid var(--line)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {/* 列头部 */}
              <div
                style={{
                  padding: "12px 14px",
                  borderBottom: "1px solid var(--line)",
                  background: "#ffffff",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        background: col.badgeBg,
                        color: col.badgeColor,
                        fontSize: "11px",
                        fontWeight: 800,
                        display: "inline-grid",
                        placeItems: "center",
                      }}
                    >
                      {col.stepNum}
                    </span>
                    <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{col.title}</strong>
                  </div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                    {col.subtitle}
                  </div>
                </div>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: "10px",
                    background: col.badgeBg,
                    color: col.badgeColor,
                    fontSize: "11px",
                    fontWeight: 700,
                  }}
                >
                  {col.count}
                </span>
              </div>

              {/* 卡片流 */}
              <div
                style={{
                  padding: "10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  flex: 1,
                  minHeight: "140px",
                }}
              >
                {/* 方案 A: Linear 风格置顶待办行动卡 (与下方卡片完全同宽同构，自然融入) */}
                {col.focusTask && (
                  <Link
                    href={col.focusTask.href}
                    style={{
                      background: "linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%)",
                      border: "1px solid #bbf7d0",
                      borderRadius: "8px",
                      padding: "10px 12px",
                      textDecoration: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      boxShadow: "0 1px 3px rgba(22, 101, 52, 0.04)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 800,
                          color: "var(--green)",
                          background: "#dcfce7",
                          padding: "1px 6px",
                          borderRadius: "4px",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        ⚡ 待办行动
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 800,
                          color: "#fff",
                          background: "var(--green)",
                          borderRadius: "10px",
                          padding: "0 6px",
                          lineHeight: "16px",
                        }}
                      >
                        {col.focusTask.value} 项
                      </span>
                    </div>

                    <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", lineHeight: 1.35 }}>
                      {col.focusTask.label}
                    </div>

                    <div style={{ fontSize: "10.5px", color: "var(--muted)", lineHeight: 1.3 }}>
                      {col.focusTask.detail}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "var(--green)",
                        borderTop: "1px dashed #dcfce7",
                        paddingTop: "4px",
                        marginTop: "2px",
                      }}
                    >
                      {col.focusTask.action} →
                    </div>
                  </Link>
                )}
                {col.items.length > 0 ? (
                  col.items.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: "#ffffff",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "var(--ink)",
                          lineHeight: "1.3",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {item.title}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                        <span style={{ color: "var(--muted)", background: "#f5f7f5", padding: "1px 6px", borderRadius: "4px" }}>
                          {item.tag}
                        </span>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ color: "var(--muted)", fontSize: "10px" }}>{item.metricLabel}: </span>
                          <strong style={{ color: "var(--green)" }}>{item.metricVal}</strong>
                        </div>
                      </div>

                      <div style={{ borderTop: "1px dashed var(--line)", paddingTop: "6px", marginTop: "2px" }}>
                        <Link
                          href={item.href}
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: col.badgeColor,
                            display: "inline-block",
                          }}
                        >
                          {item.actionText}
                        </Link>
                      </div>
                    </div>
                  ))
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      color: "var(--muted)",
                      fontSize: "11px",
                      padding: "24px 8px",
                      lineHeight: "1.4",
                    }}
                  >
                    {col.emptyText}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* 紧凑汇总列表 */
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {cases.slice(0, 8).map((c) => {
            const res = c.costModel?.results;
            const s = sourcingMap.get(c.id);
            const statusLabel =
              c.status === "approved"
                ? "已立项通过"
                : c.status === "review_pending"
                ? "待财务核准"
                : "调研中";
            return (
              <div
                key={c.id}
                style={{
                  background: "#ffffff",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className="badge badge-neutral" style={{ fontSize: "11px" }}>
                    {c.asin}
                  </span>
                  <strong style={{ color: "var(--ink)" }}>{c.title}</strong>
                  <span style={{ color: "var(--muted)" }}>({c.category})</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div>
                    <span style={{ color: "var(--muted)" }}>机会分: </span>
                    <strong style={{ color: "var(--green)" }}>{c.opportunityScore}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>单件净利: </span>
                    <strong>{res ? money(res.netProfitCents) : "—"}</strong>
                  </div>
                  <span className="badge badge-success">{statusLabel}</span>
                  <Link href={`/cases/${c.id}/report`} className="button secondary" style={{ fontSize: "11px", padding: "4px 8px", height: "auto" }}>
                    🖨️ 打印报告
                  </Link>
                  <Link href={`/cases/${c.id}`} className="button secondary" style={{ fontSize: "11px", padding: "4px 10px", height: "auto" }}>
                    进入案卷 &rarr;
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
