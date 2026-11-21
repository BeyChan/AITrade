"use client";

import { useMemo, useState } from "react";
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
}: Props) {
  const [viewport, setViewport] = useState<"mobile" | "desktop">("mobile");
  const [myPosition, setMyPosition] = useState<number>(1);

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

  return (
    <section className="section shelf-test-section">
      <div className="section-header">
        <div>
          <h2>主图 SERP 竞品货架对比测试（Shelf Test）</h2>
          <p>把你的主图、标题与拟定价放进真实竞品搜索货架中，检验手机端小图清晰度、视觉突围度与价格竞争力。</p>
        </div>
        <div className="shelf-controls">
          <div className="shelf-toggle">
            <button
              type="button"
              className={`button ${viewport === "mobile" ? "primary" : "ghost"}`}
              onClick={() => setViewport("mobile")}
            >
              手机端（70% 流量）
            </button>
            <button
              type="button"
              className={`button ${viewport === "desktop" ? "primary" : "ghost"}`}
              onClick={() => setViewport("desktop")}
            >
              PC 端货架
            </button>
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() => setMyPosition((prev) => (prev + 1) % 5)}
          >
            切换排位（第 {myPosition + 1} 位）
          </button>
        </div>
      </div>

      <div className={`shelf-stage is-${viewport}`}>
        <div className="shelf-search-bar">
          <span className="shelf-search-query">{myTitle ? myTitle.slice(0, 42) : "Amazon 搜索结果页货架模拟"}</span>
          <span className="muted mono">{viewport === "mobile" ? "390px 移动视角" : "4列 桌面视角"}</span>
        </div>

        <div className={`shelf-grid is-${viewport}`}>
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
    </section>
  );
}
