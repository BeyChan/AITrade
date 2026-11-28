import Link from "next/link";
import { AddSelectionMenu } from "@/components/add-selection-menu";
import { DeleteResearchBatch } from "@/components/delete-research-batch";
import { EmptyState, MetricGrid, PageHeader, QueryNotices } from "@/components/ui";
import {
  eliminateHypothesisAction,
  restoreHypothesisAction,
  saveFunnelThresholdsAction,
} from "@/app/actions";
import {
  getBatchSiteLabel,
  listAISourcingBatches,
  listKanbanCandidates,
  type KanbanCandidateItem,
} from "@/lib/ai-sourcing-repository";
import { getAppMode } from "@/lib/app-mode";
import { loadFunnelThresholds } from "@/lib/app-settings";
import { shortDate } from "@/lib/format";
import {
  ELIMINATION_REASONS,
  KANBAN_COLUMNS,
  type KanbanStageKey,
} from "@/lib/sourcing-funnel";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ notice?: string; error?: string; batch?: string }>;
};

function formatKanbanTitle(concept: string): string {
  const idx = concept.lastIndexOf(" · ");
  if (idx > 18 && idx + 3 < concept.length) {
    const prefix = concept.slice(0, idx).trim();
    const suffix = concept.slice(idx + 3).trim();
    if (suffix.length <= 16) return `${suffix} · ${prefix}`;
  }
  return concept;
}

