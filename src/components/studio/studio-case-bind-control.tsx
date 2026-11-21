"use client";

import Link from "next/link";
import { useState } from "react";
import type { StudioBoundCaseRef } from "@/lib/standalone-image-studio";

export type BindableCaseOption = {
  id: string;
  title: string;
  marketplace?: string;
};

type Props = {
  kind: "image" | "video";
  studioAssetId: string;
  slot?: string;
  actor?: string;
  selectedCaseId?: string;
  cases: BindableCaseOption[];
  initialBoundCases?: StudioBoundCaseRef[];
  onBound?: (ref: StudioBoundCaseRef, message: string) => void;
  onError?: (message: string) => void;
};

export function StudioCaseBindControl({
  kind,
  studioAssetId,
  slot,
  actor = "运营人员",
  selectedCaseId = "",
  cases,
  initialBoundCases = [],
  onBound,
  onError,
}: Props) {
  const [boundCases, setBoundCases] = useState<StudioBoundCaseRef[]>(initialBoundCases);
  const [binding, setBinding] = useState(false);

  const boundSet = new Set(boundCases.map((c) => c.caseId));
  const selectedIsBound = Boolean(selectedCaseId && boundSet.has(selectedCaseId));
  const remainingCases = cases.filter((c) => !boundSet.has(c.id));

  async function bindToCase(targetCaseId: string) {
    if (!targetCaseId || binding || boundSet.has(targetCaseId)) return;
    setBinding(true);
    try {
      const resp = await fetch("/api/studio/bind-case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          studioAssetId,
          caseId: targetCaseId,
          slot,
          actor,
        }),
      });
      const data = (await resp.json()) as {
        boundCase?: StudioBoundCaseRef;
        message?: string;
        error?: string;
      };
      if (!resp.ok) throw new Error(data.error || "入库到商品案卷失败");
      const targetTitle =
        data.boundCase?.caseTitle ||
        cases.find((c) => c.id === targetCaseId)?.title ||
        "商品案卷";
      const nextRef: StudioBoundCaseRef = data.boundCase ?? {
        caseId: targetCaseId,
        caseTitle: targetTitle,
        boundAt: new Date().toISOString(),
      };
      setBoundCases((prev) => (prev.some((c) => c.caseId === nextRef.caseId) ? prev : [...prev, nextRef]));
      onBound?.(nextRef, data.message || `已入库至「${targetTitle}」。`);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "入库到商品案卷失败");
    } finally {
      setBinding(false);
    }
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center", minWidth: 0 }}>
      {boundCases.length > 0 ? (
        boundCases.map((ref) => (
          <Link
            key={ref.caseId}
            href={`/cases/${encodeURIComponent(ref.caseId)}/content`}
            title={`点击前往「${ref.caseTitle}」内容页审核`}
            style={{
              display: "inline-block",
              padding: "3px 8px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 700,
              textDecoration: "none",
              background: "var(--green-soft)",
              color: "var(--green)",
              border: "1px solid var(--green)",
              maxWidth: "min(220px, 100%)",
              boxSizing: "border-box",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            ✓ {ref.caseTitle}
          </Link>
        ))
      ) : (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "3px 8px",
            borderRadius: "6px",
            fontSize: "12px",
            fontWeight: 600,
            background: "var(--surface-subtle)",
            color: "var(--muted)",
            border: "1px solid var(--line)",
          }}
        >
          草稿 · 未归属
        </span>
      )}

      {selectedCaseId && !selectedIsBound ? (
        <button
          type="button"
          className="button secondary"
          disabled={binding}
          style={{ minHeight: "28px", padding: "0 10px", fontSize: "12px" }}
          onClick={() => bindToCase(selectedCaseId)}
        >
          {binding ? "入库中..." : "入库到当前案卷"}
        </button>
      ) : remainingCases.length > 0 ? (
        <select
          aria-label="归属到商品案卷"
          className="studio-filter-control"
          disabled={binding}
          value=""
          onChange={(e) => {
            if (e.target.value) void bindToCase(e.target.value);
          }}
          style={{
            width: "auto",
            maxWidth: "160px",
            minHeight: "28px",
            padding: "2px 28px 2px 10px",
          }}
        >
          <option value="">{binding ? "入库中..." : "+ 归属到商品…"}</option>
          {remainingCases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
