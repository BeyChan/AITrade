import Link from "next/link";
import { listCases } from "@/lib/repository";
import { money, percent } from "@/lib/format";
import { CasesAuditLedger, type AuditLedgerRow } from "@/components/cases-audit-ledger";
import { IconClipboard } from "@/components/icons";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    market?: string;
  }>;
};

export default async function ProductCasesPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const cases = await listCases();

  const currentStatus = query.status || "all";
  const currentMarket = query.market || "all";

  const filteredCases = cases.filter((c) => {
    if (currentStatus !== "all" && c.status !== currentStatus) return false;
    if (currentMarket !== "all" && c.marketplace.toUpperCase() !== currentMarket.toUpperCase()) return false;
    return true;
  });

  const totalCases = cases.length;
  const approvedCases = cases.filter((c) => c.status === "approved").length;
  const pendingCases = cases.filter((c) => c.status === "review_pending").length;
  const totalMonthlyProfitCents = cases.reduce((acc, c) => {
    const net = c.costModel?.results?.netProfitCents || 0;
    return acc + net * (c.monthly_sales_estimate || 0);
  }, 0);

  const ledgerRows: AuditLedgerRow[] = filteredCases.map((c) => {
    const cost = c.costModel;
    const res = cost?.results;
    const asm = cost?.assumptions;
    const monthlyProfitCents = res ? res.netProfitCents * (c.monthly_sales_estimate || 0) : null;
    return {
      id: c.id,
      title: c.title,
      marketplace: c.marketplace,
      asin: c.asin,
      category: c.category,
      status: c.status,
      recommendation: c.recommendation,
      opportunityScore: c.opportunityScore,
      isVerified: !c.is_demo && c.evidence_score >= 50,
      isDemo: c.is_demo,
      evidenceScore: c.evidence_score,
      salePriceText: asm ? money(asm.salePriceCents) : "—",
      landedCostText: asm ? money(asm.landedCostCents) : "—",
      netProfitCents: res ? res.netProfitCents : null,
      netProfitText: res ? money(res.netProfitCents) : "—",
      marginRate: res ? res.marginRate : null,
      marginText: res ? percent(res.marginRate) : "—",
      monthlyProfitCents,
      monthlyProfitText: monthlyProfitCents !== null ? money(monthlyProfitCents) : "—",
    };
  });

  return (
    <div className="page">
      {/* 头部标题与新建入口 */}
      <header style={{ marginBottom: "18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <h1>商品工作台</h1>
            <p className="muted" style={{ fontSize: "14px", margin: 0 }}>
              集中管理所有已立项商品案卷。追踪从竞品研报、工厂询价、财务核准、内容打磨到批量发布模板 (Flat File) 的完整进度。
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <Link href="/competitors" className="button primary">
              竞品横评并立项
            </Link>
            <Link href="/import" className="button secondary">
              批量导入商品
            </Link>
          </div>
        </div>
      </header>

      {/* 核心指标概览 */}
      <section className="metrics-grid" style={{ marginBottom: "24px" }}>
        <article className="metric-card">
          <div className="metric-label">已立项商品案卷</div>
          <div className="metric-value">{totalCases}</div>
          <div className="metric-note">覆盖活跃立项商品</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已终审立项 (Approved)</div>
          <div className="metric-value" style={{ color: "var(--green)" }}>{approvedCases}</div>
          <div className="metric-note">已完成财务定标审批</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">待财务核准 (Review)</div>
          <div className="metric-value" style={{ color: "var(--amber)" }}>{pendingCases}</div>
          <div className="metric-note">等待管理层审批报价</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">预估月度利润贡献</div>
          <div className="metric-value" style={{ color: "var(--green)" }}>{money(totalMonthlyProfitCents)}</div>
          <div className="metric-note">按测算单件净利 × 月销估计</div>
        </article>
      </section>

      {/* 筛选过滤栏 */}
      <div
        style={{
          background: "var(--paper)",
          padding: "11px 16px",
          borderRadius: "10px",
          border: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginRight: "4px" }}>状态筛选</span>
          {[
            { id: "all", label: "全部案卷" },
            { id: "approved", label: "已立项通过" },
            { id: "review_pending", label: "待财务核准" },
            { id: "draft", label: "调研初选" },
          ].map((tab) => {
            const active = currentStatus === tab.id;
            return (
              <Link
                key={tab.id}
                href={`/cases?status=${tab.id}&market=${currentMarket}`}
                style={{
                  fontSize: "12px",
                  padding: "5px 12px",
                  borderRadius: "6px",
                  textDecoration: "none",
                  fontWeight: active ? 700 : 500,
                  background: active ? "var(--deep)" : "var(--canvas)",
                  color: active ? "#ffffff" : "var(--ink)",
                  transition: "all 0.15s ease",
                }}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        <div style={{ fontSize: "12px", color: "var(--muted)" }}>
          共展示 <strong className="badge-num" style={{ color: "var(--ink)" }}>{filteredCases.length}</strong> 个商品案卷
        </div>
      </div>

      {/* 跨境立项审计台账表 */}
      {filteredCases.length === 0 ? (
        <div
          style={{
            background: "var(--paper)",
            borderRadius: "10px",
            border: "1px dashed var(--line)",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ color: "var(--muted)", marginBottom: "10px", display: "flex", justifyContent: "center" }}>
            <IconClipboard size={28} />
          </div>
          <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", color: "var(--ink)" }}>暂无匹配的商品案卷</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--muted)" }}>
            可在「竞品对比」工作台对标 1~4 个竞品后一键立项。
          </p>
          <Link href="/competitors" className="button primary">
            进入竞品对比工作台
          </Link>
        </div>
      ) : (
        <CasesAuditLedger rows={ledgerRows} />
      )}
    </div>
  );
}
