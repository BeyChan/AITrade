"use client";

import Link from "next/link";
import { useState } from "react";
import type { PipelineResult } from "@/lib/operations-pipeline";
import type { ChannelSkuMapping, SavedOperationsBatch } from "@/lib/operations-repository";
import { moneyIn, percent, shortDate } from "@/lib/format";

const SAMPLE_SETTLEMENT_TSV = [
  "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tposted-date\tposted-date-time\tsku\tquantity-purchased",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tItemPrice\tPrincipal\t399.90\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t10",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tRefund\tORD-1001\tItemPrice\tPrincipal\t-39.99\t2026-10-28\t2026-10-28T09:10:00-07:00\tB0DEMO0001\t1",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tItemFees\tCommission\t-53.99\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tItemFees\tFBAPerUnitFulfillmentFee\t-57.20\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tPromotion\tShipping discount\t-12.00\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1002\tItemPrice\tPrincipal\t249.90\t2026-10-26\t2026-10-26T10:15:00-07:00\tB0DEMO0002\t10",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1002\tItemFees\tCommission\t-37.49\t2026-10-26\t2026-10-26T10:15:00-07:00\tB0DEMO0002\t",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1002\tItemFees\tFBAPerUnitFulfillmentFee\t-49.50\t2026-10-26\t2026-10-26T10:15:00-07:00\tB0DEMO0002\t",
].join("\n");

const SAMPLE_INVENTORY_TSV = [
  "sku\tfnsku\tasin\tafn-fulfillable-quantity\tafn-reserved-quantity\tafn-unsellable-quantity\tafn-inbound-working-quantity\tafn-inbound-shipped-quantity\tafn-inbound-receiving-quantity",
  "B0DEMO0001\tX001DEMO01\tB0DEMO0001\t280\t12\t2\t100\t150\t0",
  "B0DEMO0002\tX001DEMO02\tB0DEMO0002\t42\t5\t1\t0\t0\t0",
].join("\n");

const SAMPLE_ADS_CSV = [
  "Advertised SKU,Spend",
  "B0DEMO0001,56.00",
  "B0DEMO0002,38.50",
].join("\n");

export type CaseOption = {
  id: string;
  asin: string;
  title: string;
  category: string;
  landedCostCents: number | null;
};

function adAttributionLabel(source: string) {
  if (source === "ads_report") return "Ads报表";
  if (source === "settlement") return "结算扣款";
  if (source === "manual") return "手工录入";
  return "未归因";
}

