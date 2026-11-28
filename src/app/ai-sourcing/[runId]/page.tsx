import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { DetailTabCookie } from "@/components/detail-tab-cookie";
import { PageHeader, QueryNotices } from "@/components/ui";
import {
  getAISourcingBatch,
  getBatchSiteLabel,
  listEliminatedHypotheses,
} from "@/lib/ai-sourcing-repository";
import { loadFunnelThresholds } from "@/lib/app-settings";
import { getComparisonReports } from "@/lib/competitor-compare/storage";
import {
  getCostSheet,
  isLatestCostSheetVersion,
  type CostSheet,
} from "@/lib/cost-sheets-repository";
import {
  listSupplierDraftsByRun,
  type SupplierDraft,
} from "@/lib/ai-supplier-assistant/repository";
import { listAiInboxTaskCountsByRun } from "@/lib/ai-inbox/repository";
import { evaluateFastScreen } from "@/lib/sourcing-funnel";
import { gradeManualHypothesis, type SourcingGradeMeta } from "@/lib/sourcing-grade";
import type { ProductComplianceAttribute } from "@/lib/prelaunch-compliance";
import { shortDate } from "@/lib/format";
import { dateTimeInputValue, type DetailTab } from "./_components/helpers";
import { CandidateSwitcher } from "./_components/candidate-switcher";
import { HypothesisCard } from "./_components/hypothesis-card";

export const dynamic = "force-dynamic";

/** 统一 4 步选品验证工作台：每步只做一件事，零重复 */
const DETAIL_TABS: Array<{ key: DetailTab; label: string; hint: string }> = [
  { key: "hypotheses", label: "竞品研报", hint: "价格带 · 差评痛点" },
  { key: "profit", label: "成本核算", hint: "已确认核算单 · 18% 门禁" },
  { key: "suppliers", label: "找厂与打样", hint: "1688 选厂 · 报价 · 样品分" },
  { key: "decision", label: "风险与立项", hint: "合规红线 · 专利物流 · 唯一立项口" },
];

function parseDetailTab(value: string | undefined): DetailTab {
  if (value === "profit" || value === "suppliers" || value === "decision") return value;
  if (value === "quotes") return "suppliers";
  return "hypotheses";
}

type PageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{
    market?: string;
    platform?: string;
    notice?: string;
    error?: string;
    capture?: string;
    hypothesisId?: string;
    tab?: string;
  }>;
};

