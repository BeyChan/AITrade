"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CalibrationImpactPreview, CalibrationSuggestion } from "@/lib/calibration";
import { moneyIn, percent } from "@/lib/format";

type Props = {
  caseId: string;
  currency: string;
  currentCalibrationStatus: "uncalibrated" | "partial" | "calibrated";
  currentCalibrationScope?: string;
  suggestion: CalibrationSuggestion;
  preview: CalibrationImpactPreview | null;
};

export function CaseCalibrationPanel({
  caseId,
  currency,
  currentCalibrationStatus,
  currentCalibrationScope,
  suggestion,
  preview,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"apply" | "dismiss" | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function handleAction(action: "apply" | "dismiss") {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/cases/${encodeURIComponent(caseId)}/calibration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: "本机用户" }),
      });
      const json = (await res.json()) as { ok?: boolean; newVersion?: number | null; error?: string };
      if (!res.ok || !json.ok) {
        setMessage({ kind: "err", text: json.error || "操作失败" });
        return;
      }
      if (action === "apply") {
        setMessage({
          kind: "ok",
          text: `已应用实盘校准并生成成本模型 v${json.newVersion ?? ""}，变更已写入审计日志。`,
        });
      } else {
        setMessage({
          kind: "ok",
          text: "已记录「暂不采纳」决定至审计日志，当前成本模型保持不变。",
        });
      }
      router.refresh();
    } catch {
      setMessage({ kind: "err", text: "请求异常，请稍后重试" });
    } finally {
      setBusy(null);
    }
  }

  const statusBadgeClass =
    currentCalibrationStatus === "calibrated"
      ? "badge-success"
      : currentCalibrationStatus === "partial"
        ? "status-review_pending"
        : "badge-neutral";
  const statusText =
    currentCalibrationStatus === "calibrated"
      ? "实盘已校准"
      : currentCalibrationStatus === "partial"
        ? "部分实盘校准"
        : "未校准 · 平台默认假设";

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>实盘校准建议（数据闭环）</h2>
          <p>{suggestion.scopeLabel}</p>
        </div>
        <span className={`badge ${statusBadgeClass}`}>{statusText}</span>
      </div>

      {message ? (
        <div className={`notice ${message.kind === "err" ? "warn" : ""}`} style={{ marginBottom: 14 }}>
          <span className={`badge ${message.kind === "ok" ? "badge-success" : "badge-danger"}`}>
            {message.kind === "ok" ? "已记录" : "失败"}
          </span>
          <span>{message.text}</span>
        </div>
      ) : null}

      {suggestion.scope === "platform_default" ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="notice warn">
            <span className="badge status-review_pending">待校准</span>
            <span>
              {suggestion.notes[0] || "当前尚无足够历史实盘样本，佣金、履约、退货和广告仍基于平台默认基准。"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              导入 Amazon 结算单并绑定 SKU 后，系统会自动按类目/全店中位数提供校准建议。
            </span>
            <Link href="/operations" className="button secondary">
              去实盘账本导入结算单
            </Link>
          </div>
        </div>
      ) : preview ? (
        <div className="stack" style={{ gap: 14 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 13 }}>
            <span className="badge badge-neutral">样本 {suggestion.sampleSkuCount} 个 SKU</span>
            <span className="badge badge-neutral">累计销量 {suggestion.totalUnits} 件</span>
            {suggestion.latestPeriodEnd ? (
              <span className="badge badge-neutral">最近账期 {suggestion.latestPeriodEnd}</span>
            ) : null}
            {currentCalibrationScope ? (
              <span className="muted">当前模型来源：{currentCalibrationScope}</span>
            ) : null}
          </div>

          {suggestion.notes.length > 0 ? (
            <div className="notice" style={{ fontSize: 13 }}>
              <span className="badge badge-neutral">说明</span>
              <span>{suggestion.notes.join(" ")}</span>
            </div>
          ) : null}

          {preview.appliedFields.length === 0 ? (
            <div className="notice">
              <span className="badge badge-success">已同步</span>
              <span>当前成本模型假设已与最新实盘中位数一致，无需重复更新。</span>
            </div>
          ) : (
            <>
              <div className="heatmap-scroll">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>校准项</th>
                      <th className="num">当前假设</th>
                      <th className="num">实盘中位数建议</th>
                      <th className="num">P25 – P75 区间</th>
                      <th className="num">变动</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.appliedFields.map((diff) => {
                      const fmt = (v: number) =>
                        diff.unit === "rate" ? percent(v, 1) : moneyIn(currency, v);
                      const deltaText =
                        diff.unit === "rate"
                          ? `${diff.delta >= 0 ? "+" : ""}${percent(diff.delta, 1)}`
                          : `${diff.delta >= 0 ? "+" : ""}${moneyIn(currency, diff.delta)}`;
                      return (
                        <tr key={diff.field}>
                          <td><strong>{diff.label}</strong></td>
                          <td className="num mono">{fmt(diff.before)}</td>
                          <td className="num mono"><strong>{fmt(diff.after)}</strong></td>
                          <td className="num mono muted">
                            {diff.distribution
                              ? `${fmt(diff.distribution.p25)} ~ ${fmt(diff.distribution.p75)}`
                              : "—"}
                          </td>
                          <td className="num mono">{deltaText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="metric-pairs">
                <div className="metric-pair">
                  <small>单件净利变化</small>
                  <strong className="mono">
                    {moneyIn(currency, preview.before.netProfitCents)} →{" "}
                    {moneyIn(currency, preview.after.netProfitCents)}
                  </strong>
                </div>
                <div className="metric-pair">
                  <small>净利率变化</small>
                  <strong className="mono">
                    {percent(preview.before.marginRate, 1)} → {percent(preview.after.marginRate, 1)}
                  </strong>
                </div>
                <div className="metric-pair">
                  <small>18% 门禁采购上限</small>
                  <strong className="mono">
                    {moneyIn(currency, preview.before.maxLandedCostCents)} →{" "}
                    {moneyIn(currency, preview.after.maxLandedCostCents)}
                  </strong>
                </div>
                <div className="metric-pair">
                  <small>立项门禁结论</small>
                  <strong className="mono">
                    {preview.before.recommendation} → {preview.after.recommendation}
                    {preview.decisionChanged ? "（发生切换）" : ""}
                  </strong>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy !== null}
                  onClick={() => handleAction("apply")}
                >
                  {busy === "apply" ? "正在写入新版本..." : "确认应用实盘校准（生成新版本）"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy !== null}
                  onClick={() => handleAction("dismiss")}
                >
                  {busy === "dismiss" ? "正在记录..." : "暂不采纳（写入审计日志）"}
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  所有校准均需人工确认后生效，不会静默改动财务模型。
                </span>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
