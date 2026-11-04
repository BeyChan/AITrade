import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approveListingContentAction,
  reviewMainImageAction,
  saveListingDraftAction,
  saveProductDefinitionAction,
  uploadMainImageAction,
} from "@/app/actions";
import { StatusBadge } from "@/components/badges";
import { money, shortDate } from "@/lib/format";
import { emptyListingContent, normalizeListingContent, preflightListing } from "@/lib/listing";
import { getContentDetail } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
};

export default async function ContentStudioPage({ params, searchParams }: PageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const detail = await getContentDetail(id);
  if (!detail) notFound();

  const { productCase, costModel, selection, selectedSupplierName, profile, assets, listing, listingReviews, auditLogs } = detail;
  const content = listing ? normalizeListingContent(listing.content) : emptyListingContent();
  const preflight = listing ? preflightListing(content) : null;
  const mainImages = assets.filter((asset) => asset.asset_type === "main_image");
  const approvedImages = mainImages.filter((asset) => asset.status === "approved");
  const latestMainImage = mainImages[0] ?? null;
  const latestHumanReview = listingReviews.find((review) => review.review_type === "human_content_review") ?? null;
  const contentApproved = listing?.status === "content_approved";
  const canApprove = Boolean(listing && preflight?.passed && approvedImages.length && !contentApproved);

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link href="/">AI 选品</Link> / <Link href={`/cases/${productCase.id}`}>{productCase.asin}</Link> / <Link href={`/cases/${productCase.id}/channels`}>上市矩阵</Link> / 默认内容工作台
      </div>

      <div className="title-row">
        <div>
          <div className="eyebrow">Content &amp; listing studio</div>
          <h1>{productCase.title}</h1>
          <div className="title-meta">
            <StatusBadge status={productCase.status} />
            <span className="badge badge-neutral">{productCase.marketplace}</span>
            <span className="badge badge-neutral">{productCase.category}</span>
            {listing ? <span className="badge status-researching">Listing v{listing.version}</span> : <span className="badge badge-neutral">尚无 Listing 草稿</span>}
          </div>
        </div>
        <div className="button-row">
          <Link href={`/cases/${productCase.id}`} className="button secondary">商品与成本详情</Link>
          <Link href={`/cases/${productCase.id}/channels`} className="button primary">多国家 / 多平台矩阵</Link>
          <Link href={`/cases/${productCase.id}/sourcing`} className="button ghost">供应商定标</Link>
        </div>
      </div>

      {query.error ? (
        <div className="notice warn"><span className="badge badge-danger">ERROR</span><span>{query.error}</span></div>
      ) : null}
      {query.notice ? (
        <div className="notice"><span className="badge badge-success">DONE</span><span>{query.notice}</span></div>
      ) : null}
      {productCase.is_demo ? (
        <div className="notice">
          <span className="badge demo-badge">DEMO</span>
          <span>当前商品为演示数据。上传的图片、商品定义和 Listing 只用于验证工作流，不代表真实商品资料或可发布内容。</span>
        </div>
      ) : null}

      {!selection ? (
        <section className="panel locked-panel">
          <div className="empty-state">
            <span className="badge status-review_pending">LOCKED</span>
            <h3>先完成供应商人工定标</h3>
            <p>内容制作必须建立在已确认的供应商和成本模型之上。系统不会绕过定标直接生成采购承诺或发布内容。</p>
            <Link href={`/cases/${productCase.id}/sourcing`} className="button primary">前往供应商定标</Link>
          </div>
        </section>
      ) : (
        <>
          <section className="content-context">
            <div>
              <span className="eyebrow" style={{ color: "var(--lime)" }}>Selected source</span>
              <h2>{selectedSupplierName ?? "已定标供应商"}</h2>
              <p>内容工作台已解锁。商品定义、主图与 Listing 都必须使用经过人工确认的事实，不得把竞品图片或未核验声明当成自有素材。</p>
            </div>
            <div className="selection-result-meta">
              <span>当前成本模型</span><strong>{costModel ? `v${costModel.version}` : "—"}</strong>
              <span>到岸成本</span><strong>{costModel ? money(costModel.assumptions.landedCostCents) : "—"}</strong>
              <span>定标人</span><strong>{selection.selected_by}</strong>
              <span>内容确认</span><strong>{contentApproved ? "已通过" : "未通过"}</strong>
            </div>
          </section>

          <section className="metrics-grid content-summary-grid">
            <article className="metric-card">
              <div className="metric-label">商品定义</div>
              <div className="metric-value content-metric-text">{profile ? "已保存" : "待填写"}</div>
              <div className="metric-note">{profile ? `${profile.updated_by} · ${shortDate(profile.updated_at)}` : "先固定目标用户、差异点和事实边界"}</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">主图素材</div>
              <div className="metric-value">{approvedImages.length} / {mainImages.length}</div>
              <div className="metric-note">已通过人工检查 / 已上传</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">发布预检</div>
              <div className="metric-value">{preflight ? preflight.score : "—"}</div>
              <div className="metric-note">{preflight ? `${preflight.errorCount} 错误 · ${preflight.warningCount} 提醒` : "保存草稿后自动运行"}</div>
            </article>
            <article className="metric-card">
              <div className="metric-label">Listing 版本</div>
              <div className="metric-value content-metric-text">{listing ? `v${listing.version}` : "—"}</div>
              <div className="metric-note">{contentApproved ? "内容已人工确认，未发布" : listing ? "草稿，等待人工检查" : "尚未创建草稿"}</div>
            </article>
          </section>

          <div className="detail-grid">
            <div className="stack">
              <section className="section">
                <div className="section-header">
                  <div>
                    <h2>1. 商品定义</h2>
                    <p>先把产品事实、目标用户和禁用声明固定下来，再写标题与卖点。</p>
                  </div>
                  {profile ? <span className="badge badge-success">已保存</span> : <span className="badge status-review_pending">待完成</span>}
                </div>
                <form action={saveProductDefinitionAction} className="stack">
                  <input type="hidden" name="caseId" value={productCase.id} />
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="productName">商品名称</label>
                      <input id="productName" name="productName" required defaultValue={profile?.product_name ?? ""} placeholder="例：静音可拆洗宠物饮水器" />
                    </div>
                    <div className="field">
                      <label htmlFor="targetCustomer">目标用户</label>
                      <input id="targetCustomer" name="targetCustomer" required defaultValue={profile?.target_customer ?? ""} placeholder="例：养猫或小型犬、对夜间噪音敏感的家庭" />
                    </div>
                    <div className="field full">
                      <label htmlFor="coreDifferentiator">核心差异点</label>
                      <textarea id="coreDifferentiator" name="coreDifferentiator" required defaultValue={profile?.core_differentiator ?? ""} placeholder="只写已有样品、供应商或证据能够支持的事实。" />
                    </div>
                    <div className="field full">
                      <label htmlFor="specifications">规格、材质与关键尺寸</label>
                      <textarea id="specifications" name="specifications" required defaultValue={profile?.specifications ?? ""} placeholder="容量、材质、尺寸、重量、电源、滤芯型号等。" />
                    </div>
                    <div className="field full">
                      <label htmlFor="packageContents">包装清单</label>
                      <textarea id="packageContents" name="packageContents" required defaultValue={profile?.package_contents ?? ""} placeholder="主机、滤芯、电源适配器、说明书、赠品等。" />
                    </div>
                    <div className="field full">
                      <label htmlFor="claimsToAvoid">禁用声明与待核验事项</label>
                      <textarea id="claimsToAvoid" name="claimsToAvoid" defaultValue={profile?.claims_to_avoid ?? ""} placeholder="例：未经认证不得写 FDA approved；不得写 100% 静音。" />
                    </div>
                    <div className="field">
                      <label htmlFor="definitionActor">编辑人</label>
                      <input id="definitionActor" name="actor" required defaultValue={profile?.updated_by ?? ""} placeholder="输入姓名" />
                    </div>
                  </div>
                  <div className="form-actions">
                    <span className="help">商品定义会写入审计日志；后续修改不会覆盖历史记录。</span>
                    <button className="button primary" type="submit">保存商品定义</button>
                  </div>
                </form>
              </section>

              <section className="section">
                <div className="section-header">
                  <div>
                    <h2>2. 主图上传与人工检查</h2>
                    <p>系统校验真实图片格式与大小；白底、完整商品和文案合规由人确认。</p>
                  </div>
                  <span className="badge badge-neutral">仅本地存储</span>
                </div>

                <form action={uploadMainImageAction} className="upload-row">
                  <input type="hidden" name="caseId" value={productCase.id} />
                  <div className="field">
                    <label htmlFor="image">选择 JPG / PNG / WebP，最大 8 MB</label>
                    <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required />
                  </div>
                  <div className="field">
                    <label htmlFor="uploadActor">上传人</label>
                    <input id="uploadActor" name="actor" required placeholder="输入姓名" />
                  </div>
                  <button className="button secondary" type="submit">上传主图</button>
                </form>

                {mainImages.length ? (
                  <div className="asset-grid">
                    {mainImages.map((asset, index) => {
                      const originalName = typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : `主图 ${mainImages.length - index}`;
                      const size = Number(asset.metadata.size ?? 0);
                      return (
                        <article className={`asset-card ${asset.status === "approved" ? "approved" : ""}`} key={asset.id}>
                          <img src={asset.file_url} alt={originalName} className="asset-thumb" />
                          <div className="asset-body">
                            <div className="asset-top">
                              <strong>{originalName}</strong>
                              <span className={`badge ${asset.status === "approved" ? "badge-success" : "status-review_pending"}`}>
                                {asset.status === "approved" ? "已检查" : "待检查"}
                              </span>
                            </div>
                            <div className="subvalue">{(size / 1024).toFixed(0)} KB · {shortDate(asset.created_at)}</div>
                            {asset.status !== "approved" ? (
                              <details className="review-details">
                                <summary>人工检查此图</summary>
                                <form action={reviewMainImageAction} className="stack" style={{ marginTop: 12 }}>
                                  <input type="hidden" name="caseId" value={productCase.id} />
                                  <input type="hidden" name="assetId" value={asset.id} />
                                  <label className="check-row"><input type="checkbox" name="whiteBackground" /> 白底或平台允许的纯色背景</label>
                                  <label className="check-row"><input type="checkbox" name="productComplete" /> 商品完整、比例清楚、未被裁切</label>
                                  <label className="check-row"><input type="checkbox" name="noTextWatermark" /> 无未授权文字、Logo、水印或促销角标</label>
                                  <label className="check-row"><input type="checkbox" name="resolutionConfirmed" /> 已人工确认分辨率和画质满足目标平台要求</label>
                                  <div className="field">
                                    <label htmlFor={`imageReviewer-${asset.id}`}>检查人</label>
                                    <input id={`imageReviewer-${asset.id}`} name="reviewer" required placeholder="输入姓名" />
                                  </div>
                                  <div className="field">
                                    <label htmlFor={`imageNotes-${asset.id}`}>检查说明</label>
                                    <textarea id={`imageNotes-${asset.id}`} name="notes" required placeholder="记录版本、来源和仍需修正的问题。" />
                                  </div>
                                  <button className="button primary" type="submit">确认主图检查通过</button>
                                </form>
                              </details>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-inline">还没有上传主图。请使用自有拍摄、供应商授权素材或明确可商用的生成图。</div>
                )}
              </section>

              <section className="section">
                <div className="section-header">
                  <div>
                    <h2>3. Listing 草稿</h2>
                    <p>每次保存都会创建新版本，并自动运行确定性发布预检。</p>
                  </div>
                  {listing ? (
                    <span className={`badge ${contentApproved ? "badge-success" : "status-researching"}`}>
                      {contentApproved ? `v${listing.version} 已确认` : `v${listing.version} 草稿`}
                    </span>
                  ) : null}
                </div>

                <form action={saveListingDraftAction} className="stack">
                  <input type="hidden" name="caseId" value={productCase.id} />
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="brand">品牌</label>
                      <input id="brand" name="brand" defaultValue={content.brand} placeholder="确认后的品牌名" />
                    </div>
                    <div className="field">
                      <label htmlFor="listingActor">编辑人</label>
                      <input id="listingActor" name="actor" required defaultValue={listing?.created_by ?? ""} placeholder="输入姓名" />
                    </div>
                    <div className="field full">
                      <label htmlFor="title">标题 <span className="label-count">建议 40–200 字符</span></label>
                      <textarea id="title" name="title" className="compact-textarea" defaultValue={content.title} required placeholder="品牌 + 核心品类 + 核心功能 + 适用对象" />
                    </div>
                    {content.bullets.map((bullet, index) => (
                      <div className="field full" key={index}>
                        <label htmlFor={`bullet-${index}`}>五点描述 {index + 1} <span className="label-count">最多 500 字符</span></label>
                        <textarea id={`bullet-${index}`} name="bullet" defaultValue={bullet} required placeholder="一条只表达一个购买理由。" />
                      </div>
                    ))}
                    <div className="field full">
                      <label htmlFor="description">商品描述 <span className="label-count">最多 2000 字符</span></label>
                      <textarea id="description" name="description" className="tall-textarea" defaultValue={content.description} required placeholder="补充场景、使用方式、包装内容和必要限制。" />
                    </div>
                    <div className="field full">
                      <label htmlFor="searchTerms">后台搜索词 <span className="label-count">最多 250 字节</span></label>
                      <textarea id="searchTerms" name="searchTerms" className="compact-textarea" defaultValue={content.searchTerms} required placeholder="使用空格分隔，不要堆砌竞品品牌。" />
                    </div>
                  </div>
                  <div className="form-actions">
                    <span className="help">保存不会发布到 Amazon，也不会调用任何外部平台接口。</span>
                    <button className="button primary" type="submit">保存草稿并运行预检</button>
                  </div>
                </form>
              </section>

              <section className="section">
                <div className="section-header">
                  <div>
                    <h2>4. 发布预检结果</h2>
                    <p>确定性规则检查长度、完整性、搜索词字节和可能的高风险声明。</p>
                  </div>
                  {preflight ? (
                    <span className={`badge ${preflight.passed ? "badge-success" : "badge-danger"}`}>
                      {preflight.passed ? "预检通过" : "预检未通过"} · {preflight.score}
                    </span>
                  ) : null}
                </div>
                {preflight ? (
                  <>
                    <div className="preflight-metrics">
                      <div><small>标题</small><strong>{preflight.metrics.titleChars}</strong><span>字符</span></div>
                      <div><small>卖点</small><strong>{preflight.metrics.filledBulletCount}/5</strong><span>已填写</span></div>
                      <div><small>最长卖点</small><strong>{preflight.metrics.maxBulletChars}</strong><span>字符</span></div>
                      <div><small>描述</small><strong>{preflight.metrics.descriptionChars}</strong><span>字符</span></div>
                      <div><small>搜索词</small><strong>{preflight.metrics.searchTermsBytes}</strong><span>字节</span></div>
                    </div>
                    {preflight.findings.length ? (
                      <div className="finding-list">
                        {preflight.findings.map((finding, index) => (
                          <div className={`finding ${finding.severity}`} key={`${finding.code}-${index}`}>
                            <span className={`badge ${finding.severity === "error" ? "badge-danger" : "status-review_pending"}`}>
                              {finding.severity === "error" ? "错误" : "提醒"}
                            </span>
                            <span>{finding.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-inline success">没有发现确定性问题。仍需人工核对品牌、商标、认证和声明依据。</div>
                    )}
                  </>
                ) : (
                  <div className="empty-inline">保存第一版 Listing 草稿后，这里会显示预检明细。</div>
                )}
              </section>

              <section className="section">
                <div className="section-header">
                  <div>
                    <h2>审计时间线</h2>
                    <p>商品定义、图片检查、Listing 版本和内容确认均写入审计日志。</p>
                  </div>
                </div>
                {auditLogs.length ? (
                  <div className="timeline">
                    {auditLogs.map((entry) => (
                      <div className="timeline-item" key={entry.id}>
                        <span className="timeline-dot" />
                        <div>
                          <div className="timeline-title">{auditLabel(entry.action)}</div>
                          <div className="timeline-meta">{entry.actor} · {shortDate(entry.created_at)}{auditSummary(entry.action, entry.details)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="muted">暂无审计记录。</p>}
              </section>
            </div>

            <aside className="stack">
              <section className="listing-preview">
                <div className="eyebrow" style={{ color: "var(--lime)" }}>Listing preview</div>
                {latestMainImage ? <img src={latestMainImage.file_url} alt="Listing 主图预览" className="preview-image" /> : <div className="preview-image-placeholder">MAIN IMAGE</div>}
                <div className="preview-brand">{content.brand || "BRAND"}</div>
                <h3>{content.title || "保存草稿后显示标题"}</h3>
                <div className="preview-rating">★★★★☆ <span>示例预览</span></div>
                <ul>
                  {content.bullets.map((bullet, index) => bullet ? <li key={index}>{bullet}</li> : null)}
                </ul>
                <p>{content.description || "商品描述将在这里显示。"}</p>
                {content.searchTerms ? <div className="preview-terms"><strong>后台搜索词</strong><span>{content.searchTerms}</span></div> : null}
              </section>

              <section className="action-card">
                <div className="eyebrow" style={{ color: "var(--lime)" }}>Human content gate</div>
                <h2>{contentApproved ? "内容已人工确认" : "人工内容确认"}</h2>
                {contentApproved ? (
                  <>
                    <p>当前 Listing v{listing?.version} 已通过内容检查。系统仍未发布到平台，也没有调用 SP-API。</p>
                    <div className="selection-side-meta">
                      <span>检查人</span><strong>{latestHumanReview?.reviewer ?? "—"}</strong>
                      <span>预检分</span><strong>{preflight?.score ?? "—"}</strong>
                      <span>检查时间</span><strong>{latestHumanReview ? shortDate(latestHumanReview.created_at) : "—"}</strong>
                    </div>
                    <Link href={`/cases/${productCase.id}`} className="button primary" style={{ width: "100%", marginTop: 16 }}>返回商品详情</Link>
                  </>
                ) : (
                  <>
                    <p>只有预检通过且至少一张主图通过人工检查后，才允许记录内容确认。提醒项仍需在检查说明中解释。</p>
                    <form action={approveListingContentAction} className="stack">
                      <input type="hidden" name="caseId" value={productCase.id} />
                      <div className="field">
                        <label htmlFor="contentReviewer">检查人</label>
                        <input id="contentReviewer" name="reviewer" required placeholder="输入姓名" disabled={!canApprove} />
                      </div>
                      <div className="field">
                        <label htmlFor="contentNotes">检查说明</label>
                        <textarea
                          id="contentNotes"
                          name="notes"
                          required
                          disabled={!canApprove}
                          placeholder="记录品牌、商标、认证、图片授权和高风险声明的核验依据。"
                        />
                      </div>
                      {!canApprove ? (
                        <div className="action-warning">
                          {!listing ? "先保存 Listing 草稿。" : !preflight?.passed ? "预检尚未通过，请修正错误后保存新版本。" : !approvedImages.length ? "请先上传并通过至少一张主图。" : "当前版本不可再次确认。"}
                        </div>
                      ) : null}
                      <button className="button primary" type="submit" disabled={!canApprove}>确认内容</button>
                    </form>
                  </>
                )}
              </section>

              <section className="section">
                <h3>当前门禁</h3>
                <div className="gate-list">
                  <div className={profile ? "done" : ""}><span>{profile ? "✓" : "1"}</span>商品定义已保存</div>
                  <div className={approvedImages.length ? "done" : ""}><span>{approvedImages.length ? "✓" : "2"}</span>主图通过人工检查</div>
                  <div className={preflight?.passed ? "done" : ""}><span>{preflight?.passed ? "✓" : "3"}</span>确定性发布预检通过</div>
                  <div className={contentApproved ? "done" : ""}><span>{contentApproved ? "✓" : "4"}</span>人工内容确认</div>
                </div>
                <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
                  这是内容确认，不是平台上架。SP-API dry-run、品牌授权、类目合规和最终发布仍需单独实现与人工确认。
                </p>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function auditLabel(action: string) {
  const labels: Record<string, string> = {
    "case.seeded": "创建演示商品",
    "case.imported": "导入候选品并生成成本模型",
    "cost_model.created": "保存新的成本模型版本",
    "case.approved": "确认商品立项",
    "case.rejected": "否决商品立项",
    "supplier.created": "创建供应商记录",
    "rfq.created": "创建询价记录",
    "quote.created": "录入供应商报价",
    "supplier.selected": "人工选定供应商并回写成本",
    "content_profile.updated": "保存商品定义",
    "asset.main_image_uploaded": "上传主图",
    "asset.main_image_reviewed": "通过主图人工检查",
    "listing.draft_saved": "保存 Listing 版本并运行预检",
    "listing.content_approved": "人工确认 Listing 内容",
    "channel.target_created": "创建渠道目标",
    "channel.listing_version_saved": "保存渠道版本并预检",
    "channel.content_approved": "人工确认渠道内容",
  };
  return labels[action] ?? action;
}

function auditSummary(action: string, details: Record<string, unknown>) {
  if (action === "supplier.selected") return details.supplierName ? ` · ${String(details.supplierName)}` : "";
  if (action === "asset.main_image_uploaded") return details.originalName ? ` · ${String(details.originalName)}` : "";
  if (action === "listing.draft_saved") {
    return ` · v${String(details.version ?? "—")} · 预检 ${String(details.preflightScore ?? "—")} 分`;
  }
  if (action === "listing.content_approved") return ` · v${String(details.version ?? "—")} · 未外部发布`;
  return "";
}
