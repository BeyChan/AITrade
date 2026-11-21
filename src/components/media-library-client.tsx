"use client";

import { useState } from "react";
import type { BindableCaseOption } from "@/components/studio/studio-case-bind-control";
import { StudioMediaGallery, type StudioGalleryMediaItem } from "@/components/studio/studio-media-gallery";
import { IMAGE_SLOT_LABELS } from "@/lib/image-skills-types";
import type { StandaloneStudioAsset } from "@/lib/standalone-image-studio";
import type { StandaloneVideoAsset } from "@/lib/standalone-video-studio";

type Props = {
  initialImages: StandaloneStudioAsset[];
  initialVideos: StandaloneVideoAsset[];
  cases: BindableCaseOption[];
};

export function MediaLibraryClient({ initialImages, initialVideos, cases }: Props) {
  const [items, setItems] = useState<StudioGalleryMediaItem[]>(() => {
    const imgs: StudioGalleryMediaItem[] = initialImages.map((img) => ({
      id: img.id,
      kind: "image",
      fileUrl: img.fileUrl,
      title: img.productName || img.originalName,
      originalName: img.originalName,
      provider: img.provider,
      model: img.model,
      aspectRatio: img.aspectRatio,
      metaLabel: IMAGE_SLOT_LABELS[img.slot] || img.skillName || img.slot,
      slot: img.slot,
      prompt: img.prompt,
      boundCases: img.boundCases ?? [],
      createdAt: img.createdAt,
    }));
    const vids: StudioGalleryMediaItem[] = initialVideos.map((vid) => ({
      id: vid.id,
      kind: "video",
      fileUrl: vid.fileUrl,
      title: vid.productName || vid.originalName,
      originalName: vid.originalName,
      provider: vid.provider,
      model: vid.model,
      aspectRatio: vid.aspectRatio,
      metaLabel: `${vid.durationSec}s`,
      prompt: vid.prompt,
      boundCases: vid.boundCases ?? [],
      createdAt: vid.createdAt,
    }));
    return [...imgs, ...vids].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  });

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(item: StudioGalleryMediaItem) {
    setError(null);
    setNotice(null);
    try {
      const endpoint =
        item.kind === "image"
          ? `/api/image-studio/file/${encodeURIComponent(item.id)}`
          : `/api/video-studio/file/${encodeURIComponent(item.id)}`;
      const resp = await fetch(endpoint, { method: "DELETE" });
      if (!resp.ok) throw new Error("删除素材失败");
      setItems((prev) => prev.filter((x) => !(x.id === item.id && x.kind === item.kind)));
      setNotice(`已删除「${item.title}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除素材失败");
    }
  }

  return (
    <div style={{ display: "grid", gap: "16px" }}>
      {notice ? <div className="notice"><strong>已完成：</strong>{notice}</div> : null}
      {error ? <div className="notice warn"><strong>未完成：</strong>{error}</div> : null}

      <StudioMediaGallery
        mode="library"
        kind="all"
        items={items}
        cases={cases}
        onBound={(itemId, ref, msg) => {
          setNotice(msg);
          setError(null);
          setItems((prev) =>
            prev.map((x) =>
              x.id === itemId
                ? { ...x, boundCases: [...x.boundCases.filter((c) => c.caseId !== ref.caseId), ref] }
                : x,
            ),
          );
        }}
        onDelete={handleDelete}
        onError={(msg) => setError(msg)}
      />
    </div>
  );
}
