"use client";

import { useState } from "react";
import Link from "next/link";
import { money } from "@/lib/format";
import type { CaseStatus } from "@/lib/types";
import { StatusBadge } from "@/components/badges";
import { IconCheck, IconClipboard, IconDownload, IconPrinter } from "@/components/icons";

export type AuditLedgerRow = {
  id: string;
  title: string;
  marketplace: string;
  asin: string;
  category: string;
  status: CaseStatus;
  recommendation: "GO" | "HOLD" | "NO-GO";
  stageLabel?: string;
  canExportFlatFile?: boolean;
  opportunityScore: number;
  isVerified: boolean;
  isDemo: boolean;
  evidenceScore: number;
  salePriceText: string;
  landedCostText: string;
  netProfitCents: number | null;
  netProfitText: string;
  marginRate: number | null;
  marginText: string;
  monthlyProfitCents: number | null;
  monthlyProfitText: string;
};

export function CasesAuditLedger({ rows }: { rows: AuditLedgerRow[] }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copiedAsins, setCopiedAsins] = useState(false);

  const selectedSet = new Set(selectedIds);
  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.id));
  const selectedRows = rows.filter((row) => selectedSet.has(row.id));
  const selectedMonthlyTotalCents = selectedRows.reduce((sum, row) => sum + (row.monthlyProfitCents ?? 0), 0);

  function toggleAll() {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(rows.map((row) => row.id));
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  const exportableSelectedRows = selectedRows.filter((row) => row.canExportFlatFile);

  function handleBatchFlatFileExport() {
    exportableSelectedRows.forEach((row, idx) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = `/api/cases/${row.id}/flatfile`;
        link.download = "";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, idx * 200);
    });
  }

  async function handleCopyAsins() {
    if (selectedRows.length === 0) return;
    const text = selectedRows.map((row) => row.asin).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAsins(true);
      window.setTimeout(() => setCopiedAsins(false), 1800);
    } catch {
      setCopiedAsins(false);
    }
  }

  return (
    <div>
      {selectedRows.length > 0 ? (
        <div className="audit-bulk-bar" role="region" aria-label="批量操作">
          <div className="audit-bulk-summary">
            <span>
              已选 <strong className="badge-num">{selectedRows.length}</strong> 个案卷
            </span>
            <span className="audit-bulk-sep" aria-hidden="true">·</span>
            <span>
              预估月贡献合计{" "}
              <strong className="badge-num">{money(selectedMonthlyTotalCents)}</strong>
            </span>
          </div>

          <div className="audit-bulk-actions">
            {exportableSelectedRows.length > 0 ? (
              <button type="button" className="button secondary" onClick={handleBatchFlatFileExport}>
                <IconDownload size={14} />
                <span>批量导出 Flat File ({exportableSelectedRows.length})</span>
              </button>
            ) : (
              <span className="muted" style={{ fontSize: 12 }}>仅内容已终审案卷可导出 Flat File</span>
            )}
            <button type="button" className="button secondary" onClick={handleCopyAsins}>
              {copiedAsins ? <IconCheck size={14} /> : <IconClipboard size={14} />}
              <span>{copiedAsins ? "已复制" : "复制 ASIN"}</span>
            </button>
            <button type="button" className="button ghost" onClick={() => setSelectedIds([])}>
              清空选择
            </button>
          </div>
        </div>
      ) : null}

      <div className="audit-ledger-wrap">
        <table className="audit-ledger">
          <thead>
            <tr>
              <th className="ledger-check-col">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="全选当前列表案卷"
                />
              </th>
              <th>商品案卷</th>
              <th className="num">预估售价</th>
              <th className="num">到岸成本</th>
              <th className="num">单件净利</th>
              <th className="num">基准净利率</th>
              <th className="num">预估月贡献</th>
              <th>判定</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const checked = selectedSet.has(row.id);
              const marginRate = row.marginRate;
              const marginPass = marginRate !== null && marginRate >= 0.18;
              const meterWidthPct =
                marginRate === null
                  ? 0
                  : Math.min(100, Math.max(6, Math.round((Math.max(0, marginRate) / 0.3) * 100)));

              return (
                <tr
                  key={row.id}
                  className={`ledger-row ${row.isVerified ? "is-verified" : "is-pending"}${checked ? " is-selected" : ""}`}
                  title={
                    row.isVerified
                      ? `已核实证据 · 完整度 ${row.evidenceScore}%`
                      : `${row.isDemo ? "演示样板" : "证据待核实"} · 完整度 ${row.evidenceScore}%`
                  }
                >
                  <td className="ledger-check-col">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRow(row.id)}
                      aria-label={`选择 ${row.title}`}
                    />
                  </td>

                  <td className="ledger-case-cell">
                    <Link href={`/cases/${row.id}`} className="ledger-case-title">
                      {row.title}
                    </Link>
                    <div className="ledger-case-meta">
                      <span className="ledger-market-chip">{row.marketplace}</span>
                      <span className="ledger-asin-chip">{row.asin}</span>
                      <span>{row.category}</span>
                      <StatusBadge status={row.status} />
                      {row.stageLabel ? (
                        <span className="ledger-evidence-chip">{row.stageLabel}</span>
                      ) : null}
                      <span
                        className={`ledger-evidence-chip ${row.isVerified ? "is-verified" : "is-pending"}`}
                        title={`证据完整度 ${row.evidenceScore}%`}
                      >
                        {row.isVerified ? "已核实" : row.isDemo ? "演示样板" : "待核实"}
                      </span>
                    </div>
                  </td>

                  <td className="num">{row.salePriceText}</td>

                  <td className="num">{row.landedCostText}</td>

                  <td
                    className="num"
                    style={{
                      fontWeight: 700,
                      color:
                        row.netProfitCents === null
                          ? "var(--muted)"
                          : row.netProfitCents > 0
                            ? "var(--green)"
                            : "var(--red)",
                    }}
                  >
                    {row.netProfitText}
                  </td>

                  <td
                    className="num margin-gate-cell"
                    title={marginRate !== null && !marginPass ? "低于 18% 门禁线" : "达到或高于 18% 门禁线"}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        color: marginRate === null ? "var(--muted)" : marginPass ? "var(--green)" : "var(--red)",
                      }}
                    >
                      {row.marginText}
                      {marginRate !== null && !marginPass ? " ↓" : ""}
                    </span>
                    {marginRate !== null ? (
                      <div className="margin-gate-bar" aria-hidden="true">
                        <div
                          className={`margin-gate-fill ${marginPass ? "is-pass" : "is-fail"}`}
                          style={{ width: `${meterWidthPct}%` }}
                        />
                        <span className="margin-gate-mark" />
                      </div>
                    ) : null}
                  </td>

                  <td
                    className="num"
                    style={{
                      fontWeight: 700,
                      color:
                        row.monthlyProfitCents !== null && row.recommendation === "GO"
                          ? "var(--green)"
                          : "var(--ink)",
                    }}
                  >
                    {row.monthlyProfitText}
                  </td>

                  <td>
                    <span
                      className={`verdict-pill ${
                        row.recommendation === "GO"
                          ? "is-go"
                          : row.recommendation === "NO-GO"
                            ? "is-no-go"
                            : "is-hold"
                      }`}
                    >
                      {row.recommendation} · {row.opportunityScore}分
                    </span>
                  </td>

                  <td>
                    <div className="ledger-actions">
                      <Link href={`/cases/${row.id}`} className="ledger-action-link">
                        总览
                      </Link>
                      {row.recommendation !== "NO-GO" ? (
                        <Link href={`/cases/${row.id}/sourcing`} className="ledger-action-link">
                          报价
                        </Link>
                      ) : null}
                      <Link href={`/cases/${row.id}/content`} className="ledger-action-link">
                        文案
                      </Link>
                      {row.canExportFlatFile ? (
                        <a
                          href={`/api/cases/${row.id}/flatfile`}
                          download
                          className="ledger-action-link"
                          title="直接下载亚马逊官方批量上传模板 (.tsv)"
                        >
                          <IconDownload size={13} />
                          <span>Flat File</span>
                        </a>
                      ) : null}
                      <Link
                        href={`/cases/${row.id}/report`}
                        className="ledger-action-link is-report"
                        title="查看并打印立项决策战报 (Memo)"
                      >
                        <IconPrinter size={13} />
                        <span>战报</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="audit-ledger-legend">
          <span className="ledger-legend-item">
            <span className="ledger-evidence-chip is-verified">已核实</span>
            <span>证据完整度 ≥ 50%</span>
          </span>
          <span className="ledger-legend-item">
            <span className="ledger-evidence-chip is-pending">演示样板 / 待核实</span>
            <span>仅作参考，立项前需补齐真实证据</span>
          </span>
          <span className="ledger-legend-item">
            <span className="ledger-legend-gate" aria-hidden="true" />
            <span>净利率竖线：18% GO 门禁线</span>
          </span>
        </div>
      </div>
    </div>
  );
}
