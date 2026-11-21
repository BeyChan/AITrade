"use client";

import { useRef } from "react";

export type QuickPickImage = {
  id: string;
  fileUrl: string;
  label: string;
  sublabel?: string;
};

type Props = {
  title?: string;
  hint?: string;
  selectedFile: File | null;
  selectedFilePreview: string | null;
  selectedGalleryId: string;
  quickPickImages: QuickPickImage[];
  onFileChange: (file: File | null) => void;
  onSelectGalleryImage: (img: QuickPickImage) => void;
  emptyGalleryNote?: string;
};

export function StudioReferenceDropzone({
  title = "参考底图（可选上传或从图库点选）",
  hint = "拖拽或点击上传 JPG / PNG / WebP，锁定商品主体外观",
  selectedFile,
  selectedFilePreview,
  selectedGalleryId,
  quickPickImages,
  onFileChange,
  onSelectGalleryImage,
  emptyGalleryNote,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeGalleryImg = !selectedFile
    ? quickPickImages.find((img) => img.id === selectedGalleryId) ?? null
    : null;

  return (
    <div className="field">
      <div className="studio-label-row">
        <label>{title}</label>
        {(selectedFile || activeGalleryImg) ? (
          <button
            type="button"
            className="studio-inline-danger"
            onClick={() => {
              onFileChange(null);
              if (activeGalleryImg) onSelectGalleryImage({ id: "", fileUrl: "", label: "" });
            }}
          >
            清除底图
          </button>
        ) : null}
      </div>

      <div
        className="studio-dropzone"
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFileChange(dropped);
        }}
        style={{ cursor: "pointer" }}
      >
        {selectedFile && selectedFilePreview ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
            <img
              src={selectedFilePreview}
              alt={selectedFile.name}
              style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", border: "1px solid var(--line)" }}
            />
            <div style={{ minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedFile.name}
              </div>
              <div style={{ fontSize: "12px", color: "var(--green)" }}>✓ 已选为本地上传底图（点击可更换）</div>
            </div>
          </div>
        ) : activeGalleryImg ? (
          <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
            <img
              src={activeGalleryImg.fileUrl}
              alt={activeGalleryImg.label}
              style={{ width: "48px", height: "48px", objectFit: "cover", borderRadius: "6px", border: "1px solid var(--line)" }}
            />
            <div style={{ minWidth: 0, textAlign: "left" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {activeGalleryImg.label}
              </div>
              <div style={{ fontSize: "12px", color: "var(--green)" }}>
                ✓ 已选图库底图{activeGalleryImg.sublabel ? ` · ${activeGalleryImg.sublabel}` : ""}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: "4px", textAlign: "center" }}>
            <strong style={{ fontSize: "12.5px", color: "var(--ink)" }}>点击或拖拽上传商品参考图</strong>
            <span style={{ fontSize: "12px", color: "var(--muted)" }}>{hint}</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
      </div>

      {quickPickImages.length > 0 ? (
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
          {quickPickImages.slice(0, 6).map((img) => {
            const active = !selectedFile && selectedGalleryId === img.id;
            return (
              <button
                key={img.id}
                type="button"
                onClick={() => onSelectGalleryImage(img)}
                title={img.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "4px 8px 4px 4px",
                  borderRadius: "8px",
                  border: active ? "1.5px solid var(--green)" : "1px solid var(--line)",
                  background: active ? "var(--green-soft)" : "var(--surface-subtle)",
                  color: "var(--ink)",
                  cursor: "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                <img
                  src={img.fileUrl}
                  alt={img.label}
                  style={{ width: "24px", height: "24px", objectFit: "cover", borderRadius: "4px" }}
                />
                <span style={{ maxWidth: "84px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {img.label}
                </span>
              </button>
            );
          })}
        </div>
      ) : emptyGalleryNote ? (
        <small className="field-hint" style={{ marginTop: "6px", display: "block" }}>
          {emptyGalleryNote}
        </small>
      ) : null}
    </div>
  );
}
