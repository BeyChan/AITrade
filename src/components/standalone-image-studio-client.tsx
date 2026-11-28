"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { StudioMediaGallery, type StudioGalleryMediaItem } from "@/components/studio/studio-media-gallery";
import type { ImageProviderStatus } from "@/lib/image-provider";
import {
  IMAGE_SLOT_LABELS,
  type ComposedImagePrompt,
  type ImageAspectRatio,
  type ImageAssetSlot,
  type ImageSkillDefinition,
} from "@/lib/image-skills-types";
import type { StandaloneStudioAsset } from "@/lib/standalone-image-studio";

export type StudioCaseOption = {
  id: string;
  asin: string;
  title: string;
  marketplace: string;
  hasSelection: boolean;
};

type Props = {
  skills: ImageSkillDefinition[];
  providerStatus: ImageProviderStatus;
  initialAssets: StandaloneStudioAsset[];
  cases: StudioCaseOption[];
  initialCaseId?: string;
  activeMarketCode: string;
  activeMarketName: string;
};


const SLOT_OPTIONS: Array<{ value: ImageAssetSlot; label: string }> = [
  { value: "main_image", label: "纯白底主图" },
  { value: "lifestyle_image", label: "使用场景图" },
  { value: "feature_image", label: "卖点/细节图" },
  { value: "packaging_image", label: "包装全家福" },
  { value: "reference_image", label: "实拍参考底图" },
];

const ASPECT_RATIOS: ImageAspectRatio[] = ["1:1", "4:5", "16:9"];

