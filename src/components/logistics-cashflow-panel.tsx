"use client";

import { useMemo, useState } from "react";
import {
  calculateFbaSizeTier,
  calculateLaunchCashflow,
  calculateVatBreakdown,
  calculateVolumetricFreight,
  type ShippingMethod,
} from "@/lib/logistics-cashflow";
import { moneyIn, percent } from "@/lib/format";
import type { AppMode } from "@/lib/app-mode";

type Props = {
  marketCode: string;
  mode: AppMode;
  currency: string;
  salePriceCents: number;
  landedCostCents: number;
  steadyNetProfitCents: number;
  monthlySalesEstimate: number;
};

export function LogisticsCashflowPanel({
  marketCode,
  mode,
  currency,
  salePriceCents,
  landedCostCents,
  steadyNetProfitCents,
  monthlySalesEstimate,
}: Props) {
  // 包装尺寸与重量（默认一组常见小家电/宠物用品彩盒尺寸，支持随时修改）
  const [lengthCm, setLengthCm] = useState(22);
  const [widthCm, setWidthCm] = useState(18);
  const [heightCm, setHeightCm] = useState(12);
  const [weightG, setWeightG] = useState(680);
  const [shippingMethod, setShippingMethod] = useState<ShippingMethod>("sea_fast");

  // 首单现金流参数
  const [moq, setMoq] = useState(500);
  const [sampleAndMoldUsd, setSampleAndMoldUsd] = useState(300);
  const [certUsd, setCertUsd] = useState(600);
  const [launchAdUsd, setLaunchAdUsd] = useState(1200);
  const [fbaFilledNotice, setFbaFilledNotice] = useState(false);

  const fba = useMemo(
    () => calculateFbaSizeTier(lengthCm, widthCm, heightCm, weightG),
    [lengthCm, widthCm, heightCm, weightG],
  );

  const freight = useMemo(
    () => calculateVolumetricFreight(lengthCm, widthCm, heightCm, weightG, shippingMethod, currency, mode),
    [lengthCm, widthCm, heightCm, weightG, shippingMethod, currency, mode],
  );

  const vat = useMemo(
    () => calculateVatBreakdown(salePriceCents, marketCode),
    [salePriceCents, marketCode],
  );

  const cashflow = useMemo(
    () =>
      calculateLaunchCashflow({
        currency,
        moq,
        unitLandedCostCents: landedCostCents,
        sampleAndMoldCents: Math.round(sampleAndMoldUsd * 100),
        certificationCents: Math.round(certUsd * 100),
        launchAdExtraCents: Math.round(launchAdUsd * 100),
        monthlySalesEstimate: Math.max(100, monthlySalesEstimate || 400),
        steadyNetProfitCents,
      }, mode),
    [currency, moq, landedCostCents, sampleAndMoldUsd, certUsd, launchAdUsd, monthlySalesEstimate, steadyNetProfitCents, mode],
  );

  const maxAbsCurve = useMemo(
    () => Math.max(1, ...cashflow.monthlyCurve.map((p) => Math.abs(p.cumulativeCashCents))),
    [cashflow.monthlyCurve],
  );

  function applyFbaToForm() {
    const el = document.getElementById("fbaFee") as HTMLInputElement | null;
    if (el) {
      el.value = (fba.estimatedFbaFeeCents / 100).toFixed(2);
      setFbaFilledNotice(true);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2>包装尺寸 · FBA 降档 / 抛货头程 / VAT / 90 天现金流回本</h2>
          <p>按真实彩盒尺寸与毛重校验 FBA 尺寸阶梯、抛货体积重头程、目标站税制，以及首单备货资金峰值与回本周期。</p>
        </div>
        <button type="button" className="button secondary" onClick={applyFbaToForm}>
          将估算 FBA 费填入表单
        </button>
      </div>

      {fbaFilledNotice ? (
        <div className="notice" style={{ marginBottom: 14 }}>
          <span className="badge badge-success">READY</span>
          <span>已将估算 FBA 配送费 {moneyIn("USD", fba.estimatedFbaFeeCents)} 回填至上方「成本假设」表单，核对后保存即可。</span>
        </div>
      ) : null}

      {/* 上半部：尺寸重量输入 + FBA/头程/VAT 诊断 */}
      <div className="logistics-grid">
        <div className="sandbox-panel">
          <h3>单品包装尺寸与头程测算</h3>
          <div className="logistics-inputs">
            <label className="field">
              <span>长 (cm)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={lengthCm}
                onChange={(e) => setLengthCm(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="field">
              <span>宽 (cm)</span>
              <input
                type="number"
                min={1}
                step={0.5}
                value={widthCm}
                onChange={(e) => setWidthCm(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            <label className="field">
              <span>高 (cm)</span>
              <input
                type="number"
                min={0.5}
                step={0.5}
                value={heightCm}
                onChange={(e) => setHeightCm(Math.max(0.5, Number(e.target.value) || 0.5))}
              />
            </label>
            <label className="field">
              <span>毛重 (g)</span>
              <input
                type="number"
                min={10}
                step={10}
                value={weightG}
                onChange={(e) => setWeightG(Math.max(10, Number(e.target.value) || 10))}
              />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>头程渠道</span>
              <select
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value as ShippingMethod)}
              >
                <option value="sea_slow">海运普船 DDP（¥11/kg · 35–45天）</option>
                <option value="sea_fast">美森快船 DDP（¥18/kg · 18–24天）</option>
                <option value="air_ddp">空派专线 DDP（¥46/kg · 8–12天）</option>
              </select>
            </label>
          </div>

          <div className="logistics-metrics">
            <div>
              <span>FBA 尺寸分段</span>
              <strong>{fba.tierLabel}</strong>
              <small className="mono">{fba.lengthIn} × {fba.widthIn} × {fba.heightIn} in · 计费 {fba.billableWeightLb} lb</small>
            </div>
            <div>
              <span>估算 FBA 配送费</span>
              <strong className="mono">{moneyIn("USD", fba.estimatedFbaFeeCents)}</strong>
              <small className="mono">体积重 {fba.dimensionalWeightLb} lb vs 实重 {fba.weightLb} lb</small>
            </div>
            <div>
              <span>单件头程（{freight.isVolumetricCharged ? "按抛重计费" : "按实重计费"}）</span>
              <strong className={`mono ${freight.isVolumetricCharged ? "is-amber" : ""}`}>
                ¥{freight.freightRmb.toFixed(2)}（{moneyIn(currency, freight.freightForeignCents)}）
              </strong>
              <small className="mono">
                实重 {freight.actualWeightKg}kg · 抛重 {freight.volumetricWeightKg}kg（/6000）
              </small>
            </div>
            <div>
              <span>站点税制（{vat.marketCode}）</span>
              <strong className="mono">
                {vat.vatRate > 0 ? `扣税 ${moneyIn(currency, vat.vatAmountCents)} (${percent(vat.vatRate, 0)})` : "定价不含税 (0%)"}
              </strong>
              <small>{vat.vatLabel}</small>
            </div>
          </div>

          {fba.downgradeOpportunity ? (
            <div className="notice warn" style={{ marginTop: 12 }}>
              <span className="badge status-review_pending">降档省钱</span>
              <span>
                <strong>可降档至 {fba.downgradeOpportunity.targetTierLabel}：</strong>
                {fba.downgradeOpportunity.axisLabel}当前 {fba.downgradeOpportunity.currentValue}，
                {fba.downgradeOpportunity.reductionNeeded} 至 {fba.downgradeOpportunity.limitValue} 以内，
                单件 FBA 费预计立省 <strong className="mono">{moneyIn("USD", fba.downgradeOpportunity.estimatedSavingCents)}</strong>！
              </span>
            </div>
          ) : null}

          {freight.isVolumetricCharged ? (
            <div className="notice warn" style={{ marginTop: 10 }}>
              <span className="badge status-review_pending">抛货预警</span>
              <span>
                当前彩盒体积重（{freight.volumetricWeightKg}kg）大于实重（{freight.actualWeightKg}kg），
                建议向 1688 工厂确认是否可做可拆卸/真空压缩/紧致内托包装以压低头程。
              </span>
            </div>
          ) : null}
        </div>

        {/* 右侧：首单现金流与 6 个月回本曲线 */}
        <div className="sandbox-panel">
          <h3>首单启动资金与 6 个月回本沙盘</h3>
          <div className="logistics-inputs">
            <label className="field">
              <span>首单 MOQ (件)</span>
              <input
                type="number"
                min={50}
                step={50}
                value={moq}
                onChange={(e) => setMoq(Math.max(10, Number(e.target.value) || 50))}
              />
            </label>
            <label className="field">
              <span>打样/开模 ({currency})</span>
              <input
                type="number"
                min={0}
                step={50}
                value={sampleAndMoldUsd}
                onChange={(e) => setSampleAndMoldUsd(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span>合规认证费 ({currency})</span>
              <input
                type="number"
                min={0}
                step={100}
                value={certUsd}
                onChange={(e) => setCertUsd(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
            <label className="field">
              <span>前60天额外推广 ({currency})</span>
              <input
                type="number"
                min={0}
                step={100}
                value={launchAdUsd}
                onChange={(e) => setLaunchAdUsd(Math.max(0, Number(e.target.value) || 0))}
              />
            </label>
          </div>

          <div className="cashflow-summary-row">
            <div>
              <span>首单启动总投入</span>
              <strong className="mono">{moneyIn(currency, cashflow.totalInitialCapitalCents)}</strong>
              <small className="mono">约 ¥{cashflow.totalInitialCapitalRmb.toLocaleString()}</small>
            </div>
            <div>
              <span>最大现金占用峰值（含翻单）</span>
              <strong className="mono is-danger">{moneyIn(currency, cashflow.peakCashOutflowCents)}</strong>
              <small className="mono">约 ¥{cashflow.peakCashOutflowRmb.toLocaleString()}</small>
            </div>
            <div>
              <span>预计回本周期</span>
              <strong className={`mono ${cashflow.paybackMonths && cashflow.paybackMonths <= 4 ? "is-go" : ""}`}>
                {cashflow.paybackMonths ? `第 ${cashflow.paybackMonths} 个月` : "> 6 个月"}
              </strong>
              <small className="mono">年化资金 ROI {percent(cashflow.annualizedCapitalRoi, 0)}</small>
            </div>
          </div>

          <div className="cashflow-bars">
            {cashflow.monthlyCurve.map((pt) => {
              const positive = pt.cumulativeCashCents >= 0;
              const pct = Math.min(100, Math.max(4, Math.round((Math.abs(pt.cumulativeCashCents) / maxAbsCurve) * 100)));
              return (
                <div key={pt.month} className="cashflow-bar-row">
                  <span className="cashflow-month">{pt.label}</span>
                  <div className="cashflow-track">
                    <div
                      className={`cashflow-fill ${positive ? "is-positive" : "is-negative"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`cashflow-val mono ${positive ? "is-go" : "is-danger"}`}>
                    {positive ? "+" : "−"}{moneyIn(currency, Math.abs(pt.cumulativeCashCents))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            口径：第 1–2 月按 40% / 70% 销量爬坡并摊销冷启动推广，第 3 月起按稳态月销 {Math.max(100, monthlySalesEstimate || 400)} 件推演，余量低于 45 天提前期自动计入翻单采购款。
          </p>
        </div>
      </div>
    </section>
  );
}
