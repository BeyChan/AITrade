"use client";

import {
  isVerifiedCompetitorField,
  type CompetitorComparisonReport,
  type CompetitorProfile,
} from "@/lib/competitor-compare/types";
import type { AppMode } from "@/lib/app-mode";
import { OFFICIAL_FX_CONFIG } from "@/lib/currency";
import {
  calcItemProfitEstimate,
  calcItemRealMarginPct,
  estimateMaxPurchaseRmb,
  getBuyerTotalPriceCents,
} from "./helpers";

type Props = {
  currentReport: CompetitorComparisonReport;
  mode: AppMode;
  isSingleProduct: boolean;
  isReanalyzing: boolean;
  removingAsin: string | null;
  translatingKey: string | null;
  translatedKwMap: Record<string, { keyword: string; searchUrl: string }>;
  editingCostAsin: string | null;
  setEditingCostAsin: (asin: string | null) => void;
  editingCostVal: string;
  setEditingCostVal: (v: string) => void;
  isSavingItemCost: boolean;
  editingShippingAsin: string | null;
  setEditingShippingAsin: (asin: string | null) => void;
  editingShippingVal: string;
  setEditingShippingVal: (v: string) => void;
  isSavingShipping: boolean;
  setQuoteCostRmb: (v: number) => void;
  setTargetPriceVal: (v: number) => void;
  setBenchmarkAsin: (asin: string | null) => void;
  setStatusMsg: (msg: { type: "success" | "error"; text: string } | null) => void;
  formatPrice: (cents: number, cur: string) => string;
  handleClearManualItemCost: (asin: string) => void;
  handleSaveManualItemCost: (asin: string) => void;
  handleSaveItemShipping: (asin: string, amountOverride?: number | null) => void;
  handleSearch1688Translated: (item: CompetitorProfile, targetMaxCny: number, fallbackKeywords?: string[]) => void;
  handleDownloadImageAndOpen1688: (item: CompetitorProfile, targetMaxCny: number) => void;
  handleReanalyze: (excludeAsin?: string) => void;
};

