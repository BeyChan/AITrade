"use client";

import { useState } from "react";
import type { PipelineResult } from "@/lib/operations-pipeline";
import { moneyIn, percent } from "@/lib/format";

const SAMPLE_SETTLEMENT_TSV = [
  "settlement-id\tsettlement-start-date\tsettlement-end-date\tdeposit-date\tcurrency\ttransaction-type\torder-id\tamount-type\tamount-description\tamount\tposted-date\tposted-date-time\tsku\tquantity-purchased",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tItemPrice\tPrincipal\t399.90\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t10",
  "SET-2026-10B\t2026-10-16T00:00:00-07:00\t2026-10-31T00:00:00-07:00\t2026-11-02T00:00:00-08:00\tUSD\tOrder\tORD-1001\tItemFees\tCommission\t-59.99\t2026-10-25\t2026-10-25T14:20:00-07:00\tB0DEMO0001\t",
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

export function OperationsReviewClient({
  defaultMarket,
  defaultCurrency,
}: {
  defaultMarket: string;
  defaultCurrency: string;
}) {
  const [marketplaceCode, setMarketplaceCode] = useState(defaultMarket || "US");
  const [reportingCurrency, setReportingCurrency] = useState(defaultCurrency || "USD");
  const [reportTimezone, setReportTimezone] = useState("America/Los_Angeles");
  const [policy, setPolicy] = useState<"settlement" | "order">("settlement");
  const [snapshotDate, setSnapshotDate] = useState("2026-10-31");
  const [settlementText, setSettlementText] = useState("");
  const [inventoryText, setInventoryText] = useState("");
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  function loadSample() {
    setMarketplaceCode("US");
    setReportingCurrency("USD");
    setReportTimezone("America/Los_Angeles");
    setPolicy("settlement");
    setSnapshotDate("2026-10-31");
    setSettlementText(SAMPLE_SETTLEMENT_TSV);
    setInventoryText(SAMPLE_INVENTORY_TSV);
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
  const lowStockCount = result
    ? result.periods.filter((p) => p.inventoryDays && p.inventoryDays.days !== null && p.inventoryDays.days < 30).length
    : 0;

  return (
    <div className="stack">
      <section className="section">
        <div className="section-header">
          <div>
            <h2>零写入结算与库存试算（Actual vs Plan）</h2>
            <p>粘贴或上传 Amazon Settlement V2 与 FBA 库存快照报表，系统自动匹配已立项案卷的成本模型，输出实盘偏差与断货预警（全程只读、不写库）。</p>
          </div>
          <button type="button" className="button secondary" onClick={loadSample}>
            载入示例结算单与库存快照
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

          <div className="form-actions">
            <span className="help">纯确定性归集，缺失字段不会静默按 0 估算，未识别行会进入隔离区等待核对。</span>
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
              <div className="metric-label">实盘总贡献毛利</div>
              <div className="metric-value mono">{moneyIn(reportingCurrency, totalContributionCents)}</div>
              <div className="metric-note">口径：{policy === "settlement" ? "结算月" : "订单月"}</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">断货预警 SKU（&lt;30天）</div>
              <div className={`metric-value mono ${lowStockCount > 0 ? "is-danger" : ""}`}>{lowStockCount}</div>
              <div className="metric-note">基于 FBA 可售库存与日均销量</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">未映射隔离行</div>
              <div className="metric-value mono">{result.settlement.unmapped.length}</div>
              <div className="metric-note">不参与归集，需人工核对列名</div>
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
                <h2>SKU 级实盘 vs 立项预测偏差台账</h2>
                <p>自动将结算单中的 SKU / ASIN 与系统内已立项案卷的成本模型进行对齐，偏差为负表示实盘低于立项预期。</p>
              </div>
            </div>
            <div className="heatmap-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>SKU / ASIN</th>
                    <th>期间</th>
                    <th className="num">实盘件数</th>
                    <th className="num">净销售额</th>
                    <th className="num">实盘贡献毛利</th>
                    <th className="num">立项预测总利</th>
                    <th className="num">实盘 vs 预测偏差</th>
                    <th className="num">FBA 可售 / 在途</th>
                    <th className="num">可售天数 (DOI)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.periods.map((row) => {
                    const variance = row.forecast?.variance ?? null;
                    const doi = row.inventoryDays?.days ?? null;
                    const doiClass = doi === null ? "" : doi < 15 ? "is-no-go" : doi < 30 ? "is-hold" : "is-go";
                    return (
                      <tr key={`${row.skuKey}-${row.periodKey}`}>
                        <td className="mono"><strong>{row.skuKey}</strong></td>
                        <td className="mono">{row.periodKey}</td>
                        <td className="num mono">{row.units}</td>
                        <td className="num mono">{moneyIn(row.currency, row.contribution.netRevenueCents)}</td>
                        <td className="num mono"><strong>{moneyIn(row.currency, row.contribution.contributionProfitCents)}</strong></td>
                        <td className="num mono">
                          {row.forecast ? moneyIn(row.currency, row.forecast.folded.foldedProfitCents) : "未匹配案卷"}
                        </td>
                        <td className={`num mono ${variance ? (variance.differenceCents >= 0 ? "is-go" : "is-danger") : ""}`}>
                          {variance
                            ? `${variance.differenceCents >= 0 ? "+" : "−"}${moneyIn(row.currency, Math.abs(variance.differenceCents))}${variance.ratio !== null ? ` (${percent(variance.ratio, 1)})` : ""}`
                            : "—"}
                        </td>
                        <td className="num mono">
                          {row.inventory
                            ? `${row.inventory.availableUnits} / ${row.inventory.inTransitUnits ?? 0}`
                            : "—"}
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
          </section>
        </>
      ) : null}
    </div>
  );
}
