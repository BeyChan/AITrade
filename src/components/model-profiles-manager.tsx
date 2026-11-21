"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ModelProfilePublic,
  ModelServiceType,
  ModelVendorPreset,
} from "@/lib/model-profiles";

type Props = {
  initialProfiles: ModelProfilePublic[];
  presets: readonly ModelVendorPreset[];
};

const SERVICE_TYPE_META: Record<
  ModelServiceType,
  { label: string; short: string; bg: string; color: string }
> = {
  text: { label: "文本生成", short: "文本", bg: "var(--blue-soft)", color: "var(--blue)" },
  image: { label: "图片生成", short: "图片", bg: "var(--green-soft)", color: "var(--green)" },
  video: { label: "视频生成", short: "视频", bg: "var(--amber-soft)", color: "var(--amber)" },
};

const PROTOCOL_OPTIONS: Record<ModelServiceType, Array<{ value: string; label: string }>> = {
  text: [
    { value: "openai-compatible", label: "OpenAI 兼容（/v1/chat/completions）" },
    { value: "anthropic-compatible", label: "Anthropic 兼容（/v1/messages）" },
    { value: "ollama", label: "本地 Ollama" },
  ],
  image: [
    { value: "dashscope", label: "阿里云百炼原生（通义万相 / Qwen-Image）" },
    { value: "volcengine", label: "火山引擎方舟（Seedream）" },
    { value: "siliconflow", label: "硅基流动（OpenAI Images 兼容）" },
    { value: "zhipu", label: "智谱 BigModel（CogView）" },
    { value: "gemini", label: "Google Gemini（Interactions API）" },
    { value: "fal", label: "fal.ai（FLUX Pro / Kontext）" },
    { value: "ideogram", label: "Ideogram 原生" },
    { value: "openai-compatible", label: "OpenAI Images 兼容（/v1/images/generations）" },
    { value: "anthropic-compatible", label: "Anthropic 多模态兼容" },
  ],
  video: [
    { value: "kling", label: "快手可灵 Kling（/v1/videos/image2video）" },
    { value: "volcengine", label: "火山引擎方舟（Seedance）" },
    { value: "dashscope", label: "阿里云百炼（通义万相异步任务）" },
    { value: "veo", label: "Google Veo（predictLongRunning）" },
    { value: "runway", label: "Runway Gen-4（/v1/image_to_video）" },
    { value: "openai-compatible", label: "OpenAI Sora / 兼容视频网关（/v1/videos）" },
  ],
};

type FormState = {
  id?: string;
  serviceType: ModelServiceType;
  vendor: string;
  protocol: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  apiKeyHint: string;
  modelsText: string;
  defaultModel: string;
  submitEndpoint: string;
  queryEndpoint: string;
  supportsMultiImage: boolean;
  isDefault: boolean;
};

