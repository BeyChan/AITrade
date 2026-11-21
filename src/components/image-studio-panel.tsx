"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ImageProviderStatus } from "@/lib/image-provider";
import {
  IMAGE_SLOT_LABELS,
  type ComposedImagePrompt,
  type ImageAspectRatio,
  type ImageAssetSlot,
  type ImageSkillDefinition,
} from "@/lib/image-skills-types";
import type { AssetRow } from "@/lib/types";

type ImageStudioPanelProps = {
  caseId: string;
  marketplace: string;
  assets: AssetRow[];
  skills: ImageSkillDefinition[];
  providerStatus: ImageProviderStatus;
  hasProfile: boolean;
  claimsToAvoid: string;
  topPainPoints: string[];
  uploadAction: (formData: FormData) => Promise<void>;
  reviewAction: (formData: FormData) => Promise<void>;
};

type FilterTab = "all" | ImageAssetSlot;

const SLOT_OPTIONS: Array<{ value: ImageAssetSlot; label: string }> = [
  { value: "main_image", label: "纯白底主图 (main_image)" },
  { value: "lifestyle_image", label: "使用场景图 (lifestyle_image)" },
  { value: "feature_image", label: "卖点/细节图 (feature_image)" },
  { value: "packaging_image", label: "包装全家福 (packaging_image)" },
  { value: "reference_image", label: "实拍参考底图 (reference_image)" },
];

