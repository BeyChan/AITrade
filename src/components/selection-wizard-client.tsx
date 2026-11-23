"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { runCompetitorAnalysisAction } from "@/app/competitors/actions";
import {
  createAISourcingBatchAction,
  createQuickCandidateAction,
  saveSourcingConstraintsAction,
} from "@/app/actions";
import { CategoryRecommender } from "@/components/category-recommender";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import { moneyIn, shortDate } from "@/lib/format";
import {
  COMPLIANCE_ATTRIBUTE_OPTIONS,
  type ProductComplianceAttribute,
} from "@/lib/prelaunch-compliance";
import {
  DEFAULT_SOURCING_CONSTRAINTS,
  findEliminationMatches,
  type CustomExclusionItem,
  type EliminatedHistoryRecord,
  type SourcingConstraints,
} from "@/lib/sourcing-funnel";

type EntryMode = "ai" | "competitor" | "sourcing";

type Props = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
  currency: string;
  requestKey: string;
  siteReports?: CompetitorComparisonReport[];
  initialReportId?: string;
  initialEntryMode?: EntryMode;
  initialConstraints?: SourcingConstraints;
  eliminatedHistory?: EliminatedHistoryRecord[];
};

export function SelectionWizardClient({
  marketCode,
  marketName,
  platformCode,
  platformName,
  currency,
  requestKey,
  siteReports = [],
  initialReportId = "",
  initialEntryMode = "ai",
  initialConstraints = DEFAULT_SOURCING_CONSTRAINTS,
  eliminatedHistory = [],
}: Props) {
  const [entryMode, setEntryMode] = useState<EntryMode>(initialEntryMode);

  // 分支 1：AI 找方向约束
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

  // 分支 2：我有竞品链接
  const [selectedReportId, setSelectedReportId] = useState(initialReportId);
  const [rawCompetitors, setRawCompetitors] = useState("");
  const [compTitle, setCompTitle] = useState("");
  const [compCategory, setCompCategory] = useState("跨境精品");
  const [compError, setCompError] = useState<string | null>(null);
  const [isAnalyzing, startAnalyze] = useTransition();

  // 分支 3：我有货源成本
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceCategory, setSourceCategory] = useState("跨境精品");
  const [sourceTargetPrice, setSourceTargetPrice] = useState("32.99");
  const [sourceFactoryRmb, setSourceFactoryRmb] = useState("32");

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

  const selectedReport = useMemo(
    () => siteReports.find((r) => r.id === selectedReportId) ?? null,
    [siteReports, selectedReportId],
  );

  const eliminationAlerts = useMemo(() => {
    const query =
      entryMode === "ai"
        ? briefText
        : entryMode === "competitor"
          ? `${compTitle} ${selectedReport?.title ?? ""} ${rawCompetitors}`
          : sourceTitle;
    const cat =
      entryMode === "competitor"
        ? compCategory
        : entryMode === "sourcing"
          ? sourceCategory
          : "";
    return findEliminationMatches(query, cat, eliminatedHistory);
  }, [entryMode, briefText, compTitle, selectedReport, rawCompetitors, sourceTitle, compCategory, sourceCategory, eliminatedHistory]);

  function handleAnalyzeAndCreateCandidate(e: React.FormEvent) {
    e.preventDefault();
    setCompError(null);
    if (!rawCompetitors.trim() && !selectedReportId) {
      setCompError("请粘贴至少 1 个竞品链接/ASIN，或选择一份已有竞品研报。");
      return;
    }

    startAnalyze(async () => {
      let reportId = selectedReportId;
      let conceptTitle = compTitle.trim();
      let p50PriceStr = "";

      if (rawCompetitors.trim()) {
        const fd = new FormData();
        fd.set("rawInputs", rawCompetitors);
        fd.set("marketCode", marketCode);
        fd.set("platformCode", platformCode);
        fd.set("currency", currency);
        const res = await runCompetitorAnalysisAction(fd);
        if (!res.success || !res.report) {
          setCompError(res.error || "竞品分析失败，请检查链接或 ASIN 格式");
          return;
        }
        reportId = res.report.id;
        if (!conceptTitle) conceptTitle = res.report.title;
        if (res.report.priceStats.p50 > 0) {
          p50PriceStr = (res.report.priceStats.p50 / 100).toFixed(2);
        }
      } else if (selectedReport) {
        if (!conceptTitle) conceptTitle = selectedReport.title;
        if (selectedReport.priceStats.p50 > 0) {
          p50PriceStr = (selectedReport.priceStats.p50 / 100).toFixed(2);
        }
      }

      const submitFd = new FormData();
      submitFd.set("marketCode", marketCode);
      submitFd.set("platformCode", platformCode);
      submitFd.set("category", compCategory.trim() || "跨境精品");
      submitFd.set("concept", conceptTitle || "竞品对标候选");
      submitFd.set("sourceKind", "asin_scan");
      if (reportId) submitFd.set("comparisonReportId", reportId);
      if (p50PriceStr) submitFd.set("confirmedPrice", p50PriceStr);
      submitFd.set("targetTab", "profit");
      submitFd.set("actor", "选品负责人");
      await createQuickCandidateAction(submitFd);
    });
  }

  return (
    <div className="stack selection-wizard-root">
      {/* 3 个并列起点（三选一，非顺序步骤）：全部落入同一套 4 步选品工作台 */}
      <section
        className="wizard-entry-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        aria-label="选择建品起点（三选一）"
      >
        <button
          type="button"
          aria-pressed={entryMode === "ai"}
          className={`wizard-entry-card${entryMode === "ai" ? " is-active" : ""}`}
          onClick={() => setEntryMode("ai")}
        >
          <span className="wizard-entry-num" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3 1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3Z" />
            </svg>
          </span>
          <span className="wizard-entry-body">
            <strong>让 AI 找方向</strong>
            <span className="wizard-entry-description">还没定品：输入类目与约束，生成 5 个候选进入看板</span>
          </span>
        </button>

        <button
          type="button"
          aria-pressed={entryMode === "competitor"}
          className={`wizard-entry-card${entryMode === "competitor" ? " is-active" : ""}`}
          onClick={() => setEntryMode("competitor")}
        >
          <span className="wizard-entry-num" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          <span className="wizard-entry-body">
            <strong>我有竞品链接</strong>
            <span className="wizard-entry-description">贴 ASIN 或选已有研报，建候选后直达第 2 步算毛利</span>
          </span>
        </button>

        <button
          type="button"
          aria-pressed={entryMode === "sourcing"}
          className={`wizard-entry-card${entryMode === "sourcing" ? " is-active" : ""}`}
          onClick={() => setEntryMode("sourcing")}
        >
          <span className="wizard-entry-num" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </span>
          <span className="wizard-entry-body">
            <strong>我有货源成本</strong>
            <span className="wizard-entry-description">填 1688 拿货价与售价，建候选后直达第 2 步核 18% 门禁</span>
          </span>
        </button>
      </section>

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

      {/* 入口 1：让 AI 找方向 */}
      {entryMode === "ai" ? (
        <section className="section wizard-panel-anchor" id="ai-brainstorm-panel">
          <div className="section-header">
            <div>
              <h2>AI 类目机会发散（{marketName}站 · {platformName}）</h2>
              <p>输入想做的类目与硬约束，AI 生成 5 个待验证候选，全部进入统一选品工作台。</p>
            </div>
            <div className="button-row">
              <Link
                href={`/import?market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
                className="button funnel-import-cta"
              >
                <span>批量导入 CSV</span>
              </Link>
            </div>
          </div>

          <form action={createAISourcingBatchAction} className="stack">
            <input type="hidden" name="marketCode" value={marketCode} />
            <input type="hidden" name="platformCode" value={platformCode} />
            <input type="hidden" name="requestKey" value={requestKey} />
            <input type="hidden" name="actor" value="选品负责人" />

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
                  <label>直接排除项（命中即自动过滤，记忆上次偏好）</label>
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
                        if (isEditingExclusions) persistConstraints({});
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
                            onChange={(e) => setAttrLabelOverrides({ ...attrLabelOverrides, [opt.id]: e.target.value })}
                            onBlur={() => persistConstraints({ attrLabelOverrides })}
                          />
                          <button
                            type="button"
                            className="funnel-compliance-pill-remove"
                            title="删除此排除项"
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
              <span className="help">生成后自动进入 4 步选品工作台。</span>
              <button type="submit" className="button primary">生成候选方向并进入工作台</button>
            </div>
          </form>
        </section>
      ) : null}

      {/* 入口 2：我有竞品链接 */}
      {entryMode === "competitor" ? (
        <section className="section wizard-panel-anchor" id="competitor-entry-panel">
          <div className="section-header">
            <div>
              <h2>从竞品链接建立候选（{marketName}站 · {platformName}）</h2>
              <p>粘贴 1–4 个竞品链接或直接选用已有竞品研报，创建候选后自动带入中位售价与差评痛点，进入第 2 步利润测算。</p>
            </div>
            <Link href="/competitors" className="button ghost compact-button">
              去竞品研报库
            </Link>
          </div>

          <form onSubmit={handleAnalyzeAndCreateCandidate} className="stack">
            {compError ? <div className="notice danger">{compError}</div> : null}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="compTitle">候选商品名称（选填，留空自动用研报标题）</label>
                <input
                  id="compTitle"
                  type="text"
                  value={compTitle}
                  onChange={(e) => setCompTitle(e.target.value)}
                  placeholder="例如：双层可抽拉水槽下收纳架"
                />
              </div>
              <div className="field">
                <label htmlFor="compCategory">类目</label>
                <input
                  id="compCategory"
                  type="text"
                  value={compCategory}
                  onChange={(e) => setCompCategory(e.target.value)}
                  placeholder="例如：家居收纳"
                />
              </div>

              {siteReports.length > 0 ? (
                <div className="field full">
                  <label htmlFor="existingReport">或直接关联一份已有竞品研报</label>
                  <select
                    id="existingReport"
                    value={selectedReportId}
                    onChange={(e) => setSelectedReportId(e.target.value)}
                  >
                    <option value="">-- 新粘贴竞品链接（不选用已有研报） --</option>
                    {siteReports.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title}（{r.competitors.length} 款竞品 · P50 {moneyIn(r.currency, r.priceStats.p50)}）
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="field full">
                <label htmlFor="rawCompetitors">粘贴 1–4 个竞品链接或 ASIN（每行一个）</label>
                <textarea
                  id="rawCompetitors"
                  rows={4}
                  value={rawCompetitors}
                  onChange={(e) => setRawCompetitors(e.target.value)}
                  placeholder={"https://www.amazon.com/dp/B08CZ8K652\nhttps://www.amazon.com/dp/B09M87J11L"}
                />
                <span className="help">
                  提示：也可在亚马逊搜索页点击 Chrome 扩展「AITrade 竞品采集」一键抓取 Top 20，再在上方下拉框直接选用。
                </span>
              </div>
            </div>

            <div className="form-actions">
              <span className="help">创建后将自动挂接竞品数据，并跳转至工作台第 2 步算 18% 毛利。</span>
              <button type="submit" className="button primary" disabled={isAnalyzing}>
                {isAnalyzing ? "正在分析竞品并建候选..." : "分析竞品并进入选品工作台 →"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {/* 入口 3：我有货源成本 */}
      {entryMode === "sourcing" ? (
        <section className="section wizard-panel-anchor" id="sourcing-entry-panel">
          <div className="section-header">
            <div>
              <h2>从 1688 / 工厂货源建立候选（{marketName}站 · {platformName}）</h2>
              <p>已有货源拿货价时，先录入基础成本建候选，直接跳进工作台第 2 步测算 18% 毛利硬门禁。</p>
            </div>
          </div>

          <form action={createQuickCandidateAction} className="stack">
            <input type="hidden" name="marketCode" value={marketCode} />
            <input type="hidden" name="platformCode" value={platformCode} />
            <input type="hidden" name="sourceKind" value="quick_calc" />
            <input type="hidden" name="targetTab" value="profit" />
            <input type="hidden" name="actor" value="选品负责人" />

            <div className="form-grid">
              <div className="field">
                <label htmlFor="sourceTitle">商品名称 *</label>
                <input
                  id="sourceTitle"
                  name="concept"
                  type="text"
                  required
                  value={sourceTitle}
                  onChange={(e) => setSourceTitle(e.target.value)}
                  placeholder="例如：静音不锈钢宠物饮水器"
                />
              </div>
              <div className="field">
                <label htmlFor="sourceCategory">类目</label>
                <input
                  id="sourceCategory"
                  name="category"
                  type="text"
                  value={sourceCategory}
                  onChange={(e) => setSourceCategory(e.target.value)}
                  placeholder="例如：宠物用品"
                />
              </div>
              <div className="field">
                <label htmlFor="sourceTargetPrice">拟定售价 ({currency}) *</label>
                <input
                  id="sourceTargetPrice"
                  name="confirmedPrice"
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={sourceTargetPrice}
                  onChange={(e) => setSourceTargetPrice(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="sourceFactoryRmb">1688 参考拿货价 (RMB ¥) *</label>
                <input
                  id="sourceFactoryRmb"
                  name="referenceFactoryCostRmb"
                  type="number"
                  min="0.1"
                  step="0.1"
                  required
                  value={sourceFactoryRmb}
                  onChange={(e) => setSourceFactoryRmb(e.target.value)}
                />
              </div>
            </div>

            <div className="form-actions">
              <span className="help">创建后直接进入第 2 步「利润测算」核 18% 硬门禁，后续随时补采竞品或打样。</span>
              <button type="submit" className="button primary">
                建候选并去算 18% 毛利 →
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
