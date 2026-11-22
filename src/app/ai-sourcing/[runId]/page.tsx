import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { DetailTabCookie } from "@/components/detail-tab-cookie";
import { HashOpenDetails } from "@/components/hash-open-details";
import { PageHeader, QueryNotices } from "@/components/ui";
import {
  getAISourcingBatch,
  getBatchSiteLabel,
} from "@/lib/ai-sourcing-repository";
import {
  listSupplierDraftsByRun,
  type SupplierDraft,
} from "@/lib/ai-supplier-assistant/repository";
import { listAiInboxTaskCountsByRun } from "@/lib/ai-inbox/repository";
import { shortDate } from "@/lib/format";
import { dateTimeInputValue } from "./_components/helpers";
import { HypothesisCard, HypothesisSummaryList } from "./_components/hypothesis-card";

export const dynamic = "force-dynamic";

/** 详情页按步骤分区，避免一个长页面堆满所有操作。 */
const DETAIL_TABS = [
  { key: "overview", label: "概览", hint: "批次进展与机会方向" },
  { key: "hypotheses", label: "验证证据", hint: "补任务、录证据、核对竞品" },
  { key: "suppliers", label: "找供应商", hint: "采集、对比、人工核验" },
  { key: "quotes", label: "报价与 RFQ", hint: "真实报价、成本倒推、内部草稿" },
  { key: "decision", label: "门禁结论", hint: "确定性结论与转立项" },
] as const;

type DetailTab = (typeof DETAIL_TABS)[number]["key"];

