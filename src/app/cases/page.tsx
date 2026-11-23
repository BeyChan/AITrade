import Link from "next/link";
import { deriveCaseWorkflowSnapshot } from "@/lib/case-stage";
import { listCases } from "@/lib/repository";
import { money, percent } from "@/lib/format";
import { CasesAuditLedger, type AuditLedgerRow } from "@/components/cases-audit-ledger";
import { IconClipboard } from "@/components/icons";
import { MetricGrid, PageHeader } from "@/components/ui";

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

  const currentView = query.status === "archived" ? "archived" : "active";
  const currentMarket = query.market || "all";

  const isArchived = (status: string) => status === "archived" || status === "rejected";

  const filteredCases = cases.filter((c) => {
    if (currentView === "archived" && !isArchived(c.status)) return false;
    if (currentView === "active" && isArchived(c.status)) return false;
    if (currentMarket !== "all" && c.marketplace.toUpperCase() !== currentMarket.toUpperCase()) return false;
    return true;
  });

  const activeCases = cases.filter((c) => !isArchived(c.status));
  const archivedCases = cases.filter((c) => isArchived(c.status));
  const goCases = activeCases.filter((c) => c.recommendation === "GO").length;
  const profitEligibleCases = activeCases.filter((c) => c.recommendation !== "NO-GO");
  const noGoCaseCount = activeCases.filter((c) => c.recommendation === "NO-GO").length;
  const totalMonthlyProfitCents = profitEligibleCases.reduce((acc, c) => {
    const net = c.costModel?.results?.netProfitCents || 0;
    return acc + net * (c.monthly_sales_estimate || 0);
  }, 0);

  const ledgerRows: AuditLedgerRow[] = filteredCases.map((c) => {
    const cost = c.costModel;
    const res = cost?.results;
    const asm = cost?.assumptions;
    const monthlyProfitCents = res ? res.netProfitCents * (c.monthly_sales_estimate || 0) : null;
    const workflow = deriveCaseWorkflowSnapshot({
      caseId: c.id,
      status: c.status,
      recommendation: c.recommendation,
      hasNoGoException: Boolean(c.hasNoGoException),
      hasCostModel: Boolean(cost),
      quoteCount: c.quoteCount ?? 0,
      hasSupplierSelection: Boolean(c.hasSupplierSelection),
      approvedMainImageCount: c.approvedMainImageCount,
      hasApprovedContent: Boolean(c.hasApprovedContent),
      hasFlatFileExported: Boolean(c.hasFlatFileExported),
      hasMediaPackExported: Boolean(c.hasMediaPackExported),
    });
    return {
      id: c.id,
      title: c.title,
      marketplace: c.marketplace,
      asin: c.asin,
      category: c.category,
      status: c.status,
      recommendation: c.recommendation,
      stageLabel: `${workflow.name} · ${workflow.subName}`,
      nextActionLabel: workflow.primaryAction.label,
      nextActionHref: workflow.primaryAction.href,
      nextActionKind: workflow.primaryAction.kind,
      showSourcing:
        workflow.permissions.canRecordQuote ||
        workflow.permissions.canSelectSupplier ||
        workflow.facts.quoteCount > 0,
      showContent:
        workflow.permissions.canEditContent ||
        workflow.permissions.canExportDeliveryPack ||
        workflow.facts.hasApprovedContent,
      canExportFlatFile: workflow.permissions.canExportDeliveryPack,
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
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "商品案卷" },
        ]}
        eyebrow="立项台账与全周期追踪"
        title="商品案卷"
        description="集中管理所有已立项商品案卷。追踪从竞品研报、工厂询价、财务核准、内容打磨到平台导入资料交付的完整进度。"
        actions={
          <>
            <Link href="/discover" className="button primary">
              + 新建选品
            </Link>
            <Link href="/import" className="button secondary">
              批量导入商品
            </Link>
          </>
        }
      />

      <MetricGrid
        ariaLabel="我的商品核心指标"
        items={[
          { label: "活跃商品", value: activeCases.length, note: "正在推进中的已立项商品" },
          { label: "达标 GO 商品", value: goCases, note: "净利率 ≥ 18%、压测为正且机会分 ≥ 65", tone: "success" },
          { label: "已归档", value: archivedCases.length, note: "已终止或归档复盘" },
          {
            label: "测算月毛利（非承诺）",
            value: money(totalMonthlyProfitCents),
            note: `${profitEligibleCases.length} 款参与测算${noGoCaseCount > 0 ? ` · 已排除 ${noGoCaseCount} 款 NO-GO` : ""}`,
            tone: totalMonthlyProfitCents >= 0 ? "success" : "danger",
          },
        ]}
      />

      {archivedCases.length > 0 || currentView === "archived" ? (
        <div
          style={{
            background: "var(--paper)",
            padding: "10px 16px",
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
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {[
              { id: "active", label: `活跃商品 (${activeCases.length})`, href: `/cases${currentMarket !== "all" ? `?market=${currentMarket}` : ""}` },
              { id: "archived", label: `已归档 (${archivedCases.length})`, href: `/cases?status=archived${currentMarket !== "all" ? `&market=${currentMarket}` : ""}` },
            ].map((tab) => {
              const active = currentView === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={tab.href}
                  style={{
                    fontSize: "12px",
                    padding: "5px 12px",
                    borderRadius: "6px",
                    textDecoration: "none",
                    fontWeight: active ? 700 : 500,
                    background: active ? "var(--deep)" : "var(--canvas)",
                    color: active ? "var(--deep-fg)" : "var(--ink)",
                  }}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <div style={{ fontSize: "12px", color: "var(--muted)" }}>
            共展示 <strong className="badge-num" style={{ color: "var(--ink)" }}>{filteredCases.length}</strong> 个商品
          </div>
        </div>
      ) : null}

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
            可在「竞品研报」工作台对标 1~4 个竞品后一键立项。
          </p>
          <Link href="/competitors" className="button primary">
            进入竞品研报工作台
          </Link>
        </div>
      ) : (
        <CasesAuditLedger rows={ledgerRows} />
      )}
    </div>
  );
}
