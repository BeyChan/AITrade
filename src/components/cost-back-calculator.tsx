"use client";

import { useMemo, useState } from "react";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import {
  calculateMaxPurchasePriceCents,
  calculateTargetLandedCost,
  type EconomicsAssumptions,
} from "@/lib/economics";
import { moneyIn, percent } from "@/lib/format";

type Quote = {
  id: string;
  supplierName?: string;
  unitPriceCents: number;
  freightPerUnitCents: number;
  dutyRate: number;
  landedCostCents: number;
  currency: string;
  moq: number;
  sampleFeeCents: number;
  sampleScore: number | null;
};

type Props = {
  platformCode: string;
  platformName: string;
  currency: string;
  recommendedPriceCents: number | null;
  confirmedPriceCents: number | null;
  suggestedMarginRate: number;
  quotes: Quote[];
  priceEntryHref: string;
  quoteEntryHref: string;
  fxRateToUsd: number | null;
};

type FeeOverrides = Partial<
  Pick<
    EconomicsAssumptions,
    | "fbaFeeCents"
    | "referralRate"
    | "adRate"
    | "returnRate"
    | "returnProcessingCents"
    | "returnRecoveryRate"
    | "couponCents"
    | "storageCents"
    | "otherCostCents"
  >
>;

type ChecklistStatus = "complete" | "assumption" | "missing";

function clampMargin(value: number) {
  if (!Number.isFinite(value)) return 0.18;
  return Math.min(0.6, Math.max(0.01, value));
}

