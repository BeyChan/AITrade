"use client";

import { useMemo, useState } from "react";
import {
  calculateEconomics,
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
  type EconomicsAssumptions,
} from "@/lib/economics";
import { moneyIn, percent } from "@/lib/format";

type Props = {
  assumptions: EconomicsAssumptions;
  monthlySalesEstimate: number;
  reviewCount: number;
  evidenceScore: number;
  currency?: string;
};

const ACOS_COLUMNS = [0.06, 0.1, 0.15, 0.2, 0.25];
const PRICE_MULTIPLIERS = [0.85, 0.925, 1, 1.075, 1.15];
const MIN_MARGIN_GATE = 0.18;

export function EconomicsSandbox({
  assumptions,
  monthlySalesEstimate,
  reviewCount,
  evidenceScore,
  currency = assumptions.currency ?? "USD",
}: Props) {
  const [salePriceCents, setSalePriceCents] = useState(assumptions.salePriceCents);
  const [landedCostCents, setLandedCostCents] = useState(assumptions.landedCostCents);
  const [adRate, setAdRate] = useState(assumptions.adRate);
  const [returnRate, setReturnRate] = useState(assumptions.returnRate);
  const [appliedNotice, setAppliedNotice] = useState(false);

  const isDirty =
    salePriceCents !== assumptions.salePriceCents ||
    landedCostCents !== assumptions.landedCostCents ||
    Math.abs(adRate - assumptions.adRate) > 1e-4 ||
    Math.abs(returnRate - assumptions.returnRate) > 1e-4;

  const simAssumptions: EconomicsAssumptions = useMemo(
    () => ({
      ...assumptions,
      currency,
      salePriceCents,
      landedCostCents,
      adRate,
      returnRate,
    }),
    [assumptions, currency, salePriceCents, landedCostCents, adRate, returnRate],
  );

  const simResult = useMemo(() => calculateEconomics(simAssumptions), [simAssumptions]);
  const simScore = useMemo(
    () => opportunityScore(simResult, monthlySalesEstimate, reviewCount, evidenceScore),
    [simResult, monthlySalesEstimate, reviewCount, evidenceScore],
  );
  const simRecommendation = useMemo(
    () => recommendationFor(simResult, simScore),
    [simResult, simScore],
  );

  const targetLanded = useMemo(
    () =>
      calculateTargetLandedCost({
        currency,
        salePriceCents,
        fbaFeeCents: assumptions.fbaFeeCents,
        referralRate: assumptions.referralRate,
        adRate,
        returnRate,
        returnProcessingCents: assumptions.returnProcessingCents,
        returnRecoveryRate: assumptions.returnRecoveryRate,
        couponCents: assumptions.couponCents,
        storageCents: assumptions.storageCents,
        otherCostCents: assumptions.otherCostCents,
        targetMarginRate: MIN_MARGIN_GATE,
      }),
    [assumptions, currency, salePriceCents, adRate, returnRate],
  );

  const landedGapCents = landedCostCents - targetLanded.maxLandedCostCents;
  const priceMin = Math.max(100, Math.round(assumptions.salePriceCents * 0.6));
  const priceMax = Math.max(priceMin + 500, Math.round(assumptions.salePriceCents * 1.45));
  const landedMax = Math.max(
    500,
    Math.round(Math.max(assumptions.landedCostCents * 2, salePriceCents * 0.65)),
  );

  const waterfallRows = useMemo(() => {
    const base = Math.max(1, salePriceCents);
    const refundRevenueGap = Math.max(0, salePriceCents - simResult.couponCents - simResult.netRevenueCents);
    const storageAndOther = simResult.storageCents + simResult.otherCostCents;
    return [
      { label: "标定售价", amount: salePriceCents, share: 1, tone: "revenue" as const },
      ...(simResult.couponCents > 0
        ? [{ label: "Coupon 折扣", amount: -simResult.couponCents, share: simResult.couponCents / base, tone: "cost" as const }]
        : []),
      ...(refundRevenueGap > 0
        ? [{ label: "退货收入冲减", amount: -refundRevenueGap, share: refundRevenueGap / base, tone: "cost" as const }]
        : []),
      { label: "采购与落地成本", amount: -simResult.landedCostCents, share: simResult.landedCostCents / base, tone: "cost-primary" as const },
      { label: "FBA / 履约费", amount: -simResult.fbaFeeCents, share: simResult.fbaFeeCents / base, tone: "cost" as const },
      { label: "平台佣金", amount: -simResult.referralFeeCents, share: simResult.referralFeeCents / base, tone: "cost" as const },
      { label: "广告成本", amount: -simResult.adCostCents, share: simResult.adCostCents / base, tone: "cost-ad" as const },
      { label: "退货处理与残损", amount: -simResult.returnLossCents, share: simResult.returnLossCents / base, tone: "cost" as const },
      { label: "仓储与其他", amount: -storageAndOther, share: storageAndOther / base, tone: "cost" as const },
      {
        label: "模拟单件净利",
        amount: simResult.netProfitCents,
        share: Math.abs(simResult.netProfitCents) / base,
        tone: simResult.netProfitCents <= 0 ? ("loss" as const) : simResult.marginRate >= MIN_MARGIN_GATE ? ("profit-go" as const) : ("profit-hold" as const),
      },
    ];
  }, [salePriceCents, simResult]);

  const heatmapMatrix = useMemo(() => {
    return PRICE_MULTIPLIERS.map((mult) => {
      const rowPriceCents = Math.max(100, Math.round(assumptions.salePriceCents * mult));
      const cells = ACOS_COLUMNS.map((colAcos) => {
        const res = calculateEconomics({
          ...simAssumptions,
          salePriceCents: rowPriceCents,
          adRate: colAcos,
        });
        const tone =
          !res.isProfitable || res.stressProfitCents <= 0
            ? "no-go"
            : res.marginRate >= MIN_MARGIN_GATE
              ? "go"
              : "hold";
        return { priceCents: rowPriceCents, acos: colAcos, res, tone };
      });
      return { mult, rowPriceCents, cells };
    });
  }, [assumptions.salePriceCents, simAssumptions]);

  function handleReset() {
    setSalePriceCents(assumptions.salePriceCents);
    setLandedCostCents(assumptions.landedCostCents);
    setAdRate(assumptions.adRate);
    setReturnRate(assumptions.returnRate);
    setAppliedNotice(false);
  }

  function handleFillForm() {
    const fill = (id: string, value: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = value;
    };
    fill("salePrice", (salePriceCents / 100).toFixed(2));
    fill("landedCost", (landedCostCents / 100).toFixed(2));
    fill("adRate", (adRate * 100).toFixed(1));
    fill("returnRate", (returnRate * 100).toFixed(1));
    setAppliedNotice(true);
    document.getElementById("salePrice")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const verdictClass =
    simRecommendation === "GO"
      ? "is-go"
      : simRecommendation === "HOLD"
        ? "is-hold"
        : "is-no-go";

  return (
    <section className="section sandbox-section">
      <div className="section-header">
        <div>
          <h2>交互式财务沙盘（What-If 灵敏度推演）</h2>
          <p>拖动滑杆实时测算 18% 硬门禁、成本瀑布与「售价 × 广告 ACoS」盈利边界；试算不写库，确认后可一键回填下方成本表单。</p>
        </div>
        <div className="sandbox-header-actions">
          <span className={`verdict-pill ${verdictClass}`}>
            {simRecommendation} · {simScore} 分
          </span>
          {isDirty ? (
            <>
              <button type="button" className="button ghost" onClick={handleReset}>
                重置参数
              </button>
              <button type="button" className="button primary" onClick={handleFillForm}>
                回填至下方表单
              </button>
            </>
          ) : null}
        </div>
      </div>

      {appliedNotice ? (
        <div className="notice" style={{ marginBottom: 16 }}>
          <span className="badge badge-success">READY</span>
          <span>已将当前沙盘参数填入下方「成本假设」表单，核对后点击「保存新成本版本并重新计算」即可留痕落库。</span>
        </div>
      ) : null}

      {/* 顶部实时核心 KPI 条 */}
      <div className="sandbox-kpi-strip">
        <div className="sandbox-kpi-cell">
          <span className="sandbox-kpi-label">模拟单件净利</span>
          <strong className={`sandbox-kpi-value mono ${simResult.netProfitCents > 0 ? "" : "is-danger"}`}>
            {moneyIn(currency, simResult.netProfitCents)}
          </strong>
        </div>
        <div className="sandbox-kpi-cell">
          <span className="sandbox-kpi-label">净利率（门禁 18%）</span>
          <strong
            className={`sandbox-kpi-value mono ${
              simResult.marginRate >= MIN_MARGIN_GATE ? "is-go" : "is-danger"
            }`}
          >
            {percent(simResult.marginRate)}
            {simResult.marginRate < MIN_MARGIN_GATE ? " ↓" : ""}
          </strong>
        </div>
        <div className="sandbox-kpi-cell">
          <span className="sandbox-kpi-label">压力情景净利</span>
          <strong className={`sandbox-kpi-value mono ${simResult.stressProfitCents > 0 ? "" : "is-danger"}`}>
            {moneyIn(currency, simResult.stressProfitCents)}
          </strong>
        </div>
        <div className="sandbox-kpi-cell">
          <span className="sandbox-kpi-label">广告盈亏平衡点</span>
          <strong className="sandbox-kpi-value mono">{percent(simResult.breakEvenAdRate)}</strong>
        </div>
        <div className="sandbox-kpi-cell">
          <span className="sandbox-kpi-label">18% 门禁最高到岸价</span>
          <strong className={`sandbox-kpi-value mono ${landedGapCents > 0 ? "is-danger" : "is-go"}`}>
            {targetLanded.achievable ? moneyIn(currency, targetLanded.maxLandedCostCents) : "不可达"}
          </strong>
          {targetLanded.achievable ? (
            <span className="sandbox-kpi-sub mono">
              {landedGapCents > 0
                ? `超标 ${moneyIn(currency, landedGapCents)}`
                : `余量 ${moneyIn(currency, Math.abs(landedGapCents))}`}
            </span>
          ) : null}
        </div>
      </div>

      {/* 4 根灵敏度滑杆 */}
      <div className="sandbox-sliders-grid">
        <label className="sandbox-slider-card">
          <div className="sandbox-slider-top">
            <span>拟定售价</span>
            <strong className="mono">{moneyIn(currency, salePriceCents)}</strong>
          </div>
          <input
            type="range"
            min={priceMin}
            max={priceMax}
            step={50}
            value={salePriceCents}
            onChange={(e) => {
              setSalePriceCents(Number(e.target.value));
              setAppliedNotice(false);
            }}
          />
          <div className="sandbox-slider-bounds mono">
            <span>{moneyIn(currency, priceMin)}</span>
            <span>基准 {moneyIn(currency, assumptions.salePriceCents)}</span>
            <span>{moneyIn(currency, priceMax)}</span>
          </div>
        </label>

        <label className="sandbox-slider-card">
          <div className="sandbox-slider-top">
            <span>采购与落地成本</span>
            <strong className="mono">{moneyIn(currency, landedCostCents)}</strong>
          </div>
          <input
            type="range"
            min={0}
            max={landedMax}
            step={20}
            value={landedCostCents}
            onChange={(e) => {
              setLandedCostCents(Number(e.target.value));
              setAppliedNotice(false);
            }}
          />
          <div className="sandbox-slider-bounds mono">
            <span>{moneyIn(currency, 0)}</span>
            <span>基准 {moneyIn(currency, assumptions.landedCostCents)}</span>
            <span>{moneyIn(currency, landedMax)}</span>
          </div>
        </label>

        <label className="sandbox-slider-card">
          <div className="sandbox-slider-top">
            <span>广告占比（ACoS）</span>
            <strong className="mono">{percent(adRate)}</strong>
          </div>
          <input
            type="range"
            min={0}
            max={0.45}
            step={0.005}
            value={adRate}
            onChange={(e) => {
              setAdRate(Number(e.target.value));
              setAppliedNotice(false);
            }}
          />
          <div className="sandbox-slider-bounds mono">
            <span>0.0%</span>
            <span>平衡点 {percent(Math.max(0, simResult.breakEvenAdRate))}</span>
            <span>45.0%</span>
          </div>
        </label>

        <label className="sandbox-slider-card">
          <div className="sandbox-slider-top">
            <span>预估退货率</span>
            <strong className="mono">{percent(returnRate)}</strong>
          </div>
          <input
            type="range"
            min={0}
            max={0.25}
            step={0.005}
            value={returnRate}
            onChange={(e) => {
              setReturnRate(Number(e.target.value));
              setAppliedNotice(false);
            }}
          />
          <div className="sandbox-slider-bounds mono">
            <span>0.0%</span>
            <span>基准 {percent(assumptions.returnRate)}</span>
            <span>25.0%</span>
          </div>
        </label>
      </div>

      {/* 下半部：左侧瀑布图 + 右侧 5×5 盈利热力矩阵 */}
      <div className="sandbox-visual-grid">
        <div className="sandbox-panel">
          <h3>单件成本结构瀑布图</h3>
          <div className="waterfall-list">
            {waterfallRows.map((row) => {
              const barWidth = Math.min(100, Math.max(2, Math.round(row.share * 100)));
              return (
                <div key={row.label} className="waterfall-row">
                  <span className="waterfall-label">{row.label}</span>
                  <div className="waterfall-track">
                    <div
                      className={`waterfall-bar tone-${row.tone}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <span className={`waterfall-amount mono ${row.tone === "loss" ? "is-danger" : row.tone === "profit-go" ? "is-go" : ""}`}>
                    {row.amount >= 0 ? moneyIn(currency, row.amount) : `−${moneyIn(currency, Math.abs(row.amount))}`}
                  </span>
                  <span className="waterfall-pct mono">{(row.share * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="sandbox-panel">
          <div className="sandbox-panel-head">
            <h3>售价 × 广告 ACoS 盈利热力矩阵</h3>
            <span className="muted">点击任意格即时切入该情景</span>
          </div>
          <div className="heatmap-scroll">
            <table className="heatmap-table">
              <thead>
                <tr>
                  <th>售价 \ ACoS</th>
                  {ACOS_COLUMNS.map((col) => (
                    <th key={col} className="mono">{(col * 100).toFixed(0)}%</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapMatrix.map((row) => (
                  <tr key={row.mult}>
                    <th className="mono">
                      {moneyIn(currency, row.rowPriceCents)}
                      {row.mult === 1 ? " ·" : ""}
                    </th>
                    {row.cells.map((cell) => {
                      const isSelected =
                        Math.abs(cell.priceCents - salePriceCents) <= 25 &&
                        Math.abs(cell.acos - adRate) < 0.008;
                      return (
                        <td key={cell.acos}>
                          <button
                            type="button"
                            className={`heatmap-cell tone-${cell.tone}${isSelected ? " is-active" : ""}`}
                            onClick={() => {
                              setSalePriceCents(cell.priceCents);
                              setAdRate(cell.acos);
                              setAppliedNotice(false);
                            }}
                            title={`售价 ${moneyIn(currency, cell.priceCents)} · ACoS ${(cell.acos * 100).toFixed(0)}% → 单件净利 ${moneyIn(currency, cell.res.netProfitCents)} (${percent(cell.res.marginRate)})`}
                          >
                            <span className="mono">{percent(cell.res.marginRate, 1)}</span>
                            <small className="mono">{moneyIn(currency, cell.res.netProfitCents)}</small>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="heatmap-legend">
            <span><i className="legend-dot tone-go" /> ≥18% 且压测盈利</span>
            <span><i className="legend-dot tone-hold" /> 盈利但未达 18%</span>
            <span><i className="legend-dot tone-no-go" /> 亏损或压测为负</span>
          </div>
        </div>
      </div>
    </section>
  );
}
