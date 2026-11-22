"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { moneyIn } from "@/lib/format";

export type ShelfCompetitorCard = {
  asin: string;
  title: string;
  priceCents: number;
  rating: number;
  reviewCount: number;
};

type Props = {
  myTitle: string;
  myPriceCents: number;
  currency: string;
  myImageUrl: string | null;
  competitors?: ShelfCompetitorCard[];
  brand?: string;
  bullets?: string[];
  description?: string;
  searchTerms?: string;
  sectionId?: string;
  compactSidebar?: boolean;
};

const FALLBACK_SHELF_COMPETITORS: ShelfCompetitorCard[] = [
  {
    asin: "B0BENCH001",
    title: "Category Leader Stainless Steel Model with Quiet Motor & Dual Filter",
    priceCents: 3999,
    rating: 4.4,
    reviewCount: 3420,
  },
  {
    asin: "B0BENCH002",
    title: "Value Compact Design Daily Essential Kit with Replacement Pack",
    priceCents: 2899,
    rating: 4.2,
    reviewCount: 1180,
  },
  {
    asin: "B0BENCH003",
    title: "Pro Upgraded Version Heavy-Duty Construction & Easy-Clean Body",
    priceCents: 4699,
    rating: 4.6,
    reviewCount: 890,
  },
  {
    asin: "B0BENCH004",
    title: "Budget Basic Starter Edition Standard Capacity",
    priceCents: 2399,
    rating: 4.1,
    reviewCount: 5120,
  },
];