export function StandaloneImageStudioClient({
  skills,
  providerStatus,
  initialAssets,
  cases,
  initialCaseId = "",
  activeMarketCode,
  activeMarketName,
}: Props) {
  const router = useRouter();
  const [availableSkills, setAvailableSkills] = useState<ImageSkillDefinition[]>(skills);
  const initialSkill = availableSkills[0] ?? skills[0]!;
  const initialMatchedCase = initialCaseId ? cases.find((c) => c.id === initialCaseId) : undefined;

  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialMatchedCase?.id ?? "");
  const [selectedSkillId, setSelectedSkillId] = useState<string>(initialSkill.id);
  const [slot, setSlot] = useState<ImageAssetSlot>(initialSkill.slot);
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>(initialSkill.aspectRatio);
  const [count, setCount] = useState<number>(1);

  const [productName, setProductName] = useState<string>(initialMatchedCase?.title ?? "");
  const [marketplace, setMarketplace] = useState<string>(initialMatchedCase?.marketplace || activeMarketCode);
  const [targetCustomer, setTargetCustomer] = useState<string>("");
  const [coreDifferentiator, setCoreDifferentiator] = useState<string>("");
  const [specifications, setSpecifications] = useState<string>("");
  const [packageContents, setPackageContents] = useState<string>("");
  const [claimsToAvoid, setClaimsToAvoid] = useState<string>("");
  const [customInstruction, setCustomInstruction] = useState<string>("");
  const [customSkillName, setCustomSkillName] = useState<string>("");
  const [customStyleDirectives, setCustomStyleDirectives] = useState<string>("");
  const [customNegativeDirectives, setCustomNegativeDirectives] = useState<string>("");
  const [actor, setActor] = useState<string>("运营人员");

  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceFilePreviewUrl, setReferenceFilePreviewUrl] = useState<string>("");
  const [referenceAssetId, setReferenceAssetId] = useState<string>("");

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
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copiedPrompt, setCopiedPrompt] = useState<boolean>(false);

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

  useEffect(() => {
    setMarketplace(activeMarketCode);
    setPreview(null);
    setConfirmed(false);
  }, [activeMarketCode]);

  useEffect(() => {
    if (!referenceFile) {
      setReferenceFilePreviewUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(referenceFile);
    setReferenceFilePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [referenceFile]);

  const builtinSkills = useMemo(() => availableSkills.filter((item) => item.source === "builtin"), [availableSkills]);
  const localSkills = useMemo(() => availableSkills.filter((item) => item.source === "local"), [availableSkills]);
  const isCustomSkill = selectedSkillId === "custom";
  const activeSkill = useMemo(
    () => (isCustomSkill ? null : availableSkills.find((item) => item.id === selectedSkillId) ?? initialSkill),
    [isCustomSkill, availableSkills, selectedSkillId, initialSkill],
  );

  const selectedCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId],
  );

  const selectedHistoryRef = useMemo(
    () => initialAssets.find((item) => item.id === referenceAssetId) ?? null,
    [initialAssets, referenceAssetId],
  );


  const galleryItems: StudioGalleryMediaItem[] = useMemo(
    () =>
      initialAssets.map((item) => ({
        id: item.id,
        kind: "image",
        fileUrl: item.fileUrl,
        title: item.productName || item.originalName,
        originalName: item.originalName,
        provider: item.provider,
        model: item.model,
        aspectRatio: item.aspectRatio,
        metaLabel: IMAGE_SLOT_LABELS[item.slot] || item.skillName,
        slot: item.slot,
        prompt: item.prompt,
        boundCases: item.boundCases ?? [],
        createdAt: item.createdAt,
      })),
    [initialAssets],
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
    setNotice("");
    setError("");
  }

  async function handleAiGenerateImagePrompt(openPreview = false) {
    setError("");
    setNotice("");
    setAiGeneratingPrompt(true);
    try {
      const resp = await fetch("/api/studio/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image",
          skillId: selectedSkillId,
          productName: productName.trim() || customSkillName.trim() || "跨境电商品牌主推单品",
          coreDifferentiator,
          claimsToAvoid,
          slot,
          aspectRatio,
          marketplace,
          idea: customInstruction.trim() || customStyleDirectives.trim() || customSkillName.trim(),
        }),
      });
      const data = (await resp.json()) as {
        prompt?: string;
        styleDirectives?: string;
        negativePrompt?: string;
        note?: string;
        error?: string;
      };
      if (!resp.ok || !data.prompt) throw new Error(data.error || "AI 生成提示词失败");
      if (!openPreview && data.styleDirectives) {
        setCustomStyleDirectives(data.styleDirectives);
        if (data.negativePrompt) setCustomNegativeDirectives(data.negativePrompt);
      }
      if (openPreview) {
        const activeSkillObj = availableSkills.find((s) => s.id === selectedSkillId);
        setPreview({
          skillId: selectedSkillId,
          skillName: activeSkillObj?.name || customSkillName || "AI 商业摄影提示词",
          slot,
          aspectRatio,
          prompt: data.prompt,
          negativePrompt: data.negativePrompt || "",
          complianceNotes: [],
        });
        setPromptDraft(data.prompt);
        setNegativeDraft(data.negativePrompt || "");
        setConfirmed(false);
      } else {
        setPromptDraft(data.prompt);
        setPreview(null);
        setConfirmed(false);
      }
      if (data.note) setNotice(data.note);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI 生成提示词失败");
    } finally {
      setAiGeneratingPrompt(false);
    }
  }

  async function handleSaveCustomSkill() {
    if (!customSkillName.trim()) {
      setError("请填写自定义规范名称后再保存");
      return;
    }
    if (!customStyleDirectives.trim()) {
      setError("请填写自定义风格与构图规范后再保存");
      return;
    }
    setSavingSkill(true);
    setError("");
    setNotice("");
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
      setNotice(`已保存可复用规范「${data.skill.name}」`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存自定义规范失败");
    } finally {
      setSavingSkill(false);
    }
  }

  async function handleDeleteLocalSkill() {
    if (!activeSkill || activeSkill.source !== "local") return;
    if (!window.confirm(`确定要删除本地规范「${activeSkill.name}」吗？`)) return;
    setDeletingSkill(true);
    setError("");
    setNotice("");
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
      setNotice(`已删除本地规范「${activeSkill.name}」`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除本地规范失败");
    } finally {
      setDeletingSkill(false);
    }
  }

  function handleApplyCasePrefill() {
    if (!selectedCase) return;
    setProductName(selectedCase.title);
    setMarketplace(selectedCase.marketplace || activeMarketCode);
    setPreview(null);
    setConfirmed(false);
    setNotice(`已带入「${selectedCase.title}」`);
    setError("");
  }

  function buildFormData(action: "preview" | "generate"): FormData {
    const form = new FormData();
    form.set("action", action);
    form.set("skillId", selectedSkillId);
    form.set("slot", slot);
    form.set("aspectRatio", aspectRatio);
    form.set("count", String(count));
    form.set("productName", productName);
    form.set("marketplace", marketplace);
    form.set("targetCustomer", targetCustomer);
    form.set("coreDifferentiator", coreDifferentiator);
    form.set("specifications", specifications);
    form.set("packageContents", packageContents);
    form.set("claimsToAvoid", claimsToAvoid);
    form.set("customInstruction", customInstruction);
    if (isCustomSkill) {
      form.set("customSkillName", customSkillName);
      form.set("customStyleDirectives", customStyleDirectives);
      form.set("customNegativeDirectives", customNegativeDirectives);
    }
    form.set("actor", actor.trim() || "运营人员");
    if (selectedCaseId) {
      form.set("caseId", selectedCaseId);
    }
    if (referenceFile) {
      form.set("referenceFile", referenceFile);
    } else if (referenceAssetId) {
      form.set("referenceAssetId", referenceAssetId);
    }
    if (action === "generate") {
      form.set("confirmed", confirmed ? "true" : "false");
      form.set("promptOverride", promptDraft);
      form.set("negativePromptOverride", negativeDraft);
    }
    return form;
  }

  async function handlePreviewPrompt() {
    if (!productName.trim()) {
      setError("请先填写商品名称");
      return;
    }
    if (isCustomSkill && !customStyleDirectives.trim()) {
      setError("请填写自定义风格与构图规范");
      return;
    }
    setLoadingPreview(true);
    setError("");
    setNotice("");
    setConfirmed(false);
    try {
      const response = await fetch("/api/image-studio/generate", {
        method: "POST",
        body: buildFormData("preview"),
      });
      const data = (await response.json()) as { error?: string; preview?: ComposedImagePrompt };
      if (!response.ok || !data.preview) {
        throw new Error(data.error || "生成提示词预览失败");
      }
      setPreview(data.preview);
      setPromptDraft(data.preview.prompt);
      setNegativeDraft(data.preview.negativePrompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成提示词预览失败");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleGenerate() {
    if (!preview) {
      setError("请先生成提示词预览");
      return;
    }
    if (!confirmed) {
      setError("请先勾选确认生图");
      return;
    }

    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/image-studio/generate", {
        method: "POST",
        body: buildFormData("generate"),
      });
      const data = (await response.json()) as {
        error?: string;
        mode?: "model" | "prompt_only";
        note?: string;
        createdAssets?: StandaloneStudioAsset[];
      };
      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }
      setNotice(data.note || "生成完成");
      setConfirmed(false);
      if (data.mode === "model" && data.createdAssets && data.createdAssets.length > 0) {
        const newIds = data.createdAssets.map((a) => a.id);
        setSessionIds((prev) => [...newIds, ...prev]);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
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
      // Ignore clipboard failures in restricted environments.
    }
  }

  return (
    <div className="studio-split">
      <aside className="studio-controls panel" id="standalone-workbench">
        <div className="studio-controls-body">
          <div className="field">
            <div className="studio-label-row">
              <label htmlFor="standalone-skill">视觉规范</label>
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
              id="standalone-skill"
              value={selectedSkillId}
              onChange={(event) => handleSelectSkillById(event.target.value)}
            >
              <optgroup label="内置规范">
                {builtinSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>
                    {skill.name}（{IMAGE_SLOT_LABELS[skill.slot]} · {skill.aspectRatio}）
                  </option>
                ))}
              </optgroup>
              {localSkills.length > 0 ? (
                <optgroup label="本地规范（~/.agents/skills/）">
                  {localSkills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}（{IMAGE_SLOT_LABELS[skill.slot]} · {skill.aspectRatio}）
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="自定义">
                <option value="custom">自定义规范...</option>
              </optgroup>
            </select>
            <small className="field-hint">
              {activeSkill ? activeSkill.description : "自定义风格与禁止项，可保存至本地规范库复用。"}
            </small>
          </div>

          {isCustomSkill ? (
            <div className="studio-custom-box">
              <div className="field">
                <label htmlFor="standalone-custom-skill-name">规范名称 *</label>
                <input
                  id="standalone-custom-skill-name"
                  value={customSkillName}
                  onChange={(event) => {
                    setCustomSkillName(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="例：极简北欧厨房自然光"
                  maxLength={80}
                />
              </div>
              <div className="field">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <label htmlFor="standalone-custom-style" style={{ margin: 0 }}>风格与构图要求 *</label>
                  <button
                    type="button"
                    className="button secondary"
                    style={{ minHeight: "26px", padding: "0 10px", fontSize: "12px" }}
                    disabled={aiGeneratingPrompt || loadingPreview || generating}
                    onClick={() => handleAiGenerateImagePrompt(false)}
                  >
                    {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成专业提示词"}
                  </button>
                </div>
                <textarea
                  id="standalone-custom-style"
                  rows={2}
                  value={customStyleDirectives}
                  onChange={(event) => {
                    setCustomStyleDirectives(event.target.value);
                    setPreview(null);
                    setConfirmed(false);
                  }}
                  placeholder="画风、光线、背景材质与主体构图（中英文均可）"
                />
              </div>
              <div className="field">
                <label htmlFor="standalone-custom-negative">负向禁止项（可选）</label>
                <input
                  id="standalone-custom-negative"
                  value={customNegativeDirectives}
                  onChange={(event) => {
                    setCustomNegativeDirectives(event.target.value);
                    setPreview(null);
                  }}
                  placeholder="例：水印、多余配件、塑料感"
                />
              </div>
              <button
                type="button"
                className="button secondary"
                style={{ width: "100%" }}
                onClick={handleSaveCustomSkill}
                disabled={savingSkill || loadingPreview || generating}
              >
                {savingSkill ? "正在保存..." : "保存为可复用规范"}
              </button>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="standalone-product">商品名称 *</label>
            <input
              id="standalone-product"
              value={productName}
              onChange={(event) => {
                setProductName(event.target.value);
                setPreview(null);
                setConfirmed(false);
              }}
              placeholder="例：静音可拆洗不锈钢宠物饮水器"
            />
          </div>

          <div className="field">
            <label htmlFor="standalone-custom">画面补充说明（可选）</label>
            <textarea
              id="standalone-custom"
              rows={2}
              value={customInstruction}
              onChange={(event) => {
                setCustomInstruction(event.target.value);
                setPreview(null);
              }}
              placeholder="例：放在浅橡木台面，清晨柔和窗光，突出拉丝质感"
            />
          </div>

          <div className="field">
            <label>参考底图（可选 · 传图即走图生图）</label>
            <input
              id="standalone-ref-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setReferenceFile(file);
                if (file) setReferenceAssetId("");
                setPreview(null);
                setConfirmed(false);
              }}
            />
            {referenceFilePreviewUrl || selectedHistoryRef ? (
              <div className="image-reference-preview" style={{ marginTop: 0 }}>
                <img
                  src={referenceFilePreviewUrl || selectedHistoryRef?.fileUrl || ""}
                  alt="参考底图预览"
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {referenceFile ? referenceFile.name : selectedHistoryRef?.originalName}
                  </strong>
                  <span>图生图结构锚点</span>
                </div>
                <button
                  type="button"
                  className="button ghost"
                  style={{ minHeight: 28, padding: "2px 8px", fontSize: 12 }}
                  onClick={() => {
                    setReferenceFile(null);
                    setReferenceAssetId("");
                    setPreview(null);
                  }}
                >
                  清除
                </button>
              </div>
            ) : (
              <label htmlFor="standalone-ref-file" className="studio-dropzone">
                + 上传实拍底图（JPG / PNG / WebP）
              </label>
            )}
          </div>

          <div className="studio-quick-row">
            <div className="field">
              <label>画幅</label>
              <div className="studio-pill-group">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    type="button"
                    key={ratio}
                    className={`studio-pill ${aspectRatio === ratio ? "active" : ""}`}
                    onClick={() => {
                      setAspectRatio(ratio);
                      setPreview(null);
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>张数</label>
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
          </div>

          <div className="field">
            <label htmlFor="standalone-slot">图槽位</label>
            <select
              id="standalone-slot"
              value={slot}
              onChange={(event) => {
                setSlot(event.target.value as ImageAssetSlot);
                setPreview(null);
              }}
            >
              {SLOT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <details className="studio-more-details">
            <summary>更多商品细节与关联商品（可选）</summary>
            <div className="studio-more-body">
              {cases.length > 0 ? (
                <div className="field">
                  <label htmlFor="studio-case-select">带入已有商品</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      id="studio-case-select"
                      value={selectedCaseId}
                      onChange={(event) => setSelectedCaseId(event.target.value)}
                      style={{ flex: 1, minWidth: 0 }}
                    >
                      <option value="">选择商品...</option>
                      {cases.map((item) => (
                        <option key={item.id} value={item.id}>
                          [{item.marketplace}] {item.title}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ padding: "0 10px" }}
                      disabled={!selectedCase}
                      onClick={handleApplyCasePrefill}
                    >
                      填入
                    </button>
                  </div>
                  {selectedCase ? (
                    <Link
                      href={`/cases/${selectedCase.id}/content#image-studio`}
                      className="field-hint"
                      style={{ color: "var(--green)", fontWeight: 700 }}
                    >
                      前往该商品正式内容页
                    </Link>
                  ) : null}
                </div>
              ) : null}

              <div className="field">
                <label htmlFor="standalone-customer">目标人群</label>
                <input
                  id="standalone-customer"
                  value={targetCustomer}
                  onChange={(event) => setTargetCustomer(event.target.value)}
                  placeholder="例：多猫家庭"
                />
              </div>

              <div className="field">
                <label htmlFor="standalone-diff">核心差异点</label>
                <input
                  id="standalone-diff"
                  value={coreDifferentiator}
                  onChange={(event) => setCoreDifferentiator(event.target.value)}
                  placeholder="例：304 不锈钢 + 静音水泵"
                />
              </div>

              <div className="field">
                <label htmlFor="standalone-specs">材质规格</label>
                <input
                  id="standalone-specs"
                  value={specifications}
                  onChange={(event) => setSpecifications(event.target.value)}
                  placeholder="例：2.5L、USB 5V"
                />
              </div>

              <div className="field">
                <label htmlFor="standalone-packaging">包装清单</label>
                <input
                  id="standalone-packaging"
                  value={packageContents}
                  onChange={(event) => setPackageContents(event.target.value)}
                  placeholder="例：主机、水泵、3片滤芯"
                />
              </div>

              <div className="field">
                <label htmlFor="standalone-avoid">禁用红线</label>
                <input
                  id="standalone-avoid"
                  value={claimsToAvoid}
                  onChange={(event) => setClaimsToAvoid(event.target.value)}
                  placeholder="例：FDA approved、100%静音"
                />
              </div>

              <div className="field">
                <label htmlFor="standalone-actor">操作人</label>
                <input
                  id="standalone-actor"
                  value={actor}
                  onChange={(event) => setActor(event.target.value)}
                  maxLength={80}
                />
              </div>
            </div>
          </details>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <button
              type="button"
              className="button primary"
              onClick={() => handleAiGenerateImagePrompt(true)}
              disabled={aiGeneratingPrompt || loadingPreview || generating}
              title="调用默认文本大模型，将中文商品想法扩写为专业英文商业摄影提示词"
            >
              {aiGeneratingPrompt ? "AI 扩写中..." : "✨ AI 生成提示词"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={handlePreviewPrompt}
              disabled={loadingPreview || aiGeneratingPrompt || generating}
            >
              {loadingPreview ? "生成中..." : "模板预览"}
            </button>
          </div>

          {error ? (
            <div className="notice warn" style={{ marginBottom: 0, padding: "10px 12px" }}>
              <span className="badge badge-danger">ERROR</span>
              <span>{error}</span>
            </div>
          ) : null}
          {notice ? (
            <div className="notice" style={{ marginBottom: 0, padding: "10px 12px" }}>
              <span className="badge badge-success">DONE</span>
              <span>{notice}</span>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="studio-canvas stack">
        {preview ? (
          <section className="section studio-preview-card">
            <div className="image-studio-block-head">
              <div>
                <span className="eyebrow">Prompt 预览与生成确认</span>
                <h3>{preview.skillName} · {IMAGE_SLOT_LABELS[preview.slot]} · {preview.aspectRatio}</h3>
              </div>
              <button type="button" className="button ghost" onClick={handleCopyPrompt}>
                {copiedPrompt ? "✓ 已复制" : "复制 Prompt"}
              </button>
            </div>

            <div className="image-studio-context-strip" style={{ marginBottom: 12 }}>
              {preview.complianceNotes.map((item, idx) => (
                <span key={idx}>{item}</span>
              ))}
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div className="field">
                <label htmlFor="standalone-prompt-draft">正向提示词（可微调）</label>
                <textarea
                  id="standalone-prompt-draft"
                  className="tall-textarea"
                  value={promptDraft}
                  onChange={(event) => setPromptDraft(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="standalone-negative-draft">负向禁止项</label>
                <input
                  id="standalone-negative-draft"
                  value={negativeDraft}
                  onChange={(event) => setNegativeDraft(event.target.value)}
                />
              </div>
            </div>

            <div className="studio-confirm-row">
              <label className="check-row" style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>已核对提示词与底图，确认调用生图</span>
              </label>
              <button
                type="button"
                className="button primary"
                onClick={handleGenerate}
                disabled={!confirmed || generating}
              >
                {generating ? (
                  <>
                    <span className="studio-spinner" aria-hidden="true" />
                    正在生图（{elapsedSeconds}s）...
                  </>
                ) : providerStatus.provider === "template" ? (
                  "输出提示词方案"
                ) : (
                  `立即生成 ${count} 张`
                )}
              </button>
            </div>
          </section>
        ) : initialAssets.length === 0 ? (
          <section className="panel">
            <div className="empty-state" style={{ padding: "44px 24px" }}>
              <span className="badge badge-neutral">{activeMarketName} · {marketplace}</span>
              <h3>选择左侧规范与商品名，即可开始出图</h3>
              <p>
                支持上传供应商实拍图走图生图，也支持纯文生图探索构图；点击「AI 生成提示词」或「模板预览」后可先微调再确认调用模型。
              </p>
            </div>
          </section>
        ) : null}

        <StudioMediaGallery
          mode="studio"
          kind="image"
          items={galleryItems}
          sessionIds={sessionIds}
          selectedCaseId={selectedCaseId}
          cases={cases.filter((c) => c.hasSelection)}
          actor={actor.trim() || "运营人员"}
          loadingCards={
            generating && providerStatus.provider !== "template"
              ? Array.from({ length: count }).map((_, idx) => (
                  <article className="asset-card studio-loading-card" key={`loading-${idx}`} aria-busy="true">
                    <div className="studio-loading-media">
                      <div className="studio-loading-inner">
                        <span className="studio-spinner studio-spinner-lg" aria-hidden="true" />
                        <strong>正在生成第 {idx + 1} / {count} 张...</strong>
                        <span>已等待 {elapsedSeconds}s · {providerStatus.model}</span>
                      </div>
                    </div>
                  </article>
                ))
              : null
          }
          onUseAsReference={(item) => {
            setReferenceFile(null);
            setReferenceAssetId(item.id);
            setPreview(null);
            setConfirmed(false);
            document.getElementById("standalone-workbench")?.scrollIntoView({ behavior: "smooth" });
          }}
          onBound={(_id, _ref, msg) => {
            setNotice(msg);
            setError("");
            router.refresh();
          }}
          onDelete={async (item) => {
            try {
              const resp = await fetch(`/api/image-studio/file/${encodeURIComponent(item.id)}`, {
                method: "DELETE",
              });
              if (!resp.ok) throw new Error("删除图片失败");
              setNotice("已删除该图片。");
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : "删除图片失败");
            }
          }}
          onError={(msg) => setError(msg)}
        />
      </div>
    </div>
  );
}