function parseDetailTab(value: string | undefined): DetailTab {
  return DETAIL_TABS.find((tab) => tab.key === value)?.key ?? "overview";
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
  const [batch, supplierDrafts, aiInboxCounts] = await Promise.all([
    getAISourcingBatch(runId),
    listSupplierDraftsByRun(runId),
    listAiInboxTaskCountsByRun(runId),
  ]);
  if (!batch) notFound();

  const draftsByHypothesis = new Map<string, SupplierDraft[]>();
  for (const draft of supplierDrafts) {
    const existing = draftsByHypothesis.get(draft.hypothesisId) ?? [];
    existing.push(draft);
    draftsByHypothesis.set(draft.hypothesisId, existing);
  }

  const siteLabel = getBatchSiteLabel(batch);
  const selectedCount = batch.hypotheses.filter((item) => item.selectedForValidation).length;
  const goCount = batch.hypotheses.filter((item) => item.decision?.decision === "GO").length;
  const completeness = batch.hypotheses.length
    ? Math.round(batch.hypotheses.reduce((sum, item) => sum + (item.decision?.evidenceCompleteness ?? 0), 0) / batch.hypotheses.length)
    : 0;
  const observedAt = dateTimeInputValue(new Date());
  const requestedHypothesisId = batch.hypotheses.some((item) => item.id === query.hypothesisId)
    ? query.hypothesisId
    : undefined;
  const defaultHypothesisId =
    requestedHypothesisId ??
    batch.hypotheses.find((item) => item.decision?.decision === "GO")?.id ??
    batch.hypotheses.find((item) => item.selectedForValidation)?.id ??
    batch.hypotheses[0]?.id;
  const savedTab = cookieStore.get("aitrade_detail_tab")?.value;
  const activeTab = parseDetailTab(query.tab ?? savedTab);
  const activeTabMeta = DETAIL_TABS.find((tab) => tab.key === activeTab) ?? DETAIL_TABS[0];
  const tabHref = (key: DetailTab) => {
    const search = new URLSearchParams({ tab: key });
    if (requestedHypothesisId) search.set("hypothesisId", requestedHypothesisId);
    return `/ai-sourcing/${encodeURIComponent(runId)}?${search.toString()}`;
  };

  return (
    <div className="page ai-sourcing-detail-page">
      <DetailTabCookie tab={activeTab} />
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "AI 选品批次", href: "/ai-sourcing" },
          { label: "批次详情" },
        ]}
        eyebrow="证据优先的选品验证"
        title={`${batch.category} · 选品验证`}
        meta={
          <>
            <span className="badge badge-neutral">{siteLabel}</span>
            <span className="badge badge-neutral">{batch.currency}</span>
            <span className="badge badge-success">{goCount} 个 GO</span>
            <span className="badge status-review_pending">{selectedCount} 个验证中</span>
          </>
        }
        actions={
          <>
            <Link href="/ai-sourcing" className="button secondary">返回研究列表</Link>
            <Link href={`/?market=${encodeURIComponent(batch.marketCode)}&platform=${encodeURIComponent(batch.platformCode)}#opportunities`} className="button ghost">查看已立项商品</Link>
          </>
        }
      />

      <QueryNotices notice={query.notice} error={query.error} />
      {batch.templateFallback ? (
        <div className="notice warn">
          <strong>本批假设由内置模板生成：</strong>模型调用失败，已自动回退（{batch.providerError ?? "原因未记录"}）。这 5 个方向不是 {batch.provider} / {batch.model} 的输出。
        </div>
      ) : null}

      <nav className="ai-detail-tabs" aria-label="验证步骤">
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

      {activeTab === "overview" ? (
        <>
      <section className="ai-batch-overview">
        <div>
          <span className="eyebrow" style={{ color: "var(--lime)" }}>研究简报</span>
          <h2>{batch.brief}</h2>
          <p>创建人 {batch.createdBy} · {shortDate(batch.createdAt)} · {batch.provider} / {batch.model}</p>
        </div>
        <div className="ai-batch-overview-side">
          <span>币种口径</span>
          <strong>{batch.currency}</strong>
          {batch.currency === "USD" ? (
            <small>USD 无需汇率换算</small>
          ) : batch.fxSourceUrl ? (
            <a href={batch.fxSourceUrl} target="_blank" rel="noreferrer">
              1 USD = {batch.fxRateToUsd ?? "—"} {batch.currency} · 查看汇率来源
            </a>
          ) : (
            <small>未记录汇率来源</small>
          )}
        </div>
      </section>

      <section className="metrics-grid ai-metrics" aria-label="批次验证概览">
        <Link href={tabHref("hypotheses")} className="metric-card" title="点击查看所有待验证方向">
          <div className="metric-label">机会假设</div>
          <div className="metric-value">{batch.hypotheses.length}</div>
          <div className="metric-note">AI 只生成待验证方向 · 点击核验</div>
        </Link>
        <Link href={tabHref("hypotheses")} className="metric-card" title="点击查看已加入验证方向的证据与任务">
          <div className="metric-label">已加入验证</div>
          <div className="metric-value">{selectedCount}</div>
          <div className="metric-note">加入后开放证据与报价录入 · 点击推进</div>
        </Link>
        <Link href={tabHref("decision")} className="metric-card" title="点击查看确定性门禁结论与转立项">
          <div className="metric-label">确定性 GO</div>
          <div className="metric-value">{goCount}</div>
          <div className="metric-note">证据、利润、风险、现金全部达标 · 查看结论</div>
        </Link>
        <Link href={tabHref("hypotheses")} className="metric-card" title="点击核对证据链完整度">
          <div className="metric-label">平均证据完整度</div>
          <div className="metric-value">{completeness}%</div>
          <div className="metric-note">竞品、评论、供应商、报价、专利、样品</div>
        </Link>
      </section>

      <p className="muted" style={{ fontSize: "12px", margin: "0 0 8px" }}>
        下方为流程示意，不代表当前进度；各假设的真实进度请看验证任务与 GO 门禁面板。
      </p>
      <div className="ai-workflow-strip" aria-label="选品验证流程示意（非当前进度）">
        {[
          ["01", "AI 假设"],
          ["02", "人工核实证据"],
          ["03", "供应商报价"],
          ["04", "确定性门禁"],
          ["05", "GO 转立项"],
          ["06", "定标与内容"],
        ].map(([step, label]) => (
          <div key={step}>
            <span>{step}</span>
            <strong>{label}</strong>
          </div>
        ))}
      </div>

          <HypothesisSummaryList batch={batch} />

      <section className="panel ai-guardrail-panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">流程护栏</div>
            <h2>这套流程不会替你虚构事实</h2>
            <p>AI 仅生成假设；销量、评论、竞品、供应商、报价、专利和利润都必须有来源。系统不会自动联系供应商、下单、付款或发布 Listing。</p>
          </div>
          <span className="badge badge-success">externalActions: none</span>
        </div>
      </section>
        </>
      ) : (
        <>
          <div className="ai-tab-intro">
            <div>
              <span className="eyebrow">当前步骤</span>
              <strong>{activeTabMeta.label}</strong>
              <span>{activeTabMeta.hint}</span>
            </div>
            <Link href={tabHref("overview")} className="button ghost">返回概览</Link>
          </div>

      <div className="ai-hypothesis-list">
        {batch.hypotheses.map((hypothesis) => (
          <HypothesisCard
            key={hypothesis.id}
            batch={batch}
            hypothesis={hypothesis}
            tab={activeTab}
            supplierDrafts={draftsByHypothesis.get(hypothesis.id) ?? []}
            aiInboxCounts={aiInboxCounts.get(hypothesis.id) ?? null}
            observedAt={observedAt}
            defaultOpen={hypothesis.id === defaultHypothesisId}
            autoReadClipboard={query.capture === "clipboard" && query.hypothesisId === hypothesis.id}
          />
        ))}
      </div>

        </>
      )}
    </div>
  );
}

