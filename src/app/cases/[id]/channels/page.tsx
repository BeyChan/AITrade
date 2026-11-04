import Link from "next/link";
import { notFound } from "next/navigation";
import { createChannelTargetAction } from "@/app/actions";
import { StatusBadge } from "@/components/badges";
import { getChannelProfile } from "@/lib/channels";
import { shortDate } from "@/lib/format";
import { getChannelMatrix } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function ChannelMatrixPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const matrix = await getChannelMatrix(id);
  if (!matrix) notFound();

  const { productCase, product, targets, markets, platforms, auditLogs } = matrix;
  const approvedTargets = targets.filter((target) => target.latestVersion?.status === "content_approved").length;
  const preflightedTargets = targets.filter((target) => target.latestVersion?.preflight_result?.passed).length;
  const defaultMarket = markets.find((market) => market.code === productCase.marketplace) ?? markets.find((market) => market.code === "US") ?? markets[0];

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/">商品机会</Link> / <Link href={`/cases/${productCase.id}`}>{productCase.asin}</Link> / 上市矩阵
      </div>

      <div className="title-row">
        <div>
          <div className="eyebrow">Market × channel matrix</div>
          <h1>{productCase.title}</h1>
          <div className="title-meta">
            <StatusBadge status={productCase.status} />
            <span className="badge badge-neutral">SKU {product?.sku ?? "待生成"}</span>
            <span className="badge badge-neutral">{targets.length} 个国家 × 平台目标</span>
            <span className="badge status-researching">P1.1 本地适配层</span>
          </div>
        </div>
        <div className="button-row">
          <Link href={`/cases/${productCase.id}`} className="button secondary">商品详情</Link>
          <Link href={`/cases/${productCase.id}/content`} className="button secondary">默认内容工作台</Link>
        </div>
      </div>

      {query.error ? (
        <div className="notice warn"><span className="badge badge-danger">ERROR</span><span>{query.error}</span></div>
      ) : null}
      {query.notice ? (
        <div className="notice"><span className="badge badge-success">DONE</span><span>{query.notice}</span></div>
      ) : null}

      <div className="notice warn">
        <span className="badge status-review_pending">LOCAL ONLY</span>
        <span>
          <strong>当前只做国家/市场版本、平台字段映射与本地预检。</strong>
          Amazon、Shopify、TikTok Shop、eBay 连接器均未配置；不会调用平台 API、不会发布、不会改价、不会下单或付款。
        </span>
      </div>

      <section className="metrics-grid" aria-label="渠道矩阵概览">
        <article className="metric-card">
          <div className="metric-label">渠道目标</div>
          <div className="metric-value">{targets.length}</div>
          <div className="metric-note">同一商品可覆盖多个国家与平台</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">已有本地版本</div>
          <div className="metric-value">{targets.filter((target) => target.latestVersion).length}</div>
          <div className="metric-note">每个目标独立版本与 payload</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">预检通过</div>
          <div className="metric-value">{preflightedTargets}</div>
          <div className="metric-note">预检不是平台 dry-run</div>
        </article>
        <article className="metric-card">
          <div className="metric-label">内容已批准</div>
          <div className="metric-value">{approvedTargets}</div>
          <div className="metric-note">仅内部门禁，未发布</div>
        </article>
      </section>

      <div className="channel-layout">
        <section className="section">
          <div className="section-header">
            <div>
              <h2>新增国家 × 平台目标</h2>
              <p>同一组合幂等复用；平台店铺自动标记为测试且状态为 unconfigured。</p>
            </div>
          </div>
          <form action={createChannelTargetAction} className="stack">
            <input type="hidden" name="caseId" value={productCase.id} />
            <div className="form-grid">
              <div className="field">
                <label htmlFor="marketCode">目标国家 / 市场</label>
                <select id="marketCode" name="marketCode" defaultValue={defaultMarket?.code}>
                  {markets.map((market) => (
                    <option key={market.code} value={market.code}>
                      {market.code} · {market.name} · {market.locale} · {market.currency}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="platformCode">平台</label>
                <select id="platformCode" name="platformCode" defaultValue="amazon">
                  {platforms.map((platform) => (
                    <option key={platform.code} value={platform.code}>{platform.name}</option>
                  ))}
                </select>
              </div>
              <div className="field full">
                <label htmlFor="actor">创建人</label>
                <input id="actor" name="actor" required placeholder="输入姓名，写入审计日志" />
              </div>
            </div>
            <div className="form-actions">
              <span className="help">市场版本自动继承 locale、currency 和计量口径；店铺连接状态不会因此变成 connected。</span>
              <button className="button primary" type="submit">创建本地渠道目标</button>
            </div>
          </form>
        </section>

        <aside className="section channel-boundary-card">
          <div className="eyebrow">Connector boundary</div>
          <h3>什么是“已经上架”？</h3>
          <p>本页不产生平台上架。只有真实连接店铺、平台 dry-run、发布审批和外部回执都完成后，才应出现 external ID。</p>
          <div className="gate-list">
            <div className="done"><span>✓</span>国家/市场版本独立</div>
            <div className="done"><span>✓</span>平台 payload 可预览</div>
            <div><span>3</span>平台连接器未配置</div>
            <div><span>4</span>不出站、不发布</div>
          </div>
        </aside>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <div>
            <h2>渠道目标与最新版本</h2>
            <p>不同国家可以有不同货币、语言、标题与预检结果；它们共享商品事实，但不共享发布状态。</p>
          </div>
        </div>

        {targets.length === 0 ? (
          <div className="empty-state">
            <h3>还没有渠道目标</h3>
            <p>先创建一个国家 × 平台组合，再保存该市场的独立 Listing 版本。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>国家 / 市场</th>
                  <th>平台与连接器</th>
                  <th>本地化</th>
                  <th>最新版本</th>
                  <th>预检</th>
                  <th>外部 ID</th>
                  <th aria-label="打开目标" />
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => {
                  const profile = getChannelProfile(target.platform.code);
                  const version = target.latestVersion;
                  const preflight = version?.preflight_result;
                  return (
                    <tr key={target.channelListing.id}>
                      <td>
                        <div className="product-title">{target.market.code} · {target.market.name}</div>
                        <div className="product-meta"><span>{target.market.region}</span><span>{target.market.measurement_system}</span></div>
                      </td>
                      <td>
                        <div className="product-title">{target.platform.name}</div>
                        <div className="connector-line"><span className={`connector-dot ${target.account.status}`} />{profile.connectionLabel}</div>
                        <div className="subvalue">{target.account.name} · {target.account.status}</div>
                      </td>
                      <td>
                        <div>{target.market.locale}</div>
                        <div className="subvalue">{target.market.currency} · {target.variant.title.slice(0, 42)}</div>
                      </td>
                      <td>
                        {version ? (
                          <>
                            <span className={`badge ${version.status === "content_approved" ? "badge-success" : "status-researching"}`}>v{version.version}</span>
                            <div className="subvalue">{version.status === "content_approved" ? "内容已批准" : "草稿"} · 共 {target.versionCount} 版</div>
                          </>
                        ) : <span className="badge badge-neutral">尚无版本</span>}
                      </td>
                      <td>
                        {version && preflight ? (
                          <>
                            <span className={`badge ${preflight.passed ? "badge-success" : "badge-danger"}`}>{preflight.score ?? "—"} 分</span>
                            <div className="subvalue">{preflight.errorCount ?? 0} 错误 · {preflight.warningCount ?? 0} 提醒</div>
                          </>
                        ) : <span className="muted">待运行</span>}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{target.channelListing.external_id ?? "未连接"}</span>
                        <div className="subvalue">{shortDate(target.channelListing.updated_at)}</div>
                      </td>
                      <td>
                        <Link href={`/cases/${productCase.id}/channels/${target.channelListing.id}`} className="arrow-link" aria-label={`打开 ${target.market.code} ${target.platform.name}`}>→</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section" style={{ marginTop: 20 }}>
        <div className="section-header">
          <div>
            <h2>渠道审计时间线</h2>
            <p>目标创建、版本保存、人工批准全部记录 platform、market、version 和 externalActions=none。</p>
          </div>
        </div>
        {auditLogs.filter((entry) => String(entry.action).startsWith("channel.") || String(entry.action).startsWith("listing.")).length ? (
          <div className="timeline">
            {auditLogs
              .filter((entry) => String(entry.action).startsWith("channel.") || String(entry.action).startsWith("listing."))
              .slice(0, 16)
              .map((entry) => (
                <div className="timeline-item" key={entry.id}>
                  <span className="timeline-dot" />
                  <div>
                    <div className="timeline-title">{auditLabel(entry.action)}</div>
                    <div className="timeline-meta">
                      {entry.actor} · {shortDate(entry.created_at)}
                      {entry.details.marketCode ? ` · ${String(entry.details.marketCode)} × ${String(entry.details.platformCode ?? "")}` : ""}
                      {entry.details.version ? ` · v${String(entry.details.version)}` : ""} · 外部动作 none
                    </div>
                  </div>
                </div>
              ))}
          </div>
        ) : <p className="muted" style={{ marginBottom: 0 }}>暂无渠道审计记录。</p>}
      </section>
    </div>
  );
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "channel.target_created": "创建国家 × 平台目标",
    "channel.listing_version_saved": "保存渠道 Listing 版本并预检",
    "channel.content_approved": "人工批准渠道内容",
    "listing.draft_saved": "保存 Amazon 本地版本并预检",
    "listing.content_approved": "人工批准 Amazon 本地内容",
  };
  return labels[action] ?? action;
}
