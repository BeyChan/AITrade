"use client";

import Link from "next/link";
import { useState } from "react";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { money } from "@/lib/format";
import {
  groupCaseActionQueue,
  type CaseActionQueueItem,
  type CaseActionQueueStage,
} from "@/lib/case-stage";

type Props = {
  marketCode: string;
  platformCode: string;
  currency: string;
  competitorReports: CompetitorComparisonReport[];
  actionQueue: CaseActionQueueItem[];
};

type ColumnMeta = {
  id: CaseActionQueueStage;
  stepNum: string;
  title: string;
  subtitle: string;
  badgeColor: string;
  badgeBg: string;
  viewAllHref: string;
  emptyText: string;
};

const COLUMN_META: ColumnMeta[] = [
  {
    id: "stage1",
    stepNum: "1",
    title: "选品与利润",
    subtitle: "竞品研报 · 成本模型 · NO-GO 门禁",
    badgeColor: "var(--blue)",
    badgeBg: "var(--blue-soft)",
    viewAllHref: "/competitors",
    emptyText: "暂无待补门禁的案卷或未立项研报",
  },
  {
    id: "stage2",
    stepNum: "2",
    title: "供应商报价与打样",
    subtitle: "录入真实报价 · 拿样验收",
    badgeColor: "var(--amber)",
    badgeBg: "var(--amber-soft)",
    viewAllHref: "/sourcing",
    emptyText: "所有商品均已录入工厂报价",
  },
  {
    id: "stage3",
    stepNum: "3",
    title: "人工定标",
    subtitle: "多厂对比 · 人工确认中标",
    badgeColor: "#a855f7",
    badgeBg: "rgba(168, 85, 247, 0.14)",
    viewAllHref: "/sourcing",
    emptyText: "无待人工定标商品",
  },
  {
    id: "stage4",
    stepNum: "4",
    title: "文案与视觉",
    subtitle: "视觉工坊 · 人工终审",
    badgeColor: "var(--green)",
    badgeBg: "var(--green-soft)",
    viewAllHref: "/content",
    emptyText: "暂无进行中的内容任务",
  },
  {
    id: "stage5",
    stepNum: "5",
    title: "上架交付",
    subtitle: "Flat File · 素材包完整度",
    badgeColor: "var(--ink)",
    badgeBg: "var(--surface-subtle)",
    viewAllHref: "/cases",
    emptyText: "暂无待导出交付资料的案卷",
  },
];

function gateClass(tradeGate: CaseActionQueueItem["tradeGate"]) {
  if (tradeGate === "GO") return "is-go";
  if (tradeGate === "NO-GO") return "is-no-go";
  return "is-hold";
}

function gateLabel(tradeGate: CaseActionQueueItem["tradeGate"]) {
  if (tradeGate === "NO-GO_EXCEPTION") return "NO-GO 例外放行";
  return tradeGate;
}

function WorkflowAction({ item }: { item: CaseActionQueueItem }) {
  if (item.actionKind === "download") {
    return (
      <a href={item.href} download className="kanban-action-primary">
        {item.actionLabel}
      </a>
    );
  }
  if (item.actionKind === "none") {
    return <span className="kanban-action-primary">{item.actionLabel}</span>;
  }
  return (
    <Link href={item.href} className="kanban-action-primary">
      {item.actionLabel}
    </Link>
  );
}