export default async function AISourcingDetailPage({ params, searchParams }: PageProps) {
  const [{ runId }, query, cookieStore] = await Promise.all([params, searchParams, cookies()]);
  const [batch, supplierDrafts, aiInboxCounts, allReports, funnelThresholds, eliminatedHistory] = await Promise.all([
    getAISourcingBatch(runId),
    listSupplierDraftsByRun(runId),
    listAiInboxTaskCountsByRun(runId),
    getComparisonReports(),
    loadFunnelThresholds(),
    listEliminatedHypotheses(),
  ]);
  if (!batch) notFound();

  const siteReports = allReports.filter(
    (r) => r.marketCode.toUpperCase() === batch.marketCode.toUpperCase(),
  );
  const recentReports = siteReports.length > 0 ? siteReports : allReports;

  const draftsByHypothesis = new Map<string, SupplierDraft[]>();
  for (const draft of supplierDrafts) {
    const existing = draftsByHypothesis.get(draft.hypothesisId) ?? [];
    existing.push(draft);
    draftsByHypothesis.set(draft.hypothesisId, existing);
  }

  const siteLabel = getBatchSiteLabel(batch);
  const goCount = batch.hypotheses.filter((item) => item.decision?.decision === "GO").length;
  const eliminatedCount = batch.hypotheses.filter((item) => Boolean(item.eliminatedAt)).length;
  const observedAt = dateTimeInputValue(new Date());

  const activeHypothesis =
    batch.hypotheses.find((item) => item.id === query.hypothesisId) ??
    batch.hypotheses.find((item) => !item.eliminatedAt && item.decision?.decision === "GO") ??
    batch.hypotheses.find((item) => !item.eliminatedAt) ??
    batch.hypotheses[0];

  const costSheetIds = [
    ...new Set(batch.hypotheses.map((item) => item.costSheetId).filter(Boolean)),
  ] as string[];
  const costSheetEntries = await Promise.all(
    costSheetIds.map(async (id) => {
      const [sheet, isLatest] = await Promise.all([
        getCostSheet(id),
        isLatestCostSheetVersion(id),
      ]);
      return [id, sheet, isLatest] as const;
    }),
  );
  const costSheetsById = new Map<string, CostSheet>();
  const costSheetLatestById = new Map<string, boolean>();
  for (const [id, sheet, isLatest] of costSheetEntries) {
    if (!sheet) continue;
    costSheetsById.set(id, sheet);
    costSheetLatestById.set(id, isLatest);
  }

  const gradeByHypothesis = new Map<string, SourcingGradeMeta>();
  for (const item of batch.hypotheses) {
    const report = item.comparisonReportId
      ? recentReports.find((r) => r.id === item.comparisonReportId) ?? null
      : null;
    const fastEval = evaluateFastScreen({
      marketCode: batch.marketCode,
      verifiedCompetitorCount: item.counts.verifiedCompetitors ?? item.counts.competitors,
      p50PriceCents: item.benchmark.price?.p50 ?? null,
      complianceAttrs: item.complianceAttrs as ProductComplianceAttribute[],
      conceptText: `${batch.category} ${item.concept}`,
      report,
      thresholds: funnelThresholds,
    });
    const sheet = item.costSheetId ? costSheetsById.get(item.costSheetId) ?? null : null;
    gradeByHypothesis.set(
      item.id,
      gradeManualHypothesis({ hypothesis: item, fastScreen: fastEval, costSheet: sheet, funnelThresholds }),
    );
  }

  const sCount = [...gradeByHypothesis.values()].filter((g) => g.grade === "S").length;
  const aCount = [...gradeByHypothesis.values()].filter((g) => g.grade === "A").length;
  const bCount = [...gradeByHypothesis.values()].filter((g) => g.grade === "B").length;

  const savedTab = cookieStore.get("aitrade_detail_tab")?.value;
  const activeTab = parseDetailTab(query.tab ?? savedTab);
  const tabHref = (key: DetailTab, hypothesisId = activeHypothesis?.id) => {
    const search = new URLSearchParams({ tab: key });
    if (hypothesisId) search.set("hypothesisId", hypothesisId);
    return `/ai-sourcing/${encodeURIComponent(runId)}?${search.toString()}`;
  };

  return (
    <div className="page ai-sourcing-detail-page">
      <DetailTabCookie tab={activeTab} />
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品看板", href: "/ai-sourcing" },
          { label: batch.category },
        ]}
        eyebrow="单品 4 步推进"
        title={`${batch.category} · 选品验证`}
        meta={
          <>
            <span className="badge badge-neutral">{siteLabel}</span>
            <span className="badge badge-neutral">{batch.currency}</span>
            {sCount > 0 ? <span className="badge badge-success">S 级 {sCount}</span> : null}
            {aCount > 0 ? <span className="badge status-review_pending">A 级 {aCount}</span> : null}
            {bCount > 0 ? <span className="badge badge-warn">B 级 {bCount}</span> : null}
            <span className="badge badge-success">已定标 {goCount} GO</span>
            {eliminatedCount > 0 ? <span className="badge badge-danger">{eliminatedCount} 已淘汰</span> : null}
          </>
        }
        actions={
          <details className="funnel-brief-pop">
            <summary className="button ghost compact-button">简报 ⓘ</summary>
            <div className="funnel-brief-popover">
              <div className="funnel-brief-popover-head">
                <strong>研究简报</strong>
                <span>{shortDate(batch.createdAt)} · {batch.model}</span>
              </div>
              <p>{batch.brief}</p>
            </div>
          </details>
        }
      />

      <QueryNotices notice={query.notice} error={query.error} />
      {batch.templateFallback ? (
        <div className="notice warn">
          <strong>本批假设由内置模板生成：</strong>模型调用失败，已自动回退（{batch.providerError ?? "原因未记录"}）。
        </div>
      ) : null}

      {/* 同批次兄弟方向切换条（支持单个删除 + 弹窗确认） */}
      <CandidateSwitcher
        runId={batch.id}
        activeTab={activeTab}
        activeHypothesisId={activeHypothesis?.id}
        items={batch.hypotheses.map((item) => ({
          id: item.id,
          position: item.position,
          concept: item.concept,
          eliminatedAt: item.eliminatedAt,
          productCaseId: item.productCaseId,
          decision: item.decision?.decision ?? null,
          grade: gradeByHypothesis.get(item.id)?.grade ?? "HOLD",
        }))}
      />

      {/* 纯净 4 步动作导航 */}
      <nav className="ai-detail-tabs funnel-tabs-4" aria-label="4 步验证流程">
        {DETAIL_TABS.map((tab, index) => (
          <Link
            key={tab.key}
            href={tabHref(tab.key)}
            className={`ai-detail-tab${activeTab === tab.key ? " active" : ""}`}
            aria-current={activeTab === tab.key ? "step" : undefined}
          >
            <span>0{index + 1}</span>
            <strong>{tab.label}</strong>
            <small>{tab.hint}</small>
          </Link>
        ))}
      </nav>

      {activeHypothesis ? (
        <HypothesisCard
          batch={batch}
          hypothesis={activeHypothesis}
          tab={activeTab}
          supplierDrafts={draftsByHypothesis.get(activeHypothesis.id) ?? []}
          aiInboxCounts={aiInboxCounts.get(activeHypothesis.id) ?? null}
          observedAt={observedAt}
          autoReadClipboard={query.capture === "clipboard" && query.hypothesisId === activeHypothesis.id}
          recentReports={recentReports}
          costSheet={
            activeHypothesis.costSheetId
              ? costSheetsById.get(activeHypothesis.costSheetId) ?? null
              : null
          }
          costSheetIsLatest={
            activeHypothesis.costSheetId
              ? costSheetLatestById.get(activeHypothesis.costSheetId) ?? false
              : false
          }
          funnelThresholds={funnelThresholds}
          eliminatedHistory={eliminatedHistory}
          nextTabHref={
            activeTab === "hypotheses"
              ? tabHref("profit")
              : activeTab === "profit"
                ? tabHref("suppliers")
                : activeTab === "suppliers"
                  ? tabHref("decision")
                  : undefined
          }
          nextTabLabel={
            activeTab === "hypotheses"
              ? "下一步：02 成本核算 →"
              : activeTab === "profit"
                ? "下一步：03 找厂与打样 →"
                : activeTab === "suppliers"
                  ? "下一步：04 风险与立项 →"
                  : undefined
          }
        />
      ) : null}
    </div>
  );
}