export function SerpShelfTest({
  myTitle,
  myPriceCents,
  currency,
  myImageUrl,
  competitors,
  brand,
  bullets,
  description,
  searchTerms,
  sectionId,
  compactSidebar = false,
}: Props) {
  const [previewMode, setPreviewMode] = useState<"list" | "detail">("list");
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const [myPosition, setMyPosition] = useState<number>(1);
  const [desktopModalOpen, setDesktopModalOpen] = useState<boolean>(false);
  const nonEmptyBullets = useMemo(
    () => (bullets ?? []).map((item) => item.trim()).filter(Boolean),
    [bullets],
  );

  useEffect(() => {
    if (!desktopModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDesktopModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [desktopModalOpen]);

  const shelfItems = useMemo(() => {
    const baseCompetitors =
      competitors && competitors.length > 0
        ? competitors.slice(0, 4)
        : FALLBACK_SHELF_COMPETITORS;

    const myCard = {
      isMine: true,
      asin: "MY-NEW-SKU",
      title: myTitle || "待填写商品主标题（模拟新品上架搜索结果展示效果）",
      priceCents: myPriceCents > 0 ? myPriceCents : 3499,
      rating: 0,
      reviewCount: 0,
      imageUrl: myImageUrl,
    };

    const list: Array<ShelfCompetitorCard & { isMine: boolean; imageUrl: string | null }> =
      baseCompetitors.map((c) => ({ ...c, isMine: false, imageUrl: null }));
    const clampedPos = Math.max(0, Math.min(list.length, myPosition));
    list.splice(clampedPos, 0, myCard);
    return list;
  }, [competitors, myTitle, myPriceCents, myImageUrl, myPosition]);

  const renderListStage = (targetViewport: "mobile" | "desktop") => (
    <div className={`shelf-stage is-${targetViewport}`}>
      <div className="shelf-search-bar">
        <span className="shelf-search-query">{myTitle ? myTitle.slice(0, 36) : "Amazon 搜索结果页货架模拟"}</span>
        <span className="muted mono">{targetViewport === "mobile" ? "手机端" : "PC 4 列"}</span>
      </div>

      <div className={`shelf-grid is-${targetViewport}`}>
        {shelfItems.map((item, idx) => (
          <article
            key={`${item.asin}-${idx}`}
            className={`shelf-card${item.isMine ? " is-mine" : ""}`}
          >
            <div className="shelf-thumb">
              {item.isMine && item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt={item.title} className="shelf-thumb-img" />
              ) : (
                <div className="shelf-thumb-placeholder">
                  <span className="mono">{item.isMine ? "待上传/生成主图" : item.asin}</span>
                </div>
              )}
              {item.isMine ? <span className="shelf-mine-tag">本品（新品）</span> : null}
            </div>

            <div className="shelf-body">
              <div className="shelf-title">{item.title}</div>
              <div className="shelf-rating mono">
                {item.isMine ? (
                  <span className="muted">新品 0 评 · 靠首图与卖点破局</span>
                ) : (
                  <>
                    <span className="shelf-stars">★ {item.rating.toFixed(1)}</span>
                    <span className="muted">({item.reviewCount.toLocaleString()})</span>
                  </>
                )}
              </div>
              <div className="shelf-price mono">{moneyIn(currency, item.priceCents)}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );

  const renderDetailStage = (targetViewport: "mobile" | "desktop") => (
    <div className={`shelf-stage shelf-detail-stage is-${targetViewport}`}>
      <div className="shelf-search-bar">
        <span className="shelf-search-query">{brand?.trim() || "BRAND"} · 商品详情页</span>
        <span className="muted mono">{targetViewport === "mobile" ? "手机端" : "PC 双栏"}</span>
      </div>

      <article className={`shelf-detail-card is-${targetViewport}`}>
        <div className="shelf-detail-media">
          {myImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={myImageUrl} alt={myTitle || "Listing 主图预览"} className="shelf-detail-img" />
          ) : (
            <div className="shelf-detail-placeholder">
              <span className="mono">待上传 / 生成主图</span>
            </div>
          )}
        </div>

        <div className="shelf-detail-info">
          <div className="shelf-detail-brand">{brand?.trim() || "BRAND"}</div>
          <h3 className="shelf-detail-title">{myTitle || "保存草稿后显示商品主标题"}</h3>
          <div className="shelf-detail-meta">
            <span className="shelf-stars">★★★★☆</span>
            <span className="muted">新品示例预览</span>
            <strong className="shelf-detail-price mono">
              {moneyIn(currency, myPriceCents > 0 ? myPriceCents : 3499)}
            </strong>
          </div>

          <div className="shelf-detail-block">
            <div className="shelf-detail-label">核心五点卖点</div>
            {nonEmptyBullets.length > 0 ? (
              <ul className="shelf-detail-bullets">
                {nonEmptyBullets.map((bullet, idx) => (
                  <li key={idx}>{bullet}</li>
                ))}
              </ul>
            ) : (
              <p className="shelf-detail-empty">尚未填写五点卖点，完成「3. Listing 草稿」后将在此实时预览。</p>
            )}
          </div>

          <div className="shelf-detail-block">
            <div className="shelf-detail-label">商品描述</div>
            <p className="shelf-detail-desc">
              {description?.trim() || "商品描述将在这里显示。"}
            </p>
          </div>

          {searchTerms?.trim() ? (
            <div className="shelf-detail-terms">
              <strong>后台搜索词</strong>
              <span>{searchTerms.trim()}</span>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );

  if (compactSidebar) {
    return (
      <>
        <section className="section shelf-sidebar-preview" id={sectionId}>
          <div className="shelf-sidebar-head">
            <div>
              <div className="eyebrow">上架效果预览</div>
              <h3>手机端实时预览</h3>
            </div>
            <button
              type="button"
              className="button secondary shelf-expand-btn"
              onClick={() => setDesktopModalOpen(true)}
            >
              PC 端大图
            </button>
          </div>

          <div className="shelf-sidebar-toolbar">
            <div className="shelf-toggle" role="tablist" aria-label="预览模式切换">
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "list"}
                className={`button ${previewMode === "list" ? "primary" : "ghost"}`}
                onClick={() => setPreviewMode("list")}
              >
                商品列表
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "detail"}
                className={`button ${previewMode === "detail" ? "primary" : "ghost"}`}
                onClick={() => setPreviewMode("detail")}
              >
                商品详情
              </button>
            </div>

            {previewMode === "list" ? (
              <button
                type="button"
                className="button ghost shelf-rank-btn"
                onClick={() => setMyPosition((prev) => (prev + 1) % 5)}
                title="切换本品在竞品列表中的排位"
              >
                第 {myPosition + 1} 位 ↻
              </button>
            ) : null}
          </div>

          <div className="shelf-sidebar-body">
            {previewMode === "list" ? renderListStage("mobile") : renderDetailStage("mobile")}
          </div>
        </section>

        {desktopModalOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="shelf-pc-modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-label="PC 端上架效果预览"
                onClick={() => setDesktopModalOpen(false)}
              >
                <div className="shelf-pc-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="shelf-pc-modal-head">
                    <div>
                      <h3>PC 端上架效果预览</h3>
                      <p>检验桌面端 4 列竞品货架与双栏商品详情页的视觉呈现与价格竞争力。</p>
                    </div>
                    <div className="shelf-pc-modal-actions">
                      <div className="shelf-toggle" role="tablist" aria-label="PC 预览模式切换">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={previewMode === "list"}
                          className={`button ${previewMode === "list" ? "primary" : "ghost"}`}
                          onClick={() => setPreviewMode("list")}
                        >
                          商品列表预览
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={previewMode === "detail"}
                          className={`button ${previewMode === "detail" ? "primary" : "ghost"}`}
                          onClick={() => setPreviewMode("detail")}
                        >
                          商品详情预览
                        </button>
                      </div>
                      {previewMode === "list" ? (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => setMyPosition((prev) => (prev + 1) % 5)}
                        >
                          切换排位（第 {myPosition + 1} 位）
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => setDesktopModalOpen(false)}
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                  <div className="shelf-pc-modal-body">
                    {previewMode === "list" ? renderListStage("desktop") : renderDetailStage("desktop")}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </>
    );
  }

  return (
    <section className="section shelf-test-section" id={sectionId}>
      <div className="section-header">
        <div>
          <h2>5. 上架效果预览</h2>
          <p>切换查看商品列表货架与详情页展示效果，检验主图清晰度、卖点结构与价格竞争力。</p>
        </div>
        <div className="shelf-controls">
          <div className="shelf-controls-row">
            <div className="shelf-toggle" role="tablist" aria-label="预览模式切换">
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "list"}
                className={`button ${previewMode === "list" ? "primary" : "ghost"}`}
                onClick={() => setPreviewMode("list")}
              >
                商品列表预览
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "detail"}
                className={`button ${previewMode === "detail" ? "primary" : "ghost"}`}
                onClick={() => setPreviewMode("detail")}
              >
                商品详情预览
              </button>
            </div>

            <div className="shelf-toggle" role="group" aria-label="终端视角切换">
              <button
                type="button"
                className={`button ${viewport === "mobile" ? "primary" : "ghost"}`}
                onClick={() => setViewport("mobile")}
              >
                手机端
              </button>
              <button
                type="button"
                className={`button ${viewport === "desktop" ? "primary" : "ghost"}`}
                onClick={() => setViewport("desktop")}
              >
                PC 端
              </button>
            </div>
          </div>

          {previewMode === "list" ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => setMyPosition((prev) => (prev + 1) % 5)}
            >
              切换排位（第 {myPosition + 1} 位）
            </button>
          ) : null}
        </div>
      </div>

      {previewMode === "list" ? renderListStage(viewport) : renderDetailStage(viewport)}
    </section>
  );
}