export function ImageStudioPanel({
  caseId,
  marketplace,
  assets,
  skills,
  providerStatus,
  hasProfile,
  claimsToAvoid,
  topPainPoints,
  uploadAction,
  reviewAction,
}: ImageStudioPanelProps) {
  const router = useRouter();
  const [availableSkills, setAvailableSkills] = useState<ImageSkillDefinition[]>(skills);
  const initialSkill = availableSkills[0] ?? skills[0]!;

  const [selectedSkillId, setSelectedSkillId] = useState<string>(initialSkill.id);
  const [slot, setSlot] = useState<ImageAssetSlot>(initialSkill.slot);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(initialSkill.aspectRatio);
  const [count, setCount] = useState<number>(1);
  const [referenceAssetId, setReferenceAssetId] = useState<string>("");
  const [customInstruction, setCustomInstruction] = useState<string>("");
  const [customSkillName, setCustomSkillName] = useState<string>("");
  const [customStyleDirectives, setCustomStyleDirectives] = useState<string>("");
  const [customNegativeDirectives, setCustomNegativeDirectives] = useState<string>("");
  const [actor, setActor] = useState<string>("运营人员");

  const [preview, setPreview] = useState<ComposedImagePrompt | null>(null);
  const [promptDraft, setPromptDraft] = useState<string>("");
  const [negativeDraft, setNegativeDraft] = useState<string>("");
  const [confirmed, setConfirmed] = useState<boolean>(false);

  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [generating, setGenerating] = useState<boolean>(false);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [savingSkill, setSavingSkill] = useState<boolean>(false);
  const [deletingSkill, setDeletingSkill] = useState<boolean>(false);
  const [aiGeneratingPrompt, setAiGeneratingPrompt] = useState<boolean>(false);
  const [studioNotice, setStudioNotice] = useState<string>("");
  const [studioError, setStudioError] = useState<string>("");
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");

  useEffect(() => {
    if (!generating) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [generating]);

  useEffect(() => {
    setAvailableSkills(skills);
  }, [skills]);

  const builtinSkills = useMemo(() => availableSkills.filter((item) => item.source === "builtin"), [availableSkills]);
  const localSkills = useMemo(() => availableSkills.filter((item) => item.source === "local"), [availableSkills]);
  const isCustomSkill = selectedSkillId === "custom";
  const activeSkill = useMemo(
    () => (isCustomSkill ? null : availableSkills.find((item) => item.id === selectedSkillId) ?? initialSkill),
    [isCustomSkill, availableSkills, selectedSkillId, initialSkill],
  );

  const selectedReference = useMemo(
    () => assets.find((item) => item.id === referenceAssetId) ?? null,
    [assets, referenceAssetId],
  );

  const slotCounts = useMemo(() => {
    const counts: Record<ImageAssetSlot, number> = {
      main_image: 0,
      lifestyle_image: 0,
      feature_image: 0,
      packaging_image: 0,
      reference_image: 0,
    };
    for (const asset of assets) {
      if (asset.asset_type in counts) {
        counts[asset.asset_type as ImageAssetSlot] += 1;
      }
    }
    return counts;
  }, [assets]);

  const filteredAssets = useMemo(
    () => (activeFilter === "all" ? assets : assets.filter((item) => item.asset_type === activeFilter)),
    [assets, activeFilter],
  );

  function handleSelectSkillById(nextId: string) {
    setSelectedSkillId(nextId);
    if (nextId !== "custom") {
      const matched = availableSkills.find((item) => item.id === nextId);
      if (matched) {
        setSlot(matched.slot);
        setAspectRatio(matched.aspectRatio);
      }
    }
    setPreview(null);
    setConfirmed(false);
    setStudioNotice("");
    setStudioError("");
  }

  async function handleAiGenerateImagePrompt() {
    setStudioError("");
    setStudioNotice("");
    setAiGeneratingPrompt(true);
    try {
      const resp = await fetch("/api/studio/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          skillId: selectedSkillId,
          productName: customSkillName.trim() || "跨境电商品牌主推单品",
          claimsToAvoid,
          topPainPoints,
          slot,
          aspectRatio,
          marketplace,
          idea: customStyleDirectives.trim() || customInstruction.trim() || customSkillName.trim(),
        }),
      });
      const data = (await resp.json()) as {
        prompt?: string;
        styleDirectives?: string;
        negativePrompt?: string;
        note?: string;
        error?: string;
      };
      if (!resp.ok || !data.styleDirectives) throw new Error(data.error || "AI 生成提示词失败");
      setCustomStyleDirectives(data.styleDirectives);
      if (data.negativePrompt) setCustomNegativeDirectives(data.negativePrompt);
      if (data.prompt) setPromptDraft(data.prompt);
      setPreview(null);
      setConfirmed(false);
      if (data.note) setStudioNotice(data.note);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "AI 生成提示词失败");
    } finally {
      setAiGeneratingPrompt(false);
    }
  }

  async function handleSaveCustomSkill() {
    if (!customSkillName.trim()) {
      setStudioError("请填写自定义规范名称后再保存");
      return;
    }
    if (!customStyleDirectives.trim()) {
      setStudioError("请填写自定义风格与构图规范后再保存");
      return;
    }
    setSavingSkill(true);
    setStudioError("");
    setStudioNotice("");
    try {
      const response = await fetch("/api/image-studio/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customSkillName.trim(),
          slot,
          aspectRatio,
          styleDirectives: customStyleDirectives.trim(),
          negativeDirectives: customNegativeDirectives.trim(),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        skill?: ImageSkillDefinition;
        skills?: ImageSkillDefinition[];
      };
      if (!response.ok || !data.skill || !data.skills) {
        throw new Error(data.error || "保存自定义规范失败");
      }
      setAvailableSkills(data.skills);
      setSelectedSkillId(data.skill.id);
      setSlot(data.skill.slot);
      setAspectRatio(data.skill.aspectRatio);
      setPreview(null);
      setConfirmed(false);
      setStudioNotice(`已保存可复用规范「${data.skill.name}」`);
      router.refresh();
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "保存自定义规范失败");
    } finally {
      setSavingSkill(false);
    }
  }

  async function handleDeleteLocalSkill() {
    if (!activeSkill || activeSkill.source !== "local") return;
    if (!window.confirm(`确定要删除本地规范「${activeSkill.name}」吗？`)) return;
    setDeletingSkill(true);
    setStudioError("");
    setStudioNotice("");
    try {
      const response = await fetch(`/api/image-studio/skills?id=${encodeURIComponent(activeSkill.id)}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as {
        error?: string;
        skills?: ImageSkillDefinition[];
      };
      if (!response.ok || !data.skills) {
        throw new Error(data.error || "删除本地规范失败");
      }
      setAvailableSkills(data.skills);
      const fallback = data.skills[0]!;
      setSelectedSkillId(fallback.id);
      setSlot(fallback.slot);
      setAspectRatio(fallback.aspectRatio);
      setPreview(null);
      setConfirmed(false);
      setStudioNotice(`已删除本地规范「${activeSkill.name}」`);
      router.refresh();
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "删除本地规范失败");
    } finally {
      setDeletingSkill(false);
    }
  }

  async function handlePreviewPrompt() {
    if (isCustomSkill && !customStyleDirectives.trim()) {
      setStudioError("选择「自定义规范」时，请填写自定义风格与构图规范");
      return;
    }
    setLoadingPreview(true);
    setStudioError("");
    setStudioNotice("");
    setConfirmed(false);
    try {
      const response = await fetch("/api/content/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          skillId: selectedSkillId,
          slot,
          aspectRatio,
          count,
          referenceAssetId: referenceAssetId || undefined,
          customInstruction,
          ...(isCustomSkill
            ? {
                customSkillName,
                customStyleDirectives,
                customNegativeDirectives,
              }
            : {}),
          action: "preview",
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        preview?: ComposedImagePrompt;
      };
      if (!response.ok || !data.preview) {
        throw new Error(data.error || "生成提示词预览失败");
      }
      setPreview(data.preview);
      setPromptDraft(data.preview.prompt);
      setNegativeDraft(data.preview.negativePrompt);
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "生成提示词预览失败");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleGenerateImages() {
    if (!preview) {
      setStudioError("请先点击「生成提示词预览」");
      return;
    }
    if (!confirmed) {
      setStudioError("请先勾选确认生图");
      return;
    }
    if (!actor.trim()) {
      setStudioError("请输入操作人姓名");
      return;
    }

    setGenerating(true);
    setStudioError("");
    setStudioNotice("");
    try {
      const response = await fetch("/api/content/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          skillId: selectedSkillId,
          slot,
          aspectRatio,
          count,
          referenceAssetId: referenceAssetId || undefined,
          customInstruction,
          ...(isCustomSkill
            ? {
                customSkillName,
                customStyleDirectives,
                customNegativeDirectives,
              }
            : {}),
          promptOverride: promptDraft,
          negativePromptOverride: negativeDraft,
          actor: actor.trim(),
          action: "generate",
          confirmed: true,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        mode?: "model" | "prompt_only";
        note?: string;
        createdAssets?: Array<{ assetId: string }>;
      };
      if (!response.ok) {
        throw new Error(data.error || "生图失败");
      }
      setStudioNotice(data.note || "操作已完成");
      setConfirmed(false);
      if (data.mode === "model" && (data.createdAssets?.length ?? 0) > 0) {
        router.refresh();
      }
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : "生图失败");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyPrompt() {
    if (!promptDraft) return;
    const text = negativeDraft ? `${promptDraft}\n\nAvoid strictly: ${negativeDraft}` : promptDraft;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1800);
    } catch {
      // Clipboard API may be blocked in insecure contexts.
    }
  }

  return (
    <section className="section image-studio-section" id="image-studio">
      <div className="section-header">
        <div>
          <h2>2. 视觉素材与 AI 生图工作台</h2>
          <p>
            先上传实拍/供应商底图并选用电商生图 Skill，核对提示词与合规红线后再出图；所有生成图默认进入「待人工审核」，不经核验不得放行上架。
          </p>
        </div>
        <div className="image-studio-provider-bar">
          <span
            className={`badge ${
              providerStatus.provider !== "template" && providerStatus.configured
                ? "badge-success"
                : "badge-neutral"
            }`}
          >
            {providerStatus.label}
          </span>
          <Link href="/settings" className="button ghost">
            配置生图模型
          </Link>
        </div>
      </div>

      <div className="image-studio-context-strip">
        <span>站点语境：{marketplace}</span>
        <span>{hasProfile ? "已注入商品定义事实" : "尚未保存商品定义（建议先完善第 1 步）"}</span>
        <span>{claimsToAvoid ? `禁用红线：${claimsToAvoid}` : "未填写禁用声明"}</span>
        <span>{topPainPoints.length > 0 ? `已关联差评痛点 ${topPainPoints.length} 条` : "无关联差评痛点"}</span>
      </div>

      <div className="image-studio-workbench">
        <div className="image-studio-block">
          <div className="image-studio-block-head">
            <div>
              <span className="eyebrow">Step 1 · 视觉规范与出图参数</span>
              <h3>选择或自定义生图规范，并可选绑定参考底图</h3>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              内置/本地共 {skills.length} 套 + 自定义
            </span>
          </div>

          <div className="form-grid">
            <div className="field full">
              <div className="studio-label-row">
                <label htmlFor="studio-skill">生图视觉规范（内置 / 本地 Skill / 自定义）</label>
                {activeSkill?.source === "local" ? (
                  <button
                    type="button"
                    className="studio-inline-danger"
                    onClick={handleDeleteLocalSkill}
                    disabled={deletingSkill}
                  >
                    {deletingSkill ? "删除中..." : "删除规范"}
                  </button>
                ) : null}
              </div>
              <select
                id="studio-skill"
                value={selectedSkillId}
                onChange={(event) => handleSelectSkillById(event.target.value)}
              >
                <optgroup label="内置跨境视觉规范">
                  {builtinSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}（{IMAGE_SLOT_LABELS[skill.slot]} · {skill.aspectRatio}）
                    </option>
                  ))}
                </optgroup>
                {localSkills.length > 0 ? (
                  <optgroup label="本地 Skill（~/.agents/skills/）">
                    {localSkills.map((skill) => (
                      <option key={skill.id} value={skill.id}>
                        {skill.name}（{IMAGE_SLOT_LABELS[skill.slot]} · {skill.aspectRatio}）
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label="自定义规范">
                  <option value="custom">自定义视觉规范（自由定义风格、构图与禁止项）</option>
                </optgroup>
              </select>
              <small className="field-hint">
                {activeSkill
                  ? `${activeSkill.description} · 适用：${activeSkill.bestFor}`
                  : "在下方填写自定义风格描述与禁止项，可保存至本地规范库复用。"}
              </small>
            </div>

            {isCustomSkill ? (
              <div className="field full studio-custom-box">
                <div className="field">
                  <label htmlFor="studio-custom-skill-name">自定义规范名称 *</label>
                  <input
                    id="studio-custom-skill-name"
                    value={customSkillName}
                    onChange={(event) => {
                      setCustomSkillName(event.target.value);
                      setPreview(null);
                    }}
                    placeholder="例：欧美户外露营金属质感规范"
                    maxLength={80}
                  />
                </div>
                <div className="field">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <label htmlFor="studio-custom-style" style={{ margin: 0 }}>自定义风格与构图规范 *</label>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ minHeight: "26px", padding: "0 10px", fontSize: "11.5px" }}
                      disabled={aiGeneratingPrompt || loadingPreview || generating}
                      onClick={handleAiGenerateImagePrompt}
                    >
                      {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成专业提示词"}
                    </button>
                  </div>
                  <textarea
                    id="studio-custom-style"
                    className="compact-textarea"
                    value={customStyleDirectives}
                    onChange={(event) => {
                      setCustomStyleDirectives(event.target.value);
                      setPreview(null);
                      setConfirmed(false);
                    }}
                    placeholder="描述画风、背景材质、光线方向、主体占比与构图要求（中英文均可）..."
                  />
                </div>
                <div className="field">
                  <label htmlFor="studio-custom-negative">自定义负向禁止项（可选）</label>
                  <input
                    id="studio-custom-negative"
                    value={customNegativeDirectives}
                    onChange={(event) => {
                      setCustomNegativeDirectives(event.target.value);
                      setPreview(null);
                    }}
                    placeholder="例：文字水印、过度磨皮、多余配件"
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleSaveCustomSkill}
                    disabled={savingSkill || loadingPreview || generating}
                  >
                    {savingSkill ? "正在保存..." : "保存为可复用规范"}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="field full">
              <label htmlFor="studio-reference">参考底图（可选）</label>
              <select
                id="studio-reference"
                value={referenceAssetId}
                onChange={(event) => {
                  setReferenceAssetId(event.target.value);
                  setPreview(null);
                  setConfirmed(false);
                }}
              >
                <option value="">不使用参考图 · 纯文生图概念探索（生成图不可替代大货实拍）</option>
                {assets.map((asset) => {
                  const name = typeof asset.metadata.originalName === "string" ? asset.metadata.originalName : asset.id;
                  const slotLabel = IMAGE_SLOT_LABELS[asset.asset_type as ImageAssetSlot] ?? asset.asset_type;
                  return (
                    <option key={asset.id} value={asset.id}>
                      [{slotLabel}] {name}
                    </option>
                  );
                })}
              </select>
              {selectedReference ? (
                <div className="image-reference-preview">
                  <img src={selectedReference.file_url} alt="已选参考底图" />
                  <div>
                    <strong>图生图锚点：{String(selectedReference.metadata.originalName ?? selectedReference.id)}</strong>
                    <span>生成时将把此图作为物理产品外观锚点传给模型，尽量保持结构与颜色一致。</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="studio-slot">产出图槽位</label>
              <select
                id="studio-slot"
                value={slot}
                onChange={(event) => {
                  setSlot(event.target.value as ImageAssetSlot);
                  setPreview(null);
                  setConfirmed(false);
                }}
              >
                {SLOT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>画幅比例</label>
              <div className="studio-pill-group">
                {(["1:1", "4:5", "16:9"] as const).map((ratio) => (
                  <button
                    type="button"
                    key={ratio}
                    className={`studio-pill ${aspectRatio === ratio ? "active" : ""}`}
                    onClick={() => {
                      setAspectRatio(ratio);
                      setPreview(null);
                      setConfirmed(false);
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>本次生成张数</label>
              <div className="studio-pill-group">
                {[1, 2].map((num) => (
                  <button
                    type="button"
                    key={num}
                    className={`studio-pill ${count === num ? "active" : ""}`}
                    onClick={() => setCount(num)}
                  >
                    {num} 张
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label htmlFor="studio-actor">操作人</label>
              <input
                id="studio-actor"
                value={actor}
                onChange={(event) => setActor(event.target.value)}
                placeholder="输入姓名（如：运营小王）"
                maxLength={80}
              />
            </div>

            <div className="field full">
              <label htmlFor="studio-instruction">补充画面指令（可选）</label>
              <textarea
                id="studio-instruction"
                className="compact-textarea"
                value={customInstruction}
                onChange={(event) => {
                  setCustomInstruction(event.target.value);
                  setPreview(null);
                  setConfirmed(false);
                }}
                placeholder="例如：把产品放在浅色橡木桌面右侧，清晨自然窗光，左侧保留干净留白。"
              />
            </div>
          </div>

          <div className="form-actions" style={{ marginTop: 12 }}>
            <span className="help">{providerStatus.detail}</span>
            <button
              type="button"
              className="button secondary"
              onClick={handlePreviewPrompt}
              disabled={loadingPreview || generating}
            >
              {loadingPreview ? "正在组装提示词..." : "1. 生成提示词预览"}
            </button>
          </div>
        </div>

        {preview ? (
          <div className="image-studio-preview-box">
            <div className="image-studio-block-head">
              <div>
                <span className="eyebrow">Step 2 · 预览确认闸门（先核对再出图）</span>
                <h3>提示词与合规红线核对（可手工微调）</h3>
              </div>
              <button type="button" className="button ghost" onClick={handleCopyPrompt}>
                {copiedPrompt ? "✓ 已复制 Prompt" : "复制完整 Prompt"}
              </button>
            </div>

            <ul className="image-compliance-notes">
              {preview.complianceNotes.map((note, idx) => (
                <li key={idx}>{note}</li>
              ))}
            </ul>

            <div className="form-grid" style={{ marginTop: 10 }}>
              <div className="field full">
                <label htmlFor="studio-prompt-draft">正向提示词（Prompt）</label>
                <textarea
                  id="studio-prompt-draft"
                  className="tall-textarea"
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                />
              </div>
              <div className="field full">
                <label htmlFor="studio-negative-draft">负向禁止项（Negative / Avoid strictly）</label>
                <textarea
                  id="studio-negative-draft"
                  className="compact-textarea"
                  value={negativeDraft}
                  onChange={(event) => setNegativeDraft(event.target.value)}
                />
              </div>
            </div>

            <label className="check-row image-confirm-gate">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                我已核对上方提示词、目标槽位（{IMAGE_SLOT_LABELS[preview.slot]}）与参考底图，确认执行本次生图（结果将以「待人工检查」草稿入库）
              </span>
            </label>

            <div className="form-actions" style={{ marginTop: 12 }}>
              <span className="help">
                {providerStatus.provider === "template"
                  ? "当前未配置外部生图 Key，点击将输出可复制的提示词方案而不消耗 API 费用。"
                  : `将调用 ${providerStatus.label} (${providerStatus.model}) 生成 ${count} 张图片。`}
              </span>
              <button
                type="button"
                className="button primary"
                onClick={handleGenerateImages}
                disabled={!confirmed || generating}
              >
                {generating ? (
                  <>
                    <span className="studio-spinner" aria-hidden="true" />
                    正在生成素材（{elapsedSeconds}s）...
                  </>
                ) : providerStatus.provider === "template" ? (
                  "2. 确认输出提示词方案"
                ) : (
                  "2. 确认调用模型生图"
                )}
              </button>
            </div>
          </div>
        ) : null}

        {studioError ? (
          <div className="notice warn" style={{ marginBottom: 0 }}>
            <span className="badge badge-danger">ERROR</span>
            <span>{studioError}</span>
          </div>
        ) : null}
        {studioNotice ? (
          <div className="notice" style={{ marginBottom: 0 }}>
            <span className="badge badge-success">DONE</span>
            <span>{studioNotice}</span>
          </div>
        ) : null}
      </div>

      <div className="section-divider" />

      <div className="image-upload-strip">
        <div>
          <h3>上传本地实拍 / 供应商原图</h3>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            支持 JPG / PNG / WebP，最大 8 MB；可上传为「实拍参考底图」供上方 AI 图生图使用。
          </p>
        </div>
        <form action={uploadAction} className="upload-row image-upload-form">
          <input type="hidden" name="caseId" value={caseId} />
          <div className="field">
            <label htmlFor="upload-slot">素材槽位</label>
            <select id="upload-slot" name="assetType" defaultValue="main_image">
              {SLOT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="image">选择图片文件</label>
            <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required />
          </div>
          <div className="field">
            <label htmlFor="uploadActor">上传人</label>
            <input id="uploadActor" name="actor" required placeholder="输入姓名" />
          </div>
          <button className="button secondary" type="submit">
            上传素材
          </button>
        </form>
      </div>

      <div className="image-gallery-header">
        <h3>已入库视觉素材（{assets.length}）</h3>
        <div className="image-filter-tabs">
          <button
            type="button"
            className={`image-filter-pill ${activeFilter === "all" ? "active" : ""}`}
            onClick={() => setActiveFilter("all")}
          >
            全部 ({assets.length})
          </button>
          {SLOT_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={`image-filter-pill ${activeFilter === opt.value ? "active" : ""}`}
              onClick={() => setActiveFilter(opt.value)}
            >
              {IMAGE_SLOT_LABELS[opt.value]} ({slotCounts[opt.value]})
            </button>
          ))}
        </div>
      </div>

      {filteredAssets.length || (generating && providerStatus.provider !== "template") ? (
        <div className="asset-grid">
          {generating && providerStatus.provider !== "template"
            ? Array.from({ length: count }).map((_, idx) => (
                <article className="asset-card studio-loading-card" key={`panel-loading-${idx}`} aria-busy="true">
                  <div className="studio-loading-media">
                    <div className="studio-loading-inner">
                      <span className="studio-spinner studio-spinner-lg" aria-hidden="true" />
                      <strong>正在生成第 {idx + 1} / {count} 张...</strong>
                      <span>已等待 {elapsedSeconds}s · {providerStatus.model}</span>
                    </div>
                  </div>
                  <div className="asset-body">
                    <div className="asset-top">
                      <strong>AI 生成草稿</strong>
                      <span className="badge status-researching">{aspectRatio}</span>
                    </div>
                    <div className="subvalue">{IMAGE_SLOT_LABELS[slot]} · 生成后待人工检查</div>
                  </div>
                </article>
              ))
            : null}
          {filteredAssets.map((asset, index) => {
            const originalName =
              typeof asset.metadata.originalName === "string"
                ? asset.metadata.originalName
                : `素材 ${filteredAssets.length - index}`;
            const size = Number(asset.metadata.size ?? 0);
            const width = typeof asset.metadata.width === "number" ? asset.metadata.width : null;
            const height = typeof asset.metadata.height === "number" ? asset.metadata.height : null;
            const isAi = asset.metadata.source === "ai_generated";
            const slotLabel = IMAGE_SLOT_LABELS[asset.asset_type as ImageAssetSlot] ?? asset.asset_type;
            const lowResolution =
              width !== null &&
              height !== null &&
              Math.max(width, height) < 1000 &&
              (asset.asset_type === "main_image" || asset.asset_type === "lifestyle_image");
            const skillName = typeof asset.metadata.skillName === "string" ? asset.metadata.skillName : "";
            const modelName = typeof asset.metadata.model === "string" ? asset.metadata.model : "";
            const promptUsed = typeof asset.metadata.prompt === "string" ? asset.metadata.prompt : "";
            const reviewMeta = asset.metadata.review as { reviewer?: string; notes?: string } | undefined;

            return (
              <article className={`asset-card ${asset.status === "approved" ? "approved" : ""}`} key={asset.id}>
                <div className="asset-media-wrap">
                  <img src={asset.file_url} alt={originalName} className="asset-thumb" />
                  <div className="asset-overlay-badges">
                    <span className="badge badge-neutral">{slotLabel}</span>
                    <span className={`badge ${isAi ? "status-researching" : "badge-neutral"}`}>
                      {isAi ? "AI 生成" : "实拍上传"}
                    </span>
                  </div>
                </div>
                <div className="asset-body">
                  <div className="asset-top">
                    <strong>{originalName}</strong>
                    <span className={`badge ${asset.status === "approved" ? "badge-success" : "status-review_pending"}`}>
                      {asset.status === "approved" ? "已检查" : "待检查"}
                    </span>
                  </div>
                  <div className="subvalue">
                    {width && height ? `${width}×${height}px · ` : ""}
                    {(size / 1024).toFixed(0)} KB · {asset.created_at.slice(0, 10)}
                    {asset.parent_asset_id ? " · 基于底图衍生" : ""}
                  </div>
                  {lowResolution ? (
                    <div className="asset-resolution-warn">
                      分辨率长边不足 1000px，可能不满足 Amazon 主图放大要求，请核查画质。
                    </div>
                  ) : null}
                  {skillName ? (
                    <div className="subvalue" style={{ marginTop: 4 }}>
                      Skill：{skillName}
                      {modelName ? ` · 模型：${modelName}` : ""}
                    </div>
                  ) : null}

                  <div className="asset-quick-actions">
                    <button
                      type="button"
                      className="button ghost"
                      onClick={() => {
                        setReferenceAssetId(asset.id);
                        setPreview(null);
                        setConfirmed(false);
                        document.getElementById("image-studio")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      以此图为参考底图
                    </button>
                    <a href={`${asset.file_url}?download=1`} className="button ghost">
                      下载原图
                    </a>
                    <button
                      type="button"
                      className="button ghost"
                      style={{ color: "var(--red)" }}
                      onClick={async () => {
                        if (!window.confirm("确认删除这张商品图片？磁盘文件也会一并清理。")) return;
                        try {
                          const resp = await fetch(`/api/assets/${encodeURIComponent(asset.id)}`, {
                            method: "DELETE",
                          });
                          if (!resp.ok) throw new Error("删除图片失败");
                          router.refresh();
                        } catch (err) {
                          setStudioError(err instanceof Error ? err.message : "删除图片失败");
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>

                  {promptUsed ? (
                    <details className="review-details" style={{ marginTop: 8, paddingTop: 8 }}>
                      <summary>查看生图 Prompt 溯源</summary>
                      <pre className="asset-prompt-pre">{promptUsed}</pre>
                    </details>
                  ) : null}

                  {asset.status !== "approved" ? (
                    <details className="review-details">
                      <summary>人工检查此图</summary>
                      <form action={reviewAction} className="stack" style={{ marginTop: 12 }}>
                        <input type="hidden" name="caseId" value={caseId} />
                        <input type="hidden" name="assetId" value={asset.id} />
                        <label className="check-row">
                          <input type="checkbox" name="whiteBackground" />
                          {asset.asset_type === "main_image"
                            ? "纯白底或平台允许的纯色背景"
                            : "画面背景干净、主体突出且无杂乱干扰"}
                        </label>
                        <label className="check-row">
                          <input type="checkbox" name="productComplete" /> 商品完整、比例清楚、未被裁切
                        </label>
                        <label className="check-row">
                          <input type="checkbox" name="noTextWatermark" /> 无未授权文字、Logo、水印或促销角标
                        </label>
                        <label className="check-row">
                          <input type="checkbox" name="resolutionConfirmed" /> 已人工确认分辨率和画质满足目标平台要求
                        </label>
                        {isAi ? (
                          <label className="check-row">
                            <input type="checkbox" name="matchesPhysicalProduct" required />
                            <strong>画面外观、结构与配件数量和实物样品一致，无 AI 幻觉变形</strong>
                          </label>
                        ) : null}
                        <div className="field">
                          <label htmlFor={`imageReviewer-${asset.id}`}>检查人</label>
                          <input id={`imageReviewer-${asset.id}`} name="reviewer" required placeholder="输入姓名" />
                        </div>
                        <div className="field">
                          <label htmlFor={`imageNotes-${asset.id}`}>检查说明</label>
                          <textarea
                            id={`imageNotes-${asset.id}`}
                            name="notes"
                            required
                            placeholder="记录来源（实拍/AI底图衍生）、实物核对情况和仍需修正的问题。"
                          />
                        </div>
                        <button className="button primary" type="submit">
                          确认素材检查通过
                        </button>
                      </form>
                    </details>
                  ) : reviewMeta?.reviewer ? (
                    <div className="subvalue" style={{ marginTop: 8, color: "var(--green)" }}>
                      ✓ 检查人：{reviewMeta.reviewer}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-inline">
          当前筛选下还没有素材。你可以上传实拍底图，或选择上方生图 Skill 生成图生图/概念素材。
        </div>
      )}
    </section>
  );
}
