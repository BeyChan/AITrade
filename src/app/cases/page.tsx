import Link from "next/link";
import { listCases } from "@/lib/repository";
import { money, percent } from "@/lib/format";
import { StatusBadge } from "@/components/badges";

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

  return (
    <div className="page" style={{ maxWidth: "1280px", margin: "0 auto", padding: "26px 28px 60px" }}>
      {/* 头部标题与新建入口 */}
      <header style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: "16px" }}>
          <div>
            <span className="eyebrow" style={{ color: "var(--green)" }}>案卷总控 · 全生命周期跟踪</span>
            <h1 style={{ fontSize: "28px", margin: "6px 0 6px 0", fontWeight: 800, color: "var(--ink)", letterSpacing: "-0.02em" }}>
              商品工作台
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "14px", margin: 0 }}>
              集中管理所有已立项商品案卷。追踪从竞品研报、工厂询价、财务核准、内容打磨到批量发布模板 (Flat File) 的完整进度。
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <Link href="/competitors" className="button primary">
              ＋ 竞品横评并立项
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
          background: "#ffffff",
          padding: "14px 18px",
          borderRadius: "10px",
          border: "1px solid var(--line)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginRight: "4px" }}>状态筛选:</span>
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
                  background: active ? "var(--green)" : "#f1f5f9",
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
          共展示 <strong>{filteredCases.length}</strong> 个商品案卷
        </div>
      </div>

      {/* 案卷卡片列表 */}
      {filteredCases.length === 0 ? (
        <div
          style={{
            background: "#ffffff",
            borderRadius: "12px",
            border: "1px dashed var(--line)",
            padding: "48px 24px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "32px", marginBottom: "8px" }}>📦</div>
          <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", color: "var(--ink)" }}>暂无匹配的商品案卷</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--muted)" }}>
            可在「竞品对比」工作台对标 1~4 个竞品后一键立项。
          </p>
          <Link href="/competitors" className="button primary">
            进入竞品对比工作台
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {filteredCases.map((c) => {
            const cost = c.costModel;
            const res = cost?.results;
            const asm = cost?.assumptions;

            return (
              <div
                key={c.id}
                style={{
                  background: "#ffffff",
                  borderRadius: "10px",
                  border: "1px solid var(--line)",
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "14px",
                  transition: "border-color 0.15s ease",
                }}
              >
                {/* 顶行：标题、标签与状态 */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "#e8f0fc",
                          color: "#3766a6",
                        }}
                      >
                        {c.marketplace}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: "#f1f5f9",
                          color: "var(--muted)",
                        }}
                      >
                        ASIN: {c.asin}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>类目: {c.category}</span>
                    </div>

                    <Link
                      href={`/cases/${c.id}`}
                      style={{
                        fontSize: "16px",
                        fontWeight: 800,
                        color: "var(--ink)",
                        textDecoration: "none",
                        lineHeight: 1.4,
                      }}
                    >
                      {c.title}
                    </Link>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                    <StatusBadge status={c.status} />
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 800,
                        padding: "4px 8px",
                        borderRadius: "6px",
                        background: c.recommendation === "GO" ? "var(--green-soft)" : "var(--amber-soft)",
                        color: c.recommendation === "GO" ? "var(--green)" : "var(--amber)",
                      }}
                    >
                      {c.recommendation} · {c.opportunityScore}分
                    </span>
                  </div>
                </div>

                {/* 中行：关键财务测算指标 */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                    gap: "10px",
                    background: "#f8fafc",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #edf2f7",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <span style={{ color: "var(--muted)" }}>预估售价:</span>{" "}
                    <strong>{asm ? money(asm.salePriceCents) : "—"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>到岸成本:</span>{" "}
                    <strong>{asm ? money(asm.landedCostCents) : "—"}</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>单件净利:</span>{" "}
                    <strong style={{ color: res && res.netProfitCents > 0 ? "var(--green)" : "inherit" }}>
                      {res ? money(res.netProfitCents) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>基准净利率:</span>{" "}
                    <strong style={{ color: res && res.marginRate >= 0.18 ? "var(--green)" : "inherit" }}>
                      {res ? percent(res.marginRate) : "—"}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>月销估计:</span>{" "}
                    <strong>{c.monthly_sales_estimate || 0} 件</strong>
                  </div>
                  <div>
                    <span style={{ color: "var(--muted)" }}>预估月贡献:</span>{" "}
                    <strong style={{ color: "var(--green)" }}>
                      {res ? money(res.netProfitCents * (c.monthly_sales_estimate || 0)) : "—"}
                    </strong>
                  </div>
                </div>

                {/* 底行：快捷流转按钮组 */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                    borderTop: "1px solid #f1f5f9",
                    paddingTop: "10px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <Link
                      href={`/cases/${c.id}`}
                      className="button secondary"
                      style={{ fontSize: "11px", padding: "4px 10px", height: "auto" }}
                    >
                      案卷总览
                    </Link>
                    <Link
                      href={`/cases/${c.id}/sourcing`}
                      className="button secondary"
                      style={{ fontSize: "11px", padding: "4px 10px", height: "auto" }}
                    >
                      工厂报价 & 定标
                    </Link>
                    <Link
                      href={`/cases/${c.id}/content`}
                      className="button secondary"
                      style={{ fontSize: "11px", padding: "4px 10px", height: "auto" }}
                    >
                      反制五点文案
                    </Link>
                    <Link
                      href={`/cases/${c.id}/channels`}
                      className="button secondary"
                      style={{ fontSize: "11px", padding: "4px 10px", height: "auto" }}
                    >
                      Flat File 导出
                    </Link>
                  </div>

                  <Link
                    href={`/cases/${c.id}/report`}
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "var(--green)",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span>🖨️ 查看决策战报 (Memo)</span>
                    <span>→</span>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
