"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runCompetitorAnalysisAction } from "@/app/competitors/actions";
import { createAISourcingBatchAction } from "@/app/actions";
import { quickCreateCaseFromWizardAction } from "@/app/discover/actions";
import { CategoryRecommender } from "@/components/category-recommender";
import { CompetitorQuadrantChart } from "@/components/competitor-quadrant-chart";
import { platformEconomicDefaults } from "@/lib/ai-sourcing";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { convertForeignCentsToRmb, convertRmbToForeignCents } from "@/lib/currency";
import {
  calculateEconomics,
  calculateTargetLandedCost,
  opportunityScore,
  recommendationFor,
} from "@/lib/economics";
import { moneyIn, percent } from "@/lib/format";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  evaluatePrelaunchCompliance,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";

type Props = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
  requestKey: string;
  initialReport: CompetitorComparisonReport | null;
  initialStep?: 1 | 2 | 3;
  initialEntryMode?: "ai_brainstorm" | "wizard";
};

type EntryMode = "choose" | "ai_brainstorm" | "wizard";
type WizardStep = 1 | 2 | 3;

export function SelectionWizardClient({
  marketCode,
  marketName,
  platformCode,
  platformName,
  currency,
  requestKey,
  initialReport,
  initialStep = 1,
  initialEntryMode = "wizard",
}: Props) {
  const router = useRouter();
  const [entryMode, setEntryMode] = useState<EntryMode>(initialEntryMode);
  const [step, setStep] = useState<WizardStep>(initialStep);

  // 第 1 步：市场与竞品状态
  const [rawCompetitors, setRawCompetitors] = useState("");
  const [activeReport, setActiveReport] = useState<CompetitorComparisonReport | null>(initialReport);
  const [isAnalyzing, startAnalyze] = useTransition();
  const [stepError, setStepError] = useState<string | null>(null);

  // 第 2 步：成本与 18% 门禁状态
  const [productTitle, setProductTitle] = useState(initialReport?.title ?? "");
  const [category, setCategory] = useState("跨境精品");
  const [targetPrice, setTargetPrice] = useState(
    initialReport?.priceStats?.p50 ? Number((initialReport.priceStats.p50 / 100).toFixed(2)) : 34.99,
  );
  const [factoryCostRmb, setFactoryCostRmb] = useState(32);
  const [freightPerUnit, setFreightPerUnit] = useState(2.2);
  const [adRatePct, setAdRatePct] = useState(12);
  const [monthlySalesEst, setMonthlySalesEst] = useState(600);

  // 第 3 步：合规红线与立项
  const [complianceAttrs, setComplianceAttrs] = useState<ProductComplianceAttribute[]>([]);
  const [patentConfirmed, setPatentConfirmed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const targetPriceCents = Math.max(100, Math.round((Number(targetPrice) || 0) * 100));
  const defaults = useMemo(
    () => platformEconomicDefaults(platformCode, targetPriceCents),
    [platformCode, targetPriceCents],
  );
  const purchaseForeignCents = useMemo(
    () => convertRmbToForeignCents(Math.max(0.1, Number(factoryCostRmb) || 0), currency),
    [factoryCostRmb, currency],
  );
  const freightCents = Math.max(0, Math.round((Number(freightPerUnit) || 0) * 100));
  const landedCostCents = purchaseForeignCents + freightCents;

  const economics = useMemo(
    () =>
      calculateEconomics({
        currency,
        salePriceCents: targetPriceCents,
        landedCostCents,
        fbaFeeCents: defaults.fbaFeeCents,
        referralRate: defaults.referralRate,
        adRate: Math.max(0, Math.min(0.6, (Number(adRatePct) || 0) / 100)),
        returnRate: defaults.returnRate,
        returnProcessingCents: defaults.returnProcessingCents,
        returnRecoveryRate: defaults.returnRecoveryRate,
        couponCents: defaults.couponCents,
        storageCents: defaults.storageCents,
        otherCostCents: defaults.otherCostCents,
      }),
    [currency, targetPriceCents, landedCostCents, defaults, adRatePct],
  );

  const target18 = useMemo(
    () =>
      calculateTargetLandedCost({
        currency,
        salePriceCents: targetPriceCents,
        fbaFeeCents: defaults.fbaFeeCents,
        referralRate: defaults.referralRate,
        adRate: Math.max(0, Math.min(0.6, (Number(adRatePct) || 0) / 100)),
        returnRate: defaults.returnRate,
        returnProcessingCents: defaults.returnProcessingCents,
        returnRecoveryRate: defaults.returnRecoveryRate,
        couponCents: defaults.couponCents,
        storageCents: defaults.storageCents,
        otherCostCents: defaults.otherCostCents,
        targetMarginRate: 0.18,
      }),
    [currency, targetPriceCents, defaults, adRatePct],
  );

  const maxFactoryRmb = useMemo(() => {
    if (!target18.achievable) return 0;
    const maxPurchaseForeign = Math.max(0, target18.maxLandedCostCents - freightCents);
    return convertForeignCentsToRmb(maxPurchaseForeign, currency);
  }, [target18, freightCents, currency]);

  const score = useMemo(
    () => opportunityScore(economics, monthlySalesEst, activeReport?.competitors[0]?.reviewCount ?? 400, 65),
    [economics, monthlySalesEst, activeReport],
  );
  const verdict = useMemo(() => recommendationFor(economics, score), [economics, score]);

  const compliance = useMemo(
    () => evaluatePrelaunchCompliance(marketCode, complianceAttrs, `${category} ${productTitle}`),
    [marketCode, complianceAttrs, category, productTitle],
  );

  const search1688Url = `/api/sourcing/1688-search?q=${encodeURIComponent(
    (productTitle || category || "跨境新品").slice(0, 30),
  )}`;

  function handleAnalyzeCompetitors(e: React.FormEvent) {
    e.preventDefault();
    if (!rawCompetitors.trim()) {
      setStepError("请粘贴至少 1 个竞品链接或 ASIN（或直接点击右下角跳过第 1 步去核成本）");
      return;
    }
    setStepError(null);
    startAnalyze(async () => {
      const fd = new FormData();
      fd.set("rawInputs", rawCompetitors);
      fd.set("marketCode", marketCode);
      fd.set("platformCode", platformCode);
      fd.set("currency", currency);
      const res = await runCompetitorAnalysisAction(fd);
      if (res.success && res.report) {
        setActiveReport(res.report);
        if (!productTitle.trim()) setProductTitle(res.report.title);
        if (res.report.priceStats.p50 > 0) {
          setTargetPrice(Number((res.report.priceStats.p50 / 100).toFixed(2)));
        }
      } else {
        setStepError(res.error || "竞品分析失败，请检查输入");
      }
    });
  }

  async function handlePromoteCase() {
    setStepError(null);
    setIsCreating(true);
    try {
      const res = await quickCreateCaseFromWizardAction({
        title: productTitle.trim() || activeReport?.title || `${category} 新品立项`,
        category,
        asin: activeReport?.competitors[0]?.asin,
        marketCode,
        platformCode,
        currency,
        targetPriceCents,
        factoryCostRmb,
        freightPerUnitCents: freightCents,
        fbaFeeCents: defaults.fbaFeeCents,
        adRate: Math.max(0, Math.min(0.6, (Number(adRatePct) || 0) / 100)),
        returnRate: defaults.returnRate,
        monthlySalesEstimate: monthlySalesEst,
        sourceReportId: activeReport?.id ?? null,
        complianceSummary:
          compliance.certifications.length > 0
            ? `识别 ${compliance.certifications.length} 项认证 (${compliance.certifications.map((c) => c.code).join(", ")})，预估 $${compliance.totalEstimatedCostUsd}`
            : "低合规风险，待完成常规专利检索",
      });

      if (!res.success || !res.caseId) {
        setStepError(res.error || "立项失败，请检查必填项");
        return;
      }
      router.push(`/cases/${res.caseId}`);
    } finally {
      setIsCreating(false);
    }
  }

  const verdictClass = verdict === "GO" ? "is-go" : verdict === "HOLD" ? "is-hold" : "is-no-go";
  const nextStepBanner =
    step === 1
      ? activeReport
        ? `第 1/3 步已就绪：已载入「${activeReport.title}」（P50 中位价 ${moneyIn(activeReport.currency, activeReport.priceStats.p50)}），点击进入第 2 步核成本。`
        : "第 1/3 步：粘贴 1–4 个竞品 ASIN/链接（或用扩展在亚马逊搜索页一键抓 Top 20），也可以直接跳过进入第 2 步测毛利。"
      : step === 2
        ? economics.marginRate >= 0.18 && economics.stressProfitCents > 0
          ? `第 2/3 步通过：当前净利率 ${percent(economics.marginRate)}（满足 18% 硬门禁），可以进入第 3 步做合规自查并立项！`
          : `第 2/3 步卡点：当前净利率 ${percent(economics.marginRate)} 未达 18% 门禁，建议将 1688 拿货价压至 ¥${maxFactoryRmb.toFixed(1)} 以内或调整拟定售价。`
        : "第 3/3 步：勾选商品合规属性排查专利与认证雷区，确认无硬伤后点击「正式立项」生成案卷。";

  return (
    <div className="stack">
      {/* 顶部 3 选 1 场景起点 */}
      <section className="wizard-entry-grid" aria-label="选品起点分流">
        <button
          type="button"
          className={`wizard-entry-card${entryMode === "ai_brainstorm" ? " is-active" : ""}`}
          onClick={() => setEntryMode("ai_brainstorm")}
        >
          <span className="wizard-entry-num mono">01</span>
          <div>
            <strong>还没定品 · 让 AI 找方向</strong>
            <p>输入类目与预算，AI 拆出 5 个细分痛点机会供筛选</p>
          </div>
        </button>

        <button
          type="button"
          className={`wizard-entry-card${entryMode === "wizard" && step === 1 ? " is-active" : ""}`}
          onClick={() => {
            setEntryMode("wizard");
            setStep(1);
          }}
        >
          <span className="wizard-entry-num mono">02</span>
          <div>
            <strong>已有竞品 · 测市场格局</strong>
            <p>粘贴 ASIN 或用扩展抓搜索页 Top 20，秒出四象限图与价格带</p>
          </div>
        </button>

        <button
          type="button"
          className={`wizard-entry-card${entryMode === "wizard" && step === 2 ? " is-active" : ""}`}
          onClick={() => {
            setEntryMode("wizard");
            setStep(2);
          }}
        >
          <span className="wizard-entry-num mono">03</span>
          <div>
            <strong>已有货源 · 极速测 18% 毛利</strong>
            <p>直接填售价与 1688 拿货价，实时判定 GO / HOLD / NO-GO</p>
          </div>
        </button>
      </section>

      {/* 分支 A：还没定品 → AI 发散方向表单 */}
      {entryMode === "ai_brainstorm" ? (
        <section className="section">
          <div className="section-header">
            <div>
              <h2>AI 类目机会发散（{marketName}站 · {platformName}）</h2>
              <p>输入想做的类目和约束条件，系统生成 5 个待验证假设并自动进入研究批次（汇率已自动对接全局实时汇率）。</p>
            </div>
            <div className="button-row">
              <Link
                href={`/import?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
                className="button secondary fx-btn-sm"
              >
                导入候选品 CSV
              </Link>
              <Link
                href={`/cases?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
                className="button ghost fx-btn-sm"
              >
                查看全部商品
              </Link>
              <Link href="/ai-sourcing" className="button ghost fx-btn-sm">
                历史批次
              </Link>
            </div>
          </div>
          <form action={createAISourcingBatchAction} className="stack">
            <input type="hidden" name="marketCode" value={marketCode} />
            <input type="hidden" name="platformCode" value={platformCode} />
            <input type="hidden" name="requestKey" value={requestKey} />
            <div className="form-grid">
              <div className="ai-research-basics">
                <CategoryRecommender
                  marketCode={marketCode}
                  marketName={marketName}
                  platformCode={platformCode}
                  platformName={platformName}
                />
                <div className="field ai-research-actor">
                  <label htmlFor="wizard-actor">发起人</label>
                  <input id="wizard-actor" name="actor" defaultValue="选品负责人" required maxLength={80} />
                </div>
              </div>
              <div className="field full">
                <label htmlFor="brief">选品条件与避坑要求</label>
                <textarea
                  id="brief"
                  name="brief"
                  rows={4}
                  required
                  minLength={3}
                  maxLength={1200}
                  placeholder="例如：客单价 $25–$45，重量不超过 1kg，避开强电与儿童类目，优先找差评集中在异响/难清洗的微改良机会。"
                />
              </div>
            </div>
            <div className="form-actions">
              <span className="help">AI 只产出待验证假设，绝不编造销量和价格；生成后可直接进入验证。</span>
              <button type="submit" className="button primary">生成 5 个选品方向</button>
            </div>
          </form>
        </section>
      ) : (
        /* 分支 B：核心 3 步极简选品闯关向导 */
        <section className="section wizard-shell">
          {/* 3 步进度条 */}
          <div className="wizard-stepper" role="tablist" aria-label="选品 3 步向导">
            {[
              { id: 1 as const, title: "1. 看市场", desc: "竞品价格带与差评痛点" },
              { id: 2 as const, title: "2. 核成本", desc: "18% 硬门禁与拿货上限" },
              { id: 3 as const, title: "3. 拍板立项", desc: "合规红线与一键建案卷" },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={step === item.id}
                className={`wizard-step-tab${step === item.id ? " is-current" : ""}${step > item.id ? " is-done" : ""}`}
                onClick={() => setStep(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.desc}</span>
              </button>
            ))}
          </div>

          {/* 顶部一句人话引导条 */}
          <div className="wizard-guide-bar">
            <span className="badge badge-neutral mono">STEP {step}/3</span>
            <span>{nextStepBanner}</span>
          </div>

          {stepError ? (
            <div className="notice warn" style={{ marginBottom: 14 }}>
              <span className="badge badge-danger">提示</span>
              <span>{stepError}</span>
            </div>
          ) : null}

          {/* STEP 1: 看市场 */}
          {step === 1 ? (
            <div className="stack">
              <form onSubmit={handleAnalyzeCompetitors} className="wizard-step-box">
                <div className="field">
                  <label htmlFor="wizard-competitors">粘贴 1–4 个竞品链接或 ASIN（每行一个）</label>
                  <textarea
                    id="wizard-competitors"
                    rows={3}
                    value={rawCompetitors}
                    onChange={(e) => setRawCompetitors(e.target.value)}
                    placeholder={`https://www.amazon.com/dp/B08CZ8K652\nhttps://www.amazon.com/dp/B09M87J11L`}
                  />
                  <span className="help">
                    更快方式：打开亚马逊搜索页，点击 Chrome 扩展「AITrade 竞品采集」可 3 秒一键抓取当前页 Top 20 真实竞品！
                  </span>
                </div>
                <div className="wizard-actions-row">
                  <button type="submit" className="button secondary" disabled={isAnalyzing}>
                    {isAnalyzing ? "正在生成竞品研报…" : "生成竞品研报"}
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => {
                      setStepError(null);
                      setStep(2);
                    }}
                  >
                    {activeReport ? "下一步：核成本与 18% 门禁 →" : "已有货源，跳过此步直接核成本 →"}
                  </button>
                </div>
              </form>

              {activeReport ? (
                <CompetitorQuadrantChart
                  competitors={activeReport.competitors}
                  currency={activeReport.currency}
                  p50PriceCents={activeReport.priceStats.p50}
                  targetPriceCents={targetPriceCents}
                />
              ) : null}
            </div>
          ) : null}

          {/* STEP 2: 核成本 */}
          {step === 2 ? (
            <div className="stack">
              <div className="wizard-step-box">
                <div className="form-grid">
                  <label className="field">
                    <span>商品名称 / 方向</span>
                    <input
                      value={productTitle}
                      onChange={(e) => setProductTitle(e.target.value)}
                      placeholder="例如：静音不锈钢宠物饮水机 2.5L"
                    />
                  </label>
                  <label className="field">
                    <span>所属类目</span>
                    <input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="例如：宠物饮水器"
                    />
                  </label>
                  <label className="field">
                    <span>拟定售价 ({currency})</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={targetPrice}
                      onChange={(e) => setTargetPrice(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="field">
                    <span>1688 工厂拿货价 (RMB ¥)</span>
                    <input
                      type="number"
                      min={0.5}
                      step={1}
                      value={factoryCostRmb}
                      onChange={(e) => setFactoryCostRmb(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="field">
                    <span>估算单件头程 ({currency})</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={freightPerUnit}
                      onChange={(e) => setFreightPerUnit(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="field">
                    <span>预估广告占比 ACoS (%)</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step={1}
                      value={adRatePct}
                      onChange={(e) => setAdRatePct(Number(e.target.value) || 0)}
                    />
                  </label>
                  <label className="field">
                    <span>预估稳态月销量 (件)</span>
                    <input
                      type="number"
                      min={50}
                      step={50}
                      value={monthlySalesEst}
                      onChange={(e) => setMonthlySalesEst(Number(e.target.value) || 100)}
                    />
                  </label>
                </div>

                {/* 实时 18% 门禁与拿货上限底牌 */}
                <div className="sandbox-kpi-strip" style={{ marginTop: 16 }}>
                  <div className="sandbox-kpi-cell">
                    <span className="sandbox-kpi-label">门禁实时判定</span>
                    <span className={`verdict-pill ${verdictClass}`} style={{ alignSelf: "flex-start" }}>
                      {verdict} · {score} 分
                    </span>
                  </div>
                  <div className="sandbox-kpi-cell">
                    <span className="sandbox-kpi-label">单件净利</span>
                    <strong className={`sandbox-kpi-value mono ${economics.netProfitCents > 0 ? "" : "is-danger"}`}>
                      {moneyIn(currency, economics.netProfitCents)}
                    </strong>
                  </div>
                  <div className="sandbox-kpi-cell">
                    <span className="sandbox-kpi-label">净利率（门禁 18%）</span>
                    <strong className={`sandbox-kpi-value mono ${economics.marginRate >= 0.18 ? "is-go" : "is-danger"}`}>
                      {percent(economics.marginRate)}
                      {economics.marginRate < 0.18 ? " ↓" : ""}
                    </strong>
                  </div>
                  <div className="sandbox-kpi-cell">
                    <span className="sandbox-kpi-label">18% 门禁最高拿货上限</span>
                    <strong className={`sandbox-kpi-value mono ${factoryCostRmb > maxFactoryRmb ? "is-danger" : "is-go"}`}>
                      ¥{maxFactoryRmb.toFixed(1)}
                    </strong>
                    <span className="sandbox-kpi-sub mono">
                      {factoryCostRmb > maxFactoryRmb
                        ? `需压降 ¥${(factoryCostRmb - maxFactoryRmb).toFixed(1)}`
                        : `尚余 ¥${(maxFactoryRmb - factoryCostRmb).toFixed(1)}`}
                    </span>
                  </div>
                  <div className="sandbox-kpi-cell">
                    <span className="sandbox-kpi-label">压力情景净利</span>
                    <strong className={`sandbox-kpi-value mono ${economics.stressProfitCents > 0 ? "" : "is-danger"}`}>
                      {moneyIn(currency, economics.stressProfitCents)}
                    </strong>
                  </div>
                </div>

                <div className="wizard-actions-row">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="button ghost" onClick={() => setStep(1)}>
                      ← 返回第 1 步
                    </button>
                    <a href={search1688Url} target="_blank" rel="noreferrer" className="button secondary">
                      打开 1688 搜同款查底价
                    </a>
                  </div>
                  <button type="button" className="button primary" onClick={() => setStep(3)}>
                    下一步：合规自查与立项 →
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* STEP 3: 拍板立项 */}
          {step === 3 ? (
            <div className="stack">
              <div className="wizard-step-box">
                <h3 style={{ marginTop: 0, fontSize: 15 }}>勾选商品属性，快速排查 {marketName} 站强制认证与专利红线</h3>
                <div className="compliance-attr-grid">
                  {COMPLIANCE_ATTRIBUTE_OPTIONS.map((opt) => {
                    const active = complianceAttrs.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`compliance-attr-chip${active ? " is-active" : ""}`}
                        onClick={() =>
                          setComplianceAttrs((prev) =>
                            prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id],
                          )
                        }
                      >
                        <strong>{opt.label}</strong>
                        <span>{opt.hint}</span>
                      </button>
                    );
                  })}
                </div>

                {compliance.certifications.length > 0 ? (
                  <div className="notice warn" style={{ marginBottom: 14 }}>
                    <span className="badge status-review_pending">合规门槛</span>
                    <span>
                      识别到 <strong>{compliance.certifications.length}</strong> 项强制认证（
                      {compliance.certifications.map((c) => c.code).join("、")}），
                      预估认证费用 <strong className="mono">${compliance.totalEstimatedCostUsd.toLocaleString()}</strong>，立项后将自动记录到案卷备注。
                    </span>
                  </div>
                ) : (
                  <div className="notice" style={{ marginBottom: 14 }}>
                    <span className="badge badge-success">LOW RISK</span>
                    <span>未命中高危强认证属性，按常规专利与商标排查即可。</span>
                  </div>
                )}

                <div className="wizard-final-summary">
                  <div>
                    <span>立项商品</span>
                    <strong>{productTitle.trim() || activeReport?.title || `${category} 新品`}</strong>
                  </div>
                  <div>
                    <span>拟定售价 / 1688 拿货价</span>
                    <strong className="mono">
                      {moneyIn(currency, targetPriceCents)} / ¥{factoryCostRmb.toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>测算净利率 / 门禁结论</span>
                    <strong className="mono">
                      {percent(economics.marginRate)} · {verdict}
                    </strong>
                  </div>
                </div>

                <label className="compliance-check-label" style={{ marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={patentConfirmed}
                    onChange={(e) => setPatentConfirmed(e.target.checked)}
                  />
                  <span>我已确认上述数字为初步核验基准，立项后将在案卷内补齐工厂正式报价与专利核查</span>
                </label>

                <div className="wizard-actions-row" style={{ marginTop: 16 }}>
                  <button type="button" className="button ghost" onClick={() => setStep(2)}>
                    ← 返回修改成本
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={isCreating || !patentConfirmed}
                    onClick={handlePromoteCase}
                  >
                    {isCreating ? "正在生成正式案卷…" : "正式立项，生成商品案卷"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
