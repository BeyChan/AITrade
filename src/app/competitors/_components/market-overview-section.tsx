"use client";

import type { Dispatch, SetStateAction } from "react";
import { calculateProductIndex } from "@/lib/competitor-compare/competitiveness";
import type { CompetitorComparisonReport, CompetitorProfile } from "@/lib/competitor-compare/types";
import { CompetitorQuadrantChart } from "@/components/competitor-quadrant-chart";
import { shortDate } from "@/lib/format";

type Props = {
  currentReport: CompetitorComparisonReport;
  isEstimated: boolean;
  isSingleProduct: boolean;
  showIndexHelp: boolean;
  setShowIndexHelp: Dispatch<SetStateAction<boolean>>;
  benchmarkAsin: string | null;
  targetPriceVal: number;
  targetPriceCents: number;
  estMarginRate: number;
  formatPrice: (cents: number, cur: string) => string;
  handleSelectBenchmark: (comp: CompetitorProfile | null) => void;
};

export function MarketOverviewSection({
  currentReport,
  isEstimated,
  isSingleProduct,
  showIndexHelp,
  setShowIndexHelp,
  benchmarkAsin,
  targetPriceVal,
  targetPriceCents,
  estMarginRate,
  formatPrice,
  handleSelectBenchmark,
}: Props) {
  return (
    <>
          {/* -0.5 快照版本异动预警（同站点/同赛道再次采集时自动触发） */}
          {currentReport.snapshotDiff && (currentReport.snapshotDiff.alerts.length > 0 || currentReport.snapshotDiff.avgPriceDeltaPercent !== null) ? (
            <section
              className="panel"
              style={{
                padding: "16px 20px",
                borderLeft: "4px solid var(--amber)",
                background: "var(--amber-soft)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginBottom: "6px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
                  ⚡ 快照对比异动预警（对比上次采集 {shortDate(currentReport.snapshotDiff.previousCapturedAt)}）
                </div>
                {currentReport.snapshotDiff.avgPriceDeltaPercent !== null ? (
                  <span className="badge badge-warn mono" style={{ fontSize: "12px" }}>
                    均价变动 {currentReport.snapshotDiff.avgPriceDeltaPercent > 0 ? "+" : ""}{currentReport.snapshotDiff.avgPriceDeltaPercent}%
                  </span>
                ) : null}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", fontSize: "12px", color: "var(--ink)" }}>
                {currentReport.snapshotDiff.alerts.map((alert, idx) => (
                  <span key={idx} className="badge badge-neutral" style={{ background: "var(--panel)" }}>
                    {alert}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* 0. 科学量化：商品指数 (Product Index, 0~100 分) */}
          {(() => {
            const liveMarginPct = Number((estMarginRate * 100).toFixed(1));
            const index = calculateProductIndex(currentReport, {
              overrideMarginPercent: targetPriceCents > 0 ? liveMarginPct : null,
            });
            const signals = currentReport.marketSignals;
            const isS = index.grade === "S";
            const isA = index.grade === "A";
            const isB = index.grade === "B";

            const themeColor = isS
              ? "var(--green)"
              : isA
              ? "var(--green)"
              : isB
              ? "var(--amber)"
              : "var(--red)";
            const themeBg = isS
              ? "var(--green-soft)"
              : isA
              ? "var(--green-soft)"
              : isB
              ? "var(--amber-soft)"
              : "var(--red-soft)";

            return (
              <section id="section-overview" className="panel" style={{ padding: "24px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                  <div>
                    <div className="eyebrow" style={{ color: themeColor }}>
                      QUANTITATIVE RETAIL MODEL · 观测值驱动量化判定
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "4px", flexWrap: "wrap" }}>
                      <h4 style={{ margin: 0, fontSize: "18px", color: "var(--ink)", fontWeight: 800 }}>
                        商品指数 (Product Index)
                      </h4>
                      <span
                        className={`badge ${index.evidenceCompleteness >= 70 ? "badge-success" : index.evidenceCompleteness >= 45 ? "badge-warn" : "badge-danger"}`}
                        style={{ fontSize: "12px" }}
                      >
                        证据完整度 {index.evidenceCompleteness}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowIndexHelp((prev) => !prev)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--muted)",
                          fontSize: "12px",
                          cursor: "pointer",
                          textDecoration: "underline",
                          padding: "2px 4px",
                        }}
                      >
                        {showIndexHelp ? "收起说明 ▲" : "ℹ️ 与机会分(Opportunity Score)的区别说明 ▼"}
                      </button>
                    </div>
                  </div>
                  <span
                    className={`badge ${isS ? "badge-success" : isA ? "badge-success" : isB ? "badge-warn" : "badge-danger"}`}
                    style={{ fontSize: "12px", padding: "4px 10px", borderRadius: "8px" }}
                  >
                    参考评级（非选品门禁）: {index.decision}
                  </span>
                </div>

                {/* 市场微观信号条（仅多品模式展示，单品分析自动隐藏） */}
                {signals && !isSingleProduct ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
                      gap: "10px",
                      marginBottom: "16px",
                    }}
                  >
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Top 3 品牌占比 (CR3)</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.brandCr3Percent > 60 ? "var(--red)" : "var(--ink)", marginTop: "2px" }}>
                        {signals.brandCr3Percent}%
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>首页广告位密度</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.sponsoredRatioPercent >= 45 ? "var(--amber)" : "var(--ink)", marginTop: "2px" }}>
                        {signals.sponsoredRatioPercent}% ({signals.sponsoredCount}款)
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Coupon 隐藏折扣</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                        {signals.couponCount > 0 ? `${signals.couponCount}款 (均省 ${signals.avgDiscountPercent}%)` : "0 款"}
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>官方月销实证</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: signals.verifiedSalesCount > 0 ? "var(--green)" : "var(--muted)", marginTop: "2px" }}>
                        {signals.verifiedSalesCount} / {currentReport.competitors.length} 款
                      </div>
                    </div>
                    <div style={{ padding: "10px 12px", borderRadius: "10px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                      <div style={{ fontSize: "11px", color: "var(--muted)" }}>Amazon 自营 / 黑马新品</div>
                      <div className="mono" style={{ fontSize: "16px", fontWeight: 800, color: "var(--ink)", marginTop: "2px" }}>
                        1P: {signals.amazon1pCount} · 黑马: {signals.darkHorseAsins.length}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* 指标关系说明抽屉 */}
                {showIndexHelp && (
                  <div
                    style={{
                      background: "var(--surface-subtle)",
                      border: "1px solid var(--line)",
                      borderRadius: "10px",
                      padding: "12px 16px",
                      marginBottom: "16px",
                      fontSize: "12px",
                      lineHeight: "1.6",
                      color: "var(--ink)",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: "4px", color: "var(--green)" }}>
                      📌 双指标分工与业务漏斗流转说明：
                    </div>
                    <div>
                      <strong>1. 商品指数 (本页面，0~100 分)：</strong>
                      面向外部赛道与竞品攻防，衡量 <em>赛道垄断度(HHI)、评论阻力、价格战内卷度与真实差评改良胜算</em>。回答“这品类对手弱不弱、有没有切入机会”。
                    </div>
                    <div>
                      <strong>2. 机会分 (选品工作台，0~100 分)：</strong>
                      面向内部财务可行性，需在拿到 <em>1688 源头采购报价、FBA 头程与关税</em> 后，对到岸成本、净利率和压力测试利润进行确定性核验。回答“拿到这批货能否真赚钱”。
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: "4px" }}>
                      💡 <strong>边界：</strong>商品指数只描述赛道竞争格局，<strong>不参与 GO / HOLD / NO-GO 门禁</strong>；GO 由选品验证链路的真实报价、真实竞品证据与确定性成本规则共同决定。若本报告数值来自 AI 或模板，评级仅作示意。
                    </div>
                    <div style={{ color: "var(--muted)", marginTop: "4px" }}>
                      <strong>建议工作流：</strong>先用浏览器扩展采集真实售价与差评，人工核对后再点击【沉淀为选品假设】，前往 1688 询价并核算财务「机会分」。
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "280px 1fr",
                    gap: "24px",
                    alignItems: "center",
                    background: "var(--surface-subtle)",
                    padding: "20px",
                    borderRadius: "14px",
                    border: "1px solid var(--line)",
                  }}
                >
                  {/* 左侧：大分值与总评 */}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      textAlign: "center",
                      borderRight: "1px solid var(--line)",
                      paddingRight: "20px",
                    }}
                  >
                    <div
                      style={{
                        width: "96px",
                        height: "96px",
                        borderRadius: "50%",
                        background: themeBg,
                        border: `3px solid ${themeColor}`,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
                        marginBottom: "12px",
                      }}
                    >
                      <span style={{ fontSize: "32px", fontWeight: 900, color: themeColor, lineHeight: 1 }}>
                        {index.totalScore}
                      </span>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: themeColor, marginTop: "2px" }}>
                        {index.grade} 级 · 得分
                      </span>
                    </div>

                    <div style={{ fontSize: "14px", fontWeight: 800, color: "var(--ink)", marginBottom: "6px" }}>
                      {index.headline}
                    </div>
                    <p style={{ margin: 0, fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
                      {index.summaryText}
                    </p>
                  </div>

                  {/* 右侧：量化支柱得分明细（单品模式自动隐藏无意义的品牌 HHI 垄断支柱） */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {Object.values(index.pillars)
                      .filter((p) => !(isSingleProduct && p.key === "hhi"))
                      .map((p) => {
                      const available = p.isAvailable !== false;
                      const percent = available ? Math.round((p.score / p.max) * 100) : 0;
                      return (
                        <div key={p.key} style={{ display: "flex", flexDirection: "column", gap: "4px", opacity: available ? 1 : 0.65 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                              <strong style={{ color: "var(--ink)" }}>{p.label}</strong>
                              <span
                                style={{
                                  fontSize: "12px",
                                  padding: "1px 6px",
                                  borderRadius: "4px",
                                  background: "var(--panel)",
                                  border: "1px solid var(--line)",
                                  color: "var(--muted)",
                                  fontFamily: "ui-monospace, monospace",
                                }}
                              >
                                {p.metricValue}
                              </span>
                            </div>
                            <div>
                              {available ? (
                                <>
                                  <strong style={{ color: themeColor }}>{p.score}</strong>
                                  <span style={{ color: "var(--muted)" }}> / {p.max} 分</span>
                                </>
                              ) : (
                                <span style={{ color: "var(--muted)", fontSize: "12px" }}>未采集 · 不计分</span>
                              )}
                            </div>
                          </div>

                          {/* 进度条 */}
                          <div
                            style={{
                              width: "100%",
                              height: "6px",
                              background: "var(--line)",
                              borderRadius: "3px",
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                background: available ? themeColor : "var(--muted)",
                                borderRadius: "3px",
                                transition: "width 0.4s ease",
                              }}
                            />
                          </div>

                          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.35" }}>
                            {p.explanation}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })()}

          {/* 1. 价格分位数带与大盘基准（单品模式自动隐藏，1 款商品不需要分位带） */}
          {!isSingleProduct ? (
          <section className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div>
                <span className="eyebrow" style={{ color: "var(--green)" }}>价格格局</span>
                <h4 style={{ margin: "2px 0 0 0", fontSize: "15px", color: "var(--ink)" }}>价格分位数带与统计基准</h4>
              </div>
              <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                真实采集样本: <strong>{currentReport.priceStats.verifiedSampleCount}</strong> 款
                / 共 {currentReport.competitors.length} 款对标商品
              </span>
            </div>

            {isEstimated ? (
              <div
                className="notice warn"
                style={{ marginBottom: 0, fontSize: "13px", lineHeight: "1.6", display: "block" }}
                role="status"
              >
                <span>
                  <strong>暂无真实售价样本，已隐藏价格分位：</strong>
                  直接粘贴纯 URL 时系统不会后台抓取亚马逊，也不编造假 P50 中位价。请在 Amazon 搜索页（Top 20）或详情页点击 <strong>Chrome 二合一扩展</strong> 一键采集真实价格与差评。
                </span>
              </div>
            ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: "12px",
              }}
            >
              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>最低售价 (Min)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.min, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P25 分位价</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p25, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--green-soft)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid rgba(31, 122, 85, 0.3)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 700, marginBottom: "4px" }}>
                  黄金中位价 (P50)
                </div>
                <div style={{ fontSize: "19px", fontWeight: 800, color: "var(--green)" }}>
                  {formatPrice(currentReport.priceStats.p50, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P75 分位价</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p75, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>P90 溢价门槛</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.p90, currentReport.currency)}
                </div>
              </div>

              <div
                style={{
                  background: "var(--surface-subtle)",
                  padding: "12px 14px",
                  borderRadius: "12px",
                  border: "1px solid var(--line)",
                }}
              >
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>最高售价 (Max)</div>
                <div style={{ fontSize: "17px", fontWeight: 700, color: "var(--ink)" }}>
                  {formatPrice(currentReport.priceStats.max, currentReport.currency)}
                </div>
              </div>
            </div>
            )}
          </section>
          ) : null}

          {/* 1.5 市场格局四象限气泡图（单品模式自动隐藏） */}
          {!isSingleProduct ? (
            <CompetitorQuadrantChart
              competitors={currentReport.competitors}
              currency={currentReport.currency}
              p50PriceCents={currentReport.priceStats.p50}
              targetPriceCents={Math.round(targetPriceVal * 100)}
              darkHorseAsins={currentReport.marketSignals?.darkHorseAsins ?? []}
              benchmarkAsin={benchmarkAsin ?? currentReport.targetBenchmarkAsin ?? null}
              onSelectBenchmark={handleSelectBenchmark}
            />
          ) : null}

          {/* 1.7 差评可改良性分级矩阵（Actionable Pain Matrix） */}
          {currentReport.painPointMatrix && currentReport.painPointMatrix.length > 0 ? (
            <section className="panel" style={{ padding: "20px 24px" }}>
              <div style={{ marginBottom: "14px" }}>
                <div className="eyebrow" style={{ color: "var(--amber)" }}>差评攻防分级</div>
                <h4 style={{ margin: "2px 0 4px 0", fontSize: "16px", color: "var(--ink)" }}>
                  差评可改良性矩阵（区分改模 / 快赢包装 / 预期管理 / 物理限制）
                </h4>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
                {currentReport.painPointMatrix.map((item, idx) => {
                  const catMap = {
                    structural_design: { label: "结构/材质可改", badge: "badge-success" },
                    packaging_accessories: { label: "配件包装快赢", badge: "badge-success" },
                    expectation_mgmt: { label: "预期管理降退货", badge: "badge-warn" },
                    physical_limit: { label: "物理限制 · 避坑", badge: "badge-danger" },
                  } as const;
                  const meta = catMap[item.category] || catMap.structural_design;
                  const costLabel = item.costToFix === "low" ? "低成本快赢" : item.costToFix === "medium" ? "中等改良成本" : item.costToFix === "high" ? "高成本改模" : "不可解决";
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: "14px",
                        borderRadius: "12px",
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                        <span className={`badge ${meta.badge}`} style={{ fontSize: "11px" }}>{meta.label}</span>
                        <span className="badge badge-neutral" style={{ fontSize: "11px" }}>{costLabel}</span>
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)", lineHeight: 1.4 }}>{item.pain}</div>
                      <div style={{ fontSize: "12px", color: "var(--green)", lineHeight: 1.45 }}>
                        → {item.solution}
                      </div>
                      {item.sourceQuote ? (
                        <div style={{ fontSize: "11px", color: "var(--muted)", borderLeft: "2px solid var(--line)", paddingLeft: "8px", marginTop: "2px", lineHeight: 1.4 }}>
                          原评依据：{item.sourceQuote}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

    </>
  );
}
