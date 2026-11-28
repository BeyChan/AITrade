"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { convertReportToHypothesisAction } from "@/app/competitors/actions";
import { createHypothesisFromCostSheetAction } from "@/app/costing/actions";
import {
  createAISourcingBatchAction,
  saveSourcingConstraintsAction,
} from "@/app/actions";
import { CategoryRecommender } from "@/components/category-recommender";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import type { CostSheet } from "@/lib/cost-sheets-repository";
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
  requestKey: string;
  siteReports?: CompetitorComparisonReport[];
  confirmedCostSheets?: CostSheet[];
  initialReportId?: string;
  initialCostSheetId?: string;
  initialEntryMode?: EntryMode;
  initialConstraints?: SourcingConstraints;
  eliminatedHistory?: EliminatedHistoryRecord[];
};

export function SelectionWizardClient({
  marketCode,
  marketName,
  platformCode,
  platformName,
  requestKey,
  siteReports = [],
  confirmedCostSheets = [],
  initialReportId = "",
  initialCostSheetId = "",
  initialEntryMode = "ai",
  initialConstraints = DEFAULT_SOURCING_CONSTRAINTS,
  eliminatedHistory = [],
}: Props) {
  const router = useRouter();
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

  // 分支 2：从已确认竞品研报建立候选
  const [selectedReportId, setSelectedReportId] = useState(initialReportId);
  const [compError, setCompError] = useState<string | null>(null);
  const [isConverting, startConvert] = useTransition();

  // 分支 3：从已确认核算单建立候选
  const [selectedCostSheetId, setSelectedCostSheetId] = useState(
    initialCostSheetId || confirmedCostSheets[0]?.id || "",
  );

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
          ? selectedReport?.title ?? ""
          : confirmedCostSheets.find((sheet) => sheet.id === selectedCostSheetId)?.title ?? "";
    return findEliminationMatches(query, "", eliminatedHistory);
  }, [entryMode, briefText, selectedReport, confirmedCostSheets, selectedCostSheetId, eliminatedHistory]);

  function handleConvertReport(e: React.FormEvent) {
    e.preventDefault();
    setCompError(null);
    if (!selectedReportId) {
      setCompError("请选择一份已人工确认的竞品研报。");
      return;
    }

    startConvert(async () => {
      const result = await convertReportToHypothesisAction(selectedReportId);
      if (!result.success || !result.runId || !result.hypothesisId) {
        setCompError(result.error || "从研报建立候选失败");
        return;
      }
      router.push(
        `/ai-sourcing/${encodeURIComponent(result.runId)}?tab=profit&hypothesisId=${encodeURIComponent(result.hypothesisId)}`,
      );
    });
  }

  return (
    <div className="stack selection-wizard-root">
      {/* AI 是主入口；已确认研报与核算单只作为可追溯的次级建候选入口。 */}
      <section
        className="wizard-entry-grid"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        aria-label="选品入口"
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
            <strong>用研报建立候选</strong>
            <span className="wizard-entry-description">只选用人工核对过的竞品研报，P50 仅作为参考售价</span>
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
            <strong>用核算单建立候选</strong>
            <span className="wizard-entry-description">只选用已确认且为最新版本的核算单，直接复用其成本模型</span>
          </span>
        </button>

        <Link
          href={`/auto-pipeline?action=upload&market=${encodeURIComponent(marketCode)}&platform=${encodeURIComponent(platformCode)}`}
          className="wizard-entry-card"
          style={{ textDecoration: "none" }}
        >
          <span className="wizard-entry-num" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </span>
          <span className="wizard-entry-body">
            <strong>批量表 / 扩展快筛</strong>
            <span className="wizard-entry-description">进入选品初筛上传卖家精灵/H10 CSV，自动分级后采纳进看板</span>
          </span>
        </Link>
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

      {/* 入口 2：从已确认竞品研报建立候选 */}
      {entryMode === "competitor" ? (
        <section className="section wizard-panel-anchor" id="competitor-entry-panel">
          <div className="section-header">
            <div>
              <h2>选择一份已确认研报（{marketName}站 · {platformName}）</h2>
              <p>仅可选择已人工核对的研报。P50 仅作竞品参考，不进入正式利润门禁。</p>
            </div>
            <Link href="/competitors" className="button ghost compact-button">
              查看全部研报
            </Link>
          </div>

          {siteReports.length === 0 ? (
            <div className="empty-state">
              <strong>当前站点还没有已确认研报</strong>
              <span>请先到竞品研报库完成采集、分析并记录人工核对，再回来建立候选。</span>
            </div>
          ) : (
            <form onSubmit={handleConvertReport} className="stack">
            {compError ? <div className="notice danger">{compError}</div> : null}

            <div className="form-grid">
              <label className="field full">
                <span>已确认竞品研报</span>
                <select
                  value={selectedReportId}
                  onChange={(e) => setSelectedReportId(e.target.value)}
                  required
                >
                  <option value="">选择已确认研报</option>
                  {siteReports.map((report) => (
                    <option key={report.id} value={report.id}>
                      {report.title}（{report.competitors.length} 款竞品 · 参考 P50 {moneyIn(report.currency, report.priceStats.p50)}）
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="form-actions">
              <span className="help">建立后会挂接真实竞品与差评证据；正式 GO 需另行确认同范围成本核算单。</span>
              <button type="submit" className="button primary" disabled={isConverting || !selectedReportId}>
                {isConverting ? "正在建立候选..." : "用此研报建立候选 →"}
              </button>
            </div>
            </form>
          )}
        </section>
      ) : null}

      {/* 入口 3：从已确认核算单建立候选 */}
      {entryMode === "sourcing" ? (
        <section className="section wizard-panel-anchor" id="sourcing-entry-panel">
          <div className="section-header">
            <div>
              <h2>选择一张已确认核算单（{marketName}站 · {platformName}）</h2>
              <p>只展示人工确认且为同组最新版本的核算单；后续 GO 与正式立项会直接复用其假设和结果。</p>
            </div>
            <Link href="/costing" className="button ghost compact-button">查看全部核算单</Link>
          </div>

          {confirmedCostSheets.length === 0 ? (
            <div className="empty-state">
              <strong>当前站点还没有可用核算单</strong>
              <span>请先在成本核算页建立、确认最新版本，再回来建立候选。</span>
            </div>
          ) : (
            <form action={createHypothesisFromCostSheetAction} className="stack">
            <input type="hidden" name="actor" value="选品负责人" />
            <div className="stack">
              {confirmedCostSheets.map((sheet) => (
                <label
                  key={sheet.id}
                  className={`wizard-entry-card${selectedCostSheetId === sheet.id ? " is-active" : ""}`}
                  style={{ cursor: "pointer" }}
                >
                  <input
                    type="radio"
                    name="sheetId"
                    value={sheet.id}
                    checked={selectedCostSheetId === sheet.id}
                    onChange={() => setSelectedCostSheetId(sheet.id)}
                    required
                  />
                  <span className="wizard-entry-body">
                    <strong>{sheet.title}</strong>
                    <span className="wizard-entry-description">
                      V{sheet.version} · 确认人 {sheet.confirmedBy || "未记录"} · 净利率 {(sheet.results.marginRate * 100).toFixed(1)}% · 净利 {moneyIn(sheet.currency, sheet.results.netProfitCents)}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="form-actions">
              <span className="help">候选会绑定所选核算单；未确认、旧版本或净利率低于 18% 的核算单不能支持正式 GO。</span>
              <button type="submit" className="button primary" disabled={!selectedCostSheetId}>
                用此核算单建立候选 →
              </button>
            </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