export function CostBackCalculator({
  platformCode,
  platformName,
  currency,
  recommendedPriceCents,
  confirmedPriceCents,
  suggestedMarginRate,
  quotes,
  priceEntryHref,
  quoteEntryHref,
  fxRateToUsd,
}: Props) {
  const usableRecommendedPriceCents = Number.isFinite(recommendedPriceCents) && (recommendedPriceCents ?? 0) > 0
    ? recommendedPriceCents
    : null;
  const initialPriceCents = confirmedPriceCents && confirmedPriceCents > 0
    ? confirmedPriceCents
    : usableRecommendedPriceCents;
  const [priceInput, setPriceInput] = useState(initialPriceCents ? String(initialPriceCents / 100) : "");
  const [targetMarginInput, setTargetMarginInput] = useState(String((clampMargin(suggestedMarginRate) * 100).toFixed(1)));
  const [overrides, setOverrides] = useState<FeeOverrides>({});

  const salePriceCents = Math.max(0, Math.round((Number(priceInput) || 0) * 100));
  const hasSalePrice = salePriceCents > 0;
  const targetMarginRate = clampMargin((Number(targetMarginInput) || 0) / 100);
  const platformDefaults = useMemo(
    () => platformEconomicDefaults(platformCode, Math.max(1, salePriceCents)),
    [platformCode, salePriceCents],
  );
  const assumptions = { ...platformDefaults, ...overrides };
  const target = hasSalePrice
    ? calculateTargetLandedCost({
        currency,
        salePriceCents,
        targetMarginRate,
        ...assumptions,
      })
    : null;

  const matchingQuotes = quotes.filter((quote) => quote.currency === currency);
  const bestQuote = [...matchingQuotes].sort(
    (left, right) => left.landedCostCents - right.landedCostCents || left.moq - right.moq,
  )[0] ?? null;
  const maxPurchasePriceCents = bestQuote && target
    ? calculateMaxPurchasePriceCents(
        target.maxLandedCostCents,
        bestQuote.freightPerUnitCents,
        bestQuote.dutyRate,
      )
    : null;
  const landedGapCents = bestQuote && target ? bestQuote.landedCostCents - target.maxLandedCostCents : null;
  const purchaseGapCents = bestQuote && maxPurchasePriceCents !== null
    ? bestQuote.unitPriceCents - maxPurchasePriceCents
    : null;
  const firstOrderCashCents = bestQuote
    ? bestQuote.landedCostCents * bestQuote.moq + bestQuote.sampleFeeCents
    : null;
  const usingConfirmedPrice = confirmedPriceCents !== null && salePriceCents === confirmedPriceCents;

  const readiness = !hasSalePrice
    ? {
        key: "collecting",
        label: "待定价",
        title: "先填写预计售价",
        note: "售价可以先用竞品价格带作假设，但只有确认售价和真实报价齐备后，才能判断成本空间。",
      }
    : !target?.achievable || (landedGapCents !== null && landedGapCents > 0)
      ? {
        key: "infeasible",
        label: "不可行",
        title: "当前报价超出可接受成本上限",
        note: landedGapCents !== null
          ? `最低到岸报价还高 ${moneyIn(currency, landedGapCents)}。需要提高售价、降低目标利润或重新谈价。`
          : "按当前售价、费用和退货假设，无法同时满足目标净利率。",
        }
      : !bestQuote
        ? {
          key: "collecting",
          label: "待补报价",
          title: "先拿到真实供应商到岸报价",
          note: "至少比较 3 家供应商。报价必须包含采购价、单件运费、关税、MOQ 和交期。",
          }
        : !usingConfirmedPrice
          ? {
            key: "assumption",
            label: "待核验",
            title: "成本空间够，但售价仍是假设",
            note: "用竞品页、平台后台或价格带记录确认售价后，才能进入正式门禁。",
            }
          : {
            key: "sample",
            label: "可打样",
            title: "当前假设下具备打样价值",
            note: "这不是 GO。先打样，并用平台后台、货代报价和真实退货数据替换默认费率。",
            };

  const checklist: Array<{ label: string; status: ChecklistStatus; detail: string }> = [
    {
      label: "已确认售价",
      status: !hasSalePrice ? "missing" : usingConfirmedPrice ? "complete" : "assumption",
      detail: usingConfirmedPrice
        ? `采用已录入售价 ${moneyIn(currency, salePriceCents)}。`
        : hasSalePrice
          ? "当前售价来自 AI 建议或手动测算，只用于估算成本空间。"
          : "尚未录入预计售价，成本上限无法计算。",
    },
    {
      label: "供应商到岸报价",
      status: bestQuote ? "complete" : "missing",
      detail: bestQuote
        ? `最低报价 ${moneyIn(currency, bestQuote.landedCostCents)}，来自 ${bestQuote.supplierName || "已录入供应商"}。`
        : "尚无可比价的真实到岸报价。",
    },
    {
      label: "头程运费与关税",
      status: bestQuote ? "complete" : "missing",
      detail: bestQuote
        ? `报价含单件运费 ${moneyIn(currency, bestQuote.freightPerUnitCents)}、关税率 ${percent(bestQuote.dutyRate)}。`
        : "需要在供应商报价中录入运费和关税率。",
    },
    {
      label: "平台佣金费率",
      status: "assumption",
      detail: `当前按 ${platformName} 默认 ${percent(assumptions.referralRate)} 估算，未关联官方费率来源。`,
    },
    {
      label: "履约费",
      status: "assumption",
      detail: `当前按 ${moneyIn(currency, assumptions.fbaFeeCents)} 估算，需用平台计费结果或物流报价核验。`,
    },
    {
      label: "广告与退货率",
      status: "assumption",
      detail: `当前按广告 ${percent(assumptions.adRate)}、退货 ${percent(assumptions.returnRate)} 估算，需用后台数据核验。`,
    },
    {
      label: "样品验证",
      status: bestQuote?.sampleScore !== null && bestQuote?.sampleScore !== undefined && bestQuote.sampleScore >= 80
        ? "complete"
        : "missing",
      detail: bestQuote?.sampleScore === null || bestQuote?.sampleScore === undefined
        ? "尚无样品评分，不能进入定标。"
        : `当前样品分 ${bestQuote.sampleScore}，目标不低于 80。`,
    },
  ];

  if (currency !== "USD") {
    checklist.push({
      label: "换汇依据",
      status: fxRateToUsd ? "complete" : "missing",
      detail: fxRateToUsd
        ? `已记录 1 USD = ${fxRateToUsd} ${currency}；正式门禁会按此汇率换算。`
        : "尚未记录可追溯汇率，正式美元门槛无法判断。",
    });
  }

  function setFeeOverride<K extends keyof FeeOverrides>(key: K, value: FeeOverrides[K]) {
    setOverrides((current) => ({ ...current, [key]: value }));
  }

  function resetAssumptions() {
    setPriceInput(initialPriceCents ? String(initialPriceCents / 100) : "");
    setTargetMarginInput(String((clampMargin(suggestedMarginRate) * 100).toFixed(1)));
    setOverrides({});
  }

  return (
    <section className="ai-cost-plan" aria-labelledby="cost-plan-title">
      <div className="ai-cost-plan-head">
        <div>
          <span className="eyebrow">Cost back-calculation</span>
          <h3 id="cost-plan-title">成本反推</h3>
          <p>从预计售价和目标净利率反推最高到岸成本，再与真实报价比较。这里的调整只做即时测算，不改写正式门禁。</p>
        </div>
        <span className={`ai-cost-status ${readiness.key}`}>{readiness.label}</span>
      </div>

      <div className="ai-cost-inputs">
        <label>
          <span>预计售价（{currency}）</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={priceInput}
            onChange={(event) => setPriceInput(event.target.value)}
            placeholder="请填写售价"
          />
          <small>{usingConfirmedPrice ? "已确认售价" : "AI / 手动假设价"}</small>
        </label>
        <label>
          <span>目标净利率 %</span>
          <input
            type="number"
            min="1"
            max="60"
            step="0.1"
            value={targetMarginInput}
            onChange={(event) => setTargetMarginInput(event.target.value)}
          />
          <small>按售价计算</small>
        </label>
        <div className="ai-cost-price-shortcut">
          <span>售价口径</span>
          <div>
            {usableRecommendedPriceCents ? (
              <button type="button" onClick={() => setPriceInput(String(usableRecommendedPriceCents / 100))}>AI 建议价</button>
            ) : null}
            {confirmedPriceCents !== null ? (
              <button type="button" onClick={() => setPriceInput(String(confirmedPriceCents / 100))}>已确认价</button>
            ) : null}
          </div>
          <small>AI 建议价不参与正式门禁</small>
        </div>
      </div>

      <div className="ai-cost-results">
        <article className="primary">
          <span>最高可接受到岸成本</span>
          <strong>{target ? moneyIn(currency, target.maxLandedCostCents) : "待定价"}</strong>
          <small>{target ? `目标单件净利 ${moneyIn(currency, target.targetNetProfitCents)}` : "填写售价后计算"}</small>
        </article>
        <article>
          <span>最高采购单价</span>
          <strong>{!hasSalePrice ? "待定价" : maxPurchasePriceCents === null ? "待报价" : moneyIn(currency, maxPurchasePriceCents)}</strong>
          <small>{!hasSalePrice ? "填写售价后计算" : bestQuote ? "已扣除该报价运费与关税" : "拿到报价后计算"}</small>
        </article>
        <article>
          <span>最低真实到岸报价</span>
          <strong>{bestQuote ? moneyIn(currency, bestQuote.landedCostCents) : "待采集"}</strong>
          <small>{landedGapCents === null ? "尚无供应商报价" : landedGapCents > 0 ? `超出 ${moneyIn(currency, landedGapCents)}` : `留有 ${moneyIn(currency, Math.abs(landedGapCents))} 空间`}</small>
        </article>
        <article>
          <span>按 MOQ 首单现金</span>
          <strong>{firstOrderCashCents === null ? "待报价" : moneyIn(currency, firstOrderCashCents)}</strong>
          <small>{bestQuote ? `含 ${bestQuote.moq} 件到岸成本与样品费` : "拿到报价后计算"}</small>
        </article>
      </div>

      <div className={`ai-cost-verdict ${readiness.key}`}>
        <div>
          <strong>{readiness.title}</strong>
          <p>{readiness.note}</p>
        </div>
        {purchaseGapCents !== null ? (
          <span>{purchaseGapCents > 0 ? `采购价需再降 ${moneyIn(currency, purchaseGapCents)}` : `采购价尚有 ${moneyIn(currency, Math.abs(purchaseGapCents))} 空间`}</span>
        ) : null}
      </div>

      <details className="ai-cost-assumptions">
        <summary>
          <span>调整平台与成本假设</span>
          <span>默认值未核验，展开查看</span>
        </summary>
        <div className="ai-cost-fields">
          <label><span>平台佣金 %</span><input type="number" min="0" max="50" step="0.1" value={(assumptions.referralRate * 100).toFixed(2)} onChange={(event) => setFeeOverride("referralRate", (Number(event.target.value) || 0) / 100)} /></label>
          <label><span>广告费占售价 %</span><input type="number" min="0" max="80" step="0.1" value={(assumptions.adRate * 100).toFixed(2)} onChange={(event) => setFeeOverride("adRate", (Number(event.target.value) || 0) / 100)} /></label>
          <label><span>履约费（{currency}）</span><input type="number" min="0" step="0.01" value={(assumptions.fbaFeeCents / 100).toFixed(2)} onChange={(event) => setFeeOverride("fbaFeeCents", Math.round((Number(event.target.value) || 0) * 100))} /></label>
          <label><span>退货率 %</span><input type="number" min="0" max="95" step="0.1" value={(assumptions.returnRate * 100).toFixed(2)} onChange={(event) => setFeeOverride("returnRate", (Number(event.target.value) || 0) / 100)} /></label>
          <label><span>退货处理费（{currency}）</span><input type="number" min="0" step="0.01" value={(assumptions.returnProcessingCents / 100).toFixed(2)} onChange={(event) => setFeeOverride("returnProcessingCents", Math.round((Number(event.target.value) || 0) * 100))} /></label>
          <label><span>退货残值回收 %</span><input type="number" min="0" max="100" step="0.1" value={(assumptions.returnRecoveryRate * 100).toFixed(2)} onChange={(event) => setFeeOverride("returnRecoveryRate", (Number(event.target.value) || 0) / 100)} /></label>
          <label><span>优惠券（{currency}）</span><input type="number" min="0" step="0.01" value={(assumptions.couponCents / 100).toFixed(2)} onChange={(event) => setFeeOverride("couponCents", Math.round((Number(event.target.value) || 0) * 100))} /></label>
          <label><span>仓储与其他（{currency}）</span><input type="number" min="0" step="0.01" value={((assumptions.storageCents + assumptions.otherCostCents) / 100).toFixed(2)} onChange={(event) => setFeeOverride("otherCostCents", Math.max(0, Math.round((Number(event.target.value) || 0) * 100) - assumptions.storageCents))} /></label>
        </div>
        <div className="ai-cost-assumption-actions">
          <span>平台默认比例只用于首轮测算，不是平台报价。</span>
          <button type="button" className="text-button" onClick={resetAssumptions}>恢复平台默认假设</button>
        </div>
      </details>

      <div className="ai-cost-bottom">
        <div className="ai-cost-checklist">
          <div className="ai-cost-subhead">
            <strong>成本与证据缺口</strong>
            <span>{checklist.filter((item) => item.status === "complete").length} / {checklist.length} 项已有真实依据</span>
          </div>
          <div className="ai-cost-checklist-grid">
            {checklist.map((item) => (
              <div className={`ai-cost-check ${item.status}`} key={item.label}>
                <span>{item.status === "complete" ? "✓" : item.status === "assumption" ? "≈" : "!"}</span>
                <div><strong>{item.label}</strong><small>{item.detail}</small></div>
              </div>
            ))}
          </div>
        </div>
        <div className="ai-cost-next">
          <strong>下一步</strong>
          <p>{!hasSalePrice
            ? "先填写预计售价和目标净利率，再录入供应商真实到岸报价。"
            : bestQuote
              ? "补齐至少 3 家报价并打样；同时核对平台佣金、履约费和退货数据。"
              : "先录一条包含采购价、运费、关税、MOQ 和交期的真实报价。"}</p>
          <div>
            {!hasSalePrice ? <a href={priceEntryHref}>填写售价</a> : null}
            <a href={quoteEntryHref}>录入供应商报价</a>
            {hasSalePrice && !usingConfirmedPrice ? <a href={priceEntryHref}>确认售价</a> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
