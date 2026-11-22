"use client";

import Link from "next/link";
import type { CompetitorComparisonReport } from "@/lib/competitor-compare/types";
import type { calculateEconomics } from "@/lib/economics";

type Props = {
  currentReport: CompetitorComparisonReport;
  costSource: "estimated" | "manual" | "captured_1688";
  quoteCostRmb: number;
  targetPriceVal: number;
  landedCostInCurr: number;
  estMarginRate: number;
  estNetProfit: number;
  calcOppScore: number;
  economics: ReturnType<typeof calculateEconomics>;
  promotedCaseId: string | null;
  isPromoting: boolean;
  isConfirmed: boolean;
  onChangeQuoteCostRmb: (val: number) => void;
  onChangeTargetPriceVal: (val: number) => void;
  onPromoteToCase: () => void;
};

export function LaunchCalculatorSection({
  currentReport,
  costSource,
  quoteCostRmb,
  targetPriceVal,
  landedCostInCurr,
  estMarginRate,
  estNetProfit,
  calcOppScore,
  economics,
  promotedCaseId,
  isPromoting,
  isConfirmed,
  onChangeQuoteCostRmb,
  onChangeTargetPriceVal,
  onPromoteToCase,
}: Props) {
  return (
    <section id="section-launch" className="panel" style={{ padding: "20px 24px", background: "var(--surface-subtle)", border: "1.5px solid var(--green)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>PIPELINE PROMOTION · 业务闭环立项</div>
          <h4 style={{ margin: "2px 0 0 0", fontSize: "16px", color: "var(--ink)", fontWeight: 800 }}>
            ⚡ 拿货成本试算 & 快速立项为商品案卷 (New Case)
          </h4>
          <p style={{ margin: "2px 0 0 0", color: "var(--muted)", fontSize: "12px" }}>
            默认按中位售价 25% 倒推预估拿货价（非工厂实报）；手工填入 1688 真实报价或由下方单品实采回补后，实时测算净利与财务「机会分」。
          </p>
        </div>
        {promotedCaseId && (
          <Link
            href={`/cases/${promotedCaseId}`}
            className="button primary"
            style={{ fontSize: "12px", padding: "6px 14px", height: "32px", borderRadius: "8px" }}
          >
            ✅ 查看已创建商品案卷 &rarr;
          </Link>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1.2fr 2fr", gap: "16px", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", flexWrap: "wrap" }}>
            <span>
              {costSource === "captured_1688"
                ? "1688 实采进价 (RMB)"
                : costSource === "manual"
                  ? "手工输入拿货价 (RMB)"
                  : "预估拿货单价 (RMB)"}
            </span>
            <span
              className={`badge ${costSource === "captured_1688" ? "badge-success" : costSource === "manual" ? "badge-neutral" : "badge-warn"}`}
              style={{ fontSize: "10px", padding: "1px 6px" }}
            >
              {costSource === "captured_1688" ? "1688 实采" : costSource === "manual" ? "手工试算" : "倒推预估 · 非实报"}
            </span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "14px", color: "var(--muted)" }}>¥</span>
            <input
              type="number"
              value={quoteCostRmb}
              onChange={(e) => onChangeQuoteCostRmb(Number(e.target.value))}
              step="0.5"
              style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "14px", fontWeight: 700, background: "var(--paper)" }}
            />
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
            折合到岸约: {landedCostInCurr.toFixed(2)} {currentReport.currency} (含25%海运)
          </div>
        </div>

        <div>
          <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", display: "block", marginBottom: "4px" }}>
            计划销售售价 ({currentReport.currency})
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "14px", color: "var(--muted)" }}>$</span>
            <input
              type="number"
              value={targetPriceVal}
              onChange={(e) => onChangeTargetPriceVal(Number(e.target.value))}
              step="0.5"
              style={{ width: "100%", padding: "7px 10px", borderRadius: "8px", border: "1px solid var(--line)", fontSize: "14px", fontWeight: 700, background: "var(--paper)" }}
            />
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "2px" }}>
            竞品中位价: {(currentReport.priceStats.p50 / 100).toFixed(2)} {currentReport.currency}
          </div>
        </div>

        {/* 实时财务指标看板 */}
        <div
          style={{
            background: "var(--paper)",
            padding: "10px 14px",
            borderRadius: "10px",
            border: "1px solid var(--line)",
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            textAlign: "center",
            gap: "6px",
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>测算毛利率</div>
            <div style={{ fontSize: "16px", fontWeight: 900, color: estMarginRate >= 0.2 ? "var(--green)" : "var(--red)" }}>
              {(estMarginRate * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>单件净利润</div>
            <div style={{ fontSize: "16px", fontWeight: 900, color: estNetProfit > 0 ? "var(--green)" : "var(--red)" }}>
              {estNetProfit.toFixed(2)} {currentReport.currency}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "12px", color: "var(--muted)" }}>财务机会分</div>
            <div style={{ fontSize: "16px", fontWeight: 900, color: calcOppScore >= 65 ? "var(--green)" : "var(--amber)" }}>
              {calcOppScore} <span style={{ fontSize: "12px", fontWeight: 600 }}>分</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px", background: "var(--surface-subtle)", padding: "6px 12px", borderRadius: "6px" }}>
        💡 <strong>与正式成本模型 100% 同源核算（零偏差）：</strong>
        已扣除：到岸采购运费 ({(economics.landedCostCents / 100).toFixed(2)}) · FBA 履约派送 ({(economics.fbaFeeCents / 100).toFixed(2)}) · 平台佣金 ({(economics.referralFeeCents / 100).toFixed(2)}) · PPC 广告 12% ({(economics.adCostCents / 100).toFixed(2)}) · 退货损耗 ({(economics.returnLossCents / 100).toFixed(2)}) · 优惠券仓储杂费 ({((economics.couponCents + economics.storageCents + economics.otherCostCents) / 100).toFixed(2)})。
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", borderTop: "1px dashed var(--line)", paddingTop: "12px" }}>
        <div style={{ fontSize: "12px", color: "var(--ink)" }}>
          {calcOppScore >= 65 ? (
            <span style={{ color: "var(--green)", fontWeight: 600 }}>
              🎯 财务指标达标 (GO)：毛利率 {(estMarginRate * 100).toFixed(1)}% 满足要求，可正式立项！
            </span>
          ) : (
            <span style={{ color: "var(--amber)", fontWeight: 600 }}>
              ⚠️ 利润偏薄 (HOLD)：机会分 {calcOppScore} 分，建议与工厂争取降价或优化包装体积。
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {currentReport.promotedCaseId || promotedCaseId ? (
            <Link
              href={`/cases/${currentReport.promotedCaseId || promotedCaseId}`}
              className="button primary"
              style={{ fontSize: "13px", padding: "7px 18px", height: "36px", borderRadius: "8px", fontWeight: 700 }}
            >
              ✅ 已立项为商品案卷 (前往案卷工作台 &rarr;)
            </Link>
          ) : (
            <button
              type="button"
              className="button primary"
              disabled={isPromoting || !isConfirmed}
              title={isConfirmed ? "一键建立正式商品案卷并关联竞品与文案" : "请先在上方点击「我已核对，确认可用」"}
              onClick={onPromoteToCase}
              style={{ fontSize: "13px", padding: "7px 18px", height: "36px", borderRadius: "8px", fontWeight: 700 }}
            >
              {isPromoting ? "正在创建商品案卷..." : isConfirmed ? "🚀 一键正式立项 (New Case)" : "需先核对研报"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
