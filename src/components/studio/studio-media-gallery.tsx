"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BindableCaseOption } from "@/components/studio/studio-case-bind-control";
import { StudioMediaCard, type StudioGalleryMediaItem } from "@/components/studio/studio-media-card";
import type { StudioBoundCaseRef } from "@/lib/standalone-image-studio";

export type { StudioGalleryMediaItem } from "@/components/studio/studio-media-card";

type Props = {
  mode: "studio" | "library";
  kind?: "image" | "video" | "all";
  items: StudioGalleryMediaItem[];
  sessionIds?: string[];
  selectedCaseId?: string;
  cases: BindableCaseOption[];
  actor?: string;
  extraHeaderActions?: React.ReactNode;
  loadingCards?: React.ReactNode;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onUseAsReference?: (item: StudioGalleryMediaItem) => void;
  onBound?: (itemId: string, ref: StudioBoundCaseRef, message: string) => void;
  onDelete: (item: StudioGalleryMediaItem) => Promise<void> | void;
  onError?: (message: string) => void;
};

const IMAGE_SLOT_TABS = [
  { key: "all", label: "全部" },
  { key: "main_image", label: "纯白底主图" },
  { key: "lifestyle_image", label: "使用场景图" },
  { key: "feature_image", label: "卖点/细节图" },
  { key: "packaging_image", label: "包装全家福" },
  { key: "reference_image", label: "实拍参考底图" },
] as const;

const VIDEO_SLOT_TABS = [
  { key: "all", label: "全部" },
  { key: "hero_orbit_5s", label: "质感环绕" },
  { key: "pain_point_demo_5s", label: "痛点反制演示" },
  { key: "social_hook_9x16", label: "社媒竖屏" },
  { key: "stitched", label: "拼接成片" },
] as const;