function parseModels(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export function ModelProfilesManager({ initialProfiles, presets }: Props) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<ModelProfilePublic[]>(initialProfiles);
  const [filterType, setFilterType] = useState<"all" | ModelServiceType>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<FormState>({
    serviceType: "text",
    vendor: "",
    protocol: "openai-compatible",
    name: "",
    baseUrl: "",
    apiKey: "",
    apiKeyHint: "",
    modelsText: "",
    defaultModel: "",
    submitEndpoint: "",
    queryEndpoint: "",
    supportsMultiImage: false,
    isDefault: true,
  });

  const filteredProfiles = useMemo(
    () => (filterType === "all" ? profiles : profiles.filter((p) => p.serviceType === filterType)),
    [profiles, filterType],
  );

  const typePresets = useMemo(
    () => presets.filter((p) => p.serviceType === form.serviceType),
    [presets, form.serviceType],
  );

  const selectedPreset = useMemo(
    () => typePresets.find((p) => p.id === form.vendor) ?? null,
    [typePresets, form.vendor],
  );

  const parsedModels = useMemo(() => parseModels(form.modelsText), [form.modelsText]);

  async function reloadProfiles() {
    const resp = await fetch("/api/settings/model-profiles", { cache: "no-store" });
    if (resp.ok) {
      const data = (await resp.json()) as { profiles?: ModelProfilePublic[] };
      if (Array.isArray(data.profiles)) setProfiles(data.profiles);
    }
    router.refresh();
  }

  function openCreateModal(defaultType: ModelServiceType = filterType === "all" ? "text" : filterType) {
    setError(null);
    setNotice(null);
    const firstPreset = presets.find((p) => p.serviceType === defaultType);
    setForm({
      id: undefined,
      serviceType: defaultType,
      vendor: firstPreset?.id ?? "",
      protocol: firstPreset?.protocol ?? PROTOCOL_OPTIONS[defaultType][0]!.value,
      name: firstPreset?.defaultName ?? "",
      baseUrl: firstPreset?.baseUrl ?? "",
      apiKey: "",
      apiKeyHint: "",
      modelsText: firstPreset ? firstPreset.models.join("\n") : "",
      defaultModel: firstPreset?.models[0] ?? "",
      submitEndpoint: firstPreset?.submitEndpoint ?? "",
      queryEndpoint: firstPreset?.queryEndpoint ?? "",
      supportsMultiImage: false,
      isDefault: !profiles.some((p) => p.serviceType === defaultType && p.isDefault),
    });
    setModalOpen(true);
  }

  function openEditModal(profile: ModelProfilePublic) {
    setError(null);
    setNotice(null);
    setForm({
      id: profile.id,
      serviceType: profile.serviceType,
      vendor: profile.vendor,
      protocol: profile.protocol,
      name: profile.name,
      baseUrl: profile.baseUrl,
      apiKey: "",
      apiKeyHint: profile.apiKeyHint,
      modelsText: profile.models.join("\n"),
      defaultModel: profile.defaultModel,
      submitEndpoint: profile.submitEndpoint,
      queryEndpoint: profile.queryEndpoint,
      supportsMultiImage: profile.supportsMultiImage,
      isDefault: profile.isDefault,
    });
    setModalOpen(true);
  }

  function handleChangeServiceType(nextType: ModelServiceType) {
    const firstPreset = presets.find((p) => p.serviceType === nextType);
    setForm((prev) => ({
      ...prev,
      serviceType: nextType,
      vendor: firstPreset?.id ?? "",
      protocol: firstPreset?.protocol ?? PROTOCOL_OPTIONS[nextType][0]!.value,
      name: firstPreset?.defaultName ?? "",
      baseUrl: firstPreset?.baseUrl ?? "",
      modelsText: firstPreset ? firstPreset.models.join("\n") : "",
      defaultModel: firstPreset?.models[0] ?? "",
      submitEndpoint: firstPreset?.submitEndpoint ?? "",
      queryEndpoint: firstPreset?.queryEndpoint ?? "",
    }));
  }

  function handleSelectVendor(vendorId: string) {
    const preset = typePresets.find((p) => p.id === vendorId);
    if (!preset) {
      setForm((prev) => ({ ...prev, vendor: vendorId }));
      return;
    }
    setForm((prev) => ({
      ...prev,
      vendor: preset.id,
      protocol: preset.protocol,
      name: preset.defaultName,
      baseUrl: preset.baseUrl,
      modelsText: preset.models.join("\n"),
      defaultModel: preset.models[0] ?? "",
      submitEndpoint: preset.submitEndpoint ?? "",
      queryEndpoint: preset.queryEndpoint ?? "",
    }));
  }

  function handleAppendPresetModel(modelId: string) {
    if (!modelId) return;
    const current = parseModels(form.modelsText);
    if (!current.includes(modelId)) current.push(modelId);
    setForm((prev) => ({
      ...prev,
      modelsText: current.join("\n"),
      defaultModel: prev.defaultModel || modelId,
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const models = parseModels(form.modelsText);
      const resp = await fetch("/api/settings/model-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          serviceType: form.serviceType,
          vendor: form.vendor || form.protocol,
          protocol: form.protocol,
          name: form.name,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          models,
          defaultModel: form.defaultModel || models[0] || "",
          submitEndpoint: form.submitEndpoint,
          queryEndpoint: form.queryEndpoint,
          supportsMultiImage: form.supportsMultiImage,
          isDefault: form.isDefault,
        }),
      });
      const data = (await resp.json()) as { error?: string; profile?: ModelProfilePublic };
      if (!resp.ok) throw new Error(data.error || "保存模型配置失败");
      setModalOpen(false);
      setNotice(`已保存「${data.profile?.name ?? form.name}」配置。`);
      await reloadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存模型配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      const resp = await fetch(`/api/settings/model-profiles/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "default" }),
      });
      const data = (await resp.json()) as { message?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "切换默认配置失败");
      setNotice(data.message || "已切换默认模型配置。");
      await reloadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换默认配置失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleTest(id: string) {
    setError(null);
    setNotice(null);
    setBusyId(id);
    try {
      const resp = await fetch(`/api/settings/model-profiles/${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const data = (await resp.json()) as { message?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "连接测试失败");
      setNotice(data.message || "连接测试通过。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(profile: ModelProfilePublic) {
    if (!window.confirm(`确认删除「${profile.name}」模型配置？`)) return;
    setError(null);
    setNotice(null);
    setBusyId(profile.id);
    try {
      const resp = await fetch(`/api/settings/model-profiles/${encodeURIComponent(profile.id)}`, {
        method: "DELETE",
      });
      const data = (await resp.json()) as { error?: string };
      if (!resp.ok) throw new Error(data.error || "删除配置失败");
      setNotice(`已删除「${profile.name}」。`);
      await reloadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除配置失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setNotice(null);
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { profiles?: unknown[] }).profiles)
          ? (parsed as { profiles: unknown[] }).profiles
          : null;
      if (!list || list.length === 0) {
        throw new Error("JSON 文件格式不正确，需包含 profiles 数组");
      }
      const resp = await fetch("/api/settings/model-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", profiles: list }),
      });
      const data = (await resp.json()) as { message?: string; error?: string };
      if (!resp.ok) throw new Error(data.error || "导入配置失败");
      setNotice(data.message || "配置导入成功。");
      await reloadProfiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "导入配置失败");
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <div className="eyebrow">UNIFIED MODEL REGISTRY · 模型配置中心</div>
          <h2>文本 / 图片 / 视频模型列表</h2>
          <p>统一管理多套大模型与中转网关配置，按类型一键切换默认生效模型；API Key 采用本机 AES-256-GCM 加密存储，永不回显。</p>
        </div>
        <div className="button-row" style={{ flexWrap: "wrap" }}>
          <button type="button" className="button primary" onClick={() => openCreateModal()}>
            + 添加配置
          </button>
          <a
            href="/api/settings/model-profiles?export=1"
            className="button secondary"
            title="导出为 JSON 文件（默认脱敏不含 API Key）"
          >
            ↓ 导出配置
          </a>
          <button
            type="button"
            className="button secondary"
            disabled={importing}
            onClick={() => importInputRef.current?.click()}
            title="从 JSON 文件批量导入模型配置"
          >
            {importing ? "导入中..." : "↑ 导入配置"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImportFile}
            style={{ display: "none" }}
          />
        </div>
      </div>

      <div style={{ padding: "16px 24px 24px", display: "grid", gap: "14px" }}>
        {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
        {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

        {/* 类型筛选条 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
            {(
              [
                { key: "all", label: `全部 (${profiles.length})` },
                { key: "text", label: `文本 (${profiles.filter((p) => p.serviceType === "text").length})` },
                { key: "image", label: `图片 (${profiles.filter((p) => p.serviceType === "image").length})` },
                { key: "video", label: `视频 (${profiles.filter((p) => p.serviceType === "video").length})` },
              ] as const
            ).map((tab) => {
              const active = filterType === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilterType(tab.key)}
                  style={{
                    padding: "6px 12px",
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
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            每个类型可保存多套备选模型，点击「设为默认」即时切换生效。
          </span>
        </div>

        {/* 配置列表表格 */}
        {filteredProfiles.length === 0 ? (
          <div
            style={{
              padding: "36px 20px",
              borderRadius: "10px",
              border: "1px dashed var(--line-strong)",
              background: "var(--surface-subtle)",
              textAlign: "center",
              display: "grid",
              gap: "10px",
              justifyItems: "center",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--ink)" }}>暂无已添加的模型配置</div>
            <div style={{ fontSize: "12.5px", color: "var(--muted)" }}>
              当前默认使用免 Key 本地模板模式。点击右上角「+ 添加配置」即可接入文本、图片或视频模型。
            </div>
            <button type="button" className="button primary" onClick={() => openCreateModal()}>
              + 添加第一个模型配置
            </button>
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: "10px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
              <thead>
                <tr style={{ background: "var(--surface-subtle)", borderBottom: "1px solid var(--line)", textAlign: "left" }}>
                  <th style={{ padding: "11px 14px", fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>名称</th>
                  <th style={{ padding: "11px 12px", fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>提供商</th>
                  <th style={{ padding: "11px 12px", fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>Base URL</th>
                  <th style={{ padding: "11px 12px", fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>默认模型</th>
                  <th style={{ padding: "11px 12px", fontSize: "12px", fontWeight: 700, color: "var(--muted)" }}>类型</th>
                  <th style={{ padding: "11px 12px", fontSize: "12px", fontWeight: 700, color: "var(--muted)", textAlign: "center" }}>默认</th>
                  <th style={{ padding: "11px 14px", fontSize: "12px", fontWeight: 700, color: "var(--muted)", textAlign: "right" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((profile) => {
                  const meta = SERVICE_TYPE_META[profile.serviceType];
                  const isBusy = busyId === profile.id;
                  return (
                    <tr key={profile.id} style={{ borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
                      <td style={{ padding: "12px 14px", fontWeight: 700, color: "var(--ink)" }}>
                        <div>{profile.name}</div>
                        <div style={{ fontSize: "11px", fontWeight: 500, color: "var(--muted)", marginTop: "2px" }}>
                          {profile.apiKeyConfigured ? `Key ${profile.apiKeyHint}` : "未配置 Key"}
                        </div>
                      </td>
                      <td style={{ padding: "12px 12px", color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
                        {profile.vendor}
                      </td>
                      <td
                        style={{
                          padding: "12px 12px",
                          color: "var(--muted)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "12px",
                          maxWidth: "210px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={profile.baseUrl}
                      >
                        {profile.baseUrl || "—"}
                      </td>
                      <td
                        style={{
                          padding: "12px 12px",
                          color: "var(--ink)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "12px",
                          maxWidth: "200px",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={profile.defaultModel}
                      >
                        {profile.defaultModel || "—"}
                      </td>
                      <td style={{ padding: "12px 12px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            padding: "3px 9px",
                            borderRadius: "999px",
                            fontSize: "11.5px",
                            fontWeight: 700,
                            background: meta.bg,
                            color: meta.color,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {meta.short}
                        </span>
                      </td>
                      <td style={{ padding: "12px 12px", textAlign: "center" }}>
                        {profile.isDefault ? (
                          <span
                            title="当前生效默认模型"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: "24px",
                              height: "24px",
                              borderRadius: "6px",
                              background: "var(--green-soft)",
                              color: "var(--green)",
                              fontWeight: 800,
                              fontSize: "13px",
                            }}
                          >
                            ✓
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleSetDefault(profile.id)}
                            style={{
                              background: "transparent",
                              border: "1px solid var(--line)",
                              borderRadius: "6px",
                              padding: "3px 8px",
                              fontSize: "11px",
                              color: "var(--muted)",
                              cursor: "pointer",
                            }}
                          >
                            设为默认
                          </button>
                        )}
                      </td>
                      <td style={{ padding: "12px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <div style={{ display: "inline-flex", gap: "10px", alignItems: "center" }}>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleTest(profile.id)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "12.5px",
                              fontWeight: 600,
                              color: "var(--blue)",
                              cursor: "pointer",
                            }}
                          >
                            {isBusy ? "处理中" : "测试"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => openEditModal(profile)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "12.5px",
                              fontWeight: 600,
                              color: "var(--ink)",
                              cursor: "pointer",
                            }}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleDelete(profile)}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "12.5px",
                              fontWeight: 600,
                              color: "var(--red)",
                              cursor: "pointer",
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 添加 / 编辑配置弹窗 */}
      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={form.id ? "编辑配置" : "添加配置"}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0, 0, 0, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <form
            onSubmit={handleSave}
            style={{
              width: "100%",
              maxWidth: "560px",
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--paper)",
              color: "var(--ink)",
              border: "1px solid var(--line-strong)",
              borderRadius: "14px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <strong style={{ fontSize: "16px", color: "var(--ink)" }}>
                {form.id ? "编辑模型配置" : "添加配置"}
              </strong>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  fontSize: "18px",
                  cursor: "pointer",
                  padding: "2px 6px",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "18px 20px", display: "grid", gap: "14px" }}>
              {/* 服务类型 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-service-type">* 服务类型</label>
                <select
                  id="mp-service-type"
                  value={form.serviceType}
                  disabled={Boolean(form.id)}
                  onChange={(e) => handleChangeServiceType(e.target.value as ModelServiceType)}
                >
                  <option value="text">文本生成（选品研判 / 问答 / Listing）</option>
                  <option value="image">图片生成（主图 / 场景图 / 图生图）</option>
                  <option value="video">视频生成（I2V 商品演示短视频）</option>
                </select>
              </div>

              {/* 预设厂商 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-vendor">* 厂商（选择预设自动填充 URL 和模型）</label>
                <select
                  id="mp-vendor"
                  value={form.vendor}
                  onChange={(e) => handleSelectVendor(e.target.value)}
                >
                  <option value="">选择预设厂商（自动填充 URL 和模型）</option>
                  {typePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 视频全能多图参考开关 */}
              {form.serviceType === "video" ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: "8px", background: "var(--surface-subtle)", border: "1px solid var(--line)" }}>
                  <span style={{ fontSize: "12.5px", color: "var(--ink)" }}>多图参考模式（全能多图）</span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--muted)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={form.supportsMultiImage}
                      onChange={(e) => setForm((prev) => ({ ...prev, supportsMultiImage: e.target.checked }))}
                    />
                    <span>{form.supportsMultiImage ? "已确认支持多图参考" : "标准首帧图生视频"}</span>
                  </label>
                </div>
              ) : null}

              {/* 接口规范 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-protocol">接口规范（自定义厂商必选）</label>
                <select
                  id="mp-protocol"
                  value={form.protocol}
                  onChange={(e) => setForm((prev) => ({ ...prev, protocol: e.target.value }))}
                >
                  {PROTOCOL_OPTIONS[form.serviceType].map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* 名称 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-name">* 名称</label>
                <input
                  id="mp-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="如：火山 Seedance 1.0 Pro / 公司中转网关"
                />
              </div>

              {/* Base URL */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-base-url">* Base URL</label>
                <input
                  id="mp-base-url"
                  type="url"
                  required
                  value={form.baseUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                  placeholder="选择预设厂商后自动填充，可修改"
                  spellCheck={false}
                />
              </div>

              {/* API Key */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-api-key">API Key</label>
                <input
                  id="mp-api-key"
                  type="password"
                  autoComplete="new-password"
                  value={form.apiKey}
                  onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={form.apiKeyHint ? `已保存 ${form.apiKeyHint}，留空保留原 Key` : "API 密钥（AES-256-GCM 加密存储）"}
                  spellCheck={false}
                />
                {selectedPreset?.keyHint ? (
                  <small className="field-hint">{selectedPreset.keyHint}</small>
                ) : null}
              </div>

              {/* 视频可选提交/查询端点 */}
              {form.serviceType === "video" ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="mp-submit-ep">提交端点（可选）</label>
                    <input
                      id="mp-submit-ep"
                      type="text"
                      value={form.submitEndpoint}
                      onChange={(e) => setForm((prev) => ({ ...prev, submitEndpoint: e.target.value }))}
                      placeholder="/v1/videos/generations"
                      spellCheck={false}
                    />
                  </div>
                  <div className="field" style={{ margin: 0 }}>
                    <label htmlFor="mp-query-ep">查询端点（可选）</label>
                    <input
                      id="mp-query-ep"
                      type="text"
                      value={form.queryEndpoint}
                      onChange={(e) => setForm((prev) => ({ ...prev, queryEndpoint: e.target.value }))}
                      placeholder="/v1/video/tasks/{taskId}"
                      spellCheck={false}
                    />
                  </div>
                </div>
              ) : null}

              {/* 模型列表 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-models">模型列表</label>
                {selectedPreset && selectedPreset.models.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => handleAppendPresetModel(e.target.value)}
                    style={{ marginBottom: "6px" }}
                  >
                    <option value="">+ 追加预设模型</option>
                    {selectedPreset.models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                ) : null}
                <textarea
                  id="mp-models"
                  rows={3}
                  value={form.modelsText}
                  onChange={(e) => {
                    const nextText = e.target.value;
                    const list = parseModels(nextText);
                    setForm((prev) => ({
                      ...prev,
                      modelsText: nextText,
                      defaultModel: list.includes(prev.defaultModel) ? prev.defaultModel : (list[0] ?? ""),
                    }));
                  }}
                  placeholder="选择预设厂商后自动填入，可编辑；多个用逗号或换行分隔"
                  spellCheck={false}
                />
              </div>

              {/* 默认模型 */}
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="mp-default-model">默认模型</label>
                <select
                  id="mp-default-model"
                  value={form.defaultModel}
                  onChange={(e) => setForm((prev) => ({ ...prev, defaultModel: e.target.value }))}
                >
                  {parsedModels.length === 0 ? (
                    <option value="">请先填写上方模型列表</option>
                  ) : (
                    parsedModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* 设为默认 */}
              <label style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--ink)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm((prev) => ({ ...prev, isDefault: e.target.checked }))}
                />
                <span>保存后设为「{SERVICE_TYPE_META[form.serviceType].label}」默认生效模型</span>
              </label>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                padding: "14px 20px",
                borderTop: "1px solid var(--line)",
                background: "var(--surface-subtle)",
              }}
            >
              <button type="button" className="button ghost" onClick={() => setModalOpen(false)}>
                取消
              </button>
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? "保存中..." : "保存配置"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