export function OperationsReviewClient({
  defaultMarket,
  defaultCurrency,
  initialBatches = [],
  initialMappings = [],
  caseOptions = [],
}: {
  defaultMarket: string;
  defaultCurrency: string;
  initialBatches?: SavedOperationsBatch[];
  initialMappings?: ChannelSkuMapping[];
  caseOptions?: CaseOption[];
}) {
  const [marketplaceCode, setMarketplaceCode] = useState(defaultMarket || "US");
  const [reportingCurrency, setReportingCurrency] = useState(defaultCurrency || "USD");
  const [reportTimezone, setReportTimezone] = useState("America/Los_Angeles");
  const [policy, setPolicy] = useState<"settlement" | "order">("settlement");
  const [snapshotDate, setSnapshotDate] = useState("2026-10-31");
  const [batchLabel, setBatchLabel] = useState("");
  const [settlementText, setSettlementText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [adSpendText, setAdSpendText] = useState("");
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [savedBatches, setSavedBatches] = useState<SavedOperationsBatch[]>(initialBatches);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(initialBatches[0]?.id ?? null);

  // SKU ↔ 案卷 / 单位到岸成本映射状态
  const [mappings, setMappings] = useState<ChannelSkuMapping[]>(initialMappings);
  const [mapSku, setMapSku] = useState("");
  const [mapCaseId, setMapCaseId] = useState("");
  const [mapLandedInput, setMapLandedInput] = useState("");
  const [isSavingMap, setIsSavingMap] = useState(false);

  async function refreshBatches() {
    const res = await fetch("/api/operations/batches");
    if (res.ok) {
      const json = (await res.json()) as { batches?: SavedOperationsBatch[] };
      if (Array.isArray(json.batches)) setSavedBatches(json.batches);
    }
  }

  async function handleSaveMapping(e: React.FormEvent) {
    e.preventDefault();
    if (!mapSku.trim()) return;
    setError(null);
    setNotice(null);
    setIsSavingMap(true);
    try {
      const parsedLanded = mapLandedInput.trim() ? Number(mapLandedInput.trim()) : null;
      const unitLandedCostCentsOverride =
        parsedLanded !== null && Number.isFinite(parsedLanded) && parsedLanded >= 0
          ? Math.round(parsedLanded * 100)
          : null;

      const res = await fetch("/api/operations/sku-mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketplace: marketplaceCode,
          channelSku: mapSku.trim(),
          caseId: mapCaseId || null,
          unitLandedCostCentsOverride,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        mapping?: ChannelSkuMapping;
        updatedSnapshotCount?: number;
        error?: string;
      };
      if (!res.ok || !json.ok || !json.mapping) {
        setError(json.error || "保存 SKU 映射失败");
        return;
      }
      setMappings((prev) => {
        const rest = prev.filter(
          (m) =>
            !(
              m.marketplace.toUpperCase() === json.mapping!.marketplace.toUpperCase() &&
              m.channelSku.toUpperCase() === json.mapping!.channelSku.toUpperCase()
            ),
        );
        return [json.mapping!, ...rest];
      });
      await refreshBatches();
      setNotice(
        `已绑定 SKU「${json.mapping.channelSku}」并重算 ${json.updatedSnapshotCount ?? 0} 条历史账本记录的真实净利。`,
      );
      setMapSku("");
      setMapCaseId("");
      setMapLandedInput("");
    } catch {
      setError("保存 SKU 映射失败，请检查网络");
    } finally {
      setIsSavingMap(false);
    }
  }

  async function handleDeleteMapping(id: string) {
    const res = await fetch(`/api/operations/sku-mappings?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMappings((prev) => prev.filter((m) => m.id !== id));
      setNotice("已解除该 SKU 映射。");
    }
  }

  async function handleSaveToLedger() {
    if (!result) return;
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      const res = await fetch("/api/operations/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: batchLabel.trim() || `${marketplaceCode} 实盘账期 (${snapshotDate})`,
          marketplace: marketplaceCode,
          currency: reportingCurrency,
          result,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; batch?: SavedOperationsBatch; error?: string };
      if (!res.ok || !json.ok || !json.batch) {
        setError(json.error || "写入实盘账本失败");
        return;
      }
      setSavedBatches((prev) => [json.batch!, ...prev]);
      setExpandedBatchId(json.batch.id);
      setNotice(
        `已存入实盘账本：「${json.batch.label}」（${json.batch.skuCount} 条 SKU，已含分项费用归因与 ${json.batch.landedCostCoveredCount} 条采购成本核算）。`,
      );
      setBatchLabel("");
    } catch {
      setError("保存失败，请检查网络连接");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteBatch(id: string) {
    setError(null);
    setNotice(null);
    const res = await fetch(`/api/operations/batches?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) {
      setSavedBatches((prev) => prev.filter((b) => b.id !== id));
      if (expandedBatchId === id) setExpandedBatchId(null);
      setNotice("已删除该历史账本批次。");
    }
  }

  function loadSample() {
    setMarketplaceCode("US");
    setReportingCurrency("USD");
    setReportTimezone("America/Los_Angeles");
    setPolicy("settlement");
    setSnapshotDate("2026-10-31");
    setSettlementText(SAMPLE_SETTLEMENT_TSV);
    setInventoryText(SAMPLE_INVENTORY_TSV);
    setAdSpendText(SAMPLE_ADS_CSV);
    setIsSampleLoaded(true);
    setError(null);
  }

  async function handleRunPreview(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsRunning(true);
    try {
      const payload: Record<string, unknown> = {
        settlementText,
        inventoryText,
        adSpendText,
        marketplaceCode,
        reportingCurrency,
        reportTimezone,
        policy,
        snapshotDate,
      };
      if (isSampleLoaded) {
        payload.dailySalesBySku = {
          B0DEMO0001: [12, 10, 11, 14, 9, 13, 11],
          B0DEMO0002: [4, 5, 3, 4, 6, 4, 5],
        };
      }
      const res = await fetch("/api/operations/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { success?: boolean; result?: PipelineResult; error?: string };
      if (!res.ok || !json.success || !json.result) {
        setError(json.error || "试算失败，请检查报表列名与币种口径");
        setResult(null);
        return;
      }
      setResult(json.result);
    } catch {
      setError("请求异常，请确认本地服务正常运行");
    } finally {
      setIsRunning(false);
    }
  }

  const totalContributionCents = result
    ? result.periods.reduce((sum, p) => sum + p.contribution.contributionProfitCents, 0)
    : 0;
  const coveredPeriods = result ? result.periods.filter((p) => p.trueNetProfitCents !== null) : [];
  const totalTrueNetCents =
    coveredPeriods.length > 0
      ? coveredPeriods.reduce((sum, p) => sum + (p.trueNetProfitCents ?? 0), 0)
      : null;
  const lowStockCount = result
    ? result.periods.filter((p) => p.inventoryDays && p.inventoryDays.days !== null && p.inventoryDays.days < 30).length
    : 0;

  return (
    <div className="stack">
      <section className="section">
        <div className="section-header">
          <div>
            <h2>已存档实盘经营账本（{savedBatches.length} 期）</h2>
            <p>完整保留退款、佣金、履约、广告、仓储等分项费用；绑定采购到岸成本后自动按同口径核算真实净利并反哺立项校准。</p>
          </div>
        </div>

        {notice ? (
          <div className="notice" style={{ marginBottom: 14 }}>
            <span className="badge badge-success">已更新</span>
            <span>{notice}</span>
          </div>
        ) : null}

        {savedBatches.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            还没有存档的实盘账期。在下方粘贴或载入示例 Settlement V2 报表试算后，点击「存入实盘账本」即可永久沉淀。
          </p>
        ) : (
          <div className="stack" style={{ gap: "12px" }}>
            {savedBatches.map((batch) => {
              const isOpen = expandedBatchId === batch.id;
              return (
                <article
                  key={batch.id}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: "10px",
                    background: "var(--paper)",
                    padding: "14px 16px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <strong>{batch.label}</strong>
                        <span className="badge badge-neutral">{batch.marketplace} · {batch.currency}</span>
                        <span className="badge badge-neutral">{batch.skuCount} SKU</span>
                        <span className={`badge ${batch.landedCostCoveredCount === batch.skuCount && batch.skuCount > 0 ? "badge-success" : "status-review_pending"}`}>
                          采购成本覆盖 {batch.landedCostCoveredCount}/{batch.skuCount}
                        </span>
                        {batch.stockoutRiskCount > 0 ? (
                          <span className="badge badge-danger">断货预警 {batch.stockoutRiskCount}</span>
                        ) : (
                          <span className="badge badge-success">库存健康</span>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>
                        账期 {batch.periodStart || "—"} ~ {batch.periodEnd || "—"} · 记录人 {batch.createdBy} · {shortDate(batch.createdAt)}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>净营收</div>
                        <strong className="mono">{moneyIn(batch.currency, batch.totalRevenueCents)}</strong>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>平台贡献</div>
                        <strong className="mono" style={{ color: batch.totalContributionCents >= 0 ? "var(--green)" : "var(--red)" }}>
                          {moneyIn(batch.currency, batch.totalContributionCents)}
                        </strong>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "12px", color: "var(--muted)" }}>实盘真实净利</div>
                        <strong className="mono" style={{ color: batch.totalNetProfitCents !== null ? (batch.totalNetProfitCents >= 0 ? "var(--green)" : "var(--red)") : "var(--muted)" }}>
                          {batch.totalNetProfitCents !== null
                            ? moneyIn(batch.currency, batch.totalNetProfitCents)
                            : "缺采购成本"}
                        </strong>
                      </div>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setExpandedBatchId(isOpen ? null : batch.id)}
                      >
                        {isOpen ? "收起明细" : "展开分项归因"}
                      </button>
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => handleDeleteBatch(batch.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {isOpen && batch.skus.length > 0 ? (
                    <div className="heatmap-scroll" style={{ marginTop: "12px" }}>
                      <table className="ops-table">
                        <thead>
                          <tr>
                            <th>SKU / 案卷</th>
                            <th>期间</th>
                            <th className="num">净销量</th>
                            <th className="num">净营收</th>
                            <th className="num">退款</th>
                            <th className="num">佣金</th>
                            <th className="num">履约费</th>
                            <th className="num">广告费</th>
                            <th className="num">采购到岸</th>
                            <th className="num">平台贡献</th>
                            <th className="num">真实净利</th>
                            <th className="num">同口径偏差</th>
                            <th className="num">可售天数</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batch.skus.map((sku) => {
                            const riskClass =
                              sku.stockoutRisk === "critical"
                                ? "is-no-go"
                                : sku.stockoutRisk === "warning"
                                  ? "is-hold"
                                  : sku.stockoutRisk === "healthy"
                                    ? "is-go"
                                    : "";
                            return (
                              <tr key={sku.id}>
                                <td className="mono">
                                  {sku.caseId ? (
                                    <Link href={`/cases/${encodeURIComponent(sku.caseId)}`} style={{ textDecoration: "underline", fontWeight: 700 }}>
                                      {sku.sku}
                                    </Link>
                                  ) : (
                                    <button
                                      type="button"
                                      className="button ghost"
                                      style={{ padding: "2px 6px", fontSize: 12 }}
                                      onClick={() => setMapSku(sku.sku)}
                                      title="点击下方绑定该 SKU 到商品案卷或录入采购成本"
                                    >
                                      {sku.sku} (绑定)
                                    </button>
                                  )}
                                </td>
                                <td className="mono">{sku.periodKey}</td>
                                <td className="num mono">{sku.unitsSold}</td>
                                <td className="num mono">{moneyIn(batch.currency, sku.revenueCents)}</td>
                                <td className="num mono">{sku.refundCents > 0 ? `−${moneyIn(batch.currency, sku.refundCents)}` : "—"}</td>
                                <td className="num mono">{moneyIn(batch.currency, sku.platformFeeCents)}</td>
                                <td className="num mono">{moneyIn(batch.currency, sku.fulfillmentFeeCents)}</td>
                                <td className="num mono">
                                  {sku.adAttribution === "missing" ? (
                                    <span className="muted">未归因</span>
                                  ) : (
                                    <span title={adAttributionLabel(sku.adAttribution)}>
                                      {moneyIn(batch.currency, sku.adSpendCents)}
                                    </span>
                                  )}
                                </td>
                                <td className="num mono">
                                  {sku.landedCostCents !== null ? (
                                    moneyIn(batch.currency, sku.landedCostCents)
                                  ) : (
                                    <span className="muted">未绑定</span>
                                  )}
                                </td>
                                <td className="num mono">
                                  {moneyIn(batch.currency, sku.contributionCents)}
                                  <div className="muted" style={{ fontSize: 11 }}>{percent(sku.marginRate, 1)}</div>
                                </td>
                                <td className="num mono">
                                  {sku.netProfitCents !== null && sku.netMarginRate !== null ? (
                                    <>
                                      <strong>{moneyIn(batch.currency, sku.netProfitCents)}</strong>
                                      <div className="muted" style={{ fontSize: 11 }}>{percent(sku.netMarginRate, 1)}</div>
                                    </>
                                  ) : (
                                    <span className="muted">仅平台贡献</span>
                                  )}
                                </td>
                                <td className={`num mono ${sku.marginDelta !== null ? (sku.marginDelta >= 0 ? "is-go" : "is-danger") : ""}`}>
                                  {sku.marginDelta !== null ? (
                                    <>
                                      {sku.marginDelta >= 0 ? "+" : ""}
                                      {percent(sku.marginDelta, 1)}
                                      <div className="muted" style={{ fontSize: 10 }}>
                                        {sku.costBasis === "true_net_profit" ? "净利口径" : "平台贡献口径"}
                                      </div>
                                    </>
                                  ) : (
                                    "未匹配案卷"
                                  )}
                                </td>
                                <td className="num">
                                  {sku.daysOfSupply !== null ? (
                                    <span className={`verdict-pill ${riskClass} mono`}>{sku.daysOfSupply} 天</span>
                                  ) : (
                                    <span className="muted">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>SKU 成本映射（打通实盘 ↔ 案卷采购到岸成本）</h2>
            <p>将平台 Seller SKU 绑定到已有商品案卷或录入单件到岸成本，保存后立即重算该 SKU 所有历史账期的真实净利并写入审计日志。</p>
          </div>
        </div>

        <form onSubmit={handleSaveMapping} className="stack" style={{ gap: 12 }}>
          <div className="form-grid">
            <label className="field">
              <span>平台 SKU (Seller SKU / MSKU)</span>
              <input
                value={mapSku}
                onChange={(e) => setMapSku(e.target.value)}
                placeholder="例如 PET-BRUSH-BLK-01 或 B0DEMO0001"
              />
            </label>
            <label className="field">
              <span>关联商品案卷（自动带入类目与立项成本）</span>
              <select value={mapCaseId} onChange={(e) => setMapCaseId(e.target.value)}>
                <option value="">不关联案卷（仅手填到岸成本）</option>
                {caseOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.asin} · {c.title.slice(0, 32)} ({c.category})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>单件到岸成本覆盖（{reportingCurrency}，留空则取案卷模型）</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={mapLandedInput}
                onChange={(e) => setMapLandedInput(e.target.value)}
                placeholder="例如 12.40"
              />
            </label>
          </div>
          <div className="form-actions">
            <span className="help">显式映射优先于 ASIN 自动猜测，可用于区分同一 ASIN 下不同批次或 Seller SKU 的真实采购成本。</span>
            <button type="submit" className="button secondary" disabled={isSavingMap || !mapSku.trim()}>
              {isSavingMap ? "保存并重算中…" : "保存映射并重算历史净利"}
            </button>
          </div>
        </form>

        {mappings.length > 0 ? (
          <div className="heatmap-scroll" style={{ marginTop: 12 }}>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>站点</th>
                  <th>平台 SKU</th>
                  <th>关联案卷 / 类目</th>
                  <th className="num">生效单件到岸成本</th>
                  <th className="num">操作</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.marketplace}</td>
                    <td className="mono"><strong>{m.channelSku}</strong></td>
                    <td>
                      {m.caseId ? (
                        <Link href={`/cases/${encodeURIComponent(m.caseId)}`} style={{ textDecoration: "underline" }}>
                          {m.caseAsin} · {m.caseCategory || "未分类"}
                        </Link>
                      ) : (
                        <span className="muted">仅手动成本</span>
                      )}
                    </td>
                    <td className="num mono">
                      {m.effectiveUnitLandedCostCents !== null
                        ? moneyIn(reportingCurrency, m.effectiveUnitLandedCostCents)
                        : "—"}
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => handleDeleteMapping(m.id)}
                      >
                        解除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="section">
        <div className="section-header">
          <div>
            <h2>导入新账期（结算单、可选广告报表与库存快照）</h2>
            <p>粘贴 Amazon Settlement V2、可选 Amazon Ads 商品广告花费与 FBA 库存快照，先试算核对分项归因与同口径偏差，再存入账本。</p>
          </div>
          <button type="button" className="button secondary" onClick={loadSample}>
            载入示例结算单、广告与库存
          </button>
        </div>

        <form onSubmit={handleRunPreview} className="stack">
          <div className="form-grid">
            <label className="field">
              <span>站点代码</span>
              <input value={marketplaceCode} onChange={(e) => setMarketplaceCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>本位币</span>
              <input value={reportingCurrency} onChange={(e) => setReportingCurrency(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>站点时区 (IANA)</span>
              <input value={reportTimezone} onChange={(e) => setReportTimezone(e.target.value)} />
            </label>
            <label className="field">
              <span>归集口径</span>
              <select value={policy} onChange={(e) => setPolicy(e.target.value as "settlement" | "order")}>
                <option value="settlement">结算月（收付实现制）</option>
                <option value="order">订单月（权责发生制）</option>
              </select>
            </label>
            <label className="field">
              <span>库存快照日期</span>
              <input type="date" value={snapshotDate} onChange={(e) => setSnapshotDate(e.target.value)} />
            </label>
          </div>

          <div className="ops-textarea-grid">
            <label className="field">
              <span>Amazon Settlement V2 报表文本（TSV / CSV）</span>
              <textarea
                rows={7}
                value={settlementText}
                onChange={(e) => {
                  setSettlementText(e.target.value);
                  setIsSampleLoaded(false);
                }}
                placeholder="粘贴 Amazon 后台导出的 Settlement V2 制表符文本，或点击右上角「载入示例」体验完整复盘..."
              />
            </label>
            <label className="field">
              <span>FBA 库存快照文本（可选，用于计算可售库存天数）</span>
              <textarea
                rows={7}
                value={inventoryText}
                onChange={(e) => {
                  setInventoryText(e.target.value);
                  setIsSampleLoaded(false);
                }}
                placeholder="粘贴 FBA Manage Inventory Health / AFN 库存快照 TSV..."
              />
            </label>
          </div>

          <label className="field">
            <span>Amazon Ads 商品广告花费 CSV/TSV（可选，补齐结算单缺失的 SKU 级广告归因）</span>
            <textarea
              rows={3}
              value={adSpendText}
              onChange={(e) => {
                setAdSpendText(e.target.value);
                setIsSampleLoaded(false);
              }}
              placeholder="支持 Advertised SKU / ASIN + Spend 列（不填时该批次广告率标记为「未归因」，不会按 0% 污染校准库）"
            />
          </label>

          <div className="form-actions">
            <span className="help">纯确定性归集：保留分项费用，缺失采购成本时只显示平台贡献，缺失广告数据时不按 0% 参与校准。</span>
            <button type="submit" className="button primary" disabled={isRunning || !settlementText.trim()}>
              {isRunning ? "正在归集试算…" : "执行零写入实盘复盘"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="notice warn" style={{ marginTop: 14 }}>
            <span className="badge badge-danger">ERROR</span>
            <span>{error}</span>
          </div>
        ) : null}
      </section>

      {result ? (
        <>
          <section className="metrics-grid">
            <article className="metric-card">
              <div className="metric-label">归集 SKU × 期间数</div>
              <div className="metric-value mono">{result.periods.length}</div>
              <div className="metric-note">原始结算行 {result.settlement.lineCount} 条</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">平台侧贡献毛利</div>
              <div className="metric-value mono">{moneyIn(reportingCurrency, totalContributionCents)}</div>
              <div className="metric-note">不含采购到岸成本</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">实盘真实净利（已绑采购）</div>
              <div className="metric-value mono">
                {totalTrueNetCents !== null ? moneyIn(reportingCurrency, totalTrueNetCents) : "缺采购成本"}
              </div>
              <div className="metric-note">覆盖 {coveredPeriods.length}/{result.periods.length} 条 SKU</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">断货预警 / 隔离行</div>
              <div className={`metric-value mono ${lowStockCount > 0 ? "is-danger" : ""}`}>
                {lowStockCount} / {result.settlement.unmapped.length}
              </div>
              <div className="metric-note">可售 &lt;30 天 SKU / 未识别结算行</div>
            </article>
          </section>

          {result.warnings.length > 0 ? (
            <div className="notice warn">
              <span className="badge status-review_pending">WARNINGS</span>
              <span>{result.warnings.join("；")}</span>
            </div>
          ) : null}

          <section className="section">
            <div className="section-header">
              <div>
                <h2>SKU 级分项归因与同口径偏差（试算预览）</h2>
                <p>核对无误后点击右侧「存入实盘账本」，数据将自动参与后续立项校准。</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={batchLabel}
                  onChange={(e) => setBatchLabel(e.target.value)}
                  placeholder={`${marketplaceCode} 实盘账期 (${snapshotDate})`}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    color: "var(--ink)",
                    fontSize: "13px",
                    minWidth: "220px",
                  }}
                />
                <button
                  type="button"
                  className="button primary"
                  disabled={isSaving}
                  onClick={handleSaveToLedger}
                >
                  {isSaving ? "正在存档…" : "存入实盘账本"}
                </button>
              </div>
            </div>

            <div className="heatmap-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>SKU / ASIN</th>
                    <th>期间</th>
                    <th className="num">净销量</th>
                    <th className="num">净营收</th>
                    <th className="num">退款</th>
                    <th className="num">佣金 / 履约</th>
                    <th className="num">广告费</th>
                    <th className="num">平台贡献</th>
                    <th className="num">实盘真实净利</th>
                    <th className="num">同口径预测与偏差</th>
                    <th className="num">可售天数</th>
                  </tr>
                </thead>
                <tbody>
                  {result.periods.map((row) => {
                    const variance = row.forecast?.variance ?? null;
                    const doi = row.inventoryDays?.days ?? null;
                    const doiClass = doi === null ? "" : doi < 15 ? "is-no-go" : doi < 30 ? "is-hold" : "is-go";
                    const totalAd = (row.costsByKey.adCost ?? 0) + row.externalAdSpendCents;
                    return (
                      <tr key={`${row.skuKey}-${row.periodKey}`}>
                        <td className="mono"><strong>{row.skuKey}</strong></td>
                        <td className="mono">{row.periodKey}</td>
                        <td className="num mono">{row.units}</td>
                        <td className="num mono">{moneyIn(row.currency, row.contribution.netRevenueCents)}</td>
                        <td className="num mono">{row.refundCents > 0 ? `−${moneyIn(row.currency, row.refundCents)}` : "—"}</td>
                        <td className="num mono">
                          {moneyIn(row.currency, row.costsByKey.platformFee ?? 0)} / {moneyIn(row.currency, row.costsByKey.fulfillmentFee ?? 0)}
                        </td>
                        <td className="num mono">
                          {row.adAttribution === "missing" ? (
                            <span className="muted">未归因</span>
                          ) : (
                            <>
                              {moneyIn(row.currency, totalAd)}
                              <div className="muted" style={{ fontSize: 10 }}>{adAttributionLabel(row.adAttribution)}</div>
                            </>
                          )}
                        </td>
                        <td className="num mono">{moneyIn(row.currency, row.contribution.contributionProfitCents)}</td>
                        <td className="num mono">
                          {row.trueNetProfitCents !== null ? (
                            <>
                              <strong>{moneyIn(row.currency, row.trueNetProfitCents)}</strong>
                              <div className="muted" style={{ fontSize: 10 }}>
                                采购 {moneyIn(row.currency, row.landedCostTotalCents ?? 0)}
                              </div>
                            </>
                          ) : (
                            <span className="muted">缺采购成本</span>
                          )}
                        </td>
                        <td className={`num mono ${variance ? (variance.differenceCents >= 0 ? "is-go" : "is-danger") : ""}`}>
                          {row.forecast && variance ? (
                            <>
                              {variance.differenceCents >= 0 ? "+" : "−"}
                              {moneyIn(row.currency, Math.abs(variance.differenceCents))}
                              {variance.ratio !== null ? ` (${percent(variance.ratio, 1)})` : ""}
                              <div className="muted" style={{ fontSize: 10 }}>
                                预测 {moneyIn(row.currency, row.forecast.forecastComparableProfitCents)} ·{" "}
                                {row.forecast.comparisonBasis === "true_net_profit"
                                  ? "真实净利口径"
                                  : "平台贡献口径"}
                              </div>
                            </>
                          ) : (
                            "未匹配案卷"
                          )}
                        </td>
                        <td className="num">
                          {doi !== null ? (
                            <span className={`verdict-pill ${doiClass} mono`}>{doi.toFixed(1)} 天</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {result.periods.some((p) => (p.forecast?.breakdown?.length ?? 0) > 0) ? (
              <div style={{ marginTop: 16 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>分项预测误差拆解（实盘 vs 立项假设）</h3>
                <div className="stack" style={{ gap: 10 }}>
                  {result.periods
                    .filter((p) => (p.forecast?.breakdown?.length ?? 0) > 0)
                    .map((p) => (
                      <div
                        key={`bd-${p.skuKey}-${p.periodKey}`}
                        style={{
                          border: "1px solid var(--line)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          background: "var(--paper)",
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }} className="mono">
                          {p.skuKey} · {p.periodKey}
                        </div>
                        <div className="metric-pairs">
                          {p.forecast!.breakdown.map((item) => {
                            const fmt = (v: number) =>
                              item.unit === "rate" ? percent(v, 1) : moneyIn(p.currency, v);
                            return (
                              <div key={item.key} className="metric-pair">
                                <small>{item.label}</small>
                                <strong className="mono" style={{ fontSize: 13 }}>
                                  {item.status === "unattributed" ? (
                                    <span className="muted">未归因（预测 {fmt(item.planned)}）</span>
                                  ) : item.actual !== null && item.delta !== null ? (
                                    <>
                                      实盘 {fmt(item.actual)} / 预测 {fmt(item.planned)} (
                                      {item.delta >= 0 ? "+" : ""}
                                      {fmt(item.delta)})
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </strong>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