export function StudioMediaGallery({
  mode,
  kind = "all",
  items,
  selectedCaseId = "",
  cases,
  actor = "运营人员",
  extraHeaderActions,
  loadingCards,
  selectedIds,
  onToggleSelect,
  onUseAsReference,
  onBound,
  onDelete,
  onError,
}: Props) {
  const [slotFilter, setSlotFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "image" | "video">("all");
  const [bindFilter, setBindFilter] = useState<"all" | "current_case" | "unbound" | "bound">("all");
  const [caseFilter, setCaseFilter] = useState<string>("");
  const [keyword, setKeyword] = useState("");

  const studioSlotTabs = kind === "video" ? VIDEO_SLOT_TABS : kind === "image" ? IMAGE_SLOT_TABS : [];

  const studioItems = useMemo(() => {
    if (slotFilter === "all") return items;
    return items.filter((item) => item.slot === slotFilter);
  }, [items, slotFilter]);

  const historyItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (mode === "library" && typeFilter !== "all" && item.kind !== typeFilter) return false;
      const isBound = item.boundCases.length > 0;
      if (bindFilter === "current_case" && selectedCaseId) {
        if (!item.boundCases.some((c) => c.caseId === selectedCaseId)) return false;
      }
      if (bindFilter === "bound" && !isBound) return false;
      if (bindFilter === "unbound" && isBound) return false;
      if (caseFilter && !item.boundCases.some((c) => c.caseId === caseFilter)) return false;
      if (q) {
        const hay = `${item.title} ${item.originalName} ${item.model} ${item.prompt || ""} ${item.boundCases.map((c) => c.caseTitle).join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, mode, typeFilter, bindFilter, selectedCaseId, caseFilter, keyword]);

  const visibleItems = mode === "studio" ? studioItems : historyItems;
  const mediaLabel = kind === "video" ? "视频" : kind === "image" ? "图片" : "资源";
  const imageCount = items.filter((i) => i.kind === "image").length;
  const videoCount = items.filter((i) => i.kind === "video").length;

  return (
    <section className="panel" style={{ padding: "18px 20px", display: "grid", gap: "14px" }}>
      {/* 顶部栏 */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <strong style={{ fontSize: "15px", color: "var(--ink)" }}>
            {mode === "library"
              ? `全部资源（${historyItems.length} / ${items.length}）`
              : `生成作品（${items.length}）`}
          </strong>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {extraHeaderActions}
          {mode === "studio" ? (
            <Link href="/media-library" className="button ghost" style={{ minHeight: "30px", padding: "0 10px", fontSize: "12px" }}>
              前往资源库
            </Link>
          ) : null}
        </div>
      </div>

      {/* 工坊分类筛选胶囊 */}
      {mode === "studio" && studioSlotTabs.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {studioSlotTabs.map((tab) => {
            const count = tab.key === "all" ? items.length : items.filter((item) => item.slot === tab.key).length;
            const active = slotFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSlotFilter(tab.key)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: active ? 700 : 500,
                  cursor: "pointer",
                  background: active ? "var(--green-soft)" : "var(--surface-subtle)",
                  color: active ? "var(--green)" : "var(--muted)",
                  border: active ? "1px solid var(--green)" : "1px solid var(--line)",
                  transition: "background 0.15s ease, color 0.15s ease, border-color 0.15s ease",
                }}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
      ) : null}

      {/* 资源库筛选条 */}
      {mode === "library" ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
          <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            {mode === "library" ? (
              <>
                {(
                  [
                    { key: "all", label: `全部 (${items.length})` },
                    { key: "image", label: `图片 (${imageCount})` },
                    { key: "video", label: `视频 (${videoCount})` },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTypeFilter(t.key)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: "7px",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                      background: typeFilter === t.key ? "var(--deep)" : "var(--surface-subtle)",
                      color: typeFilter === t.key ? "var(--deep-fg)" : "var(--ink)",
                      border: typeFilter === t.key ? "1px solid var(--deep)" : "1px solid var(--line)",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
                <span style={{ color: "var(--line-strong)" }}>|</span>
              </>
            ) : null}

            {(
              [
                { key: "all", label: "全部归属" },
                ...(selectedCaseId ? ([{ key: "current_case", label: "当前商品" }] as const) : []),
                { key: "unbound", label: "未归属草稿" },
                { key: "bound", label: "已入库" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setBindFilter(tab.key)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "7px",
                  fontSize: "12px",
                  fontWeight: 700,
                  cursor: "pointer",
                  background: bindFilter === tab.key ? "var(--deep)" : "var(--surface-subtle)",
                  color: bindFilter === tab.key ? "var(--deep-fg)" : "var(--ink)",
                  border: bindFilter === tab.key ? "1px solid var(--deep)" : "1px solid var(--line)",
                }}
              >
                {tab.label}
              </button>
            ))}

            {mode === "library" && cases.length > 0 ? (
              <select
                aria-label="按商品筛选"
                className="studio-filter-control"
                value={caseFilter}
                onChange={(e) => setCaseFilter(e.target.value)}
                style={{ width: "auto", maxWidth: "180px", minHeight: "30px", padding: "2px 30px 2px 10px" }}
              >
                <option value="">按商品筛选…</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <input
            type="search"
            className="studio-filter-control"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索商品名 / 模型 / Prompt..."
            style={{ width: "220px", maxWidth: "100%", minHeight: "30px", padding: "4px 10px" }}
          />
        </div>
      ) : null}

      {/* 统一媒体网格 */}
      {visibleItems.length === 0 && !loadingCards ? (
        <div
          style={{
            padding: "36px 20px",
            borderRadius: "10px",
            border: "1px dashed var(--line)",
            background: "var(--surface-subtle)",
            textAlign: "center",
            color: "var(--muted)",
            fontSize: "13px",
          }}
        >
          {mode === "studio" && slotFilter === "all"
            ? `当前暂无${mediaLabel}产出。在左侧配置并生成后，结果会立即显示在这里。`
            : `当前筛选条件下暂无${mediaLabel}记录。`}
        </div>
      ) : (
        <div className={mode === "library" ? "studio-gallery-grid studio-gallery-grid-library" : "studio-gallery-grid"}>
          {loadingCards}
          {visibleItems.map((item) => (
            <StudioMediaCard
              key={`${item.kind}-${item.id}`}
              item={item}
              selectedCaseId={selectedCaseId}
              cases={cases}
              actor={actor}
              checked={Boolean(selectedIds?.includes(item.id))}
              onToggleSelect={onToggleSelect}
              onUseAsReference={onUseAsReference}
              onBound={onBound}
              onDelete={onDelete}
              onError={onError}
            />
          ))}
        </div>
      )}
    </section>
  );
}
