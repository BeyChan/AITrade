"use client";

import { useState } from "react";
import {
  StudioCaseBindControl,
  type BindableCaseOption,
} from "@/components/studio/studio-case-bind-control";
import { shortDate } from "@/lib/format";
import type { StudioBoundCaseRef } from "@/lib/standalone-image-studio";

export type StudioGalleryMediaItem = {
  id: string;
  kind: "image" | "video";
  fileUrl: string;
  title: string;
  originalName: string;
  provider: string;
  model: string;
  aspectRatio: string;
  metaLabel: string;
  slot?: string;
  prompt?: string;
  boundCases: StudioBoundCaseRef[];
  createdAt: string;
};

type Props = {
  item: StudioGalleryMediaItem;
  selectedCaseId?: string;
  cases: BindableCaseOption[];
  actor?: string;
  checked?: boolean;
  onToggleSelect?: (id: string) => void;
  onUseAsReference?: (item: StudioGalleryMediaItem) => void;
  onBound?: (itemId: string, ref: StudioBoundCaseRef, message: string) => void;
  onDelete: (item: StudioGalleryMediaItem) => Promise<void> | void;
  onError?: (message: string) => void;
};

export function StudioMediaCard({
  item,
  selectedCaseId = "",
  cases,
  actor = "运营人员",
  checked = false,
  onToggleSelect,
  onUseAsReference,
  onBound,
  onDelete,
  onError,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const mediaLabel = item.kind === "video" ? "视频" : "图片";

  async function handleDelete() {
    if (!window.confirm(`确认删除该${mediaLabel}「${item.title}」？本地文件也会一并清理。`)) return;
    setDeleting(true);
    try {
      await onDelete(item);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article
      className="studio-asset-card"
      style={{
        border: checked ? "2px solid var(--green)" : "1px solid var(--line)",
        borderRadius: "12px",
        overflow: "hidden",
        background: "var(--surface-subtle)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {item.kind === "video" ? (
        <video
          src={item.fileUrl}
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", aspectRatio: "1 / 1", background: "#000", display: "block", objectFit: "contain" }}
        />
      ) : (
        <img
          src={item.fileUrl}
          alt={item.title}
          style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", display: "block", background: "var(--paper)" }}
        />
      )}

      <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 }}>
          {onToggleSelect ? (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                fontSize: "12.5px",
                fontWeight: 700,
                color: "var(--ink)",
                cursor: "pointer",
                minWidth: 0,
                maxWidth: "100%",
              }}
            >
              <input type="checkbox" checked={checked} onChange={() => onToggleSelect(item.id)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
            </label>
          ) : (
            <strong
              style={{
                fontSize: "12.5px",
                color: "var(--ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
                maxWidth: "100%",
              }}
              title={item.title}
            >
              {item.title}
            </strong>
          )}
          <span
            className="badge badge-neutral"
            style={{
              fontSize: "12px",
              whiteSpace: "nowrap",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.kind === "video" ? "视频" : "图片"} · {item.aspectRatio} · {item.metaLabel}
          </span>
        </div>

        <div style={{ fontSize: "12px", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.provider} · {item.model} · {shortDate(item.createdAt)}
        </div>

        <StudioCaseBindControl
          kind={item.kind}
          studioAssetId={item.id}
          slot={item.slot}
          actor={actor}
          selectedCaseId={selectedCaseId}
          cases={cases}
          initialBoundCases={item.boundCases}
          onBound={(ref, msg) => onBound?.(item.id, ref, msg)}
          onError={onError}
        />

        {item.prompt ? (
          <details className="studio-more-details">
            <summary>Prompt</summary>
            <div
              className="studio-more-body"
              style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5, wordBreak: "break-word" }}
            >
              {item.prompt}
            </div>
          </details>
        ) : null}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            marginTop: "auto",
            paddingTop: "2px",
          }}
        >
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {onUseAsReference && item.kind === "image" ? (
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
                onClick={() => onUseAsReference(item)}
              >
                设为参考底图
              </button>
            ) : null}
            <a
              href={`${item.fileUrl}?download=1`}
              className="button ghost"
              style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
            >
              下载
            </a>
          </div>
          <button
            type="button"
            className="button ghost"
            style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px", color: "var(--red)" }}
            disabled={deleting}
            onClick={handleDelete}
          >
            {deleting ? "删除中..." : "删除"}
          </button>
        </div>
      </div>
    </article>
  );
}
