"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { VideoGenerationJob } from "@/lib/video-jobs";
import type {
  ComposedVideoPrompt,
  VideoAspectRatio,
  VideoDurationSec,
  VideoProviderStatus,
  VideoTemplateId,
  VideoTemplateSpec,
} from "@/lib/video-provider";

type ImageAssetSummary = {
  id: string;
  assetType: string;
  status: string;
  fileUrl: string;
  originalName: string;
};

type VideoAssetSummary = {
  id: string;
  status: string;
  file_url: string;
  created_at: string;
  metadata: Record<string, unknown>;
};

type Props = {
  caseId: string;
  imageAssets: ImageAssetSummary[];
  initialVideoAssets: VideoAssetSummary[];
  initialJobs: VideoGenerationJob[];
  providerStatus: VideoProviderStatus;
  templates: readonly VideoTemplateSpec[];
  ffmpegReady: boolean;
};

export function VideoStudioPanel({
  caseId,
  imageAssets,
  initialVideoAssets,
  initialJobs,
  providerStatus,
  templates,
  ffmpegReady,
}: Props) {
  const approvedFirst = [...imageAssets].sort((a, b) =>
    a.status === "approved" && b.status !== "approved" ? -1 : b.status === "approved" && a.status !== "approved" ? 1 : 0,
  );
  const [sourceAssetId, setSourceAssetId] = useState(approvedFirst[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<VideoTemplateId>(templates[0]?.id ?? "hero_orbit_5s");
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("16:9");
  const [durationSec, setDurationSec] = useState<VideoDurationSec>(5);
  const [customInstruction, setCustomInstruction] = useState("");
  const [actor, setActor] = useState("本机管理员");

  const [preview, setPreview] = useState<ComposedVideoPrompt | null>(null);
  const [promptText, setPromptText] = useState("");
  const [negativePromptText, setNegativePromptText] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [jobs, setJobs] = useState<VideoGenerationJob[]>(initialJobs);
  const [videoAssets, setVideoAssets] = useState<VideoAssetSummary[]>(initialVideoAssets);
  const [selectedForStitch, setSelectedForStitch] = useState<string[]>([]);
  const [stitchRatio, setStitchRatio] = useState<VideoAspectRatio>("16:9");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [aiGeneratingPrompt, setAiGeneratingPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stitching, setStitching] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshVideoState = useCallback(async () => {
    try {
      const resp = await fetch(`/api/content/videos?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" });
      if (!resp.ok) return;
      const data = (await resp.json()) as { jobs?: VideoGenerationJob[]; videoAssets?: VideoAssetSummary[] };
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
      if (Array.isArray(data.videoAssets)) setVideoAssets(data.videoAssets);
    } catch {
      // ignore transient network errors during poll
    }
  }, [caseId]);

  const hasPendingJob = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!hasPendingJob) return;
    const timer = setInterval(async () => {
      const pending = jobs.filter((j) => j.status === "queued" || j.status === "running");
      let changed = false;
      for (const job of pending) {
        try {
          const resp = await fetch(`/api/content/videos/${encodeURIComponent(job.id)}`, { cache: "no-store" });
          if (!resp.ok) continue;
          const data = (await resp.json()) as { job?: VideoGenerationJob };
          if (data.job && data.job.status !== job.status) changed = true;
        } catch {
          // ignore
        }
      }
      if (changed) {
        await refreshVideoState();
      }
    }, 4500);
    return () => clearInterval(timer);
  }, [hasPendingJob, jobs, refreshVideoState]);

  function handleSelectTemplate(tpl: VideoTemplateSpec) {
    setTemplateId(tpl.id);
    setAspectRatio(tpl.defaultAspectRatio);
    setDurationSec(tpl.defaultDurationSec);
    setPreview(null);
    setConfirmed(false);
  }

  async function handleAiGenerateVideoPrompt() {
    setError(null);
    setNotice(null);
    setAiGeneratingPrompt(true);
    try {
      const resp = await fetch("/api/studio/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          skillId: templateId,
          idea: customInstruction,
          aspectRatio,
          durationSec,
        }),
      });
      const data = (await resp.json()) as {
        prompt?: string;
        negativePrompt?: string;
        storyboard?: ComposedVideoPrompt["storyboard"];
        note?: string;
        error?: string;
      };
      if (!resp.ok || !data.prompt) throw new Error(data.error || "AI 生成视频提示词失败");
      const baseResp = await fetch("/api/content/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          action: "preview",
          templateId,
          aspectRatio,
          durationSec,
          customInstruction,
        }),
      });
      const baseData = (await baseResp.json()) as { preview?: ComposedVideoPrompt };
      if (baseData.preview) {
        setPreview({
          ...baseData.preview,
          prompt: data.prompt,
          negativePrompt: data.negativePrompt || baseData.preview.negativePrompt,
          storyboard: Array.isArray(data.storyboard) && data.storyboard.length > 0 ? data.storyboard : baseData.preview.storyboard,
        });
      }
      setPromptText(data.prompt);
      setNegativePromptText(data.negativePrompt || "");
      setConfirmed(false);
      if (data.note) setNotice(data.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 生成视频提示词失败");
    } finally {
      setAiGeneratingPrompt(false);
    }
  }

  async function handlePreview() {
    setError(null);
    setNotice(null);
    setLoadingPreview(true);
    try {
      const resp = await fetch("/api/content/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          action: "preview",
          templateId,
          aspectRatio,
          durationSec,
          customInstruction,
        }),
      });
      const data = (await resp.json()) as { preview?: ComposedVideoPrompt; error?: string };
      if (!resp.ok || !data.preview) throw new Error(data.error || "分镜预览失败");
      setPreview(data.preview);
      setPromptText(data.preview.prompt);
      setNegativePromptText(data.preview.negativePrompt);
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "分镜预览失败");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleSubmitGenerate() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const resp = await fetch("/api/content/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          action: "generate",
          sourceAssetId,
          templateId,
          aspectRatio,
          durationSec,
          customInstruction,
          promptOverride: promptText,
          negativePromptOverride: negativePromptText,
          confirmed,
          actor,
        }),
      });
      const data = (await resp.json()) as {
        mode?: string;
        job?: VideoGenerationJob;
        note?: string;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || "提交视频任务失败");
      setNotice(data.note || "已提交视频生成任务。");
      setConfirmed(false);
      await refreshVideoState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交视频任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualPoll(jobId: string) {
    setError(null);
    try {
      const resp = await fetch(`/api/content/videos/${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = (await resp.json()) as { job?: VideoGenerationJob; error?: string };
      if (!resp.ok) throw new Error(data.error || "刷新状态失败");
      await refreshVideoState();
      if (data.job?.status === "succeeded") setNotice("视频生成完成并已入库，请在下方播放并完成人工审核。");
      if (data.job?.status === "failed") setError(data.job.error_message || "外部视频生成失败");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新状态失败");
    }
  }

  async function handleReviewVideo(assetId: string, decision: "approved" | "rejected") {
    setError(null);
    setNotice(null);
    setReviewingId(assetId);
    try {
      const resp = await fetch("/api/content/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          action: "review",
          assetId,
          decision,
          reviewer: actor || "本机管理员",
          notes: decision === "approved" ? "人工确认外观一致、无水印与畸变" : "退回重做",
        }),
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || "审核失败");
      setNotice(decision === "approved" ? "视频已审核通过，可用于 Amazon / TikTok 上架。" : "已标记退回重做。");
      await refreshVideoState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "审核失败");
    } finally {
      setReviewingId(null);
    }
  }

  async function handleStitch() {
    setError(null);
    setNotice(null);
    setStitching(true);
    try {
      const resp = await fetch("/api/content/videos/stitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          assetIds: selectedForStitch,
          aspectRatio: stitchRatio,
          actor: actor || "本机管理员",
        }),
      });
      const data = (await resp.json()) as { note?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "合成成片失败");
      setNotice(data.note || "已完成多镜头合成。");
      setSelectedForStitch([]);
      await refreshVideoState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "合成成片失败");
    } finally {
      setStitching(false);
    }
  }

  function toggleStitchSelection(assetId: string) {
    setSelectedForStitch((prev) =>
      prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId],
    );
  }

  return (
    <section className="panel" id="video-studio" style={{ marginTop: "20px" }}>
      <div className="panel-header">
        <div>
          <div className="eyebrow">VIDEO STUDIO · 商品演示视频工作台（I2V）</div>
          <h2>图生商品视频与多镜头成片</h2>
          <p>
            强制基于「已入库商品图」做首帧生成 5–10 秒演示短片（杜绝纯文生图的外观漂移），支持异步队列轮询、人工审核门禁与本地 ffmpeg 多镜头拼接。
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span className={`badge ${providerStatus.configured && providerStatus.provider !== "template" ? "badge-success" : "badge-neutral"}`}>
            {providerStatus.label} · {providerStatus.model}
          </span>
          <span className={`badge ${ffmpegReady ? "badge-success" : "badge-neutral"}`}>
            {ffmpegReady ? "ffmpeg 已就绪" : "未检测到 ffmpeg"}
          </span>
          <Link href="/settings" className="button ghost" style={{ minHeight: "32px", fontSize: "12px" }}>
            配置视频 API
          </Link>
        </div>
      </div>

      <div style={{ padding: "20px 24px", display: "grid", gap: "18px" }}>
        {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
        {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

        {/* 1. 选择首帧底图 */}
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px" }}>
            1. 选择首帧商品底图（优先使用「审核通过」的主图或场景图）
          </div>
          {approvedFirst.length === 0 ? (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "10px",
                border: "1px dashed var(--line-strong)",
                background: "var(--surface-subtle)",
                color: "var(--muted)",
                fontSize: "13px",
              }}
            >
              当前商品暂无图片素材。请先在上方「视觉素材与主图」上传或生成商品图，再基于该图发起图生视频。
            </div>
          ) : (
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {approvedFirst.map((img) => {
                const active = sourceAssetId === img.id;
                return (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setSourceAssetId(img.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "6px 10px 6px 6px",
                      borderRadius: "10px",
                      border: active ? "2px solid var(--green)" : "1px solid var(--line)",
                      background: active ? "var(--green-soft)" : "var(--surface-subtle)",
                      color: "var(--ink)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <img
                      src={img.fileUrl}
                      alt={img.originalName}
                      style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "6px", border: "1px solid var(--line)" }}
                    />
                    <div style={{ display: "grid", gap: "2px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, maxWidth: "140px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {img.originalName}
                      </span>
                      <span style={{ fontSize: "12px", color: img.status === "approved" ? "var(--green)" : "var(--muted)" }}>
                        {img.status === "approved" ? "✓ 已审核" : "待审核"} · {img.assetType}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 2. 模板与规格 */}
        <div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px" }}>
            2. 选择电商高 ROI 镜头模板与输出规格
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px", marginBottom: "12px" }}>
            {templates.map((tpl) => {
              const active = templateId === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl)}
                  style={{
                    textAlign: "left",
                    padding: "12px 14px",
                    borderRadius: "10px",
                    border: active ? "1.5px solid var(--green)" : "1px solid var(--line)",
                    background: active ? "var(--green-soft)" : "var(--surface-subtle)",
                    color: "var(--ink)",
                    cursor: "pointer",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <div style={{ fontSize: "13px", fontWeight: 800 }}>{tpl.name}</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.45 }}>{tpl.tagline}</div>
                  <div style={{ fontSize: "12px", color: "var(--green)", fontWeight: 600, marginTop: "2px" }}>{tpl.channelHint}</div>
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "140px 115px minmax(0, 1fr) auto auto", gap: "10px", alignItems: "end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="videoAspectRatio">画幅比例</label>
              <select
                id="videoAspectRatio"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as VideoAspectRatio)}
              >
                <option value="16:9">16:9（Amazon 主图）</option>
                <option value="1:1">1:1（详情方屏）</option>
                <option value="9:16">9:16（TikTok 竖屏）</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="videoDuration">单镜时长</label>
              <select
                id="videoDuration"
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value) >= 8 ? 10 : 5)}
              >
                <option value={5}>5 秒（推荐）</option>
                <option value={10}>10 秒</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="videoCustomInstruction">中文创意想法 / 补充运镜（可交给 AI 扩写）</label>
              <input
                id="videoCustomInstruction"
                type="text"
                value={customInstruction}
                onChange={(e) => setCustomInstruction(e.target.value)}
                placeholder="例如：镜头缓慢推进展示水流循环，光线柔和，无文字水印"
              />
            </div>
            <button
              type="button"
              className="button primary"
              onClick={handleAiGenerateVideoPrompt}
              disabled={aiGeneratingPrompt}
            >
              {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成提示词"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={handlePreview}
              disabled={loadingPreview}
            >
              {loadingPreview ? "生成中..." : "模板预览"}
            </button>
          </div>
        </div>

        {/* 3. 分镜预览 & 费用确认 */}
        {preview ? (
          <div
            style={{
              padding: "16px 18px",
              borderRadius: "12px",
              border: "1px solid var(--line-strong)",
              background: "var(--surface-subtle)",
              display: "grid",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
              <strong style={{ fontSize: "13px", color: "var(--ink)" }}>
                分镜与 I2V 提示词预览（{preview.aspectRatio} · {preview.durationSec}s）
              </strong>
              <span className="badge badge-neutral">
                预估费用：${preview.estimatedCostUsd.toFixed(2)} · {preview.estimatedLatencyLabel}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
              {preview.storyboard.map((shot) => (
                <div
                  key={shot.shot}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--paper)",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)" }}>
                    镜头 {shot.shot}（{shot.durationSec}s）· {shot.role}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.45 }}>{shot.captionEn}</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)" }}>{shot.captionZh}</div>
                </div>
              ))}
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="videoPromptEdit">主镜头英文 I2V Prompt（可直接微调）</label>
              <textarea
                id="videoPromptEdit"
                rows={3}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--ink)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  确认预估费用（约 <strong>${preview.estimatedCostUsd.toFixed(2)}</strong>）并基于所选底图提交异步视频生成
                </span>
              </label>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="text"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  placeholder="操作人"
                  style={{ width: "110px", padding: "6px 10px", fontSize: "12px" }}
                />
                <button
                  type="button"
                  className="button primary"
                  disabled={!confirmed || submitting || (providerStatus.provider !== "template" && !sourceAssetId)}
                  onClick={handleSubmitGenerate}
                >
                  {submitting
                    ? "提交中..."
                    : providerStatus.provider === "template"
                      ? "生成分镜包（免 Key）"
                      : "提交异步生成 MP4"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* 4. 异步任务队列 */}
        {jobs.length > 0 ? (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)", marginBottom: "8px" }}>
              异步渲染队列（最近 {jobs.length} 条{hasPendingJob ? " · 每 4.5 秒自动轮询" : ""}）
            </div>
            <div style={{ display: "grid", gap: "8px" }}>
              {jobs.slice(0, 6).map((job) => (
                <div
                  key={job.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: "1px solid var(--line)",
                    background: "var(--surface-subtle)",
                    fontSize: "12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span
                      className={`badge ${
                        job.status === "succeeded"
                          ? "badge-success"
                          : job.status === "failed"
                            ? "badge-danger"
                            : "badge-neutral"
                      }`}
                    >
                      {job.status === "succeeded"
                        ? "已完成"
                        : job.status === "failed"
                          ? "失败"
                          : job.status === "running"
                            ? "渲染中"
                            : "排队中"}
                    </span>
                    <strong style={{ color: "var(--ink)" }}>{job.provider} / {job.model}</strong>
                    <span style={{ color: "var(--muted)" }}>{job.aspect_ratio} · {job.duration_sec}s · 预估 ${job.estimated_cost_usd.toFixed(2)}</span>
                    {job.error_message ? <span style={{ color: "var(--red)" }}>{job.error_message}</span> : null}
                  </div>
                  {(job.status === "queued" || job.status === "running") ? (
                    <button
                      type="button"
                      className="button ghost"
                      style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                      onClick={() => handleManualPoll(job.id)}
                    >
                      立即刷新
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* 5. 商品视频资产库 + Phase 2 本地 ffmpeg 拼接 */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", marginBottom: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>
              已入库商品视频资产（{videoAssets.length} 条）
            </div>
            {videoAssets.length >= 2 ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <select
                  value={stitchRatio}
                  onChange={(e) => setStitchRatio(e.target.value as VideoAspectRatio)}
                  style={{ width: "auto", minHeight: "30px", fontSize: "12px", padding: "4px 8px" }}
                >
                  <option value="16:9">成片 16:9</option>
                  <option value="9:16">成片 9:16</option>
                  <option value="1:1">成片 1:1</option>
                </select>
                <button
                  type="button"
                  className="button secondary"
                  style={{ minHeight: "30px", fontSize: "12px", padding: "0 12px" }}
                  disabled={selectedForStitch.length < 2 || stitching || !ffmpegReady}
                  onClick={handleStitch}
                  title={!ffmpegReady ? "本机未安装 ffmpeg" : "将勾选的 2~5 段镜头无损拼接为一条成片"}
                >
                  {stitching ? "ffmpeg 合成中..." : `一键合成成片（已选 ${selectedForStitch.length} 段）`}
                </button>
              </div>
            ) : null}
          </div>

          {videoAssets.length === 0 ? (
            <div
              style={{
                padding: "16px",
                borderRadius: "10px",
                border: "1px dashed var(--line)",
                color: "var(--muted)",
                fontSize: "12.5px",
                textAlign: "center",
              }}
            >
              暂无已生成视频。先在上方预览分镜并提交 I2V 生成，完成后可在此在线播放、人工审核或拼接多镜头成片。
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
              {videoAssets.map((asset) => {
                const meta = asset.metadata ?? {};
                const ratio = typeof meta.aspectRatio === "string" ? meta.aspectRatio : "16:9";
                const dur = Number(meta.durationSec) || 5;
                const providerName = typeof meta.provider === "string" ? meta.provider : meta.source === "ffmpeg_stitched" ? "ffmpeg 多镜头合成" : "AI 视频";
                const checked = selectedForStitch.includes(asset.id);
                return (
                  <div
                    key={asset.id}
                    style={{
                      borderRadius: "12px",
                      border: checked ? "2px solid var(--green)" : "1px solid var(--line)",
                      background: "var(--surface-subtle)",
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <video
                      src={asset.file_url}
                      controls
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", maxHeight: "220px", background: "#000", display: "block" }}
                    />
                    <div style={{ padding: "12px", display: "grid", gap: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                        <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 700, color: "var(--ink)", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStitchSelection(asset.id)}
                          />
                          <span>{ratio} · {dur}s</span>
                        </label>
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
                      <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                        来源：{providerName}
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {asset.status !== "approved" ? (
                          <button
                            type="button"
                            className="button primary"
                            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                            disabled={reviewingId === asset.id}
                            onClick={() => handleReviewVideo(asset.id, "approved")}
                          >
                            审核通过
                          </button>
                        ) : null}
                        {asset.status !== "rejected" ? (
                          <button
                            type="button"
                            className="button ghost"
                            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                            disabled={reviewingId === asset.id}
                            onClick={() => handleReviewVideo(asset.id, "rejected")}
                          >
                            退回重做
                          </button>
                        ) : null}
                        <a
                          href={`${asset.file_url}?download=1`}
                          className="button secondary"
                          style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                        >
                          下载 MP4
                        </a>
                        <button
                          type="button"
                          disabled={reviewingId === asset.id}
                          onClick={async () => {
                            if (!window.confirm("确认删除该视频素材？磁盘文件也会一并清理。")) return;
                            setReviewingId(asset.id);
                            setError(null);
                            try {
                              const resp = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
                              if (!resp.ok) throw new Error("删除视频失败");
                              setVideoAssets((prev) => prev.filter((item) => item.id !== asset.id));
                              setSelectedForStitch((prev) => prev.filter((id) => id !== asset.id));
                              setNotice("已删除该视频素材。");
                            } catch (err) {
                              setError(err instanceof Error ? err.message : "删除视频失败");
                            } finally {
                              setReviewingId(null);
                            }
                          }}
                          style={{
                            minHeight: "28px",
                            padding: "0 10px",
                            fontSize: "12px",
                            background: "transparent",
                            border: "1px solid var(--line)",
                            borderRadius: "6px",
                            color: "var(--red)",
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
