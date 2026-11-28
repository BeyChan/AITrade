"use client";

import Link from "next/link";
import type { AutoCandidateResult } from "@/lib/auto-pipeline/types";
import type { EliminatedHistoryRecord } from "@/lib/sourcing-funnel";
import { getSelectionActionCapabilities, getSelectionStatusMeta } from "@/lib/selection-status";
import { btn, gradeBadgeStyle, statusBadgeStyle } from "./ui-styles";

export type SortField = "grade" | "score" | "price" | "margin" | "maxCost" | "reviews";
export type SortDir = "asc" | "desc";

export function CandidateTable(props: {
  items: AutoCandidateResult[];
  selectedIds: string[];
  allSelected: boolean;
  sortField: SortField;
  sortDir: SortDir;
  busy: boolean;
  adoptingId: string | null;
  unadoptingId: string | null;
  flashedRowId?: string | null;
  animateEnterKey?: number;
  blacklistMap: Map<string, EliminatedHistoryRecord>;
  onToggleAll: () => void;
  onToggleSelect: (id: string) => void;
  onSort: (field: SortField) => void;
  onOpenDrawer: (item: AutoCandidateResult) => void;
  onAdopt: (id: string) => void;
  onUnadopt: (item: AutoCandidateResult) => void;
}) {
  const { items, selectedIds, sortField, sortDir } = props;

  const sortIcon = (field: SortField) => {
    if (sortField !== field) return "↕";
    return sortDir === "desc" ? "↓" : "↑";
  };

  const thStyle: React.CSSProperties = {
    padding: "10px 10px",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
    color: "var(--muted)",
    borderBottom: "1px solid var(--line)",
    whiteSpace: "nowrap",
    background: "var(--surface-subtle)",
    position: "sticky",
    top: 0,
    zIndex: 2,
  };

  const sortBtnStyle: React.CSSProperties = {
    background: "transparent",
    border: "none",
    padding: 0,
    color: "inherit",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };

  const tdStyle: React.CSSProperties = {
    padding: "10px 10px",
    borderBottom: "1px solid var(--line)",
    fontSize: 13,
    verticalAlign: "middle",
  };

  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid var(--line)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 36, textAlign: "center" }}>
              <input
                type="checkbox"
                checked={props.allSelected}
                onChange={props.onToggleAll}
                aria-label="全选当前列表"
              />
            </th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("grade")}>
                分级 {sortIcon("grade")}
              </button>
            </th>
            <th style={thStyle}>商品线索 / ASIN</th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("score")}>
                机会分 {sortIcon("score")}
              </button>
            </th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("price")}>
                售价 {sortIcon("price")}
              </button>
            </th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("margin")}>
                估算净利率 {sortIcon("margin")}
              </button>
            </th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("maxCost")}>
                采购上限 {sortIcon("maxCost")}
              </button>
            </th>
            <th style={thStyle}>
              <button type="button" style={sortBtnStyle} onClick={() => props.onSort("reviews")}>
                评论 / 评分 {sortIcon("reviews")}
              </button>
            </th>
            <th style={{ ...thStyle, textAlign: "right" }}>分诊操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => {
            const checked = selectedIds.includes(item.id);
            const hit = props.blacklistMap.get(item.id);
            const failReasons = item.reasons.filter((r) => r.severity === "fail");
            const statusMeta = getSelectionStatusMeta(item.selectionStatus);
            const caps = getSelectionActionCapabilities(item.selectionStatus);
            const caseHref = item.promotedCaseId ? `/cases/${encodeURIComponent(item.promotedCaseId)}` : "";
            const kanbanHref =
              item.adoptedRunId && item.adoptedHypothesisId
                ? `/ai-sourcing/${encodeURIComponent(item.adoptedRunId)}?hypothesisId=${encodeURIComponent(item.adoptedHypothesisId)}`
                : "";
            const shouldStagger = Boolean(props.animateEnterKey && idx < 15);
            const isFlashed = props.flashedRowId === item.id;
            const rowClassName = isFlashed
              ? "ap-row-flash"
              : shouldStagger
                ? "ap-row-stagger"
                : undefined;

            return (
              <tr
                key={shouldStagger ? `${item.id}-${props.animateEnterKey}` : item.id}
                className={rowClassName}
                onClick={() => props.onOpenDrawer(item)}
                style={{
                  background: checked ? "var(--accent-soft)" : "var(--paper)",
                  cursor: "pointer",
                  transition: "background 0.12s ease",
                  ...(shouldStagger ? { animationDelay: `${idx * 25}ms` } : {}),
                }}
              >
                <td
                  style={{ ...tdStyle, textAlign: "center" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => props.onToggleSelect(item.id)}
                    aria-label={`选择 ${item.externalId}`}
                  />
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <span
                    style={{
                      ...gradeBadgeStyle(item.grade),
                      padding: "2px 9px",
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 700,
                      display: "inline-block",
                    }}
                  >
                    {item.grade} 级
                  </span>
                </td>

                <td style={{ ...tdStyle, maxWidth: 340 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>
                        {item.externalId}
                      </span>
                      {item.brand && (
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>· {item.brand}</span>
                      )}
                      {(statusMeta.phase === "case" || statusMeta.phase === "kanban") && (
                        <span
                          style={{
                            ...statusBadgeStyle(statusMeta.tone),
                            fontSize: 11,
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                          title={statusMeta.label}
                        >
                          {statusMeta.shortLabel}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--ink)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={item.title}
                    >
                      {item.title}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {hit && (
                        <span
                          style={{
                            fontSize: 11,
                            padding: "1px 6px",
                            borderRadius: 4,
                            background: "var(--red-soft)",
                            color: "var(--red)",
                            fontWeight: 600,
                          }}
                          title={`历史避坑命中：${hit.concept}（${hit.eliminationReason}）`}
                        >
                          ⚠ 历史已淘汰：{hit.eliminationReason}
                        </span>
                      )}
                      {!hit && failReasons[0] && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--red)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            maxWidth: 280,
                          }}
                        >
                          {failReasons[0].message}
                        </span>
                      )}
                    </div>
                  </div>
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <strong className="mono" style={{ color: "var(--ink)" }}>{item.score}</strong>
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
                    {(item.priceCents / 100).toFixed(2)} {item.currency}
                  </span>
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <span
                    className="mono"
                    style={{
                      fontWeight: 700,
                      color: item.estimatedMarginRate >= 0.18 ? "var(--green)" : "var(--amber)",
                    }}
                  >
                    {(item.estimatedMarginRate * 100).toFixed(1)}%
                  </span>
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  <span className="mono" style={{ fontWeight: 700, color: "var(--green)" }}>
                    ≤ ¥{item.maxLandedCostCny.toFixed(1)}
                  </span>
                </td>

                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontSize: 12, color: "var(--muted)" }}>
                  <span className="mono">{item.reviewCount.toLocaleString()}</span>
                  {" · "}
                  <span>{item.rating ?? "—"}★</span>
                </td>

                <td
                  style={{ ...tdStyle, whiteSpace: "nowrap", textAlign: "right" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {caps.canViewCase && caseHref ? (
                      <Link href={caseHref} style={btn.subtleGood}>
                        查看案卷 →
                      </Link>
                    ) : caps.canViewKanban && kanbanHref ? (
                      <>
                        <Link href={kanbanHref} style={btn.subtleGood}>
                          查看看板 →
                        </Link>
                        <button
                          type="button"
                          disabled={props.busy || props.unadoptingId === item.id}
                          onClick={() => props.onUnadopt(item)}
                          style={btn.secondary}
                          title="取消采纳（若看板尚未录入调研数据，将同步移出空白候选）"
                        >
                          {props.unadoptingId === item.id ? "取消中…" : "取消采纳"}
                        </button>
                      </>
                    ) : caps.canAdopt ? (
                      <button
                        type="button"
                        disabled={props.busy || props.adoptingId === item.id}
                        onClick={() => props.onAdopt(item.id)}
                        style={btn.subtleAccent}
                      >
                        {props.adoptingId === item.id ? "采纳中…" : "采纳进看板"}
                      </button>
                    ) : (
                      <span style={{ fontSize: 12, color: "var(--muted)", paddingRight: 4 }}>{statusMeta.shortLabel}</span>
                    )}

                    <button
                      type="button"
                      onClick={() => props.onOpenDrawer(item)}
                      style={btn.secondary}
                    >
                      详情
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