export function DashboardPipelineKanban({
  marketCode,
  platformCode,
  currency,
  competitorReports,
  actionQueue,
}: Props) {
  const [activeTab, setActiveTab] = useState<"kanban" | "list">("kanban");
  const groupedTasks = new Map(groupCaseActionQueue(actionQueue).map((task) => [task.stage, task]));
  const queuedByStage = new Map(
    COLUMN_META.map((column) => [
      column.id,
      actionQueue.filter((item) => item.stage === column.id),
    ]),
  );

  // 竞品研报是案卷创建前的输入，不冒充案卷待办；仅在阶段 1 同时展示。
  const stage1Reports = competitorReports.filter(
    (report) =>
      report.marketCode === marketCode &&
      report.platformCode === platformCode &&
      !report.promotedCaseId,
  );

  return (
    <section className="panel" style={{ padding: "24px" }}>
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
          <span className="eyebrow" style={{ color: "var(--green)", margin: 0, lineHeight: 1 }}>
            操盘手业务大盘
          </span>
          <h2 style={{ margin: "6px 0 0", fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
            全生命周期业务推进看板 ({marketCode} 站 · {platformCode.toUpperCase()})
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
            阶段数量与首页待办同源，每个在办案卷只出现一次；交付完成即移出队列。
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href={`/cases?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
            className="button ghost fx-btn-sm"
          >
            查看全部案卷
          </Link>
          <div
            style={{
              display: "inline-flex",
              background: "var(--surface-subtle)",
              borderRadius: "8px",
              padding: "2px",
            }}
          >
            {([
              ["kanban", "5 阶漏斗看板"],
              ["list", "紧凑行动列表"],
            ] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                style={{
                  border: "none",
                  background: activeTab === tab ? "var(--paper)" : "transparent",
                  color: activeTab === tab ? "var(--ink)" : "var(--muted)",
                  fontWeight: activeTab === tab ? 700 : 500,
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "6px",
                  boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === "kanban" ? (
        <div className="dashboard-kanban-grid">
          {COLUMN_META.map((column) => {
            const focusTask = groupedTasks.get(column.id);
            const items = queuedByStage.get(column.id) ?? [];
            const reportItems = column.id === "stage1" ? stage1Reports.slice(0, 3) : [];
            const hasItems = items.length > 0 || reportItems.length > 0;

            return (
              <div
                key={column.id}
                style={{
                  background: "var(--surface-subtle)",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--line)",
                    background: "var(--paper)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          background: column.badgeBg,
                          color: column.badgeColor,
                          fontSize: "12px",
                          fontWeight: 800,
                          display: "inline-grid",
                          placeItems: "center",
                        }}
                      >
                        {column.stepNum}
                      </span>
                      <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{column.title}</strong>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
                      {column.subtitle}
                    </div>
                  </div>
                  <span
                    title="该阶段统一行动队列中的案卷数"
                    style={{
                      padding: "2px 8px",
                      borderRadius: "10px",
                      background: column.badgeBg,
                      color: column.badgeColor,
                      fontSize: "12px",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {items.length} 卷
                  </span>
                </div>

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
                  {focusTask ? (
                    <Link
                      href={focusTask.href}
                      style={{
                        background: "var(--green-soft)",
                        border: "1px solid var(--line-strong)",
                        borderRadius: "8px",
                        padding: "10px 12px",
                        textDecoration: "none",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: "var(--green)" }}>
                          ⚡ {focusTask.label}
                        </span>
                        <span className="badge-num" style={{ fontSize: "12px", color: "var(--green)" }}>
                          {focusTask.value} 卷
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.35 }}>
                        {focusTask.detail}
                      </div>
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)", textAlign: "right" }}>
                        {focusTask.action} →
                      </div>
                    </Link>
                  ) : null}

                  {items.slice(0, 4).map((item) => (
                    <article
                      key={item.caseId}
                      style={{
                        background: "var(--paper)",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px solid var(--line)",
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        <span style={{ color: "var(--muted)", background: "var(--surface-subtle)", padding: "1px 6px", borderRadius: "4px" }}>
                          {item.stageSubName}
                        </span>
                        <span className={`verdict-pill ${gateClass(item.tradeGate)}`}>
                          {gateLabel(item.tradeGate)}
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: "1px dashed var(--line)", paddingTop: 6 }}>
                        <WorkflowAction item={item} />
                        <Link href={`/cases/${item.caseId}?tab=overview`} className="kanban-action-secondary">
                          查看案卷
                        </Link>
                      </div>
                    </article>
                  ))}

                  {reportItems.map((report) => (
                    <article
                      key={report.id}
                      style={{
                        background: "var(--paper)",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: "1px dashed var(--line-strong)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>{report.title}</div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--muted)" }}>
                        <span>竞品研报 · {report.competitors.length} 款样本</span>
                        <span>
                          P50 {report.priceStats.p50 ? `${money(report.priceStats.p50)} ${report.currency || currency}` : "待采集"}
                        </span>
                      </div>
                      <Link
                        href={`/competitors?reportId=${report.id}`}
                        className="kanban-action-primary"
                        style={{ alignSelf: "flex-start" }}
                      >
                        查看竞品 PK →
                      </Link>
                    </article>
                  ))}

                  {!hasItems ? (
                    <div
                      style={{
                        textAlign: "center",
                        color: "var(--muted)",
                        fontSize: "12px",
                        padding: "24px 8px",
                        lineHeight: "1.4",
                      }}
                    >
                      {column.emptyText}
                    </div>
                  ) : null}

                  {items.length > 4 || (column.id === "stage1" && stage1Reports.length > 3) ? (
                    <Link
                      href={column.id === "stage1" ? `/competitors?market=${marketCode}&platform=${platformCode}` : column.viewAllHref}
                      style={{
                        display: "block",
                        textAlign: "center",
                        padding: "8px 10px",
                        borderRadius: "6px",
                        background: "var(--green-soft)",
                        color: "var(--green)",
                        fontSize: "12px",
                        fontWeight: 700,
                        textDecoration: "none",
                        border: "1px dashed #c0dcce",
                      }}
                    >
                      查看全部 {items.length} 个案卷
                      {column.id === "stage1" && stage1Reports.length > 0 ? ` · ${stage1Reports.length} 份研报` : ""}
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {actionQueue.length > 0 ? (
            actionQueue.slice(0, 12).map((item) => (
              <div
                key={item.caseId}
                style={{
                  background: "var(--paper)",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--line)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  fontSize: "12px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <span className="badge badge-neutral" style={{ fontSize: "12px" }}>
                    {item.asin || "待补 ASIN"}
                  </span>
                  <strong style={{ color: "var(--ink)" }}>{item.title}</strong>
                  <span style={{ color: "var(--muted)" }}>
                    {item.stageNumber}. {item.stageName} · {item.stageSubName}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className={`verdict-pill ${gateClass(item.tradeGate)}`}>{gateLabel(item.tradeGate)}</span>
                  <span style={{ color: "var(--muted)" }}>
                    {item.blocker || `交付：${item.deliveryState === "complete" ? "资料已齐" : item.stageSubName}`}
                  </span>
                  <WorkflowAction item={item} />
                  <Link href={`/cases/${item.caseId}?tab=overview`} className="button secondary" style={{ fontSize: "12px", padding: "4px 10px", height: "auto" }}>
                    查看案卷 →
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state" style={{ padding: "28px 16px" }}>
              <h3>当前没有待推进案卷</h3>
              <p>可继续处理未立项竞品研报，或从选品入口开启下一轮验证。</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
