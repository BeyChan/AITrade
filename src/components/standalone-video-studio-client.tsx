"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StandaloneStudioAsset } from "@/lib/standalone-image-studio";
import type { StandaloneVideoAsset } from "@/lib/standalone-video-studio";
import type { VideoGenerationJob } from "@/lib/video-jobs";
import type {
  ComposedVideoPrompt,
  VideoAspectRatio,
  VideoDurationSec,
  VideoProviderStatus,
} from "@/lib/video-provider";
import type { VideoSkillDefinition } from "@/lib/video-skills";

type Props = {
  initialAssets: StandaloneVideoAsset[];
  initialJobs: VideoGenerationJob[];
  studioImages: StandaloneStudioAsset[];
  providerStatus: VideoProviderStatus;
  initialSkills: VideoSkillDefinition[];
  ffmpegReady: boolean;
  activeMarketCode: string;
};

export function StandaloneVideoStudioClient({
  initialAssets,
  initialJobs,
  studioImages,
  providerStatus,
  initialSkills,
  ffmpegReady,
  activeMarketCode,
}: Props) {
  const [skills, setSkills] = useState<VideoSkillDefinition[]>(initialSkills);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(initialSkills[0]?.id ?? "amazon-hero-orbit");
  const [productName, setProductName] = useState("");
  const [coreDifferentiator, setCoreDifferentiator] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(initialSkills[0]?.aspectRatio ?? "16:9");
  const [durationSec, setDurationSec] = useState<VideoDurationSec>(initialSkills[0]?.durationSec ?? 5);
  const [actor, setActor] = useState("本机管理员");

  // 自定义 Video Skill 表单
  const [showCustomSkillForm, setShowCustomSkillForm] = useState(false);
  const [customSkillName, setCustomSkillName] = useState("");
  const [customSkillChannel, setCustomSkillChannel] = useState("Amazon / TikTok 自定义镜头");
  const [customMotion, setCustomMotion] = useState("");
  const [customLighting, setCustomLighting] = useState("");
  const [customNegative, setCustomNegative] = useState("");
  const [savingSkill, setSavingSkill] = useState(false);
  const [aiGeneratingPrompt, setAiGeneratingPrompt] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);
  const [selectedStudioImageId, setSelectedStudioImageId] = useState<string>(studioImages[0]?.id ?? "");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [preview, setPreview] = useState<ComposedVideoPrompt | null>(null);
  const [promptText, setPromptText] = useState("");
  const [negativePromptText, setNegativePromptText] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const [assets, setAssets] = useState<StandaloneVideoAsset[]>(initialAssets);
  const [jobs, setJobs] = useState<VideoGenerationJob[]>(initialJobs);
  const [selectedForStitch, setSelectedForStitch] = useState<string[]>([]);
  const [stitchRatio, setStitchRatio] = useState<VideoAspectRatio>("16:9");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stitching, setStitching] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const resp = await fetch("/api/video-studio", { cache: "no-store" });
      if (!resp.ok) return;
      const data = (await resp.json()) as {
        assets?: StandaloneVideoAsset[];
        jobs?: VideoGenerationJob[];
      };
      if (Array.isArray(data.assets)) setAssets(data.assets);
      if (Array.isArray(data.jobs)) setJobs(data.jobs);
    } catch {
      // ignore transient network errors
    }
  }, []);

  const hasPending = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(async () => {
      const pending = jobs.filter((j) => j.status === "queued" || j.status === "running");
      let changed = false;
      for (const job of pending) {
        try {
          const resp = await fetch("/api/video-studio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll", jobId: job.id }),
          });
          if (!resp.ok) continue;
          const data = (await resp.json()) as { job?: VideoGenerationJob };
          if (data.job && data.job.status !== job.status) changed = true;
        } catch {
          // ignore
        }
      }
      if (changed) await refreshState();
    }, 4500);
    return () => clearInterval(timer);
  }, [hasPending, jobs, refreshState]);

  function handleFileChange(file: File | null) {
    if (selectedFilePreview) URL.revokeObjectURL(selectedFilePreview);
    setSelectedFile(file);
    if (file) {
      setSelectedFilePreview(URL.createObjectURL(file));
      setSelectedStudioImageId("");
    } else {
      setSelectedFilePreview(null);
    }
  }

  function handlePickStudioImage(img: StandaloneStudioAsset) {
    handleFileChange(null);
    setSelectedStudioImageId(img.id);
    if (!productName && img.productName) setProductName(img.productName);
  }

  function handleSelectSkill(skill: VideoSkillDefinition) {
    setSelectedSkillId(skill.id);
    setAspectRatio(skill.aspectRatio);
    setDurationSec(skill.durationSec);
    setPreview(null);
    setConfirmed(false);
  }

  async function handleSaveCustomSkill() {
    setError(null);
    setNotice(null);
    setSavingSkill(true);
    try {
      const resp = await fetch("/api/video-studio/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customSkillName,
          channelHint: customSkillChannel,
          aspectRatio,
          durationSec,
          motionDirectives: customMotion,
          lightingDirectives: customLighting,
          negativeDirectives: customNegative,
        }),
      });
      const data = (await resp.json()) as { created?: VideoSkillDefinition; skills?: VideoSkillDefinition[]; error?: string };
      if (!resp.ok || !data.created) throw new Error(data.error || "保存自定义视频 Skill 失败");
      if (Array.isArray(data.skills)) setSkills(data.skills);
      setSelectedSkillId(data.created.id);
      setShowCustomSkillForm(false);
      setCustomSkillName("");
      setCustomMotion("");
      setCustomLighting("");
      setCustomNegative("");
      setNotice(`已保存自定义视频 Skill「${data.created.name}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存自定义视频 Skill 失败");
    } finally {
      setSavingSkill(false);
    }
  }

  async function handleDeleteCustomSkill(skill: VideoSkillDefinition) {
    if (!window.confirm(`确认删除自定义视频 Skill「${skill.name}」？`)) return;
    setError(null);
    try {
      const resp = await fetch(`/api/video-studio/skills?id=${encodeURIComponent(skill.id)}`, { method: "DELETE" });
      const data = (await resp.json()) as { skills?: VideoSkillDefinition[]; error?: string };
      if (!resp.ok) throw new Error(data.error || "删除 Skill 失败");
      if (Array.isArray(data.skills)) setSkills(data.skills);
      if (selectedSkillId === skill.id) setSelectedSkillId(skills[0]?.id ?? "amazon-hero-orbit");
      setNotice(`已删除自定义视频 Skill「${skill.name}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除 Skill 失败");
    }
  }

  async function handleAiGeneratePrompt(fillCustomSkillForm = false) {
    setError(null);
    setNotice(null);
    setAiGeneratingPrompt(true);
    try {
      const resp = await fetch("/api/studio/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "video",
          skillId: selectedSkillId,
          productName: productName.trim() || "跨境电商品牌主推单品",
          coreDifferentiator,
          idea: customInstruction.trim() || customMotion.trim(),
          aspectRatio,
          durationSec,
          marketplace: activeMarketCode,
        }),
      });
      const data = (await resp.json()) as {
        prompt?: string;
        negativePrompt?: string;
        motionDirectives?: string;
        lightingDirectives?: string;
        storyboard?: ComposedVideoPrompt["storyboard"];
        note?: string;
        error?: string;
      };
      if (!resp.ok || !data.prompt) throw new Error(data.error || "AI 生成视频提示词失败");
      if (fillCustomSkillForm) {
        setCustomMotion(data.motionDirectives || data.prompt);
        setCustomLighting(data.lightingDirectives || "");
        setCustomNegative(data.negativePrompt || "");
      } else {
        const previewResp = await fetch("/api/video-studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "preview",
            productName: productName.trim() || "跨境电商品牌主推单品",
            coreDifferentiator,
            customInstruction,
            templateId: "hero_orbit_5s",
            aspectRatio,
            durationSec,
            marketplace: activeMarketCode,
          }),
        });
        const baseData = (await previewResp.json()) as { preview?: ComposedVideoPrompt };
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
      }
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
      const activeSkill = skills.find((s) => s.id === selectedSkillId);
      const mergedInstruction = [activeSkill?.motionDirectives, activeSkill?.lightingDirectives, customInstruction]
        .filter(Boolean)
        .join(" ");
      const resp = await fetch("/api/video-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          productName: productName.trim() || "跨境电商品牌主推单品",
          coreDifferentiator,
          customInstruction: mergedInstruction,
          templateId: "hero_orbit_5s",
          aspectRatio,
          durationSec,
          marketplace: activeMarketCode,
        }),
      });
      const data = (await resp.json()) as { preview?: ComposedVideoPrompt; error?: string };
      if (!resp.ok || !data.preview) throw new Error(data.error || "生成分镜失败");
      setPreview(data.preview);
      setPromptText(data.preview.prompt);
      setNegativePromptText(activeSkill?.negativeDirectives || data.preview.negativePrompt);
      setConfirmed(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成分镜失败");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("confirmed", String(confirmed));
      form.append("actor", actor || "本机管理员");
      form.append("productName", productName.trim() || "独立创作商品");
      form.append("coreDifferentiator", coreDifferentiator);
      form.append("customInstruction", customInstruction);
      form.append("templateId", selectedSkillId);
      form.append("aspectRatio", aspectRatio);
      form.append("durationSec", String(durationSec));
      form.append("marketplace", activeMarketCode);
      form.append("promptOverride", promptText);
      form.append("negativePromptOverride", negativePromptText);
      if (selectedFile) {
        form.append("referenceFile", selectedFile);
      } else if (selectedStudioImageId) {
        form.append("studioImageId", selectedStudioImageId);
      }

      const resp = await fetch("/api/video-studio", { method: "POST", body: form });
      const data = (await resp.json()) as { note?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "提交视频任务失败");
      setNotice(data.note || "已提交视频生成任务。");
      setConfirmed(false);
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "提交视频任务失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualPoll(jobId: string) {
    setError(null);
    try {
      const resp = await fetch("/api/video-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "poll", jobId }),
      });
      const data = (await resp.json()) as { job?: VideoGenerationJob; error?: string };
      if (!resp.ok) throw new Error(data.error || "刷新状态失败");
      await refreshState();
      if (data.job?.status === "succeeded") setNotice("视频生成完成并已保存到图库。");
      if (data.job?.status === "failed") setError(data.job.error_message || "外部视频生成失败");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新状态失败");
    }
  }

  async function handleDeleteJob(jobId: string) {
    setError(null);
    try {
      const resp = await fetch("/api/video-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_job", jobId }),
      });
      if (!resp.ok) throw new Error("删除任务失败");
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除任务失败");
    }
  }

  async function handleDeleteAsset(asset: StandaloneVideoAsset) {
    if (!window.confirm(`确认删除视频「${asset.originalName}」？磁盘文件也会一并清理。`)) return;
    setError(null);
    setDeletingId(asset.id);
    try {
      const resp = await fetch(`/api/video-studio/file/${encodeURIComponent(asset.id)}`, {
        method: "DELETE",
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || "删除视频失败");
      setAssets((prev) => prev.filter((item) => item.id !== asset.id));
      setSelectedForStitch((prev) => prev.filter((id) => id !== asset.id));
      setNotice("已删除该视频资产。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除视频失败");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleStitch() {
    setError(null);
    setNotice(null);
    setStitching(true);
    try {
      const resp = await fetch("/api/video-studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "stitch",
          assetIds: selectedForStitch,
          aspectRatio: stitchRatio,
          actor: actor || "本机管理员",
        }),
      });
      const data = (await resp.json()) as { note?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "合成成片失败");
      setNotice(data.note || "已完成多镜头合成。");
      setSelectedForStitch([]);
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "合成成片失败");
    } finally {
      setStitching(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "20px" }}>
      {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
      {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

      {/* 创作台主面板 */}
      <section className="panel" style={{ padding: "22px 24px", display: "grid", gap: "18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sv-product-name">商品名称 / 主题</label>
            <input
              id="sv-product-name"
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="例如：不锈钢静音宠物饮水机（可自由填写，无需先建案卷）"
            />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sv-diff">核心卖点 / 场景亮点（可选）</label>
            <input
              id="sv-diff"
              type="text"
              value={coreDifferentiator}
              onChange={(e) => setCoreDifferentiator(e.target.value)}
              placeholder="例如：22dB 超静音无刷水泵、304 不锈钢可拆卸清洗"
            />
          </div>
        </div>

        {/* 首帧底图：支持自由上传 或 一键选用生图工坊图库 */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>
              首帧商品底图（上传本地图片，或直接点选「AI 生图工坊」已生成图片）
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: "30px", fontSize: "12px", padding: "0 12px" }}
                onClick={() => fileInputRef.current?.click()}
              >
                + 上传本地参考图
              </button>
              {selectedFile ? (
                <button
                  type="button"
                  className="button ghost"
                  style={{ minHeight: "30px", fontSize: "12px", padding: "0 10px" }}
                  onClick={() => handleFileChange(null)}
                >
                  清除已上传图
                </button>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
            {selectedFile && selectedFilePreview ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "6px 12px 6px 6px",
                  borderRadius: "10px",
                  border: "2px solid var(--green)",
                  background: "var(--green-soft)",
                }}
              >
                <img
                  src={selectedFilePreview}
                  alt={selectedFile.name}
                  style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px" }}
                />
                <div style={{ display: "grid", gap: "2px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)" }}>{selectedFile.name}</span>
                  <span style={{ fontSize: "11px", color: "var(--green)" }}>✓ 已选为首帧底图（本地上传）</span>
                </div>
              </div>
            ) : null}

            {studioImages.slice(0, 8).map((img) => {
              const active = !selectedFile && selectedStudioImageId === img.id;
              return (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => handlePickStudioImage(img)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
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
                    alt={img.productName || img.originalName}
                    style={{ width: "44px", height: "44px", objectFit: "cover", borderRadius: "6px" }}
                  />
                  <div style={{ display: "grid", gap: "2px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {img.productName || img.originalName}
                    </span>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>生图工坊 · {img.aspectRatio}</span>
                  </div>
                </button>
              );
            })}

            {!selectedFile && studioImages.length === 0 ? (
              <span style={{ fontSize: "12.5px", color: "var(--muted)" }}>
                点击右上角「+ 上传本地参考图」，或先去 <Link href="/image-studio" style={{ textDecoration: "underline" }}>AI 生图工坊</Link> 生成商品主图。
              </span>
            ) : null}
          </div>
        </div>

        {/* 内置 + 自定义 Video Skills */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>
              视频运镜 Skill（内置 6 套电商高转化规范 + 支持自定义沉淀）
            </span>
            <button
              type="button"
              className="button ghost"
              style={{ minHeight: "28px", fontSize: "12px", padding: "0 10px" }}
              onClick={() => setShowCustomSkillForm((v) => !v)}
            >
              {showCustomSkillForm ? "收起自定义 Skill" : "+ 新增自定义视频 Skill"}
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px" }}>
            {skills.map((skill) => {
              const active = selectedSkillId === skill.id;
              return (
                <div
                  key={skill.id}
                  onClick={() => handleSelectSkill(skill)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleSelectSkill(skill);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "11px 13px",
                    borderRadius: "10px",
                    border: active ? "1.5px solid var(--green)" : "1px solid var(--line)",
                    background: active ? "var(--green-soft)" : "var(--surface-subtle)",
                    color: "var(--ink)",
                    cursor: "pointer",
                    display: "grid",
                    gap: "4px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 800 }}>{skill.name}</span>
                    {skill.source === "local" ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustomSkill(skill);
                        }}
                        style={{ background: "none", border: "none", color: "var(--red)", fontSize: "11px", cursor: "pointer", padding: 0 }}
                      >
                        删除
                      </button>
                    ) : (
                      <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>{skill.aspectRatio} · {skill.durationSec}s</span>
                    )}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "var(--muted)", lineHeight: 1.45 }}>{skill.description}</div>
                  <div style={{ fontSize: "11px", color: "var(--green)", fontWeight: 600 }}>{skill.channelHint}</div>
                </div>
              );
            })}
          </div>

          {showCustomSkillForm ? (
            <div
              style={{
                marginTop: "12px",
                padding: "14px 16px",
                borderRadius: "10px",
                border: "1px solid var(--line-strong)",
                background: "var(--surface-subtle)",
                display: "grid",
                gap: "10px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <strong style={{ fontSize: "13px", color: "var(--ink)" }}>创建并持久化自定义视频 Skill（保存为 SKILL.md）</strong>
                <button
                  type="button"
                  className="button secondary"
                  style={{ minHeight: "28px", fontSize: "12px", padding: "0 10px" }}
                  disabled={aiGeneratingPrompt}
                  onClick={() => handleAiGeneratePrompt(true)}
                >
                  {aiGeneratingPrompt ? "AI 生成中..." : "✨ AI 帮我生成英文运镜规范"}
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <input
                  type="text"
                  value={customSkillName}
                  onChange={(e) => setCustomSkillName(e.target.value)}
                  placeholder="Skill 名称（如：宠物饮水机慢推水流）"
                />
                <input
                  type="text"
                  value={customSkillChannel}
                  onChange={(e) => setCustomSkillChannel(e.target.value)}
                  placeholder="适用渠道（如：TikTok Shop / Amazon 主图）"
                />
              </div>
              <textarea
                rows={2}
                value={customMotion}
                onChange={(e) => setCustomMotion(e.target.value)}
                placeholder="运镜与动作规范（Motion Directives，支持中/英文，或点右上角让 AI 自动生成）"
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <input
                  type="text"
                  value={customLighting}
                  onChange={(e) => setCustomLighting(e.target.value)}
                  placeholder="光影氛围规范（Lighting Directives，可选）"
                />
                <input
                  type="text"
                  value={customNegative}
                  onChange={(e) => setCustomNegative(e.target.value)}
                  placeholder="规避词（Negative Directives，可选）"
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" className="button ghost" onClick={() => setShowCustomSkillForm(false)}>取消</button>
                <button type="button" className="button primary" disabled={savingSkill} onClick={handleSaveCustomSkill}>
                  {savingSkill ? "保存中..." : "保存自定义视频 Skill"}
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* 规格 & AI 生成 / 预览触发 */}
        <div style={{ display: "grid", gridTemplateColumns: "145px 115px minmax(0, 1fr) auto auto", gap: "10px", alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sv-ratio">画幅比例</label>
            <select id="sv-ratio" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as VideoAspectRatio)}>
              <option value="16:9">16:9（Amazon 横屏）</option>
              <option value="1:1">1:1（详情方屏）</option>
              <option value="9:16">9:16（TikTok 竖屏）</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sv-dur">单镜时长</label>
            <select id="sv-dur" value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value) >= 8 ? 10 : 5)}>
              <option value={5}>5 秒（推荐）</option>
              <option value={10}>10 秒</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="sv-custom">中文创意想法 / 补充运镜（交给 AI 扩写）</label>
            <input
              id="sv-custom"
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="例如：镜头缓慢推近展示流动清水与不锈钢拉丝质感，柔和日光"
            />
          </div>
          <button
            type="button"
            className="button primary"
            disabled={aiGeneratingPrompt}
            onClick={() => handleAiGeneratePrompt(false)}
            title="调用当前默认文本大模型，将中文创意扩写为电影级英文 I2V 提示词与 3 镜分镜脚本"
          >
            {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成提示词"}
          </button>
          <button type="button" className="button secondary" disabled={loadingPreview} onClick={handlePreview}>
            {loadingPreview ? "生成中..." : "模板预览"}
          </button>
        </div>

        {/* 分镜预览 & 费用二次确认 */}
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
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--green)" }}>
                    镜头 {shot.shot}（{shot.durationSec}s）· {shot.role}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--ink)", lineHeight: 1.45 }}>{shot.captionEn}</div>
                  <div style={{ fontSize: "11px", color: "var(--muted)" }}>{shot.captionZh}</div>
                </div>
              ))}
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="sv-prompt-edit">英文 I2V Prompt（可直接编辑）</label>
              <textarea id="sv-prompt-edit" rows={3} value={promptText} onChange={(e) => setPromptText(e.target.value)} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12.5px", color: "var(--ink)", cursor: "pointer" }}>
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>确认预估费用（约 <strong>${preview.estimatedCostUsd.toFixed(2)}</strong>）并提交异步视频生成</span>
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
                  disabled={!confirmed || submitting}
                  onClick={handleGenerate}
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
      </section>

      {/* 异步任务队列 */}
      {jobs.length > 0 ? (
        <section className="panel" style={{ padding: "18px 22px", display: "grid", gap: "10px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--ink)" }}>
            异步渲染队列（{jobs.length} 条{hasPending ? " · 每 4.5 秒自动轮询" : ""}）
          </div>
          {jobs.slice(0, 8).map((job) => (
            <div
              key={job.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "10px",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--line)",
                background: "var(--surface-subtle)",
                fontSize: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <span className={`badge ${job.status === "succeeded" ? "badge-success" : job.status === "failed" ? "badge-danger" : "badge-neutral"}`}>
                  {job.status === "succeeded" ? "已完成" : job.status === "failed" ? "失败" : job.status === "running" ? "渲染中" : "排队中"}
                </span>
                <strong style={{ color: "var(--ink)" }}>{job.provider} / {job.model}</strong>
                <span style={{ color: "var(--muted)" }}>{job.aspect_ratio} · {job.duration_sec}s</span>
                {job.error_message ? <span style={{ color: "var(--red)" }}>{job.error_message}</span> : null}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {(job.status === "queued" || job.status === "running") ? (
                  <button type="button" className="button ghost" style={{ minHeight: "26px", padding: "0 10px", fontSize: "11px" }} onClick={() => handleManualPoll(job.id)}>
                    立即刷新
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleDeleteJob(job.id)}
                  style={{ background: "none", border: "none", color: "var(--red)", fontSize: "12px", cursor: "pointer", padding: "0 4px" }}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {/* 视频作品库 + ffmpeg 拼接 + 删除 */}
      <section className="panel" style={{ padding: "20px 24px", display: "grid", gap: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "16px", color: "var(--ink)" }}>已生成视频作品库（{assets.length} 条）</h2>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--muted)" }}>
              勾选 2–5 段视频可使用本机 ffmpeg 一键拼接为 10–15 秒成片；支持在线播放、下载与删除。
            </p>
          </div>
          {assets.length >= 2 ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={stitchRatio}
                onChange={(e) => setStitchRatio(e.target.value as VideoAspectRatio)}
                style={{ width: "auto", minHeight: "32px", fontSize: "12px", padding: "4px 8px" }}
              >
                <option value="16:9">成片 16:9</option>
                <option value="9:16">成片 9:16</option>
                <option value="1:1">成片 1:1</option>
              </select>
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: "32px", fontSize: "12px", padding: "0 12px" }}
                disabled={selectedForStitch.length < 2 || stitching || !ffmpegReady}
                onClick={handleStitch}
              >
                {stitching ? "ffmpeg 合成中..." : `一键合成成片（已选 ${selectedForStitch.length} 段）`}
              </button>
            </div>
          ) : null}
        </div>

        {assets.length === 0 ? (
          <div style={{ padding: "28px 16px", borderRadius: "10px", border: "1px dashed var(--line)", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
            暂无已生成的视频。在上方上传参考底图并提交生成后，视频将出现在这里。
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }}>
            {assets.map((asset) => {
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
                    src={asset.fileUrl}
                    controls
                    playsInline
                    preload="metadata"
                    style={{ width: "100%", maxHeight: "220px", background: "#000", display: "block" }}
                  />
                  <div style={{ padding: "12px", display: "grid", gap: "8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 700, color: "var(--ink)", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedForStitch((prev) =>
                              prev.includes(asset.id) ? prev.filter((id) => id !== asset.id) : [...prev, asset.id],
                            )
                          }
                        />
                        <span>{asset.productName || asset.originalName}</span>
                      </label>
                      <span className="badge badge-neutral">{asset.aspectRatio} · {asset.durationSec}s</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {asset.provider} · {asset.model}
                    </div>
                    <div style={{ display: "flex", gap: "8px", justifyContent: "space-between", alignItems: "center" }}>
                      <a
                        href={`${asset.fileUrl}?download=1`}
                        className="button secondary"
                        style={{ minHeight: "28px", padding: "0 10px", fontSize: "11.5px" }}
                      >
                        下载 MP4
                      </a>
                      <button
                        type="button"
                        disabled={deletingId === asset.id}
                        onClick={() => handleDeleteAsset(asset)}
                        style={{
                          background: "none",
                          border: "1px solid var(--line)",
                          borderRadius: "6px",
                          padding: "4px 10px",
                          fontSize: "11.5px",
                          fontWeight: 600,
                          color: "var(--red)",
                          cursor: "pointer",
                        }}
                      >
                        {deletingId === asset.id ? "删除中..." : "删除"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