export function CompetitorPkMatrix({
  currentReport,
  mode,
  isSingleProduct,
  isReanalyzing,
  removingAsin,
  translatingKey,
  translatedKwMap,
  editingCostAsin,
  setEditingCostAsin,
  editingCostVal,
  setEditingCostVal,
  isSavingItemCost,
  editingShippingAsin,
  setEditingShippingAsin,
  editingShippingVal,
  setEditingShippingVal,
  isSavingShipping,
  setQuoteCostRmb,
  setTargetPriceVal,
  setBenchmarkAsin,
  setStatusMsg,
  formatPrice,
  handleClearManualItemCost,
  handleSaveManualItemCost,
  handleSaveItemShipping,
  handleSearch1688Translated,
  handleDownloadImageAndOpen1688,
  handleReanalyze,
}: Props) {
  return (
          <section id="section-pk" className="panel" style={{ padding: "24px" }}>
            <div style={{ marginBottom: "18px" }}>
              <div className="eyebrow" style={{ color: "var(--green)" }}>
                {isSingleProduct ? "单品深度拆解" : "横向 PK 对标"}
              </div>
              <h4 style={{ margin: "2px 0 4px 0", fontSize: "16px", color: "var(--ink)" }}>
                {isSingleProduct ? "核心卖点与买家差评拆解" : "竞品核心卖点与差评痛点对决"}
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
                      background: "var(--paper)",
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
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                          <span
                            className={`badge ${isBudget ? "badge-neutral" : isPremium ? "badge-warn" : "badge-success"}`}
                            style={{ fontSize: "12px" }}
                          >
                            {isBudget ? "低价入门" : isPremium ? "高端溢价" : "中端主力"}
                          </span>
                          {item.isSponsored ? <span className="badge badge-warn" style={{ fontSize: "11px" }}>广告位</span> : null}
                          {item.fulfillmentType === "amazon_1p" ? <span className="badge badge-danger" style={{ fontSize: "11px" }}>1P 自营</span> : null}
                          {item.boughtPastMonth && item.boughtPastMonth > 0 ? (
                            <span className="badge badge-success mono" style={{ fontSize: "11px" }}>
                              月销 {item.boughtPastMonth.toLocaleString()}+
                            </span>
                          ) : null}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
                            {item.asin}
                          </a>
                          {!isSingleProduct ? (
                            <button
                              type="button"
                              disabled={isReanalyzing}
                              onClick={() => handleReanalyze(item.asin)}
                              title="移除这条干扰竞品并基于剩余竞品重新计算分位与四象限"
                              style={{
                                background: "none",
                                border: "1px solid var(--line)",
                                borderRadius: "6px",
                                padding: "1px 6px",
                                fontSize: "11px",
                                color: "var(--muted)",
                                cursor: "pointer",
                              }}
                            >
                              {removingAsin === item.asin ? "移除中..." : "移除"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px" }}>
                        {item.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.imageUrl}
                            alt={item.title}
                            style={{ width: "52px", height: "52px", objectFit: "contain", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--panel)", flexShrink: 0 }}
                          />
                        ) : null}
                        <h5
                          style={{
                            margin: 0,
                            fontSize: "14px",
                            lineHeight: "1.4",
                            color: "var(--ink)",
                            fontWeight: 700,
                          }}
                        >
                          [{item.brand}] {item.title}
                        </h5>
                      </div>

                      {/* 价格与销售表现（含单独运费录入与实付总价） */}
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px",
                          paddingBottom: "12px",
                          marginBottom: "14px",
                          borderBottom: "1px solid var(--line)",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
                          {(() => {
                            const sell = item.priceCents;
                            const list = item.listPriceCents && item.listPriceCents > sell ? item.listPriceCents : 0;
                            const listOffPct = list > 0 && sell > 0 ? Math.round(((list - sell) / list) * 100) : 0;
                            const eff = item.effectivePriceCents && item.effectivePriceCents > 0 && item.effectivePriceCents < sell
                              ? item.effectivePriceCents
                              : 0;
                            const couponPct = eff > 0 && sell > 0 ? Math.round(((sell - eff) / sell) * 100) : 0;
                            return (
                              <>
                                <span style={{ fontSize: "20px", fontWeight: 800, color: sell > 0 ? "var(--ink)" : "var(--muted)" }}>
                                  {sell > 0 ? formatPrice(sell, item.currency) : "待采集售价"}
                                </span>
                                {list > 0 ? (
                                  <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                                    <span style={{ textDecoration: "line-through" }}>{formatPrice(list, item.currency)}</span>
                                    {listOffPct > 0 ? <strong style={{ color: "var(--red)", marginLeft: "4px" }}>-{listOffPct}%</strong> : null}
                                  </span>
                                ) : null}
                                {eff > 0 ? (
                                  <span className="badge badge-warn" style={{ fontSize: "11px" }}>
                                    券后 {formatPrice(eff, item.currency)} (-{couponPct}%)
                                  </span>
                                ) : null}
                              </>
                            );
                          })()}
                          {item.rating > 0 ? (
                            <span style={{ fontSize: "12px", color: "var(--amber)", fontWeight: 700 }}>
                              ★ {item.rating}
                            </span>
                          ) : null}
                          {item.reviewCount > 0 || item.monthlySalesEst > 0 ? (
                            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                              ({item.reviewCount > 0 ? `${item.reviewCount.toLocaleString()} 评` : "评论待采集"}
                              {item.monthlySalesEst > 0 ? ` · 约 ${item.monthlySalesEst} 件/月` : ""})
                            </span>
                          ) : (
                            <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                              评分与评论数待采集
                            </span>
                          )}
                        </div>

                        {/* 买家另付单独运费行 */}
                        {item.priceCents > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", fontSize: "11.5px" }}>
                            {item.shippingCents && item.shippingCents > 0 ? (
                              <>
                                <span className="badge badge-warn" style={{ fontSize: "11px" }}>
                                  + 单独运费 {formatPrice(item.shippingCents, item.currency)} · 买家实付 {formatPrice(getBuyerTotalPriceCents(item), item.currency)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingShippingAsin(item.asin);
                                    setEditingShippingVal((item.shippingCents! / 100).toFixed(2));
                                  }}
                                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                >
                                  改运费
                                </button>
                                <button
                                  type="button"
                                  disabled={isSavingShipping}
                                  onClick={() => handleSaveItemShipping(item.asin, 0)}
                                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                >
                                  清零
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingShippingAsin(editingShippingAsin === item.asin ? null : item.asin);
                                  setEditingShippingVal("");
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "var(--muted)",
                                  cursor: "pointer",
                                  padding: 0,
                                  textDecoration: "underline",
                                  fontSize: "11px",
                                }}
                              >
                                {editingShippingAsin === item.asin ? "取消运费录入" : "+ 买家另付运费（如不包邮点此补录）"}
                              </button>
                            )}
                          </div>
                        ) : null}

                        {editingShippingAsin === item.asin ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                            <span style={{ fontSize: "11.5px", color: "var(--muted)", whiteSpace: "nowrap" }}>
                              运费 ({item.currency || currentReport.currency})
                            </span>
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              placeholder="如 9.99"
                              value={editingShippingVal}
                              onChange={(e) => setEditingShippingVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleSaveItemShipping(item.asin);
                                }
                              }}
                              style={{
                                width: "92px",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                border: "1px solid var(--line)",
                                background: "var(--paper)",
                                color: "var(--ink)",
                                fontSize: "12px",
                                fontWeight: 700,
                              }}
                            />
                            <button
                              type="button"
                              disabled={isSavingShipping}
                              onClick={() => handleSaveItemShipping(item.asin)}
                              className="button primary"
                              style={{ fontSize: "11px", padding: "3px 10px", height: "26px" }}
                            >
                              {isSavingShipping ? "保存中" : "重算利润"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingShippingAsin(null)}
                              className="button ghost"
                              style={{ fontSize: "11px", padding: "3px 6px", height: "26px" }}
                            >
                              取消
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {!isVerifiedCompetitorField(item, "priceCents") && (
                        <div style={{ fontSize: "12px", color: "var(--amber)", marginTop: "-8px", marginBottom: "12px" }}>
                          尚未采集到前台真实售价，请使用 Chrome 二合一扩展在 Amazon 页面一键采集
                        </div>
                      )}

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
                            background: "var(--surface-subtle)",
                            padding: "8px 10px",
                            borderRadius: "8px",
                            border: "1px solid var(--line)",
                            marginBottom: "12px",
                            fontSize: "12px",
                          }}
                        >
                          <div style={{ color: "var(--muted)", marginBottom: "4px", fontWeight: 600 }}>参数对标：</div>
                          {Object.entries(item.specifications).map(([k, v]) => (
                            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: "12px", color: "var(--ink)", padding: "2px 0" }}>
                              <span style={{ color: "var(--muted)", whiteSpace: "nowrap", flexShrink: 0 }}>{k}:</span>
                              <span style={{ fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 单品毛利率与单件利润估算（按券后价 + 买家另付运费总实付口径重算） */}
                      {item.priceCents > 0 ? (() => {
                        const itemCurr = item.currency || currentReport.currency;
                        const fxRate = (OFFICIAL_FX_CONFIG[itemCurr] || OFFICIAL_FX_CONFIG.USD).rateToRmb;
                        const totalBuyerCents = getBuyerTotalPriceCents(item);
                        const hasRealCost = Boolean(item.sourcingCost?.actualCny && item.sourcingCost.actualCny > 0);
                        // 有实录/实采进价用真实进价算；未录进价时按实付总价 25% 折算人民币做参考估算并明确标注
                        const basisRmb = hasRealCost
                          ? item.sourcingCost!.actualCny
                          : Number((((totalBuyerCents / 100) * 0.25) * fxRate).toFixed(1));
                        const est = calcItemProfitEstimate(totalBuyerCents, basisRmb, itemCurr, currentReport.platformCode, mode);
                        const isHealthy = est.marginPct >= 18;
                        const hasShipping = Boolean(item.shippingCents && item.shippingCents > 0);
                        return (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "8px",
                              marginBottom: "12px",
                              padding: "8px 10px",
                              borderRadius: "8px",
                              background: "var(--surface-subtle)",
                              border: "1px solid var(--line)",
                              fontSize: "12px",
                            }}
                          >
                            <div>
                              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {hasRealCost ? "实算毛利率" : "预估毛利率"}
                                <span style={{ marginLeft: "4px", fontSize: "10px" }}>
                                  ({hasRealCost ? `按 ¥${basisRmb}` : `按 25% ≈ ¥${basisRmb}`})
                                </span>
                              </div>
                              <div className="mono" style={{ fontSize: "15px", fontWeight: 800, color: isHealthy ? "var(--green)" : "var(--red)", marginTop: "2px" }}>
                                {est.marginPct}%
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                                {hasRealCost ? "单件净利润" : "预估单件利润"}
                                {hasShipping ? <span style={{ marginLeft: "4px", fontSize: "10px", color: "var(--amber)" }}>含运费口径</span> : null}
                              </div>
                              <div className="mono" style={{ fontSize: "15px", fontWeight: 800, color: est.netProfitCents > 0 ? "var(--ink)" : "var(--red)", marginTop: "2px" }}>
                                {est.netProfitCents >= 0 ? "+" : ""}{(est.netProfitCents / 100).toFixed(2)} {itemCurr}
                                <span style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted)", marginLeft: "4px" }}>
                                  (≈¥{est.netProfitRmb})
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })() : null}
                    </div>

                    {/* AI 单品简评 + 1688 搜同款入口 */}
                    <div
                      style={{
                        borderTop: "1px dashed var(--line)",
                        paddingTop: "8px",
                        fontSize: "12px",
                        color: "var(--muted)",
                        lineHeight: "1.4",
                      }}
                    >
                      <div>
                        <strong>诊断:</strong> {item.verdict}
                      </div>
                      {(() => {
                        const key = `item_${item.asin}`;
                        const cached = translatedKwMap[key];
                        const totalBuyerCents = getBuyerTotalPriceCents(item);
                        const maxPurchaseRmb = estimateMaxPurchaseRmb(
                          totalBuyerCents,
                          item.currency || currentReport.currency,
                          currentReport.platformCode,
                          mode,
                        );
                        const cost = item.sourcingCost;
                        const realMarginPct = cost?.actualCny
                          ? calcItemRealMarginPct(
                              totalBuyerCents,
                              cost.actualCny,
                              item.currency || currentReport.currency,
                              currentReport.platformCode,
                              mode,
                            )
                          : null;
                        const passedGate = realMarginPct !== null && realMarginPct >= 18;

                        return (
                          <>
                            {/* 单品预估进价上限 / 1688 实采回补进价条 */}
                            {item.priceCents > 0 ? (
                              <div
                                style={{
                                  marginTop: "10px",
                                  padding: "8px 10px",
                                  borderRadius: "8px",
                                  background: "var(--surface-subtle)",
                                  border: "1px solid var(--line)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                {cost?.actualCny ? (
                                  <>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                      <span style={{ color: "var(--ink)", fontWeight: 700 }}>
                                        1688 实采进价：<span className="mono" style={{ color: "var(--green)" }}>¥{cost.actualCny}</span>
                                      </span>
                                      <span className={`badge ${passedGate ? "badge-success" : "badge-danger"} mono`} style={{ fontSize: "11px" }}>
                                        净利 {realMarginPct}% {passedGate ? "✓ 过 18% 门禁" : "✕ 低于 18%"}
                                      </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", fontSize: "11px", color: "var(--muted)" }}>
                                      <span>
                                        {cost.bestSupplierName === "手工录入"
                                          ? "手工录入"
                                          : cost.bestOfferUrl
                                            ? (
                                              <>
                                                <a href={cost.bestOfferUrl} target="_blank" rel="noreferrer" style={{ color: "var(--green)", textDecoration: "underline" }}>
                                                  {cost.bestSupplierName || "1688 货源"}
                                                </a>
                                                {` · 采自 ${cost.sampleCount} 家${cost.minCny ? ` (最低 ¥${cost.minCny})` : ""}`}
                                              </>
                                            )
                                            : `采自 ${cost.sampleCount} 家${cost.minCny ? ` · 最低 ¥${cost.minCny}` : ""}`}
                                        {maxPurchaseRmb > 0 ? ` · 上限 ≤ ¥${maxPurchaseRmb}` : ""}
                                      </span>
                                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingCostAsin(item.asin);
                                            setEditingCostVal(String(cost.actualCny));
                                          }}
                                          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                        >
                                          改价
                                        </button>
                                        <button
                                          type="button"
                                          disabled={isSavingItemCost}
                                          onClick={() => handleClearManualItemCost(item.asin)}
                                          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: "11px" }}
                                        >
                                          清空
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setQuoteCostRmb(cost.actualCny);
                                            setTargetPriceVal(Number((totalBuyerCents / 100).toFixed(2)));
                                            setBenchmarkAsin(item.asin);
                                            document.getElementById("section-launch")?.scrollIntoView({ behavior: "smooth" });
                                            setStatusMsg({
                                              type: "success",
                                              text: `已将 ${item.asin} 的进价 ¥${cost.actualCny} 与售价带入立项核算面板！`,
                                            });
                                          }}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            color: "var(--green)",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            padding: 0,
                                            textDecoration: "underline",
                                            fontSize: "11px",
                                          }}
                                        >
                                          按此实价立项 →
                                        </button>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                    <span style={{ color: "var(--ink)" }}>
                                      预估进价上限：
                                      <strong className="mono" style={{ color: maxPurchaseRmb > 0 ? "var(--amber)" : "var(--red)" }}>
                                        {maxPurchaseRmb > 0 ? `≤ ¥${maxPurchaseRmb}` : "客单过低难达 18%"}
                                      </strong>
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingCostAsin(item.asin);
                                        setEditingCostVal(maxPurchaseRmb > 0 ? String(Math.round(maxPurchaseRmb * 0.7)) : "");
                                      }}
                                      style={{
                                        background: "none",
                                        border: "none",
                                        color: "var(--green)",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                        padding: 0,
                                        textDecoration: "underline",
                                        fontSize: "11px",
                                      }}
                                    >
                                      + 手动填进价
                                    </button>
                                  </div>
                                )}
                                {editingCostAsin === item.asin ? (
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>¥</span>
                                    <input
                                      type="number"
                                      step="0.5"
                                      min="0.1"
                                      placeholder="输入人民币进价"
                                      value={editingCostVal}
                                      onChange={(e) => setEditingCostVal(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          handleSaveManualItemCost(item.asin);
                                        }
                                      }}
                                      style={{
                                        flex: 1,
                                        minWidth: "70px",
                                        padding: "4px 8px",
                                        borderRadius: "6px",
                                        border: "1px solid var(--line)",
                                        background: "var(--paper)",
                                        color: "var(--ink)",
                                        fontSize: "12px",
                                        fontWeight: 700,
                                      }}
                                    />
                                    <button
                                      type="button"
                                      disabled={isSavingItemCost}
                                      onClick={() => handleSaveManualItemCost(item.asin)}
                                      className="button primary"
                                      style={{ fontSize: "11px", padding: "3px 10px", height: "26px" }}
                                    >
                                      {isSavingItemCost ? "保存中" : "保存"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingCostAsin(null)}
                                      className="button ghost"
                                      style={{ fontSize: "11px", padding: "3px 6px", height: "26px" }}
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}

                            <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                              <button
                                type="button"
                                disabled={translatingKey === key}
                                onClick={() => handleSearch1688Translated(item, maxPurchaseRmb, currentReport.sourcingAction?.recommendedKeywords1688)}
                                className="button secondary"
                                style={{ flex: 1, minWidth: "130px", fontSize: "12px", padding: "6px 10px", height: "32px", justifyContent: "center" }}
                                title={cached ? `在 1688 搜索「${cached.keyword}」（GBK 无乱码）` : "自动翻译为中文采购词并在 1688 搜索同款（GBK 编码不乱码）"}
                              >
                                {translatingKey === key
                                  ? "翻译中..."
                                  : cached
                                    ? `🔍 1688搜「${cached.keyword.slice(0, 8)}」`
                                    : "🔍 翻译搜 1688 同款"}
                              </button>
                              {item.imageUrl ? (
                                <button
                                  type="button"
                                  className="button ghost"
                                  style={{ fontSize: "12px", padding: "6px 10px", height: "32px", border: "1px solid var(--line)" }}
                                  title="复制主图链接并打开 1688，点击相机图标粘贴图片链接即可搜同款"
                                  onClick={() => handleDownloadImageAndOpen1688(item, maxPurchaseRmb)}
                                >
                                  📷 复制图链搜同款
                                </button>
                              ) : null}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

  );
}
