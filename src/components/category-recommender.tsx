"use client";

import { useEffect, useRef, useState } from "react";
import type { CategoryRecommendation, CategoryRecommendationResult } from "@/lib/ai-sourcing";

const BRIEF_FIELD_ID = "brief";

// Built only from the recommendation's own verification and risk notes plus conservative solo-seller limits; no sales, price or budget figures are invented.
function briefFor(item: CategoryRecommendation) {
  return [
    `围绕「${item.category}」做首轮选品验证。`,
    `第一步核验：${item.firstValidation}`,
    `主要风险：${item.riskNote}`,
    `核验关键词：${item.searchKeywords.slice(0, 4).join("、")}`,
    "限制：团队 1 到 2 人，小批量试单；优先轻小件、非电子、非液体，避开需要认证的品类。",
  ].join("\n").slice(0, 1200); // the brief field allows 1200 characters; value set from code bypasses maxLength
}

type Props = {
  marketCode: string;
  marketName: string;
  platformCode: string;
  platformName: string;
};

type ApiResult = CategoryRecommendationResult & { error?: string };

export function CategoryRecommender({ marketCode, marketName, platformCode, platformName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CategoryRecommendationResult | null>(null);
  const [open, setOpen] = useState(false);
  const [briefNote, setBriefNote] = useState("");
  const lastAutoBrief = useRef("");

  useEffect(() => {
    setBriefNote("");
    lastAutoBrief.current = "";
    setCategory("");
    setPending(false);
    setError("");
    setResult(null);
    setOpen(false);
  }, [marketCode, platformCode]);

  async function recommendCategories() {
    setPending(true);
    setError("");
    setOpen(true);
    try {
      const response = await fetch("/api/ai/category-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketCode, platformCode }),
      });
      const payload = (await response.json()) as ApiResult;
      if (!response.ok) throw new Error(payload.error || "生成类目推荐失败");
      if (!Array.isArray(payload.recommendations) || payload.recommendations.length !== 5) {
        throw new Error("推荐结果不完整，请重试");
      }
      setResult(payload);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "生成类目推荐失败");
    } finally {
      setPending(false);
    }
  }

  function useCategory(item: CategoryRecommendation) {
    setCategory(item.category);
    const field = document.getElementById(BRIEF_FIELD_ID) as HTMLTextAreaElement | null;
    if (field) {
      // Overwrite only an empty box or text this component filled itself, never what the user typed.
      const current = field.value.trim();
      if (!current || current === lastAutoBrief.current) {
        const next = briefFor(item);
        field.value = next;
        lastAutoBrief.current = next;
        setBriefNote("已按该类目填入研究条件，可直接修改。");
      } else {
        setBriefNote("已保留你填写的研究条件，未被覆盖。");
      }
    }
    inputRef.current?.focus();
  }

  const providerLabel = result?.provider === "template"
    ? "免 Key 模板"
    : result?.provider === "ollama"
      ? "本地 Ollama"
      : "模型接口";

  return (
    <>
      <div className="field ai-category-field">
        <div className="ai-field-heading">
          <label htmlFor="category">类目</label>
          <button
            type="button"
            className="button secondary compact-button ai-category-trigger"
            onClick={recommendCategories}
            disabled={pending}
            aria-expanded={open}
            aria-controls="ai-category-suggestions"
          >
            {pending ? "正在分析…" : "AI 推荐 5 个类目"}
          </button>
        </div>
        <input
          ref={inputRef}
          id="category"
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="例如：宠物清洁、家居收纳"
          required
          maxLength={80}
        />
        <span className="help">按当前 {marketName}站 · {platformName} 推荐；也可以直接填写。{briefNote ? ` ${briefNote}` : ""}</span>
        {error ? <p className="ai-category-error" role="alert">{error}</p> : null}
      </div>

      {open && (pending || result) ? (
        <section className="ai-category-suggestions" id="ai-category-suggestions" aria-live="polite">
          <div className="ai-category-suggestions-head">
            <div>
              <div className="eyebrow">Category shortlist</div>
              <h3>{pending ? `正在分析 ${marketName}站 · ${platformName}` : `${marketName}站 · ${platformName} 推荐方向`}</h3>
              <p>这些只是首轮验证类目，不代表需求、销量、竞争度或利润结论。点击后会填入类目和研究条件，不会自动提交。</p>
            </div>
            {!pending && result ? (
              <div className="ai-category-result-meta">
                <span className="badge badge-neutral">{providerLabel}</span>
                <span>{result.model}</span>
                <button type="button" className="text-button" onClick={() => setOpen(false)}>收起</button>
              </div>
            ) : null}
          </div>

          {pending ? (
            <div className="ai-category-loading">
              <span className="spinner" aria-hidden="true" />
              <span>正在结合国家和平台生成候选类目…</span>
            </div>
          ) : null}

          {!pending && result?.responseSummary.fallback ? (
            <div className="notice warn ai-category-fallback">
              模型调用失败，已改用免 Key 模板推荐。失败原因：{String(result.responseSummary.providerError ?? "未知错误")}
            </div>
          ) : null}

          {!pending && result ? (
            <div className="ai-category-grid">
              {result.recommendations.map((item, index) => {
                const selected = category.trim() === item.category;
                return (
                  <article className={`ai-category-card ${selected ? "selected" : ""}`} key={item.category}>
                    <div className="ai-category-card-head">
                      <span>方向 {index + 1}</span>
                      <button type="button" className="text-button" onClick={() => useCategory(item)}>
                        {selected ? "已填入" : "使用该类目"}
                      </button>
                    </div>
                    <h3>{item.category}</h3>
                    <p>{item.reason}</p>
                    <div className="ai-category-detail">
                      <strong>第一步核验</strong>
                      <span>{item.firstValidation}</span>
                    </div>
                    <div className="ai-category-detail risk">
                      <strong>主要风险</strong>
                      <span>{item.riskNote}</span>
                    </div>
                    <div className="ai-category-keywords">
                      {item.searchKeywords.slice(0, 4).map((keyword) => <span key={keyword}>{keyword}</span>)}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
