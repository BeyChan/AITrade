import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveChannelLaunchQueueAction,
  approveChannelListingAction,
  checkChannelLaunchReadinessAction,
  saveChannelListingVersionAction,
} from "@/app/actions";
import { getChannelProfile } from "@/lib/channels";
import { shortDate } from "@/lib/format";
import { emptyListingContent, normalizeListingContent, type ListingPreflightResult } from "@/lib/listing";
import { getChannelTargetDetail, getContentDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string; channelListingId: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function ChannelTargetPage({ params, searchParams }: PageProps) {
  const [{ id, channelListingId }, query] = await Promise.all([params, searchParams]);
  const [target, contentDetail] = await Promise.all([
    getChannelTargetDetail(id, channelListingId),
    getContentDetail(id),
  ]);
  if (!target) notFound();

  const profile = getChannelProfile(target.platform.code);
  const latest = target.latestVersion;
  const content = latest ? normalizeListingContent(latest.canonical_snapshot) : emptyListingContent();
  const preflight = latest?.preflight_result as ListingPreflightResult | undefined;
  const approvedImages = contentDetail?.assets.filter((asset) => asset.asset_type === "main_image" && asset.status === "approved") ?? [];
  const approved = latest?.status === "content_approved";
  const canApprove = Boolean(latest && preflight?.passed && approvedImages.length && !approved);
  const launch = target.launchReadiness;
  const canApproveLaunch = launch.canApproveForLaunchQueue;
  const localReady = ["LATEST_VERSION", "LOCAL_PREFLIGHT", "CONTENT_APPROVED", "MAIN_IMAGE_APPROVED"].every(
    (code) => launch.checks.find((check) => check.code === code)?.state === "pass",
  );

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/">AI 选品</Link> / <Link href={`/cases/${id}`}>{contentDetail?.productCase.asin ?? id}</Link> / <Link href={`/cases/${id}/channels`}>上市矩阵</Link> / {target.market.code} × {target.platform.name}
      </div>

      <div className="title-row">
        <div>
          <div className="eyebrow">Channel listing workspace</div>
          <h1>{target.market.code} × {target.platform.name}</h1>
          <div className="title-meta">
            <span className="badge status-researching">{target.market.locale}</span>
            <span className="badge badge-neutral">{target.market.currency}</span>
            <span className={`badge ${target.account.status === "connected" ? "badge-success" : "status-review_pending"}`}>
              店铺 {target.account.status}
            </span>
            {latest ? <span className={`badge ${approved ? "badge-success" : "status-researching"}`}>Listing v{latest.version} · {approved ? "内容已确认" : "草稿"}</span> : null}
            <span className={`badge ${launchStatusClass(launch.status)}`}>发布准备 · {launch.label}</span>
          </div>
        </div>
        <div className="button-row">
          <Link href={`/cases/${id}/channels`} className="button secondary">返回上市矩阵</Link>
          <Link href={`/cases/${id}/content`} className="button ghost">默认内容工作台</Link>
        </div>
      </div>

      {query.error ? <div className="notice warn"><span className="badge badge-danger">ERROR</span><span>{query.error}</span></div> : null}
      {query.notice ? <div className="notice"><span className="badge badge-success">DONE</span><span>{query.notice}</span></div> : null}

      <div className="notice warn">
        <span className="badge status-review_pending">NO EXTERNAL ACTION</span>
        <span><strong>{profile.connectionLabel}。</strong> 页面中的 payload 只是本地映射预览；content_approved 不等于 published，发布队列确认也不等于平台发布，external ID 保持为空。</span>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="section">
            <div className="section-header">
              <div>
                <h2>渠道上下文</h2>
                <p>同一商品事实派生出的市场版本与平台字段，不把某个平台的规则硬编码到所有国家。</p>
              </div>
              <span className="badge badge-neutral">{profile.adapterType}</span>
            </div>
            <div className="metric-pairs">
              <div className="metric-pair"><small>市场</small><strong>{target.market.code} · {target.market.name}</strong></div>
              <div className="metric-pair"><small>Locale / Currency</small><strong>{target.market.locale} / {target.market.currency}</strong></div>
              <div className="metric-pair"><small>计量口径</small><strong>{target.market.measurement_system}</strong></div>
              <div className="metric-pair"><small>平台</small><strong>{target.platform.name}</strong></div>
              <div className="metric-pair"><small>测试店铺</small><strong>{target.account.is_demo ? "DEMO" : "正式"}</strong></div>
              <div className="metric-pair"><small>外部 ID</small><strong>{target.channelListing.external_id ?? "未连接"}</strong></div>
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>1. 本地 Listing 版本</h2>
                <p>保存后生成 canonical snapshot、平台 payload 和独立预检结果。</p>
              </div>
              {latest ? <span className="badge status-researching">当前 v{latest.version}</span> : <span className="badge badge-neutral">尚无版本</span>}
            </div>
            <form action={saveChannelListingVersionAction} className="stack">
              <input type="hidden" name="caseId" value={id} />
              <input type="hidden" name="channelListingId" value={channelListingId} />
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="brand">品牌</label>
                  <input id="brand" name="brand" defaultValue={content.brand} placeholder="已授权的品牌名" />
                </div>
                <div className="field">
                  <label htmlFor="actor">编辑人</label>
                  <input id="actor" name="actor" required placeholder="输入姓名" />
                </div>
                <div className="field full">
                  <label htmlFor="title">本地化标题</label>
                  <textarea id="title" name="title" className="compact-textarea" defaultValue={content.title} required />
                </div>
                {content.bullets.map((bullet, index) => (
                  <div className="field full" key={index}>
                    <label htmlFor={`bullet-${index}`}>卖点 {index + 1}</label>
                    <textarea id={`bullet-${index}`} name="bullet" defaultValue={bullet} />
                  </div>
                ))}
                <div className="field full">
                  <label htmlFor="description">商品描述</label>
                  <textarea id="description" name="description" className="tall-textarea" defaultValue={content.description} required />
                </div>
                <div className="field full">
                  <label htmlFor="searchTerms">后台关键词 / 标签</label>
                  <textarea id="searchTerms" name="searchTerms" className="compact-textarea" defaultValue={content.searchTerms} />
                </div>
              </div>
              <div className="form-actions">
                <span className="help">保存只写本地数据库；映射规则由 {profile.label} adapter 生成。</span>
                <button className="button primary" type="submit">保存新版本并预检</button>
              </div>
            </form>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>2. 平台 payload 预览</h2>
                <p>展示将要交给平台适配器的结构，不代表已发送或通过平台校验。</p>
              </div>
              <span className="badge badge-neutral">{profile.mappingSupported ? "字段映射可用" : "仅占位"}</span>
            </div>
            <pre className="code-block">{latest ? JSON.stringify(latest.mapped_payload, null, 2) : "保存第一个版本后显示 payload。"}</pre>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>3. 本地预检</h2>
                <p>检查标题、卖点、描述、关键词字节、locale 与高风险声明。</p>
              </div>
              {preflight ? <span className={`badge ${preflight.passed ? "badge-success" : "badge-danger"}`}>{preflight.passed ? "通过" : "未通过"} · {preflight.score}</span> : null}
            </div>
            {preflight ? (
              <>
                <div className="preflight-metrics">
                  <div><small>标题</small><strong>{preflight.metrics.titleChars}</strong><span>字符</span></div>
                  <div><small>卖点</small><strong>{preflight.metrics.filledBulletCount}/5</strong><span>已填写</span></div>
                  <div><small>最长卖点</small><strong>{preflight.metrics.maxBulletChars}</strong><span>字符</span></div>
                  <div><small>描述</small><strong>{preflight.metrics.descriptionChars}</strong><span>字符</span></div>
                  <div><small>关键词</small><strong>{preflight.metrics.searchTermsBytes}</strong><span>字节</span></div>
                </div>
                <div className="finding-list" style={{ marginTop: 16 }}>
                  {preflight.findings.length ? preflight.findings.map((finding, index) => (
                    <div className={`finding ${finding.severity}`} key={`${finding.code}-${index}`}>
                      <span className={`badge ${finding.severity === "error" ? "badge-danger" : "status-review_pending"}`}>{finding.severity === "error" ? "错误" : "提醒"}</span>
                      <span>{finding.message}</span>
                    </div>
                  )) : <div className="empty-inline success">本地预检没有发现确定性问题，但仍需人工核对商标、认证和当地法规。</div>}
                </div>
              </>
            ) : <div className="empty-inline">保存第一版后显示预检明细。</div>}
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>4. 发布准备检查</h2>
                <p>按当前渠道版本重新计算门禁。本地预检、内容确认、主图、正式店铺、官方写 Adapter 和真实 dry-run 分开判断。</p>
              </div>
              <span className={`badge ${launchStatusClass(launch.status)}`}>{launch.label}</span>
            </div>
            <div className="metric-pairs">
              <div className="metric-pair"><small>当前版本</small><strong>{latest ? `v${latest.version}` : "无"}</strong></div>
              <div className="metric-pair"><small>阻断项</small><strong>{launch.blockers.length}</strong></div>
              <div className="metric-pair"><small>真实平台 dry-run</small><strong>{profile.dryRunSupported ? "可用" : "不支持"}</strong></div>
              <div className="metric-pair"><small>外部写入</small><strong>未开放</strong></div>
              <div className="metric-pair"><small>externalActions</small><strong>{launch.externalActions}</strong></div>
              <div className="metric-pair"><small>published</small><strong>{String(launch.published)}</strong></div>
            </div>
            <div className="gate-list" style={{ marginTop: 18 }}>
              {launch.checks.map((check) => (
                <div className={launchCheckClass(check.state)} key={check.code}>
                  <span>{launchCheckIcon(check.state)}</span>
                  <div className="gate-copy">
                    <strong>{check.label}</strong>
                    <small>{check.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className={launch.blockers.length ? "action-warning" : "empty-inline success"} style={{ marginTop: 14 }}>
              {launch.blockers.length
                ? `剩余阻断项：${launch.blockers.map((blocker) => blocker.label).join("、")}。当前不能记录发布队列确认。`
                : "所有发布准备检查均已通过；仍需单独执行平台写入并保存外部回执。"}
            </div>
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>版本历史</h2>
                <p>每个国家 × 平台目标独立递增版本，不覆盖其他市场。</p>
              </div>
            </div>
            {target.versions.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>版本</th><th>状态</th><th>预检</th><th>检查人</th><th>创建时间</th></tr></thead>
                  <tbody>
                    {target.versions.map((version) => {
                      const result = version.preflight_result as Partial<ListingPreflightResult>;
                      return (
                        <tr key={version.id}>
                          <td><strong>v{version.version}</strong></td>
                          <td><span className={`badge ${version.status === "content_approved" ? "badge-success" : "status-researching"}`}>{version.status === "content_approved" ? "内容已确认" : "草稿"}</span></td>
                          <td>{result.score ?? "—"} 分 · {result.errorCount ?? 0} 错误</td>
                          <td>{version.approved_by ?? "—"}</td>
                          <td>{shortDate(version.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">尚无版本。</p>}
          </section>

          <section className="section">
            <div className="section-header">
              <div>
                <h2>发布队列确认记录</h2>
                <p>确认只针对具体 channel version；不会复用旧版本记录，也不会调用平台接口。</p>
              </div>
              <span className="badge badge-neutral">{target.launchReviews.length} 条</span>
            </div>
            {target.launchReviews.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>版本</th><th>结论</th><th>检查状态</th><th>确认人</th><th>外部动作</th><th>时间</th></tr></thead>
                  <tbody>
                    {target.launchReviews.map((review) => {
                      const reviewedVersion = target.versions.find((version) => version.id === review.channel_version_id);
                      return (
                        <tr key={review.id}>
                          <td><strong>v{reviewedVersion?.version ?? "—"}</strong></td>
                          <td><span className="badge badge-success">{review.decision === "approved" ? "确认进入队列" : "已否决"}</span></td>
                          <td>{review.readiness_status} · {review.blocker_count} 阻断</td>
                          <td>{review.reviewer}</td>
                          <td>{review.external_actions} · published={String(review.published)}</td>
                          <td>{shortDate(review.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted">尚无发布队列确认记录。</p>}
          </section>
        </div>

        <aside className="stack">
          <section className={approved ? "action-card" : "action-card"}>
            <div className="eyebrow" style={{ color: "var(--lime)" }}>Human content gate</div>
            <h2>{approved ? "该版本已内容确认" : "人工确认本地内容"}</h2>
            {approved ? (
              <>
                <p>v{latest?.version} 已通过人工内容检查。该状态仅表示内部内容门禁完成；发布准备、平台 dry-run 和外部写入仍需单独通过。</p>
                <div className="selection-side-meta">
                  <span>检查人</span><strong>{latest?.approved_by ?? "—"}</strong>
                  <span>检查时间</span><strong>{latest?.approved_at ? shortDate(latest.approved_at) : "—"}</strong>
                  <span>预检分</span><strong>{preflight?.score ?? "—"}</strong>
                </div>
                <Link href={`/cases/${id}/channels`} className="button primary" style={{ width: "100%", marginTop: 16 }}>返回上市矩阵</Link>
              </>
            ) : (
              <>
                <p>确认要求本地预检通过、至少一张主图通过人工检查，并填写声明核验依据。系统不会调用平台接口。</p>
                <form action={approveChannelListingAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="channelListingId" value={channelListingId} />
                  <div className="field">
                    <label htmlFor="reviewer">检查人</label>
                    <input id="reviewer" name="reviewer" required disabled={!canApprove} />
                  </div>
                  <div className="field">
                    <label htmlFor="notes">检查说明</label>
                    <textarea id="notes" name="notes" required disabled={!canApprove} placeholder="记录品牌、商标、认证、图片授权和当地合规依据。" />
                  </div>
                  {!canApprove ? (
                    <div className="action-warning">
                      {!latest ? "先保存 Listing 版本。" : !preflight?.passed ? "预检未通过，请修正后保存新版本。" : !approvedImages.length ? "请先在内容工作台通过主图人工检查。" : "当前版本不可重复确认。"}
                    </div>
                  ) : null}
                  <button className="button primary" type="submit" disabled={!canApprove}>确认内容</button>
                </form>
              </>
            )}
          </section>

          <section className="section">
            <div className="eyebrow">Launch readiness gate</div>
            <h3>{launch.label}</h3>
            <p className="muted">{launch.description}</p>
            <div className="selection-side-meta">
              <span>本地内容</span><strong>{localReady ? "已完成" : "未完成"}</strong>
              <span>平台 dry-run</span><strong>{profile.dryRunSupported ? "可用" : "unsupported"}</strong>
              <span>外部写入</span><strong>none</strong>
              <span>published</span><strong>false</strong>
            </div>
            <form action={checkChannelLaunchReadinessAction} className="stack" style={{ marginTop: 16 }}>
              <input type="hidden" name="caseId" value={id} />
              <input type="hidden" name="channelListingId" value={channelListingId} />
              <div className="field">
                <label htmlFor="launch-checker">检查人</label>
                <input id="launch-checker" name="actor" required placeholder="输入姓名并记录审计" />
              </div>
              <button className="button secondary" type="submit">运行发布准备检查</button>
            </form>

            <div className="section-divider" />

            {launch.status === "approved_for_publish" ? (
              <div className="empty-inline success">
                当前版本已人工确认进入内部发布队列；仍未调用平台，published=false。
              </div>
            ) : (
              <form action={approveChannelLaunchQueueAction} className="stack">
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="channelListingId" value={channelListingId} />
                <div className="field">
                  <label htmlFor="launch-reviewer">发布队列确认人</label>
                  <input id="launch-reviewer" name="reviewer" required disabled={!canApproveLaunch} />
                </div>
                <div className="field">
                  <label htmlFor="launch-notes">确认说明</label>
                  <textarea id="launch-notes" name="notes" required disabled={!canApproveLaunch} placeholder="记录 dry-run 回执、平台类目、价格库存和放量范围。" />
                </div>
                {!canApproveLaunch ? (
                  <div className="action-warning">
                    {launch.blockers[0]?.detail ?? "当前状态不允许记录发布队列确认。"} 当前不会调用任何平台 API。
                  </div>
                ) : null}
                <button className="button primary" type="submit" disabled={!canApproveLaunch}>确认进入内部发布队列</button>
              </form>
            )}
          </section>

          <section className="section">
            <div className="eyebrow">Target audit</div>
            <h3>目标审计</h3>
            {target.auditLogs.length ? (
              <div className="timeline">
                {target.auditLogs.map((entry) => (
                  <div className="timeline-item" key={entry.id}>
                    <span className="timeline-dot" />
                    <div>
                      <div className="timeline-title">{auditLabel(entry.action)}</div>
                      <div className="timeline-meta">{entry.actor} · {shortDate(entry.created_at)}{entry.details.version ? ` · v${String(entry.details.version)}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="muted">暂无目标审计记录。</p>}
          </section>

          <section className="section">
            <h3>当前边界</h3>
            <div className="gate-list">
              <div className="done"><span>✓</span>字段映射与本地预览</div>
              <div className={preflight?.passed ? "done" : ""}><span>{preflight?.passed ? "✓" : "2"}</span>本地预检</div>
              <div className={approved ? "done" : ""}><span>{approved ? "✓" : "3"}</span>人工内容确认</div>
              <div className={launchCheckClass(launch.checks.find((check) => check.code === "VERSION_LAUNCH_APPROVAL")?.state ?? "pending")}>
                <span>{launchCheckIcon(launch.checks.find((check) => check.code === "VERSION_LAUNCH_APPROVAL")?.state ?? "pending")}</span>
                当前版本发布队列确认
              </div>
              <div className="unsupported"><span>×</span>真实平台 dry-run / 外部写入未开放</div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function launchStatusClass(status: string) {
  if (status === "approved_for_publish") return "badge-success";
  if (status === "dry_run_unsupported" || status === "approval_pending") return "status-review_pending";
  if (status === "local_ready") return "status-researching";
  return "badge-danger";
}

function launchCheckClass(state: string) {
  if (state === "pass") return "done";
  if (state === "unsupported") return "unsupported";
  if (state === "pending") return "pending";
  return "failed";
}

function launchCheckIcon(state: string) {
  if (state === "pass") return "✓";
  if (state === "unsupported") return "×";
  if (state === "pending") return "…";
  return "!";
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "channel.target_created": "创建渠道目标",
    "channel.listing_version_saved": "保存渠道版本并预检",
    "channel.content_approved": "人工确认渠道内容",
    "channel.launch_readiness_checked": "运行发布准备检查",
    "channel.launch_queue_approved": "确认进入内部发布队列",
    "listing.draft_saved": "保存 Amazon 本地版本并预检",
    "listing.content_approved": "人工确认 Amazon 本地内容",
  };
  return labels[action] ?? action;
}