export default async function AISourcingBatchListPage({ searchParams }: PageProps) {
  const mode = await getAppMode();
  const [query, batches, allCandidates, thresholds] = await Promise.all([
    searchParams,
    listAISourcingBatches(undefined, undefined, { mode }),
    listKanbanCandidates(undefined, undefined, { mode }),
    loadFunnelThresholds(),
  ]);

  const selectedBatchId =
    query.batch && batches.some((b) => b.id === query.batch) ? query.batch : null;
  const candidates = selectedBatchId
    ? allCandidates.filter((c) => c.runId === selectedBatchId)
    : allCandidates;

  const byStage = new Map<KanbanStageKey, KanbanCandidateItem[]>();
  for (const col of KANBAN_COLUMNS) byStage.set(col.key, []);
  for (const item of candidates) {
    byStage.get(item.kanban.stage)?.push(item);
  }

  const activeCount = candidates.filter(
    (c) => c.kanban.stage !== "eliminated" && c.kanban.stage !== "promoted",
  ).length;
  const eliminatedCount = byStage.get("eliminated")?.length ?? 0;
  const returnPath = selectedBatchId
    ? `/ai-sourcing?batch=${encodeURIComponent(selectedBatchId)}`
    : "/ai-sourcing";

  return (
    <div className="page ai-sourcing-page ai-batch-list-page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "选品看板" },
        ]}
        eyebrow="选品漏斗 · 第 2 阶段（4 步深度验证）"
        title="选品看板"
        description="承接选品初筛采纳与 AI/手动新建的高价值方向，按真实取证进度推进（竞品研报 → 成本核算 → 找厂打样 → 风险立项）。"
        actions={<AddSelectionMenu />}
      />

      <MetricGrid
        ariaLabel="候选漏斗概览"
        columns={3}
        items={[
          { label: "推进中方向", value: activeCount, note: "候选 / 已扫 / 利润过 / 拿样中" },
          { label: "已淘汰（避坑库）", value: eliminatedCount, note: "记录原因防止重复踩坑" },
          { label: "研究批次", value: batches.length, note: "可在下方按批次筛选或清理" },
        ]}
      />

      <QueryNotices notice={query.notice} error={query.error} />

      {/* 按批次筛选条 + 批次管理 + 红灯阈值配置 */}
      <div className="funnel-toolbar-strip">
        <nav className="funnel-batch-filter" aria-label="按批次筛选">
          <Link
            href="/ai-sourcing"
            className={`funnel-batch-pill${!selectedBatchId ? " is-active" : ""}`}
          >
            全部方向 <span className="mono">{allCandidates.length}</span>
          </Link>
          {batches.map((b) => (
            <Link
              key={b.id}
              href={`/ai-sourcing?batch=${encodeURIComponent(b.id)}`}
              className={`funnel-batch-pill${selectedBatchId === b.id ? " is-active" : ""}`}
              title={`${getBatchSiteLabel(b)} · ${shortDate(b.createdAt)}`}
            >
              <span>{b.marketCode} · {b.category}</span>
              <span className="mono">{b.hypothesisCount}</span>
            </Link>
          ))}
        </nav>

        <div className="funnel-toolbar-tools">
          {batches.length > 0 ? (
            <details className="funnel-brief-pop">
              <summary className="button ghost compact-button">管理批次 ▾</summary>
              <div className="funnel-brief-popover" style={{ width: "360px" }}>
                <div className="funnel-brief-popover-head">
                  <strong>批次管理</strong>
                  <span>删除批次会保留已立项商品</span>
                </div>
                <div className="funnel-batch-manage-list">
                  {batches.map((b) => (
                    <div key={b.id} className="funnel-batch-manage-row">
                      <div>
                        <strong>{b.marketCode} · {b.category}</strong>
                        <small>{shortDate(b.createdAt)} · {b.hypothesisCount} 个方向</small>
                      </div>
                      <DeleteResearchBatch
                        runId={b.id}
                        category={b.category}
                        promotedCount={b.promotedCount}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </details>
          ) : null}

          <details className="funnel-brief-pop">
            <summary className="button ghost compact-button">红灯阈值 ▾</summary>
            <form action={saveFunnelThresholdsAction} className="funnel-brief-popover funnel-threshold-pop">
              <input type="hidden" name="returnPath" value={returnPath} />
              <div className="funnel-brief-popover-head">
                <strong>红灯阈值配置</strong>
                <span>影响快筛红灯判定</span>
              </div>
              <div className="funnel-threshold-grid-mini">
                <label>
                  <span>竞品达标数</span>
                  <input name="minCompetitorsForPass" type="number" min="4" max="50" defaultValue={thresholds.minCompetitorsForPass} />
                </label>
                <label>
                  <span>垄断 HHI 上限</span>
                  <input name="maxHhi" type="number" min="1500" max="6000" step="100" defaultValue={thresholds.maxHhi} />
                </label>
                <label>
                  <span>Top3 品牌占比 %</span>
                  <input name="maxBrandCr3Percent" type="number" min="30" max="95" defaultValue={thresholds.maxBrandCr3Percent} />
                </label>
                <label>
                  <span>评论中位上限</span>
                  <input name="maxMedianReviews" type="number" min="300" max="20000" step="100" defaultValue={thresholds.maxMedianReviews} />
                </label>
                <label>
                  <span>最低净利率 %</span>
                  <input name="minMarginPct" type="number" min="5" max="50" step="1" defaultValue={Math.round(thresholds.minMarginRate * 100)} />
                </label>
                <label>
                  <span>合规费上限 $</span>
                  <input name="maxComplianceCostUsd" type="number" min="200" max="5000" step="100" defaultValue={thresholds.maxComplianceCostUsd} />
                </label>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button type="submit" className="button primary compact-button">保存阈值</button>
              </div>
            </form>
          </details>
        </div>
      </div>

      {candidates.length === 0 ? (
        <section className="panel">
          <EmptyState
            title="还没有进入选品看板的候选"
            description="点击右上角「+ 添加选品」发起 AI 找方向，或先去「选品初筛」批量快筛后一键采纳进看板。"
            actions={
              <>
                <Link href="/auto-pipeline?action=upload" className="button primary">去选品初筛批量快筛</Link>
                <Link href="/discover?entry=ai" className="button secondary">AI 类目找方向</Link>
              </>
            }
          />
        </section>
      ) : (
        <>
          <section className="funnel-kanban-board" aria-label="选品候选 4 列看板">
            {KANBAN_COLUMNS.filter((col) => col.key !== "eliminated" && col.key !== "promoted").map((col) => {
              const items = byStage.get(col.key) ?? [];
              return (
                <div key={col.key} className={`funnel-kanban-col stage-${col.key}`}>
                  <header className="funnel-kanban-col-head">
                    <div>
                      <strong>{col.label}</strong>
                      <small>{col.hint}</small>
                    </div>
                    <span className="badge badge-neutral mono">{items.length}</span>
                  </header>

                  <div className="funnel-kanban-cards">
                    {items.length === 0 ? (
                      <div className="funnel-kanban-empty">暂无</div>
                    ) : (
                      items.map((item) => (
                        <article key={item.id} className="funnel-kanban-card">
                          <div className="funnel-kanban-card-top">
                            <span className="badge badge-neutral mono">{item.marketCode}</span>
                            <span className="funnel-kanban-metric">{item.kanban.metricBadge}</span>
                          </div>

                          <Link
                            href={item.kanban.nextActionHref}
                            className="funnel-kanban-title"
                            title={item.concept}
                          >
                            {formatKanbanTitle(item.concept)}
                          </Link>

                          <div className="funnel-kanban-card-actions">
                            <Link
                              href={item.kanban.nextActionHref}
                              className="button compact-button primary"
                            >
                              {item.kanban.nextActionLabel}
                            </Link>

                            {col.key !== "promoted" ? (
                              <details className="funnel-kanban-elim-menu">
                                <summary className="button ghost compact-button">淘汰 ▾</summary>
                                <form action={eliminateHypothesisAction} className="funnel-kanban-elim-popover">
                                  <input type="hidden" name="runId" value={item.runId} />
                                  <input type="hidden" name="hypothesisId" value={item.id} />
                                  <input type="hidden" name="returnPath" value={returnPath} />
                                  <div className="funnel-reason-grid compact">
                                    {ELIMINATION_REASONS.map((reason) => (
                                      <button
                                        key={reason}
                                        type="submit"
                                        name="reason"
                                        value={reason}
                                        className="funnel-reason-btn"
                                      >
                                        {reason}
                                      </button>
                                    ))}
                                  </div>
                                </form>
                              </details>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <details className="panel funnel-eliminated-section" open={eliminatedCount > 0}>
            <summary className="funnel-threshold-summary">
              <span>
                <strong>已淘汰 · 避坑清单</strong>
                <span className="badge badge-neutral mono">{eliminatedCount}</span>
                <small>后续新建或 AI 发散命中相似方向时将自动弹窗提醒</small>
              </span>
              <span className="button ghost compact-button">展开 / 收起 ▾</span>
            </summary>

            {eliminatedCount === 0 ? (
              <p className="muted" style={{ fontSize: "12px", margin: "12px 0 0" }}>
                暂无淘汰记录。在上方卡片或验证页点击「淘汰」即可沉淀至此。
              </p>
            ) : (
              <div className="funnel-eliminated-list">
                {(byStage.get("eliminated") ?? []).map((item) => (
                  <div key={item.id} className="funnel-eliminated-row">
                    <span className="badge badge-neutral mono">{item.marketCode}</span>
                    <Link href={item.kanban.nextActionHref} className="funnel-eliminated-name" title={item.concept}>
                      {item.concept}
                    </Link>
                    <span className="badge badge-danger">{item.eliminationReason ?? "已淘汰"}</span>
                    <span className="funnel-eliminated-note">
                      {item.eliminationNote || item.category}
                    </span>
                    <span className="funnel-eliminated-date">
                      {item.eliminatedAt ? shortDate(item.eliminatedAt) : ""}
                    </span>
                    <div className="funnel-eliminated-row-actions">
                      <Link href={item.kanban.nextActionHref} className="button ghost compact-button">
                        查看
                      </Link>
                      <form action={restoreHypothesisAction}>
                        <input type="hidden" name="runId" value={item.runId} />
                        <input type="hidden" name="hypothesisId" value={item.id} />
                        <input type="hidden" name="returnPath" value={returnPath} />
                        <button type="submit" className="button secondary compact-button">恢复</button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </details>
        </>
      )}
    </div>
  );
}
