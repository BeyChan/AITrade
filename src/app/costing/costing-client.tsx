"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  attachCostSheetAction,
  confirmCostSheetAction,
  createCostSheetVersionAction,
  createHypothesisFromCostSheetAction,
  saveAndConfirmCostSheetAction,
  saveCostSheetAction,
} from "./actions";
import {
  calculateEconomics,
  calculateMaxPurchasePriceCents,
  calculateTargetLandedCost,
} from "@/lib/economics";
import type { CostSheet, CostSheetAssumptions } from "@/lib/cost-sheets-repository";
import { moneyIn, percent, shortDate } from "@/lib/format";

type SiteOption = { code: string; name: string; currency?: string };
export type CostingCandidateContext = {
  id: string;
  concept: string;
  runId: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  costSheetId: string | null;
};

type CostFormState = {
  title: string;
  productTitle: string;
  marketCode: string;
  platformCode: string;
  currency: string;
  salePrice: string;
  purchasePrice: string;
  freightPerUnit: string;
  dutyRate: string;
  fbaFee: string;
  referralRate: string;
  adRate: string;
  returnRate: string;
  returnProcessing: string;
  returnRecoveryRate: string;
  coupon: string;
  storage: string;
  otherCost: string;
  oneTimeFixedCost: string;
  initialOrderUnits: string;
};

type Props = {
  sheet: CostSheet | null;
  hypothesis: CostingCandidateContext | null;
  markets: SiteOption[];
  platforms: SiteOption[];
  initialForm: CostFormState;
  sheets: CostSheet[];
  confirmedSheets: CostSheet[];
  actor: string;
  demoMode: boolean;
};

function cents(value: string) {
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function rate(value: string) {
  const parsed = Number(String(value).replace(/%/g, ""));
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed / 100)) : 0;
}

function toForm(sheet: CostSheet): CostFormState {
  const a = sheet.assumptions;
  return {
    title: sheet.title,
    productTitle: a.productTitle ?? sheet.title,
    marketCode: sheet.marketCode,
    platformCode: sheet.platformCode,
    currency: sheet.currency,
    salePrice: (a.salePriceCents / 100).toFixed(2),
    purchasePrice: (a.purchasePriceCents / 100).toFixed(2),
    freightPerUnit: (a.freightPerUnitCents / 100).toFixed(2),
    dutyRate: (a.dutyRate * 100).toFixed(2),
    fbaFee: (a.fbaFeeCents / 100).toFixed(2),
    referralRate: (a.referralRate * 100).toFixed(2),
    adRate: (a.adRate * 100).toFixed(2),
    returnRate: (a.returnRate * 100).toFixed(2),
    returnProcessing: (a.returnProcessingCents / 100).toFixed(2),
    returnRecoveryRate: (a.returnRecoveryRate * 100).toFixed(2),
    coupon: (a.couponCents / 100).toFixed(2),
    storage: (a.storageCents / 100).toFixed(2),
    otherCost: (a.otherCostCents / 100).toFixed(2),
    oneTimeFixedCost: ((a.oneTimeFixedCostCents ?? 0) / 100).toFixed(2),
    initialOrderUnits: String(a.initialOrderUnits ?? 0),
  };
}

function buildAssumptions(form: CostFormState): CostSheetAssumptions {
  const purchasePriceCents = cents(form.purchasePrice);
  const freightPerUnitCents = cents(form.freightPerUnit);
  const dutyRate = rate(form.dutyRate);
  const taxable = purchasePriceCents + freightPerUnitCents;
  return {
    productTitle: form.productTitle,
    marketCode: form.marketCode,
    platformCode: form.platformCode,
    currency: form.currency,
    salePriceCents: Math.max(1, cents(form.salePrice)),
    purchasePriceCents,
    freightPerUnitCents,
    dutyRate,
    landedCostCents: taxable + Math.round(taxable * dutyRate),
    fbaFeeCents: cents(form.fbaFee),
    referralRate: rate(form.referralRate),
    adRate: rate(form.adRate),
    returnRate: rate(form.returnRate),
    returnProcessingCents: cents(form.returnProcessing),
    returnRecoveryRate: rate(form.returnRecoveryRate),
    couponCents: cents(form.coupon),
    storageCents: cents(form.storage),
    otherCostCents: cents(form.otherCost),
    oneTimeFixedCostCents: cents(form.oneTimeFixedCost),
    initialOrderUnits: Math.max(0, Math.round(Number(form.initialOrderUnits) || 0)),
  };
}

