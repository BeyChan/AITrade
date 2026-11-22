"use client";

import { useState } from "react";

type Props = {
  caseId: string;
  target: "definition" | "listing";
};

function readFieldValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return el?.value ?? "";
}

function writeFieldValue(id: string, value: string) {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return;
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const DEFINITION_IDS = [
  "productName",
  "targetCustomer",
  "coreDifferentiator",
  "specifications",
  "packageContents",
  "claimsToAvoid",
] as const;

const LISTING_IDS = [
  "brand",
  "title",
  "bullet-0",
  "bullet-1",
  "bullet-2",
  "bullet-3",
  "bullet-4",
  "description",
  "searchTerms",
] as const;

export function ContentAutofillButton({ caseId, target }: Props) {
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, string> | null>(null);

  async function handleAutofill() {
    setLoading(true);
    setErrorText(null);
    setStatusText(null);

    try {
      const currentDefinition = {
        productName: readFieldValue("productName"),
        targetCustomer: readFieldValue("targetCustomer"),
        coreDifferentiator: readFieldValue("coreDifferentiator"),
        specifications: readFieldValue("specifications"),
        packageContents: readFieldValue("packageContents"),
        claimsToAvoid: readFieldValue("claimsToAvoid"),
      };

      const resp = await fetch(`/api/cases/${encodeURIComponent(caseId)}/content/autofill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, currentDefinition }),
      });

      const data = (await resp.json()) as {
        ok?: boolean;
        error?: string;
        source?: "ai" | "template";
        model?: string;
        fields?: Record<string, unknown>;
      };
      if (!resp.ok || !data.ok || !data.fields) {
        throw new Error(data.error || "生成失败，请稍后重试");
      }

      const prev: Record<string, string> = {};
      if (target === "definition") {
        for (const fieldId of DEFINITION_IDS) {
          prev[fieldId] = readFieldValue(fieldId);
          const nextVal = data.fields[fieldId];
          if (typeof nextVal === "string") {
            writeFieldValue(fieldId, nextVal);
          }
        }
      } else {
        for (const fieldId of LISTING_IDS) {
          prev[fieldId] = readFieldValue(fieldId);
        }
        if (typeof data.fields.brand === "string" && !prev.brand.trim()) {
          writeFieldValue("brand", data.fields.brand);
        }
        if (typeof data.fields.title === "string") {
          writeFieldValue("title", data.fields.title);
        }
        if (Array.isArray(data.fields.bullets)) {
          data.fields.bullets.slice(0, 5).forEach((b, idx) => {
            if (typeof b === "string") writeFieldValue(`bullet-${idx}`, b);
          });
        }
        if (typeof data.fields.description === "string") {
          writeFieldValue("description", data.fields.description);
        }
        if (typeof data.fields.searchTerms === "string") {
          writeFieldValue("searchTerms", data.fields.searchTerms);
        }
      }

      setSnapshot(prev);
      setStatusText(
        data.source === "ai"
          ? `已由 AI (${data.model || "已配置模型"}) 回填`
          : "已由本地模板回填（未配置文本模型）",
      );
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "AI 一键填写失败");
    } finally {
      setLoading(false);
    }
  }

  function handleUndo() {
    if (!snapshot) return;
    for (const [fieldId, prevValue] of Object.entries(snapshot)) {
      writeFieldValue(fieldId, prevValue);
    }
    setSnapshot(null);
    setStatusText("已撤销回填");
  }

  return (
    <div className="autofill-control">
      <button
        type="button"
        className="button secondary autofill-trigger"
        onClick={handleAutofill}
        disabled={loading}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3 1.4 3.8a3.6 3.6 0 0 0 2.3 2.3L19.5 10.5l-3.8 1.4a3.6 3.6 0 0 0-2.3 2.3L12 18l-1.4-3.8a3.6 3.6 0 0 0-2.3-2.3L4.5 10.5l3.8-1.4a3.6 3.6 0 0 0 2.3-2.3L12 3Z" />
        </svg>
        <span>
          {loading
            ? "生成中..."
            : target === "definition"
              ? "AI 一键填写"
              : "AI 一键生成 Listing"}
        </span>
      </button>

      {snapshot ? (
        <button type="button" className="button ghost autofill-undo" onClick={handleUndo}>
          撤销
        </button>
      ) : null}

      {statusText ? <span className="autofill-hint">{statusText}</span> : null}
      {errorText ? <span className="autofill-hint is-error">{errorText}</span> : null}
    </div>
  );
}
