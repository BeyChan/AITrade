"use client";

import { useState } from "react";
import { money, percent } from "@/lib/format";
import { OFFICIAL_FX_CONFIG } from "@/lib/currency";

type ScoredQuote = {
  id: string;
  score: number;
  isEligible: boolean;
  isPreferred: boolean;
  landedCostCents: number;
  economics: {
    netProfitCents: number;
    marginRate: number;
    stressProfitCents: number;
  };
};

type Quote = {
  id: string;
  unit_price_cents: number;
  freight_per_unit_cents: number;
  duty_rate: string | number;
  moq: number;
  lead_time_days: number | null;
  sample_fee_cents: number | null;
  incoterm: string | null;
  supplier: {
    id: string;
    name: string;
    platform: string;
    country: string | null;
    url?: string | null;
    contact: string | null;
  };
};

type Props = {
  caseId: string;
  marketplace: string;
  currency: string;
  quotes: Quote[];
  scoredQuotes: ScoredQuote[];
  selectedQuoteId: string | null;
  canSource: boolean;
  onSelectAction: (formData: FormData) => void;
  onCreate1688Action: (formData: FormData) => void;
};

export function SupplierMatrixPk({
  caseId,
  marketplace,
  currency,
  quotes,
  scoredQuotes,
  selectedQuoteId,
  canSource,
  onSelectAction,
  onCreate1688Action,
}: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [priceRmb, setPriceRmb] = useState<number>(24);
  const [freightRmb, setFreightRmb] = useState<number>(5);

  const fxDef = OFFICIAL_FX_CONFIG[currency] || OFFICIAL_FX_CONFIG.USD;
  const fx = fxDef.rateToRmb;

  const convUnitPrice = (priceRmb / fx).toFixed(2);
  const convFreight = (freightRmb / fx).toFixed(2);

  return (
    <section className="section" style={{ marginBottom: "28px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "10px",
        }}
      >
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>
            SUPPLIER MATRIX PK · 1688 工厂横向定标
          </div>
          <h2 style={{ margin: "2px 0 0 0", fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
            多工厂询价核算与定标决策矩阵
          </h2>
          <p style={{ margin: "2px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
            并排对标 2~4 家工厂单价、首单占用资金 (MOQ)、交期与质检评分，支持一键锁定中标工厂。
          </p>
        </div>

        <button
          type="button"
          className="button secondary"
          disabled={!canSource}
          onClick={() => setShowAddForm(!showAddForm)}
          style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "8px" }}
        >
          {showAddForm ? "收起录入" : "+ 录入 1688 工厂实报单价"}
        </button>
      </div>

      {/* 1688 人民币快速询价录入卡片 */}
      {showAddForm && (
        <form
          action={onCreate1688Action}
          style={{
            background: "#fbfcfb",
            padding: "18px 20px",
            borderRadius: "12px",
            border: "1.5px solid var(--green)",
            marginBottom: "20px",
          }}
        >
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="supplierPlatform" value="1688" />
          <input type="hidden" name="country" value="CN" />
          <input type="hidden" name="unitPrice" value={convUnitPrice} />
          <input type="hidden" name="freightPerUnit" value={convFreight} />

          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", marginBottom: "12px" }}>
            🏭 录入 1688 源头工厂报价 (自动换算为 {currency} 到岸成本)
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                1688 工厂全称 *
              </label>
              <input
                name="supplierName"
                required
                placeholder="例如：慈溪市XX塑料五金制造厂"
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                工厂出厂单价 (RMB) *
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>¥</span>
                <input
                  type="number"
                  step="0.1"
                  required
                  value={priceRmb}
                  onChange={(e) => setPriceRmb(Number(e.target.value))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px", fontWeight: 700 }}
                />
              </div>
              <div style={{ fontSize: "10px", color: "var(--green)", marginTop: "2px" }}>
                ≈ {convUnitPrice} {currency}
              </div>
            </div>

            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                单件海运头程 (RMB)
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ fontSize: "13px", color: "var(--muted)" }}>¥</span>
                <input
                  type="number"
                  step="0.5"
                  value={freightRmb}
                  onChange={(e) => setFreightRmb(Number(e.target.value))}
                  style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px" }}
                />
              </div>
              <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>
                ≈ {convFreight} {currency}
              </div>
            </div>

            <div>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                首单建议 MOQ (件) *
              </label>
              <input
                type="number"
                name="moq"
                required
                defaultValue={500}
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "13px" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: "12px", marginBottom: "14px" }}>
            <div>
              <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                1688 商品/店铺链接或旺旺号
              </label>
              <input
                name="supplierUrl"
                placeholder="https://detail.1688.com/..."
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                生产交期 (天)
              </label>
              <input
                type="number"
                name="leadTimeDays"
                defaultValue={20}
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                预估进口关税率
              </label>
              <input
                name="dutyRate"
                defaultValue="5%"
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}
              />
            </div>

            <div>
              <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: "4px" }}>
                工厂初评打分 (0~100)
              </label>
              <input
                type="number"
                name="qualityScore"
                defaultValue={80}
                max={100}
                min={0}
                style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "12px" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button
              type="button"
              className="button ghost"
              onClick={() => setShowAddForm(false)}
              style={{ fontSize: "12px" }}
            >
              取消
            </button>
            <button type="submit" className="button primary" style={{ fontSize: "12px", padding: "6px 16px" }}>
              ⚡ 保存 1688 报价并加入对比矩阵
            </button>
          </div>
        </form>
      )}

      {/* 多工厂横向对比矩阵 */}
      {quotes.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
            gap: "14px",
            alignItems: "stretch",
          }}
        >
          {scoredQuotes.map((sq, idx) => {
            const q = quotes.find((item) => item.id === sq.id);
            if (!q) return null;

            const isSelected = selectedQuoteId === q.id;
            const isPref = sq.isPreferred;
            const orderBudgetRmb = Math.round((q.unit_price_cents / 100) * fx * q.moq);

            return (
              <div
                key={q.id}
                style={{
                  background: isSelected ? "#f9fcf9" : "#ffffff",
                  borderRadius: "12px",
                  border: isSelected ? "2px solid var(--green)" : isPref ? "1.5px solid var(--lime)" : "1px solid var(--line)",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: isSelected ? "0 4px 14px rgba(31, 122, 85, 0.08)" : "0 2px 6px rgba(0,0,0,0.02)",
                  position: "relative",
                }}
              >
                <div>
                  {/* 头部：排名、名字与综合评分 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 800,
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: isPref ? "var(--green)" : "#edf2ee",
                            color: isPref ? "#ffffff" : "var(--ink)",
                          }}
                        >
                          #{idx + 1}
                        </span>
                        {isSelected && <span className="badge badge-success" style={{ fontSize: "10px" }}>已定标</span>}
                        {isPref && !isSelected && <span className="badge recommendation-go" style={{ fontSize: "10px" }}>系统推荐</span>}
                      </div>
                      <h4 style={{ margin: 0, fontSize: "14px", color: "var(--ink)", fontWeight: 800, lineHeight: "1.3" }}>
                        {q.supplier.name}
                      </h4>
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>
                        {q.supplier.platform || "1688 供应商"} · {q.supplier.country || "CN"}
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "20px", fontWeight: 900, color: "var(--green)", lineHeight: 1 }}>
                        {sq.score}
                      </div>
                      <div style={{ fontSize: "10px", color: "var(--muted)" }}>综合得分</div>
                    </div>
                  </div>

                  {/* 核心财务测算卡片 */}
                  <div
                    style={{
                      background: "#f8faf8",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      border: "1px solid var(--line)",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>单件到岸成本:</span>
                      <strong style={{ fontSize: "13px", color: "var(--ink)" }}>{money(sq.landedCostCents)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>测算单件净利:</span>
                      <strong style={{ fontSize: "13px", color: sq.economics.netProfitCents > 0 ? "var(--green)" : "var(--red)" }}>
                        {money(sq.economics.netProfitCents)} ({percent(sq.economics.marginRate)})
                      </strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>压力保本净利:</span>
                      <strong style={{ fontSize: "12px", color: sq.economics.stressProfitCents > 0 ? "var(--green)" : "var(--red)" }}>
                        {money(sq.economics.stressProfitCents)}
                      </strong>
                    </div>
                  </div>

                  {/* 工厂硬性参数列表 */}
                  <div style={{ fontSize: "11px", color: "var(--ink)", display: "flex", flexDirection: "column", gap: "4px", marginBottom: "14px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>首单 MOQ:</span>
                      <strong>{q.moq.toLocaleString()} 件</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>首单起订预算:</span>
                      <strong>约 ¥{orderBudgetRmb.toLocaleString()}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>出厂采购单价:</span>
                      <span>{money(q.unit_price_cents)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--muted)" }}>生产交期:</span>
                      <span>{q.lead_time_days ? `${q.lead_time_days} 天` : "—"}</span>
                    </div>
                    {q.supplier.url && (
                      <div style={{ marginTop: "4px" }}>
                        <a
                          href={q.supplier.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--green)", fontSize: "11px", textDecoration: "underline" }}
                        >
                          打开 1688 商品主页 &rarr;
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                {/* 定标动作按钮 */}
                <div style={{ borderTop: "1px dashed var(--line)", paddingTop: "10px" }}>
                  {isSelected ? (
                    <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, textAlign: "center", padding: "6px 0" }}>
                      ✅ 当前已选定该供应商
                    </div>
                  ) : (
                    <form action={onSelectAction}>
                      <input type="hidden" name="caseId" value={caseId} />
                      <input type="hidden" name="quoteId" value={q.id} />
                      <input type="hidden" name="reviewer" value="操盘手" />
                      <input type="hidden" name="exceptionReason" value={`通过 1688 多工厂矩阵 PK 选定 #${idx + 1} 供应商`} />
                      <button
                        type="submit"
                        disabled={!canSource || !sq.isEligible}
                        className={`button ${isPref ? "primary" : "secondary"}`}
                        style={{ width: "100%", justifyContent: "center", fontSize: "12px", height: "34px", borderRadius: "8px" }}
                      >
                        {sq.isEligible ? "选定此工厂定标 →" : "未达盈利门槛"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          style={{
            background: "#fbfcfb",
            padding: "32px 20px",
            borderRadius: "12px",
            border: "1px dashed var(--line)",
            textAlign: "center",
          }}
        >
          <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "var(--muted)" }}>
            当前案卷暂无已录入的供应商报价。可点击上方按钮快速录入 1688 工厂人民币出厂价。
          </p>
          <button
            type="button"
            className="button primary"
            disabled={!canSource}
            onClick={() => setShowAddForm(true)}
            style={{ fontSize: "12px", padding: "6px 16px" }}
          >
            + 录入第 1 家 1688 工厂报价
          </button>
        </div>
      )}
    </section>
  );
}