function Field({
  id,
  label,
  value,
  onChange,
  suffix,
  min = "0",
  step = "0.01",
  required = false,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  min?: string;
  step?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}{required ? " *" : ""}</label>
      <div className={`field-control${suffix ? " has-suffix" : ""}`}>
        <input
          id={id}
          name={id}
          type="number"
          min={min}
          step={step}
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <span className="field-suffix">{suffix}</span> : null}
      </div>
      {hint ? <span className="help">{hint}</span> : null}
    </div>
  );
}

export function CostingClient({
  sheet,
  hypothesis,
  markets,
  platforms,
  initialForm,
  sheets,
  confirmedSheets,
  actor,
  demoMode,
}: Props) {
  const [form, setForm] = useState<CostFormState>(() => (sheet ? toForm(sheet) : initialForm));
  const set = (key: keyof CostFormState) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const assumptions = useMemo(() => buildAssumptions(form), [form]);
  const economics = useMemo(() => calculateEconomics(assumptions), [assumptions]);
  const target = useMemo(
    () => calculateTargetLandedCost({ ...assumptions, targetMarginRate: 0.18 }),
    [assumptions],
  );
  const maxPurchase = useMemo(
    () => calculateMaxPurchasePriceCents(target.maxLandedCostCents, assumptions.freightPerUnitCents, assumptions.dutyRate),
    [assumptions.dutyRate, assumptions.freightPerUnitCents, target.maxLandedCostCents],
  );
  const isConfirmed = sheet?.status === "confirmed";
  const latestForGroup = sheet ? sheets.filter((item) => item.groupId === sheet.groupId).sort((a, b) => b.version - a.version)[0] : null;
  const isLatest = !sheet || latestForGroup?.id === sheet.id;
  const isBound = Boolean(sheet && hypothesis?.costSheetId === sheet.id);
  const passesGate = economics.marginRate >= 0.18 && economics.stressProfitCents > 0;
  const marketCurrency = markets.find((item) => item.code === form.marketCode)?.currency;
  const bindableSheets = useMemo(() => {
    if (!demoMode) return confirmedSheets;
    const latestByGroup = new Map<string, CostSheet>();
    for (const item of sheets) {
      const current = latestByGroup.get(item.groupId);
      if (!current || item.version > current.version) latestByGroup.set(item.groupId, item);
    }
    return [...latestByGroup.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [confirmedSheets, demoMode, sheets]);
  const newCandidateSheetHref = hypothesis
    ? `/costing?${new URLSearchParams({
        hypothesisId: hypothesis.id,
        market: hypothesis.marketCode,
        platform: hypothesis.platformCode,
      }).toString()}`
    : "/costing";

  return (
    <div className="stack" style={{ gap: 18 }}>
      {hypothesis ? (
        <div className="notice info">
          <strong>正在为候选「{hypothesis.concept}」核算成本</strong>
          <span>{isBound
            ? `当前核算单 V${sheet?.version} 已绑定此候选。`
            : hypothesis.costSheetId
              ? demoMode
                ? "当前候选已绑定其他核算单；演示模式保存或选择新单后会自动确认并替换原关联。"
                : "当前候选已绑定其他核算单；这里的新单在人工确认后会自动绑定并替换原关联。"
              : demoMode
                ? "站点、平台和币种已按候选锁定。演示模式可保存后一键确认并绑定，无需分两步操作。"
                : "站点、平台和币种已按候选锁定。保存草稿不会建立绑定；人工确认后会自动绑定到当前候选。"}</span>
        </div>
      ) : null}

      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.65fr) minmax(280px, .85fr)", gap: 1, background: "var(--border)" }}>
          <div style={{ background: "var(--surface)", padding: 22 }}>
            <div className="section-header" style={{ marginBottom: 16 }}>
              <div>
                <span className="eyebrow">成本核算单</span>
                <h2 style={{ marginBottom: 4 }}>{sheet ? `V${sheet.version} · ${sheet.title}` : "新建核算单"}</h2>
                <p>{sheet ? `${sheet.status === "confirmed" ? "已确认" : "草稿"} · 更新于 ${shortDate(sheet.updatedAt)}` : "先算清单件经济账，再决定是否进入候选和立项。"}</p>
              </div>
              {sheet ? (
                <span className={`badge ${isConfirmed ? "badge-success" : "badge-neutral"}`}>
                  {isConfirmed ? "已人工确认" : "草稿"}
                </span>
              ) : null}
            </div>

            <form action={saveCostSheetAction} className="stack">
              <input type="hidden" name="sheetId" value={sheet?.id ?? ""} />
              <input type="hidden" name="hypothesisId" value={hypothesis?.id ?? ""} />
              <input type="hidden" name="runId" value={hypothesis?.runId ?? ""} />
              <input type="hidden" name="actor" value={actor} />
              <input type="hidden" name="title" value={form.title} />
              <input type="hidden" name="productTitle" value={form.productTitle} />

              <div className="form-grid">
                <input type="hidden" name="marketCode" value={form.marketCode} />
                <input type="hidden" name="platformCode" value={form.platformCode} />
                <input type="hidden" name="currency" value={form.currency} />
                <div className="field">
                  <label htmlFor="marketCode">站点</label>
                  <select
                    id="marketCode"
                    value={form.marketCode}
                    disabled={Boolean(hypothesis)}
                    onChange={(event) => {
                      const next = event.target.value;
                      const currency = markets.find((item) => item.code === next)?.currency || form.currency;
                      setForm((current) => ({ ...current, marketCode: next, currency }));
                    }}
                  >
                    {markets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="platformCode">平台</label>
                  <select
                    id="platformCode"
                    value={form.platformCode}
                    disabled={Boolean(hypothesis)}
                    onChange={(event) => set("platformCode")(event.target.value)}
                  >
                    {platforms.map((platform) => <option key={platform.code} value={platform.code}>{platform.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="currency">币种</label>
                  <input id="currency" value={form.currency} readOnly />
                  <span className="help">{hypothesis ? "沿用候选站点，避免绑定口径不一致。" : "随站点自动带出，所有金额均按该币种录入。"}</span>
                </div>
                <div className="field">
                  <label htmlFor="productTitleInput">商品名称 / 标题 *</label>
                  <input
                    id="productTitleInput"
                    name="productTitleInput"
                    value={form.productTitle}
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      productTitle: event.target.value,
                      title: current.title === current.productTitle ? event.target.value : current.title,
                    }))}
                    placeholder="例如：静音不锈钢宠物饮水器"
                    required
                  />
                </div>
              </div>

              <div>
                <h3 style={{ margin: "8px 0 12px" }}>收入与到岸成本</h3>
                <div className="form-grid">
                  <Field id="salePrice" label="售价" value={form.salePrice} onChange={set("salePrice")} suffix={form.currency} required />
                  <Field id="purchasePrice" label="采购价" value={form.purchasePrice} onChange={set("purchasePrice")} suffix={form.currency} required />
                  <Field id="freightPerUnit" label="头程 / 单件" value={form.freightPerUnit} onChange={set("freightPerUnit")} suffix={form.currency} />
                  <Field id="dutyRate" label="关税税率" value={form.dutyRate} onChange={set("dutyRate")} suffix="%" step="0.1" />
                  <Field id="fbaFee" label="平台履约费" value={form.fbaFee} onChange={set("fbaFee")} suffix={form.currency} />
                  <Field id="referralRate" label="平台佣金率" value={form.referralRate} onChange={set("referralRate")} suffix="%" step="0.1" />
                  <Field id="adRate" label="广告费率" value={form.adRate} onChange={set("adRate")} suffix="%" step="0.1" />
                  <Field id="returnRate" label="退货率" value={form.returnRate} onChange={set("returnRate")} suffix="%" step="0.1" />
                  <Field id="returnProcessing" label="单件退货处理费" value={form.returnProcessing} onChange={set("returnProcessing")} suffix={form.currency} />
                  <Field id="returnRecoveryRate" label="退货回收率" value={form.returnRecoveryRate} onChange={set("returnRecoveryRate")} suffix="%" step="0.1" />
                  <Field id="coupon" label="优惠 / 券" value={form.coupon} onChange={set("coupon")} suffix={form.currency} />
                  <Field id="storage" label="仓储费" value={form.storage} onChange={set("storage")} suffix={form.currency} />
                  <Field id="otherCost" label="其他单件成本" value={form.otherCost} onChange={set("otherCost")} suffix={form.currency} />
                  <Field id="oneTimeFixedCost" label="一次性固定投入" value={form.oneTimeFixedCost} onChange={set("oneTimeFixedCost")} suffix={form.currency} hint="认证、开模、专利检索等" />
                  <Field id="initialOrderUnits" label="首批数量" value={form.initialOrderUnits} onChange={set("initialOrderUnits")} suffix="件" min="0" step="1" />
                </div>
              </div>

              <div className="button-row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <div className="button-row">
                  <button type="submit" className="button primary">保存草稿</button>
                  {sheet ? (
                    <button type="submit" formAction={createCostSheetVersionAction} className="button secondary">
                      生成新版本
                    </button>
                  ) : null}
                  {sheet && !isConfirmed ? (
                    demoMode ? (
                      <button
                        type="submit"
                        formAction={confirmCostSheetAction}
                        className="button secondary"
                        title="演示模式：保存当前参数、确认核算单，并自动绑定当前候选"
                      >
                        {hypothesis ? "保存、确认并绑定" : "保存并确认"}
                      </button>
                    ) : (
                      <button type="submit" formAction={confirmCostSheetAction} className="button secondary">
                        确认核算单
                      </button>
                    )
                  ) : null}
                  {demoMode && !sheet ? (
                    <button
                      type="submit"
                      formAction={saveAndConfirmCostSheetAction}
                      className="button secondary"
                      title={hypothesis ? "演示模式：保存核算单、完成确认并直接绑定当前候选" : "演示模式：保存并确认核算单"}
                    >
                      {hypothesis ? "保存、确认并绑定" : "保存并确认"}
                    </button>
                  ) : null}
                </div>
                <Link
                  href={newCandidateSheetHref}
                  className="button ghost"
                >
                  {hypothesis ? "新建另一张并绑定" : "新建另一张核算单"}
                </Link>
              </div>
              {isConfirmed ? <p className="help" style={{ margin: 0 }}>已确认版本不可覆盖；调整参数请生成新版本，旧版会保留审计记录。</p> : null}
              {demoMode && !isConfirmed ? <p className="help" style={{ margin: 0 }}>演示模式会跳过人工确认与二次绑定；正式模式仍要求人工确认。</p> : null}
            </form>
          </div>

          <aside style={{ background: "var(--surface-2)", padding: 22 }}>
            <span className="eyebrow">18% 门禁实时结果</span>
            <div style={{ marginTop: 14, padding: 18, borderRadius: 14, background: passesGate ? "rgba(22,163,74,.08)" : "rgba(220,38,38,.08)" }}>
              <span className={`badge ${passesGate ? "badge-success" : "badge-danger"}`}>{passesGate ? "通过门禁" : "未通过门禁"}</span>
              <strong style={{ display: "block", fontSize: 34, marginTop: 12 }}>{percent(economics.marginRate)}</strong>
              <span className="muted">净利润 {moneyIn(form.currency, economics.netProfitCents)}</span>
            </div>
            <div className="stack" style={{ gap: 10, marginTop: 16 }}>
              <div><span className="muted">净营收</span><strong style={{ float: "right" }}>{moneyIn(form.currency, economics.netRevenueCents)}</strong></div>
              <div><span className="muted">压测净利</span><strong style={{ float: "right" }}>{moneyIn(form.currency, economics.stressProfitCents)}</strong></div>
              <div><span className="muted">压测净利率</span><strong style={{ float: "right" }}>{percent(economics.stressMarginRate)}</strong></div>
              <div><span className="muted">最高可接受到岸成本</span><strong style={{ float: "right" }}>{moneyIn(form.currency, target.maxLandedCostCents)}</strong></div>
              <div><span className="muted">最高采购价</span><strong style={{ float: "right" }}>{moneyIn(form.currency, maxPurchase)}</strong></div>
              <div><span className="muted">当前到岸成本</span><strong style={{ float: "right" }}>{moneyIn(form.currency, economics.landedCostCents)}</strong></div>
            </div>
            {marketCurrency && marketCurrency !== form.currency ? (
              <p className="help">站点币种为 {marketCurrency}，当前核算币种为 {form.currency}，请确认换算口径。</p>
            ) : null}
            <p className="help">门禁规则：基准净利率 ≥18%，且压测净利 &gt;0；正式 GO 还要求核算单已确认、为最新版本，并补齐研报、报价和风险证据。</p>
          </aside>
        </div>
      </section>

      {!hypothesis && sheet && isConfirmed && isLatest ? (
        <section className="section">
          <div className="section-header">
            <div>
              <span className="eyebrow">下一动作</span>
              <h2>从已确认核算单建立候选</h2>
              <p>候选会复用本单售价与成本口径，但仍需补齐竞品研报、供应商报价和风险核验后才能正式立项。</p>
            </div>
          </div>
          <form action={createHypothesisFromCostSheetAction} className="form-grid">
            <input type="hidden" name="sheetId" value={sheet.id} />
            <input type="hidden" name="actor" value={actor} />
            <div className="field">
              <label htmlFor="candidateConcept">候选名称</label>
              <input id="candidateConcept" name="concept" defaultValue={form.productTitle} />
            </div>
            <div className="field">
              <label htmlFor="candidateCategory">类目</label>
              <input id="candidateCategory" name="category" placeholder="例如：宠物用品" />
            </div>
            <div className="field" style={{ alignSelf: "end" }}>
              <button type="submit" className="button primary">建立候选 →</button>
            </div>
          </form>
        </section>
      ) : sheet && isConfirmed && !isLatest ? (
        <div className="notice warn">该核算单已有更新版本，不能用于正式 GO。请打开最新版本或重新生成版本。</div>
      ) : null}

      {hypothesis && sheet && isConfirmed && isLatest ? (
        <section className="section">
          <div className="section-header">
            <div>
              <span className="eyebrow">候选绑定</span>
              <h2>{isBound ? "当前候选已使用这张核算单" : "把这张核算单绑定到当前候选"}</h2>
              <p>{isBound
                ? "候选会直接读取本单的售价、成本与门禁结果。修改参数时请生成新版本，再重新绑定。"
                : "绑定后返回候选成本步骤，后续 GO 判定将使用本单的已确认版本。"}</p>
            </div>
          </div>
          {isBound ? (
            <div className="notice notice-success">
              <strong>已绑定当前候选</strong>
              <span>V{sheet.version} · {sheet.title} · 净利率 {percent(sheet.results.marginRate)}</span>
            </div>
          ) : (
            <form action={attachCostSheetAction} className="button-row">
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <input type="hidden" name="runId" value={hypothesis.runId} />
              <input type="hidden" name="costSheetId" value={sheet.id} />
              <input type="hidden" name="actor" value={actor} />
              <button type="submit" className="button primary">绑定到当前候选 →</button>
            </form>
          )}
        </section>
      ) : null}

      {!sheet && hypothesis ? (
        <section className="card" style={{ padding: 18 }}>
          <div className="button-row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>已有核算单？</strong>
              <p className="muted" style={{ margin: "4px 0 0" }}>
                {demoMode
                  ? "演示模式可选择最新核算单，草稿也会在绑定时自动确认。"
                  : "选择一张已确认且为最新版本的核算单，直接绑定到当前候选。"}
                {hypothesis.costSheetId ? " 绑定新单后会替换当前关联。" : ""}
              </p>
            </div>
            <form action={attachCostSheetAction} className="button-row">
              <input type="hidden" name="hypothesisId" value={hypothesis.id} />
              <input type="hidden" name="runId" value={hypothesis.runId} />
              <input type="hidden" name="actor" value={actor} />
              <select name="costSheetId" required defaultValue="">
                <option value="" disabled>选择核算单</option>
                {bindableSheets.map((item) => (
                  <option key={item.id} value={item.id}>
                    V{item.version} · {item.title} · {percent(item.results.marginRate)} · {item.status === "confirmed" ? "已确认" : "草稿"}
                  </option>
                ))}
              </select>
              <button type="submit" className="button secondary">绑定</button>
            </form>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-header">
          <div>
            <span className="eyebrow">核算档案</span>
            <h2>最近核算单</h2>
            <p>每张核算单独立保存；需要改价或改成本时生成新版本，避免覆盖历史判断。</p>
          </div>
        </div>
        {sheets.length === 0 ? (
          <div className="empty-state"><strong>还没有成本核算单</strong><span>填写上方参数并保存即可创建第一张。</span></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12 }}>
            {sheets.slice(0, 12).map((item) => (
              <Link
                href={`/costing?${new URLSearchParams({
                  id: item.id,
                  ...(hypothesis ? {
                    hypothesisId: hypothesis.id,
                    market: hypothesis.marketCode,
                    platform: hypothesis.platformCode,
                  } : {}),
                }).toString()}`}
                className="card"
                key={item.id}
                style={{ padding: 16, textDecoration: "none" }}
              >
                <div className="button-row" style={{ justifyContent: "space-between" }}>
                  <span className="badge badge-neutral">V{item.version}</span>
                  <span className={`badge ${item.status === "confirmed" ? "badge-success" : "badge-neutral"}`}>{item.status === "confirmed" ? "已确认" : "草稿"}</span>
                </div>
                <strong style={{ display: "block", marginTop: 10 }}>{item.title}</strong>
                <div className="button-row" style={{ justifyContent: "space-between", marginTop: 10 }}>
                  <span className="muted">{item.marketCode} · {item.platformCode}</span>
                  <strong style={{ color: item.results.marginRate >= 0.18 ? "var(--success)" : "var(--danger)" }}>{percent(item.results.marginRate)}</strong>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export type { CostFormState };
