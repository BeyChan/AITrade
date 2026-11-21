"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StudioLoadingCard } from "@/components/studio/studio-loading-card";
import { StudioMediaGallery, type StudioGalleryMediaItem } from "@/components/studio/studio-media-gallery";
import { StudioPromptCard } from "@/components/studio/studio-prompt-card";
import { StudioReferenceDropzone, type QuickPickImage } from "@/components/studio/studio-reference-dropzone";
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

type CaseOption = {
  id: string;
  asin: string;
  title: string;
  marketplace: string;
};

type Props = {
  initialAssets: StandaloneVideoAsset[];
  initialJobs: VideoGenerationJob[];
  studioImages: StandaloneStudioAsset[];
  caseQuickImages?: QuickPickImage[];
  providerStatus: VideoProviderStatus;
  initialSkills: VideoSkillDefinition[];
  cases: CaseOption[];
  initialCaseId?: string;
  ffmpegReady: boolean;
  activeMarketCode: string;
};

export function StandaloneVideoStudioClient({
  initialAssets,
  initialJobs,
  studioImages,
  caseQuickImages = [],
  providerStatus,
  initialSkills,
  cases,
  initialCaseId = "",
  ffmpegReady,
  activeMarketCode,
}: Props) {
  const initialMatchedCase = initialCaseId ? cases.find((c) => c.id === initialCaseId) : undefined;
  const [skills, setSkills] = useState<VideoSkillDefinition[]>(initialSkills);
  const [selectedSkillId, setSelectedSkillId] = useState<string>(initialSkills[0]?.id ?? "amazon-hero-orbit");
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialMatchedCase?.id ?? "");
  const [productName, setProductName] = useState(initialMatchedCase?.title ?? "");
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

  // 首帧参考图
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFilePreview, setSelectedFilePreview] = useState<string | null>(null);
  const [selectedStudioImageId, setSelectedStudioImageId] = useState<string>(
    caseQuickImages[0]?.id ?? studioImages[0]?.id ?? "",
  );

  // 预览与提交
  const [preview, setPreview] = useState<ComposedVideoPrompt | null>(null);
  const [promptText, setPromptText] = useState("");
  const [negativePromptText, setNegativePromptText] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  // 队列与画廊
  const [assets, setAssets] = useState<StandaloneVideoAsset[]>(initialAssets);
  const [jobs, setJobs] = useState<VideoGenerationJob[]>(initialJobs);
  const [selectedForStitch, setSelectedForStitch] = useState<string[]>([]);
  const [stitchRatio, setStitchRatio] = useState<VideoAspectRatio>("16:9");

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [aiGeneratingPrompt, setAiGeneratingPrompt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stitching, setStitching] = useState(false);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quickPickImages: QuickPickImage[] = [
    ...caseQuickImages,
    ...studioImages.slice(0, 6).map((img) => ({
      id: img.id,
      fileUrl: img.fileUrl,
      label: img.productName || img.originalName,
      sublabel: `生图工坊 · ${img.aspectRatio}`,
    })),
  ].slice(0, 8);

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

  const pendingJobs = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const hasPending = pendingJobs.length > 0;

  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(async () => {
      let changed = false;
      for (const job of pendingJobs) {
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
  }, [hasPending, pendingJobs, refreshState]);

  function handleSelectCase(caseId: string) {
    setSelectedCaseId(caseId);
    const chosen = cases.find((c) => c.id === caseId);
    if (chosen) {
      setProductName(chosen.title);
    }
  }

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

  function handlePickGalleryImage(img: QuickPickImage) {
    handleFileChange(null);
    setSelectedStudioImageId(img.id);
    if (!productName && img.label) setProductName(img.label);
  }

  function handleSelectSkill(skill: VideoSkillDefinition) {
    setSelectedSkillId(skill.id);
    setAspectRatio(skill.aspectRatio);
    setDurationSec(skill.durationSec);
    setShowCustomSkillForm(false);
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
            storyboard:
              Array.isArray(data.storyboard) && data.storyboard.length > 0
                ? data.storyboard
                : baseData.preview.storyboard,
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
      if (selectedCaseId) {
        form.append("caseId", selectedCaseId);
      }
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
      if (data.job?.status === "succeeded") setNotice("视频生成完成并已保存到作品库。");
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
    setError(null);
    try {
      const resp = await fetch(`/api/video-studio/file/${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || "删除视频失败");
      setAssets((prev) => prev.filter((item) => item.id !== asset.id));
      setSelectedForStitch((prev) => prev.filter((id) => id !== asset.id));
      setNotice("已删除该视频资产。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除视频失败");
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
          caseId: selectedCaseId || undefined,
          actor: actor || "本机管理员",
        }),
      });
      const data = (await resp.json()) as { note?: string; createdAsset?: StandaloneVideoAsset; error?: string };
      if (!resp.ok) throw new Error(data.error || "合成成片失败");
      if (data.createdAsset?.id) {
        setSessionIds((prev) => [data.createdAsset!.id, ...prev]);
      }
      setNotice(data.note || "已完成多镜头合成。");
      setSelectedForStitch([]);
      await refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "合成成片失败");
    } finally {
      setStitching(false);
    }
  }

  const galleryItems: StudioGalleryMediaItem[] = useMemo(
    () =>
      assets.map((asset) => ({
        id: asset.id,
        kind: "video",
        fileUrl: asset.fileUrl,
        title: asset.productName || asset.originalName,
        originalName: asset.originalName,
        provider: asset.provider,
        model: asset.model,
        aspectRatio: asset.aspectRatio,
        metaLabel: `${asset.durationSec}s`,
        slot: asset.templateId,
        prompt: asset.prompt,
        boundCases: asset.boundCases ?? [],
        createdAt: asset.createdAt,
      })),
    [assets],
  );

  const activeSkill = skills.find((s) => s.id === selectedSkillId) ?? skills[0];

  return (
    <div className="studio-split" id="standalone-video-workbench">
      {/* 左侧控制栏（与 AI 生图工坊完全对齐） */}
      <aside className="studio-controls panel">
        <div className="studio-controls-body">
          {cases.length > 0 ? (
            <div className="field">
              <label htmlFor="sv-case-select">快速带入工作区商品（可选）</label>
              <select
                id="sv-case-select"
                value={selectedCaseId}
                onChange={(e) => handleSelectCase(e.target.value)}
              >
                <option value="">自由创作（不绑定商品案卷）</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.marketplace})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="sv-product-name">商品名称 *</label>
            <input
              id="sv-product-name"
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="例：304 不锈钢静音宠物饮水机"
            />
          </div>

          <StudioReferenceDropzone
            title="首帧参考底图（I2V 锁定商品外观）"
            hint="上传本地实拍图，或在下方点选 AI 生图工坊已生成主图"
            selectedFile={selectedFile}
            selectedFilePreview={selectedFilePreview}
            selectedGalleryId={selectedStudioImageId}
            quickPickImages={quickPickImages}
            onFileChange={handleFileChange}
            onSelectGalleryImage={handlePickGalleryImage}
            emptyGalleryNote="提示：也可先在「AI 生图工坊」生成主图，这里会自动出现快捷点选缩略图。"
          />

          {/* 视频 Skill 下拉选择（与生图工坊视觉规范完全对齐） */}
          <div className="field">
            <div className="studio-label-row">
              <label htmlFor="sv-skill-select">视频运镜 Skill（{skills.length} 套）</label>
              {activeSkill?.source === "local" && !showCustomSkillForm ? (
                <button
                  type="button"
                  className="studio-inline-danger"
                  onClick={() => handleDeleteCustomSkill(activeSkill)}
                >
                  删除当前规范
                </button>
              ) : null}
            </div>
            <select
              id="sv-skill-select"
              value={showCustomSkillForm ? "__custom__" : selectedSkillId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === "__custom__") {
                  setShowCustomSkillForm(true);
                  return;
                }
                const found = skills.find((s) => s.id === val);
                if (found) handleSelectSkill(found);
              }}
            >
              <optgroup label="内置电商视频规范">
                {skills
                  .filter((s) => s.source === "builtin")
                  .map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}（{skill.aspectRatio} · {skill.durationSec}s）
                    </option>
                  ))}
              </optgroup>
              {skills.some((s) => s.source === "local") ? (
                <optgroup label="本地自定义规范">
                  {skills
                    .filter((s) => s.source === "local")
                    .map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}（{skill.aspectRatio} · {skill.durationSec}s）
                      </option>
                    ))}
                </optgroup>
              ) : null}
              <optgroup label="新建">
                <option value="__custom__">+ 自定义视频规范（可保存复用）</option>
              </optgroup>
            </select>
            {activeSkill && !showCustomSkillForm ? (
              <small className="field-hint">{activeSkill.description}</small>
            ) : null}
          </div>

          {/* 自定义 Video Skill 表单盒 */}
          {showCustomSkillForm ? (
            <div className="studio-custom-box">
              <div className="studio-label-row">
                <strong style={{ fontSize: "12.5px", color: "var(--ink)" }}>新建可复用视频 Skill</strong>
                <button
                  type="button"
                  className="button secondary"
                  style={{ minHeight: "26px", padding: "0 10px", fontSize: "12px" }}
                  disabled={aiGeneratingPrompt}
                  onClick={() => handleAiGeneratePrompt(true)}
                >
                  {aiGeneratingPrompt ? "AI 生成中..." : "✨ AI 帮写规范"}
                </button>
              </div>
              <div className="field">
                <label htmlFor="sv-cs-name">规范名称 *</label>
                <input
                  id="sv-cs-name"
                  value={customSkillName}
                  onChange={(e) => setCustomSkillName(e.target.value)}
                  placeholder="例：宠物饮水机慢推水流规范"
                />
              </div>
              <div className="field">
                <label htmlFor="sv-cs-motion">运镜与动作规范 *</label>
                <textarea
                  id="sv-cs-motion"
                  rows={2}
                  value={customMotion}
                  onChange={(e) => setCustomMotion(e.target.value)}
                  placeholder="描述运镜路径、主体动作与防变形要求（中英文均可）"
                />
              </div>
              <div className="field">
                <label htmlFor="sv-cs-light">光影氛围（可选）</label>
                <input
                  id="sv-cs-light"
                  value={customLighting}
                  onChange={(e) => setCustomLighting(e.target.value)}
                  placeholder="例：柔和自然窗光，浅景深商业质感"
                />
              </div>
              <div className="field">
                <label htmlFor="sv-cs-neg">负向禁止项（可选）</label>
                <input
                  id="sv-cs-neg"
                  value={customNegative}
                  onChange={(e) => setCustomNegative(e.target.value)}
                  placeholder="例：水印、字幕、闪烁、商品变形"
                />
              </div>
              <button
                type="button"
                className="button secondary"
                style={{ width: "100%" }}
                disabled={savingSkill}
                onClick={handleSaveCustomSkill}
              >
                {savingSkill ? "正在保存..." : "保存为可复用视频规范"}
              </button>
            </div>
          ) : null}

          {/* 画幅 & 时长分段按钮（与生图工坊 .studio-pill 完全一致） */}
          <div className="studio-quick-row">
            <div className="field" style={{ flex: 1 }}>
              <label>画幅比例</label>
              <div className="studio-pill-group">
                {(["16:9", "1:1", "9:16"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`studio-pill${aspectRatio === r ? " active" : ""}`}
                    onClick={() => setAspectRatio(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ width: "110px" }}>
              <label>时长</label>
              <div className="studio-pill-group">
                {([5, 10] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`studio-pill${durationSec === d ? " active" : ""}`}
                    onClick={() => setDurationSec(d)}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="sv-idea">中文创意想法 / 运镜要求</label>
            <textarea
              id="sv-idea"
              rows={2}
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="例如：镜头缓慢推近展示水流循环与拉丝金属光泽，画面稳定无文字"
            />
          </div>

          <details className="studio-more-details">
            <summary>补充卖点与细节（可选）</summary>
            <div className="studio-more-body">
              <div className="field">
                <label htmlFor="sv-diff">核心差异点 / 卖点</label>
                <input
                  id="sv-diff"
                  value={coreDifferentiator}
                  onChange={(e) => setCoreDifferentiator(e.target.value)}
                  placeholder="例：22dB 超静音无刷水泵、可拆卸清洗"
                />
              </div>
            </div>
          </details>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "4px" }}>
            <button
              type="button"
              className="button primary"
              disabled={aiGeneratingPrompt || loadingPreview}
              onClick={() => handleAiGeneratePrompt(false)}
              title="调用默认文本大模型，将中文创意扩写为专业英文 I2V 提示词与 3 镜分镜"
            >
              {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成提示词"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={loadingPreview || aiGeneratingPrompt}
              onClick={handlePreview}
            >
              {loadingPreview ? "生成中..." : "模板预览"}
            </button>
          </div>
        </div>
      </aside>

      {/* 右侧画布与作品库 */}
      <div className="studio-canvas stack">
        {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
        {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

        {/* 1. 提示词与 3 镜分镜预览卡（共享组件） */}
        {preview ? (
          <StudioPromptCard
            title={`I2V 分镜与提示词预览（${preview.aspectRatio} · ${preview.durationSec}s）`}
            metaBadge={`预估 $${preview.estimatedCostUsd.toFixed(2)} · ${preview.estimatedLatencyLabel}`}
            prompt={promptText}
            negativePrompt={negativePromptText}
            onPromptChange={setPromptText}
            onNegativePromptChange={setNegativePromptText}
            storyboard={preview.storyboard}
            onAiRefine={() => handleAiGeneratePrompt(false)}
            aiRefining={aiGeneratingPrompt}
            confirmed={confirmed}
            onConfirmedChange={setConfirmed}
            confirmLabel={`确认预估费用（约 $${preview.estimatedCostUsd.toFixed(2)}）并提交异步视频生成`}
            actor={actor}
            onActorChange={setActor}
            submitLabel={
              submitting
                ? "提交中..."
                : providerStatus.provider === "template"
                  ? "生成分镜包（免 Key）"
                  : "提交异步生成 MP4"
            }
            submitting={submitting}
            onSubmit={handleGenerate}
          />
        ) : null}

        {/* 2. 异步渲染进度动效卡（共享组件） */}
        {pendingJobs.map((job) => (
          <StudioLoadingCard
            key={job.id}
            title={`正在异步渲染 ${job.provider} / ${job.model}（${job.aspect_ratio} · ${job.duration_sec}s）`}
            subtitle={job.status === "running" ? "模型渲染中，每 4.5 秒自动轮询进度..." : "已进入云端队列，正在等待调度..."}
            actionLabel="立即刷新进度"
            onAction={() => handleManualPoll(job.id)}
          />
        ))}

        {/* 失败任务提示条 */}
        {jobs.filter((j) => j.status === "failed").slice(0, 3).map((job) => (
          <div
            key={job.id}
            className="panel"
            style={{
              padding: "10px 14px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "10px",
              fontSize: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span className="badge badge-danger">渲染失败</span>
              <strong style={{ color: "var(--ink)" }}>{job.provider} / {job.model}</strong>
              <span style={{ color: "var(--red)" }}>{job.error_message || "外部接口返回错误"}</span>
            </div>
            <button type="button" className="studio-inline-danger" onClick={() => handleDeleteJob(job.id)}>
              清除记录
            </button>
          </div>
        ))}

        {/* 3. 统一可复用媒体列表（默认当前生成 + 一键查看全部历史 + 前往资源库） */}
        <StudioMediaGallery
          mode="studio"
          kind="video"
          items={galleryItems}
          sessionIds={sessionIds}
          selectedCaseId={selectedCaseId}
          cases={cases}
          actor={actor || "本机管理员"}
          selectedIds={selectedForStitch}
          onToggleSelect={(id) =>
            setSelectedForStitch((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
          }
          extraHeaderActions={
            assets.length >= 2 ? (
              <>
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
                >
                  {stitching ? "合成中..." : `拼接成片 (${selectedForStitch.length})`}
                </button>
              </>
            ) : null
          }
          onBound={(itemId, ref, msg) => {
            setNotice(msg);
            setError(null);
            setAssets((prev) =>
              prev.map((x) =>
                x.id === itemId
                  ? { ...x, boundCases: [...(x.boundCases ?? []).filter((c) => c.caseId !== ref.caseId), ref] }
                  : x,
              ),
            );
          }}
          onDelete={async (item) => {
            const target = assets.find((a) => a.id === item.id);
            if (target) await handleDeleteAsset(target);
          }}
          onError={(msg) => setError(msg)}
        />
      </div>
    </div>
  );
}
