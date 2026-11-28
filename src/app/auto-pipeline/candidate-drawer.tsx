"use client";

import { useState } from "react";
import Link from "next/link";
import type { AutoCandidateResult } from "@/lib/auto-pipeline/types";
import { ELIMINATION_REASONS, type EliminatedHistoryRecord } from "@/lib/sourcing-funnel";
import { getSelectionActionCapabilities, getSelectionStatusMeta } from "@/lib/selection-status";
import { btn, gradeBadgeStyle, inputStyle, rowBetweenStyle, rowStyle } from "./ui-styles";

export function CandidateDrawer(props: {
  item: AutoCandidateResult | null;
  blacklistHit: EliminatedHistoryRecord | null;
  busy: boolean;
  adopting: boolean;
  unadopting: boolean;
  promoting: boolean;
  unpromoting: boolean;
  deleting: boolean;
  onClose: () => void;
  onAdopt: (id: string) => void;
  onUnadopt: (item: AutoCandidateResult) => void;
  onPromote: (id: string) => void;
  onUnpromote: (item: AutoCandidateResult) => void;
  onEliminate: (id: string, reason: string, note: string) => void;
  onDelete: (item: AutoCandidateResult) => void;
}) {
  const { item, blacklistHit } = props;
  const [elimReason, setElimReason] = useState<string>(ELIMINATION_REASONS[0]);
  const [elimNote, setElimNote] = useState("");
  const [showElimBox, setShowElimBox] = useState(false);

  if (!item) return null;

  const statusMeta = getSelectionStatusMeta(item.selectionStatus);
  const caps = getSelectionActionCapabilities(item.selectionStatus);
  const caseHref = item.promotedCaseId ? `/cases/${encodeURIComponent(item.promotedCaseId)}` : "";
  const kanbanHref =
    item.adoptedRunId && item.adoptedHypothesisId
      ? `/ai-sourcing/${encodeURIComponent(item.adoptedRunId)}?hypothesisId=${encodeURIComponent(item.adoptedHypothesisId)}`
      : "";

  const metricBox: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--surface-subtle)",
    border: "1px solid var(--line)",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="线索详情抽屉"
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.35)",
        zIndex: 80,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <aside
        className="ap-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 94vw)",
          height: "100%",
          background: "var(--paper)",
          borderLeft: "1px solid var(--line)",
          padding: 20,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ ...rowBetweenStyle, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
            <div style={rowStyle}>
              <span
                style={{
                  ...gradeBadgeStyle(item.grade),
                  padding: "2px 10px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {item.grade} 级 · {item.score} 分
              </span>
              <span className="mono" style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>
                {item.externalId}
              </span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                {item.platformCode.toUpperCase()} / {item.marketCode}
              </span>
            </div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--ink)", lineHeight: 1.4 }}>
              {item.title}
            </h2>
          </div>

          <button type="button" onClick={props.onClose} style={btn.secondary} aria-label="关闭抽屉">
            ✕
          </button>
        </div>

        {blacklistHit && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "var(--red-soft)",
              border: "1px solid var(--red)",
              color: "var(--red)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <strong>⚠ 避坑库预警：历史曾淘汰相似方向</strong>
            <div>
              「{blacklistHit.concept}」因 <strong>{blacklistHit.eliminationReason}</strong> 被淘汰
              {blacklistHit.eliminationNote ? `（${blacklistHit.eliminationNote}）` : ""}
            </div>
          </div>
        )}

        {/* 主分诊动作区 */}
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: "var(--surface-subtle)",
            border: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
            当前阶段：<strong style={{ color: "var(--ink)" }}>{statusMeta.label}</strong>
            {caps.canAdopt && " · 推荐先采纳进选品看板完成 4 步验证"}
          </div>
          <div style={rowStyle}>
            {caps.canViewCase && caseHref ? (
              <>
                <Link href={caseHref} style={btn.subtleGood}>
                  查看商品案卷 →
                </Link>
                <button
                  type="button"
                  disabled={props.unpromoting || props.busy}
                  onClick={() => props.onUnpromote(item)}
                  style={btn.secondary}
                >
                  {props.unpromoting ? "取消中…" : "取消案卷关联"}
                </button>
              </>
            ) : caps.canViewKanban && kanbanHref ? (
              <>
                <Link href={kanbanHref} style={btn.subtleGood}>
                  已采纳 · 打开选品看板 →
                </Link>
                <button
                  type="button"
                  disabled={props.unadopting || props.busy}
                  onClick={() => props.onUnadopt(item)}
                  style={btn.secondary}
                >
                  {props.unadopting ? "取消中…" : "取消采纳"}
                </button>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => setShowElimBox((v) => !v)}
                  style={btn.danger}
                >
                  淘汰入避坑库
                </button>
              </>
            ) : caps.canAdopt ? (
              <>
                <button
                  type="button"
                  disabled={props.adopting || props.busy}
                  onClick={() => props.onAdopt(item.id)}
                  style={btn.primary}
                >
                  {props.adopting ? "采纳中…" : "采纳入选品看板"}
                </button>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => setShowElimBox((v) => !v)}
                  style={btn.danger}
                >
                  淘汰入避坑库
                </button>
              </>
            ) : (
              <span style={{ fontSize: 12, color: "var(--red)" }}>
                该线索已淘汰，不可采纳进看板或立项。
              </span>
            )}
          </div>

          {showElimBox && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid var(--line)" }}>
              <div style={rowStyle}>
                <select
                  value={elimReason}
                  onChange={(e) => setElimReason(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                >
                  {ELIMINATION_REASONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <input
                value={elimNote}
                onChange={(e) => setElimNote(e.target.value)}
                placeholder="补充避坑备注（可选，如专利号/大卖垄断细节）"
                style={inputStyle}
              />
              <div style={rowStyle}>
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() => {
                    props.onEliminate(item.id, elimReason, elimNote);
                    setShowElimBox(false);
                    setElimNote("");
                  }}
                  style={btn.danger}
                >
                  确认淘汰并写入避坑库
                </button>
                <button type="button" onClick={() => setShowElimBox(false)} style={btn.secondary}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 核心指标 2x3 网格 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>参考售价</span>
            <strong className="mono" style={{ fontSize: 16, color: "var(--ink)" }}>
              {(item.priceCents / 100).toFixed(2)} {item.currency}
            </strong>
          </div>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>18% 门禁达标采购上限</span>
            <strong className="mono" style={{ fontSize: 16, color: "var(--green)" }}>
              ≤ ¥{item.maxLandedCostCny.toFixed(1)}
            </strong>
          </div>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>估算净利率 / 盈亏 ACoS</span>
            <strong className="mono" style={{ fontSize: 14, color: "var(--ink)" }}>
              {(item.estimatedMarginRate * 100).toFixed(1)}% / {(item.metrics.breakEvenAcos * 100).toFixed(1)}%
            </strong>
          </div>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>评论 / 评分 / 估算月销</span>
            <strong className="mono" style={{ fontSize: 14, color: "var(--ink)" }}>
              {item.reviewCount.toLocaleString()} · {item.rating ?? "—"}★ · {item.monthlySalesEstimate}/月
            </strong>
          </div>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>市场格局 (HHI / Top3品牌占比)</span>
            <strong className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
              {item.metrics.hhi ?? "—"} / {item.metrics.brandCr3Percent !== null ? `${item.metrics.brandCr3Percent}%` : "—"}
            </strong>
          </div>
          <div style={metricBox}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>合规状态 / 估算合规成本</span>
            <strong className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
              {item.metrics.complianceStatus} · ${item.metrics.complianceCostUsd}
            </strong>
          </div>
        </div>

        {/* 快筛诊断明细 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong style={{ fontSize: 13, color: "var(--ink)" }}>快筛判定依据</strong>
          {item.reasons.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>暂无额外告警项</span>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {item.reasons.map((r, idx) => (
                <div
                  key={`${item.id}-dr-${idx}`}
                  style={{
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 6,
                    background:
                      r.severity === "fail"
                        ? "var(--red-soft)"
                        : r.severity === "warn"
                          ? "var(--amber-soft)"
                          : "var(--green-soft)",
                    color:
                      r.severity === "fail"
                        ? "var(--red)"
                        : r.severity === "warn"
                          ? "var(--amber)"
                          : "var(--green)",
                  }}
                >
                  {r.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 上下文工具直达 + 快轨案卷 */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 14,
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <strong style={{ fontSize: 12, color: "var(--muted)" }}>上下文快捷工具</strong>
          <div style={rowStyle}>
            <a
              href={`/api/sourcing/1688-search?q=${encodeURIComponent(item.title.slice(0, 40))}`}
              target="_blank"
              rel="noreferrer"
              style={btn.secondary}
            >
              按 ≤¥{item.maxLandedCostCny.toFixed(1)} 去 1688 找厂
            </a>
            <Link
              href={`/competitors?market=${encodeURIComponent(item.marketCode)}&platform=${encodeURIComponent(item.platformCode)}`}
              style={btn.secondary}
            >
              打开竞品研报
            </Link>
            <Link
              href={`/costing?market=${encodeURIComponent(item.marketCode)}&platform=${encodeURIComponent(item.platformCode)}`}
              style={btn.secondary}
            >
              打开成本核算
            </Link>
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" style={btn.secondary}>
                查看原商品页 ↗
              </a>
            )}
          </div>

          <div style={{ ...rowBetweenStyle, paddingTop: 8, borderTop: "1px dashed var(--line)" }}>
            <div style={rowStyle}>
              {caps.canPromoteFastTrack && (
                <button
                  type="button"
                  disabled={props.promoting || props.busy}
                  onClick={() => props.onPromote(item.id)}
                  style={btn.secondary}
                  title="S/A 级快轨通道：跳过看板直接创建待定标商品案卷（初始 HOLD）"
                >
                  {props.promoting ? "推进中…" : "快轨直达商品案卷"}
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={props.deleting || props.busy}
              onClick={() => props.onDelete(item)}
              style={btn.danger}
            >
              {props.deleting ? "删除中…" : "移出本批"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
