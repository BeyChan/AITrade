"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runCompetitorAnalysisAction } from "@/app/competitors/actions";
import {
  createAISourcingBatchAction,
  createQuickCandidateAction,
  saveSourcingConstraintsAction,
} from "@/app/actions";
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
import { moneyIn, percent, shortDate } from "@/lib/format";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  evaluatePrelaunchCompliance,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";
import {
  DEFAULT_SOURCING_CONSTRAINTS,
  ELIMINATION_REASONS,
  findEliminationMatches,
  type CustomExclusionItem,
  type EliminatedHistoryRecord,
  type SourcingConstraints,
} from "@/lib/sourcing-funnel";

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
  initialConstraints?: SourcingConstraints;
  eliminatedHistory?: EliminatedHistoryRecord[];
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
  initialConstraints = DEFAULT_SOURCING_CONSTRAINTS,
  eliminatedHistory = [],
}: Props) {
  const router = useRouter();
  const [entryMode, setEntryMode] = useState<EntryMode>(initialEntryMode);
  const [step, setStep] = useState<WizardStep>(initialStep);
  const pendingScrollY = useRef<number | null>(null);
  const pointerScrollY = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingScrollY.current === null) return;

    const targetY = pendingScrollY.current;
    pendingScrollY.current = null;
    const restoreViewport = () => {
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo(window.scrollX, Math.min(targetY, maxScrollY));
    };

    restoreViewport();
    const frame = window.requestAnimationFrame(restoreViewport);
    return () => window.cancelAnimationFrame(frame);
  }, [entryMode, step]);

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

  // 第 3 步：合规红线与立项（含 NO-GO 例外审批）
  const [complianceAttrs, setComplianceAttrs] = useState<ProductComplianceAttribute[]>([]);
  const [patentConfirmed, setPatentConfirmed] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [exceptionReason, setExceptionReason] = useState("");
  const [exceptionRiskNote, setExceptionRiskNote] = useState("");
  const [exceptionApprover, setExceptionApprover] = useState("");
  const [requiresException, setRequiresException] = useState(false);

  // 阶段 4：结构化选品约束 + 实时淘汰避坑匹配
  const [briefText, setBriefText] = useState(initialConstraints.customNote || "");
  const [excludedAttrs, setExcludedAttrs] = useState<ProductComplianceAttribute[]>(
    initialConstraints.excludedAttrs,
  );
  const [customExclusions, setCustomExclusions] = useState<CustomExclusionItem[]>(
    initialConstraints.customExclusions ?? [],
  );
  const [hiddenAttrs, setHiddenAttrs] = useState<ProductComplianceAttribute[]>(
    initialConstraints.hiddenAttrs ?? [],
  );
  const [attrLabelOverrides, setAttrLabelOverrides] = useState<
    Partial<Record<ProductComplianceAttribute, string>>
  >(initialConstraints.attrLabelOverrides ?? {});
  const [isEditingExclusions, setIsEditingExclusions] = useState(false);
  const [newExclusionLabel, setNewExclusionLabel] = useState("");

  const persistConstraints = (next: {
    excludedAttrs?: ProductComplianceAttribute[];
    customExclusions?: CustomExclusionItem[];
    hiddenAttrs?: ProductComplianceAttribute[];
    attrLabelOverrides?: Partial<Record<ProductComplianceAttribute, string>>;
  }) => {
    saveSourcingConstraintsAction({
      minPriceUsd: initialConstraints.minPriceUsd,
      maxPriceUsd: initialConstraints.maxPriceUsd,
      maxWeightKg: initialConstraints.maxWeightKg,
      excludedAttrs: next.excludedAttrs ?? excludedAttrs,
      customExclusions: next.customExclusions ?? customExclusions,
      hiddenAttrs: next.hiddenAttrs ?? hiddenAttrs,
      attrLabelOverrides: next.attrLabelOverrides ?? attrLabelOverrides,
      customNote: briefText,
    }).catch(() => {});
  };

  const handleAddCustomExclusion = () => {
    const label = newExclusionLabel.trim();
    if (!label) return;
    const nextItem: CustomExclusionItem = {
      id: `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label,
      enabled: true,
    };
    const next = [...customExclusions, nextItem];
    setCustomExclusions(next);
    setNewExclusionLabel("");
    persistConstraints({ customExclusions: next });
  };
  const eliminationAlerts = useMemo(() => {
    const query =
      entryMode === "ai_brainstorm"
        ? briefText
        : `${productTitle} ${rawCompetitors} ${activeReport?.title ?? ""}`;
    return findEliminationMatches(query, category, eliminatedHistory);
  }, [entryMode, briefText, productTitle, rawCompetitors, activeReport, category, eliminatedHistory]);

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

  const estimatedEvidenceScore = useMemo(() => {
    const compCount = activeReport?.competitors?.length ?? 0;
    return compCount > 0 ? Math.min(80, 40 + Math.min(compCount, 8) * 5) : 30;
  }, [activeReport]);

  const effectiveReviewCount = activeReport?.competitors[0]?.reviewCount ?? 0;

  const score = useMemo(
    () => opportunityScore(economics, monthlySalesEst, effectiveReviewCount, estimatedEvidenceScore),
    [economics, monthlySalesEst, effectiveReviewCount, estimatedEvidenceScore],
  );
  const verdict = useMemo(() => recommendationFor(economics, score), [economics, score]);
  const needsNoGoException = verdict === "NO-GO" || requiresException;

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
    if (needsNoGoException && (!exceptionReason.trim() || !exceptionRiskNote.trim() || !exceptionApprover.trim())) {
      setStepError("当前估算快筛结论为 NO-GO，如需例外创建案卷，必须填写例外原因、风险说明与审批人。");
      return;
    }
    setIsCreating(true);
    try {
      const res = await quickCreateCaseFromWizardAction({
        title: productTitle.trim() || activeReport?.title || `${category} 新品`,
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
        reviewCount: effectiveReviewCount,
        sourceReportId: activeReport?.id ?? null,
        complianceSummary:
          compliance.certifications.length > 0
            ? `识别 ${compliance.certifications.length} 项认证 (${compliance.certifications.map((c) => c.code).join(", ")})，预估 $${compliance.totalEstimatedCostUsd}`
            : "低合规风险，待完成常规专利检索",
        exceptionReason: needsNoGoException ? exceptionReason.trim() : undefined,
        exceptionRiskNote: needsNoGoException ? exceptionRiskNote.trim() : undefined,
        exceptionApprover: needsNoGoException ? exceptionApprover.trim() : undefined,
      });

      if (!res.success || !res.caseId) {
        if (res.requiresException) setRequiresException(true);
        setStepError(res.error || "创建案卷失败，请检查必填项");
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

  const capturePointerViewport = () => {
    pointerScrollY.current = window.scrollY;
  };

  const keepViewportOnStateChange = (update: () => void) => {
    pendingScrollY.current = pointerScrollY.current ?? window.scrollY;
    pointerScrollY.current = null;
    update();
  };

  const revealEntryPanel = (mode: Exclude<EntryMode, "choose">, nextStep?: WizardStep) => {
    keepViewportOnStateChange(() => {
      setEntryMode(mode);
      if (nextStep) setStep(nextStep);
    });
  };

  return (
    <div className="stack selection-wizard-root">
      {/* 顶部两条路径：还没定品走 AI 发散；已有线索直接进入 3 步立项向导 */}
      <section className="wizard-entry-grid is-two" aria-label="选品工作模式">
        <button
          type="button"
          aria-pressed={entryMode === "ai_brainstorm"}
          aria-controls="ai-brainstorm-panel"
          className={`wizard-entry-card${entryMode === "ai_brainstorm" ? " is-active" : ""}`}
          onPointerDown={capturePointerViewport}
          onClick={() => revealEntryPanel("ai_brainstorm")}
        >
          <span className="wizard-entry-num mono">A</span>
          <span className="wizard-entry-body">
            <strong>还没定品 · 让 AI 找方向</strong>
            <span className="wizard-entry-description">输入类目与预算，AI 拆出 5 个细分痛点机会，进入候选看板筛选</span>
          </span>
        </button>

        <article className={`wizard-entry-card wizard-entry-card-multi${entryMode === "wizard" ? " is-active" : ""}`}>
          <button
            type="button"
            className="wizard-entry-card-main"
            aria-pressed={entryMode === "wizard"}
            aria-controls="wizard-panel"
            onPointerDown={capturePointerViewport}
            onClick={() => revealEntryPanel("wizard", entryMode === "wizard" ? step : 1)}
          >
            <span className="wizard-entry-num mono">B</span>
            <span className="wizard-entry-body">
              <strong>已有线索 · 3 步极速立项</strong>
              <span className="wizard-entry-description">
                有竞品先测市场；已有货源可直接核 18% 毛利，最后完成合规自查并生成案卷。
              </span>
            </span>
          </button>
          <div className="wizard-entry-actions">
            <button
              type="button"
              className={`wizard-entry-action${entryMode === "wizard" && step === 1 ? " is-active" : ""}`}
              aria-pressed={entryMode === "wizard" && step === 1}
              onPointerDown={capturePointerViewport}
              onClick={() => revealEntryPanel("wizard", 1)}
            >
              有竞品 · 测市场 →
            </button>
            <button
              type="button"
              className={`wizard-entry-action${entryMode === "wizard" && step === 2 ? " is-active" : ""}`}
              aria-pressed={entryMode === "wizard" && step === 2}
              onPointerDown={capturePointerViewport}
              onClick={() => revealEntryPanel("wizard", 2)}
            >
              有货源 · 核毛利 →
            </button>
          </div>
        </article>
      </section>

      {/* 分支 A：还没定品 → AI 发散方向表单 */}
      {entryMode === "ai_brainstorm" ? (
        <section className="section wizard-panel-anchor" id="ai-brainstorm-panel">
          <div className="section-header">
            <div>
              <h2>AI 类目机会发散（{marketName}站 · {platformName}）</h2>
              <p>输入想做的类目和约束条件，系统生成 5 个待验证假设并自动进入研究批次（汇率已自动对接全局实时汇率）。</p>
            </div>
            <div className="button-row">
              <Link
                href={`/import?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
                className="button funnel-import-cta"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>导入候选品 CSV</span>
              </Link>
            </div>
          </div>
          <form action={createAISourcingBatchAction} className="stack">
            <input type="hidden" name="marketCode" value={marketCode} />
            <input type="hidden" name="platformCode" value={platformCode} />
            <input type="hidden" name="requestKey" value={requestKey} />
            <input type="hidden" name="actor" value="选品负责人" />

            {eliminationAlerts.length > 0 ? (
              <div className="notice warn funnel-history-alert" role="status">
                <strong>避坑提醒：历史曾淘汰过相似方向</strong>
                <div className="funnel-history-alert-list">
                  {eliminationAlerts.map(({ record }) => (
                    <span key={record.id}>
                      「{record.concept}」于 {shortDate(record.eliminatedAt)} 因 <strong>{record.eliminationReason}</strong> 淘汰
                      {record.eliminationNote ? `（${record.eliminationNote}）` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="form-grid">
              <div className="ai-research-basics">
                <CategoryRecommender
                  marketCode={marketCode}
                  marketName={marketName}
                  platformCode={platformCode}
                  platformName={platformName}
                />
                <div className="funnel-constraint-nums">
                  <div className="field">
                    <label htmlFor="minPriceUsd">客单价下限 ($)</label>
                    <input
                      id="minPriceUsd"
                      name="minPriceUsd"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={initialConstraints.minPriceUsd ?? 20}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="maxPriceUsd">客单价上限 ($)</label>
                    <input
                      id="maxPriceUsd"
                      name="maxPriceUsd"
                      type="number"
                      min="1"
                      step="1"
                      defaultValue={initialConstraints.maxPriceUsd ?? 60}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="maxWeightKg">单件重量上限 (kg)</label>
                    <input
                      id="maxWeightKg"
                      name="maxWeightKg"
                      type="number"
                      min="0.1"
                      step="0.1"
                      defaultValue={initialConstraints.maxWeightKg ?? 1.0}
                    />
                  </div>
                </div>
              </div>

              <div className="field full">
                <div className="funnel-compliance-header">
                  <label>直接排除项（命中即在生成结果中自动过滤，记忆上次偏好）</label>
                  <div className="funnel-compliance-header-actions">
                    {isEditingExclusions && (hiddenAttrs.length > 0 || Object.keys(attrLabelOverrides).length > 0) ? (
                      <button
                        type="button"
                        className="button ghost compact-button"
                        onClick={() => {
                          setHiddenAttrs([]);
                          setAttrLabelOverrides({});
                          persistConstraints({ hiddenAttrs: [], attrLabelOverrides: {} });
                        }}
                      >
                        恢复默认
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button ghost compact-button"
                      onClick={() => {
                        if (isEditingExclusions) {
                          persistConstraints({});
                        }
                        setIsEditingExclusions((prev) => !prev);
                      }}
                    >
                      {isEditingExclusions ? "完成编辑" : "编辑排除项"}
                    </button>
                  </div>
                </div>
                <input type="hidden" name="customExclusionsJson" value={JSON.stringify(customExclusions)} />
                <input type="hidden" name="hiddenAttrsJson" value={JSON.stringify(hiddenAttrs)} />
                <input type="hidden" name="attrLabelOverridesJson" value={JSON.stringify(attrLabelOverrides)} />
                <div className="funnel-compliance-pills">
                  {COMPLIANCE_ATTRIBUTE_OPTIONS.filter((opt) => !hiddenAttrs.includes(opt.id)).map((opt) => {
                    const checked = excludedAttrs.includes(opt.id);
                    const displayLabel = attrLabelOverrides[opt.id] ?? opt.label;
                    if (isEditingExclusions) {
                      return (
                        <div key={opt.id} className="funnel-compliance-pill is-editing">
                          <input
                            type="text"
                            className="funnel-compliance-pill-input"
                            value={displayLabel}
                            aria-label={`编辑排除项 ${opt.label}`}
                            onChange={(e) => {
                              const nextOverrides = { ...attrLabelOverrides, [opt.id]: e.target.value };
                              setAttrLabelOverrides(nextOverrides);
                            }}
                            onBlur={() => persistConstraints({ attrLabelOverrides })}
                          />
                          <button
                            type="button"
                            className="funnel-compliance-pill-remove"
                            title="删除此排除项"
                            aria-label={`删除 ${displayLabel}`}
                            onClick={() => {
                              const nextHidden = [...hiddenAttrs, opt.id];
                              const nextExcluded = excludedAttrs.filter((x) => x !== opt.id);
                              setHiddenAttrs(nextHidden);
                              setExcludedAttrs(nextExcluded);
                              persistConstraints({ hiddenAttrs: nextHidden, excludedAttrs: nextExcluded });
                            }}
                          >
                            ×
                          </button>
                        </div>
                      );
                    }
                    return (
                      <label key={opt.id} className="funnel-compliance-pill" title={opt.hint}>
                        <input
                          type="checkbox"
                          name="excludedAttr"
                          value={opt.id}
                          checked={checked}
                          onChange={() => {
                            const nextExcluded = checked
                              ? excludedAttrs.filter((x) => x !== opt.id)
                              : [...excludedAttrs, opt.id];
                            setExcludedAttrs(nextExcluded);
                            persistConstraints({ excludedAttrs: nextExcluded });
                          }}
                        />
                        <span>{displayLabel}</span>
                      </label>
                    );
                  })}

                  {customExclusions.map((item) =>
                    isEditingExclusions ? (
                      <div key={item.id} className="funnel-compliance-pill is-editing">
                        <input
                          type="text"
                          className="funnel-compliance-pill-input"
                          value={item.label}
                          aria-label={`编辑自定义排除项 ${item.label}`}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomExclusions((prev) =>
                              prev.map((c) => (c.id === item.id ? { ...c, label: val } : c)),
                            );
                          }}
                          onBlur={() => persistConstraints({ customExclusions })}
                        />
                        <button
                          type="button"
                          className="funnel-compliance-pill-remove"
                          title="删除此排除项"
                          aria-label={`删除 ${item.label}`}
                          onClick={() => {
                            const next = customExclusions.filter((c) => c.id !== item.id);
                            setCustomExclusions(next);
                            persistConstraints({ customExclusions: next });
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <label key={item.id} className="funnel-compliance-pill">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={() => {
                            const next = customExclusions.map((c) =>
                              c.id === item.id ? { ...c, enabled: !c.enabled } : c,
                            );
                            setCustomExclusions(next);
                            persistConstraints({ customExclusions: next });
                          }}
                        />
                        <span>{item.label}</span>
                      </label>
                    ),
                  )}
                </div>

                {isEditingExclusions ? (
                  <div className="funnel-compliance-add-row">
                    <input
                      type="text"
                      value={newExclusionLabel}
                      onChange={(e) => setNewExclusionLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddCustomExclusion();
                        }
                      }}
                      placeholder="输入新的排除项（例如：易碎玻璃、超大件、强季节性）"
                      aria-label="新增排除项"
                    />
                    <button
                      type="button"
                      className="button secondary compact-button"
                      onClick={handleAddCustomExclusion}
                    >
                      + 新增
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="field full">
                <label htmlFor="brief">补充方向 / 痛点要求（选填）</label>
                <textarea
                  id="brief"
                  name="brief"
                  rows={2}
                  maxLength={600}
                  value={briefText}
                  onChange={(e) => setBriefText(e.target.value)}
                  placeholder="例如：优先找差评集中在异响、难清洗或安装不牢的微改良机会。"
                />
              </div>
            </div>
            <div className="form-actions">
              <span className="help">AI 仅按你的硬约束生成待验证方向，进入候选看板后用搜索页 Top 20 快筛。</span>
              <button type="submit" className="button primary">生成候选方向并进入看板</button>
            </div>
          </form>
        </section>
      ) : (
        /* 分支 B：核心 3 步极简选品闯关向导 */
        <section className="section wizard-shell wizard-panel-anchor" id="wizard-panel">
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
                onPointerDown={capturePointerViewport}
                onClick={() => keepViewportOnStateChange(() => setStep(item.id))}
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

          {eliminationAlerts.length > 0 ? (
            <div className="notice warn funnel-history-alert" style={{ marginBottom: 14 }} role="status">
              <strong>避坑提醒：历史曾淘汰过相似方向</strong>
              <div className="funnel-history-alert-list">
                {eliminationAlerts.map(({ record }) => (
                  <span key={record.id}>
                    「{record.concept}」于 {shortDate(record.eliminatedAt)} 因 <strong>{record.eliminationReason}</strong> 淘汰
                    {record.eliminationNote ? `（${record.eliminationNote}）` : ""}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

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
                    <a href={search1688Url} target="_blank" rel="noreferrer" className="button secondary">
                      打开 1688 搜同款查底价
                    </a>
                    <form action={createQuickCandidateAction} style={{ display: "inline-flex", gap: 6 }}>
                      <input type="hidden" name="marketCode" value={marketCode} />
                      <input type="hidden" name="platformCode" value={platformCode} />
                      <input type="hidden" name="category" value={category} />
                      <input type="hidden" name="concept" value={productTitle.trim() || activeReport?.title || `${category} 候选`} />
                      <input type="hidden" name="sourceKind" value={activeReport ? "asin_scan" : "quick_calc"} />
                      {activeReport ? <input type="hidden" name="comparisonReportId" value={activeReport.id} /> : null}
                      <input type="hidden" name="confirmedPrice" value={targetPrice} />
                      <input type="hidden" name="referenceFactoryCostRmb" value={factoryCostRmb} />
                      {complianceAttrs.map((a) => (
                        <input key={a} type="hidden" name="complianceAttr" value={a} />
                      ))}
                      <button type="submit" className="button secondary">
                        写入候选看板
                      </button>
                      {economics.marginRate < 0.18 || economics.stressProfitCents <= 0 ? (
                        <button
                          type="submit"
                          name="eliminationReason"
                          value={ELIMINATION_REASONS[2]}
                          className="button ghost"
                        >
                          利润不够·记入淘汰
                        </button>
                      ) : null}
                    </form>
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

                <div className="notice" style={{ marginBottom: 14 }}>
                  <span className="badge badge-neutral">交付边界</span>
                  <span>立项后系统会继续推进报价、定标、文案视觉与交付资料；最终上架仍需在卖家后台手动完成，系统不会自动发布商品。</span>
                </div>

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
                    <span>估算快筛净利率 / 门禁建议</span>
                    <strong className="mono">
                      {percent(economics.marginRate)} · {verdict}（估算快筛）
                    </strong>
                  </div>
                </div>

                {needsNoGoException ? (
                  <div className="notice warn" style={{ marginTop: 12, display: "block" }}>
                    <div style={{ marginBottom: 8 }}>
                      <span className="badge recommendation-no-go">NO-GO 拦截</span>{" "}
                      <strong>当前利润或压测不达标，普通路径已停止。</strong>
                      如确需例外创建待验证案卷，请完整填写例外原因、风险说明与审批人（将写入独立审计 `case.exception_created`）：
                    </div>
                    <div className="form-grid" style={{ marginTop: 8 }}>
                      <div className="field">
                        <label htmlFor="wizardExceptionReason">例外原因 *</label>
                        <input
                          id="wizardExceptionReason"
                          type="text"
                          value={exceptionReason}
                          onChange={(e) => setExceptionReason(e.target.value)}
                          placeholder="说明为何在 NO-GO 下继续验证"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor="wizardExceptionApprover">审批人 *</label>
                        <input
                          id="wizardExceptionApprover"
                          type="text"
                          value={exceptionApprover}
                          onChange={(e) => setExceptionApprover(e.target.value)}
                          placeholder="审批负责人姓名"
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor="wizardExceptionRisk">风险说明与止损条件 *</label>
                        <textarea
                          id="wizardExceptionRisk"
                          value={exceptionRiskNote}
                          onChange={(e) => setExceptionRiskNote(e.target.value)}
                          placeholder="说明最大亏损边界与拿样后的退出条件"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                <label className="compliance-check-label" style={{ marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={patentConfirmed}
                    onChange={(e) => setPatentConfirmed(e.target.checked)}
                  />
                  <span>我已知晓当前为「估算快筛」，服务端将按门禁自动分流为待验证或正式推进案卷</span>
                </label>

                <div className="wizard-actions-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="button primary"
                    disabled={
                      isCreating ||
                      !patentConfirmed ||
                      (needsNoGoException && (!exceptionReason.trim() || !exceptionRiskNote.trim() || !exceptionApprover.trim()))
                    }
                    onClick={handlePromoteCase}
                  >
                    {isCreating
                      ? "正在服务端重算并创建案卷…"
                      : needsNoGoException
                        ? "提交 NO-GO 例外审批并创建待验证案卷"
                        : verdict === "GO" && Boolean(activeReport?.competitors?.length)
                          ? "创建正式推进案卷"
                          : "创建待验证案卷（估算快筛）"}
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
