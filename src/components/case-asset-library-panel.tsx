"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { shortDate } from "@/lib/format";
import { IMAGE_SLOT_LABELS, isSupportedImageSlot } from "@/lib/image-skills-types";
import type { AssetRow } from "@/lib/types";

type FilterKind = "all" | "image" | "video" | "approved" | "pending";

type Props = {
  caseId: string;
  assets: AssetRow[];
  uploadAction: (formData: FormData) => void | Promise<void>;
  reviewAction: (formData: FormData) => void | Promise<void>;
};

export function CaseAssetLibraryPanel({ caseId, assets, uploadAction, reviewAction }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKind>("all");
  const [showUpload, setShowUpload] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const imageAssets = useMemo(() => assets.filter((a) => a.asset_type !== "product_video"), [assets]);
  const videoAssets = useMemo(() => assets.filter((a) => a.asset_type === "product_video"), [assets]);
  const approvedCount = useMemo(() => assets.filter((a) => a.status === "approved").length, [assets]);
  const pendingCount = useMemo(() => assets.filter((a) => a.status !== "approved").length, [assets]);

  const visibleAssets = useMemo(() => {
    if (filter === "image") return imageAssets;
    if (filter === "video") return videoAssets;
    if (filter === "approved") return assets.filter((a) => a.status === "approved");
    if (filter === "pending") return assets.filter((a) => a.status !== "approved");
    return assets;
  }, [assets, imageAssets, videoAssets, filter]);

  async function handleDeleteAsset(asset: AssetRow) {
    if (!window.confirm("确认删除该素材？磁盘文件与记录将一并清理。")) return;
    setBusyId(asset.id);
    setError(null);
    setNotice(null);
    try {
      const resp = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      if (!resp.ok) throw new Error("删除素材失败");
      setNotice("已删除该素材。");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除素材失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReviewVideo(assetId: string, decision: "approved" | "rejected") {
    setBusyId(assetId);
    setError(null);
    setNotice(null);
    try {
      const resp = await fetch("/api/content/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          action: "review",
          assetId,
          decision,
          reviewer: "运营人员",
          notes: decision === "approved" ? "人工确认外观一致、无水印与畸变" : "退回重做",
        }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || "视频审核失败");
      setNotice(decision === "approved" ? "视频已审核通过。" : "已标记退回重做。");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "视频审核失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel" id="asset-library">
      <div className="panel-header">
        <div>
          <div className="eyebrow">VISUAL &amp; VIDEO ASSETS · 资产库与审核门禁</div>
          <h2>2. 视觉与视频资产库</h2>
          <p>
            集中管理本商品的实拍图、AI 生图与演示视频；AI 创作请直达独立工坊（自动携带当前商品上下文），生成后一键入库在此完成人工审核放行。
          </p>
        </div>
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          <Link href={`/image-studio?caseId=${encodeURIComponent(caseId)}`} className="button primary">
            ✨ 去 AI 生图工坊 →
          </Link>
          <Link href={`/video-studio?caseId=${encodeURIComponent(caseId)}`} className="button secondary">
            ✨ 去 AI 视频工坊 →
          </Link>
          <button
            type="button"
            className="button ghost"
            onClick={() => setShowUpload((v) => !v)}
          >
            {showUpload ? "收起上传" : "+ 上传实拍图"}
          </button>
        </div>
      </div>

      <div style={{ padding: "18px 24px 24px", display: "grid", gap: "16px" }}>
        {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
        {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

        {/* 折叠本地实拍上传表单 */}
        {showUpload ? (
          <form
            action={uploadAction}
            className="studio-custom-box"
            style={{ display: "grid", gap: "12px", padding: "16px" }}
          >
            <input type="hidden" name="caseId" value={caseId} />
            <strong style={{ fontSize: "13px", color: "var(--ink)" }}>上传本地实拍图 / 供应商底图</strong>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="case-upload-file">选择图片（JPG / PNG / WebP，≤8MB）</label>
                <input id="case-upload-file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="case-upload-slot">素材槽位</label>
                <select id="case-upload-slot" name="assetType" defaultValue="main_image">
                  <option value="main_image">纯白底主图 (main_image)</option>
                  <option value="lifestyle_image">场景图 (lifestyle_image)</option>
                  <option value="detail_image">细节特写 (detail_image)</option>
                  <option value="size_chart">尺寸规格图 (size_chart)</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="case-upload-actor">上传人</label>
                <input id="case-upload-actor" name="actor" type="text" defaultValue="运营人员" required />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
              <button type="button" className="button ghost" onClick={() => setShowUpload(false)}>取消</button>
              <button type="submit" className="button primary">上传并入库</button>
            </div>
          </form>
        ) : null}

        {/* 筛选胶囊 */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
          {(
            [
              { key: "all", label: `全部 (${assets.length})` },
              { key: "image", label: `图片 (${imageAssets.length})` },
              { key: "video", label: `视频 (${videoAssets.length})` },
              { key: "approved", label: `已审核 (${approvedCount})` },
              { key: "pending", label: `待审核 (${pendingCount})` },
            ] as const
          ).map((tab) => {
            const active = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  background: active ? "var(--deep)" : "var(--surface-subtle)",
                  color: active ? "var(--deep-fg)" : "var(--ink)",
                  border: active ? "1px solid var(--deep)" : "1px solid var(--line)",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 资产网格 */}
        {visibleAssets.length === 0 ? (
          <div
            style={{
              padding: "32px 20px",
              borderRadius: "10px",
              border: "1px dashed var(--line-strong)",
              background: "var(--surface-subtle)",
              textAlign: "center",
              display: "grid",
              gap: "10px",
              justifyItems: "center",
            }}
          >
            <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--ink)" }}>当前筛选下暂无素材</div>
            <div style={{ fontSize: "12.5px", color: "var(--muted)" }}>
              你可以点击右上角「+ 上传实拍图」，或直接前往 AI 生图 / 视频工坊创作并一键入库。
            </div>
          </div>
        ) : (
          <div className="studio-gallery-grid">
            {visibleAssets.map((asset) => {
              const isVideo = asset.asset_type === "product_video";
              const meta = asset.metadata ?? {};
              const originalName = typeof meta.originalName === "string" ? meta.originalName : asset.asset_type;
              const isAi = meta.source === "ai_generated" || meta.source === "ai_video_generated";
              const slotLabel = isVideo
                ? `演示视频 · ${typeof meta.aspectRatio === "string" ? meta.aspectRatio : "16:9"} · ${Number(meta.durationSec) || 5}s`
                : isSupportedImageSlot(asset.asset_type)
                  ? IMAGE_SLOT_LABELS[asset.asset_type]
                  : asset.asset_type;

              return (
                <article
                  key={asset.id}
                  className="studio-asset-card"
                  style={{
                    borderRadius: "12px",
                    border: "1px solid var(--line)",
                    background: "var(--surface-subtle)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  {isVideo ? (
                    <video
                      src={asset.file_url}
                      controls
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", aspectRatio: "1 / 1", background: "#000", display: "block", objectFit: "contain" }}
                    />
                  ) : (
                    <img
                      src={asset.file_url}
                      alt={originalName}
                      style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", display: "block", background: "var(--paper)" }}
                    />
                  )}

                  <div style={{ padding: "12px", display: "grid", gap: "8px", flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                      <span className="badge badge-neutral" style={{ fontSize: "12px" }}>{slotLabel}</span>
                      <span
                        className={`badge ${
                          asset.status === "approved"
                            ? "badge-success"
                            : asset.status === "rejected"
                              ? "badge-danger"
                              : "badge-neutral"
                        }`}
                      >
                        {asset.status === "approved" ? "已审核通过" : asset.status === "rejected" ? "已退回" : "待人工审核"}
                      </span>
                    </div>

                    <div style={{ fontSize: "12.5px", fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={originalName}>
                      {originalName}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      {isAi ? "AI 生成" : "实拍 / 合成"} · {shortDate(asset.created_at)}
                    </div>

                    {/* 审核操作区 */}
                    {isVideo ? (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "auto" }}>
                        {asset.status !== "approved" ? (
                          <button
                            type="button"
                            className="button primary"
                            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                            disabled={busyId === asset.id}
                            onClick={() => handleReviewVideo(asset.id, "approved")}
                          >
                            审核通过
                          </button>
                        ) : null}
                        <a href={`${asset.file_url}?download=1`} className="button ghost" style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}>
                          下载
                        </a>
                        <button
                          type="button"
                          className="button ghost"
                          style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px", color: "var(--red)" }}
                          disabled={busyId === asset.id}
                          onClick={() => handleDeleteAsset(asset)}
                        >
                          删除
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: "8px", marginTop: "auto" }}>
                        {asset.status !== "approved" ? (
                          <details className="studio-more-details">
                            <summary>人工审核放行</summary>
                            <form action={reviewAction} className="studio-more-body" style={{ display: "grid", gap: "6px" }}>
                              <input type="hidden" name="caseId" value={caseId} />
                              <input type="hidden" name="assetId" value={asset.id} />
                              <label style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                <input type="checkbox" name="whiteBackground" value="on" defaultChecked required />
                                背景合规无杂物
                              </label>
                              <label style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                <input type="checkbox" name="productComplete" value="on" defaultChecked required />
                                商品主体完整无裁切
                              </label>
                              <label style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                <input type="checkbox" name="noTextWatermark" value="on" defaultChecked required />
                                无违规水印/促销文字
                              </label>
                              <label style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                <input type="checkbox" name="resolutionConfirmed" value="on" defaultChecked required />
                                清晰度符合平台上架标准
                              </label>
                              {isAi ? (
                                <label style={{ fontSize: "12px", display: "flex", gap: "6px", alignItems: "center" }}>
                                  <input type="checkbox" name="matchesPhysicalProduct" value="on" required />
                                  AI 画面与实物样品一致无畸变
                                </label>
                              ) : null}
                              <input name="reviewer" type="text" defaultValue="运营人员" placeholder="审核人" required style={{ fontSize: "12px", padding: "5px 8px" }} />
                              <input name="notes" type="text" defaultValue="人工核验通过" placeholder="审核备注" required style={{ fontSize: "12px", padding: "5px 8px" }} />
                              <button type="submit" className="button primary" style={{ minHeight: "28px", fontSize: "12px" }}>
                                确认审核通过
                              </button>
                            </form>
                          </details>
                        ) : null}
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                          <a href={`${asset.file_url}?download=1`} className="button ghost" style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}>
                            下载原图
                          </a>
                          <button
                            type="button"
                            className="button ghost"
                            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px", color: "var(--red)" }}
                            disabled={busyId === asset.id}
                            onClick={() => handleDeleteAsset(asset)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
