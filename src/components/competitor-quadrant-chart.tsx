"use client";

import { useMemo, useState } from "react";
import {
  isVerifiedCompetitorField,
  type CompetitorProfile,
} from "@/lib/competitor-compare/types";
import { moneyIn } from "@/lib/format";

type Props = {
  competitors: CompetitorProfile[];
  currency: string;
  p50PriceCents: number;
  targetPriceCents?: number;
  darkHorseAsins?: string[];
  benchmarkAsin?: string | null;
  onSelectBenchmark?: (competitor: CompetitorProfile | null) => void;
};

const WIDTH = 760;
const HEIGHT = 360;
const PAD = { top: 48, right: 42, bottom: 50, left: 68 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function logReview(count: number) {
  return Math.log10(Math.max(10, count + 10));
}

function effectivePriceOf(item: CompetitorProfile): number {
  return item.effectivePriceCents && item.effectivePriceCents > 0
    ? item.effectivePriceCents
    : item.priceCents;
}

function realSalesOf(item: CompetitorProfile): number | null {
  if (typeof item.boughtPastMonth === "number" && item.boughtPastMonth > 0) {
    return item.boughtPastMonth;
  }
  if (isVerifiedCompetitorField(item, "monthlySalesEst") && item.monthlySalesEst > 0) {
    return item.monthlySalesEst;
  }
  return null;
}

function ratingColor(rating: number) {
  if (rating > 0 && rating < 4.2) return "#b8322a";
  if (rating > 0 && rating < 4.5) return "#8a5309";
  return "#1f7a55";
}

function ratingLabel(rating: number) {
  if (!rating || rating <= 0) return "未采集评分";
  if (rating < 4.2) return "痛点集中 · 易切入";
  if (rating < 4.5) return "存在改良空间";
  return "口碑壁垒较强";
}

export function CompetitorQuadrantChart({
  competitors,
  currency,
  p50PriceCents,
  targetPriceCents,
  darkHorseAsins = [],
  benchmarkAsin,
  onSelectBenchmark,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const darkHorseSet = useMemo(
    () => new Set(darkHorseAsins.map((a) => a.toUpperCase())),
    [darkHorseAsins],
  );

  const chart = useMemo(() => {
    const valid = competitors.filter((c) => effectivePriceOf(c) > 0 && isVerifiedCompetitorField(c, "priceCents"));
    if (valid.length < 2) return null;

    const prices = valid.map(effectivePriceOf);
    if (targetPriceCents && targetPriceCents > 0) prices.push(targetPriceCents);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const pricePad = Math.max(300, Math.round((maxPrice - minPrice) * 0.22));
    const xMin = Math.max(0, minPrice - pricePad);
    const xMax = Math.max(xMin + 500, maxPrice + pricePad);

    const reviews = valid.map((c) => Math.max(0, c.reviewCount));
    const sortedReviews = [...reviews].sort((a, b) => a - b);
    const medianReviews = sortedReviews[Math.floor(sortedReviews.length / 2)] ?? 500;
    const yLogs = reviews.map(logReview);
    const yMin = Math.max(0.8, Math.min(...yLogs) - 0.55);
    const yMax = Math.max(yMin + 1.2, Math.max(...yLogs) + 0.55);

    const realSalesList = valid.map(realSalesOf).filter((n): n is number => n !== null);
    const hasAnyRealSales = realSalesList.length > 0;
    const maxSales = hasAnyRealSales ? Math.max(200, ...realSalesList) : 1;

    const round1 = (n: number) => Math.round(n * 10) / 10;
    const toX = (priceCents: number) =>
      round1(PAD.left + ((priceCents - xMin) / (xMax - xMin)) * PLOT_W);
    const toY = (reviewCount: number) =>
      round1(PAD.top + PLOT_H - ((logReview(reviewCount) - yMin) / (yMax - yMin)) * PLOT_H);

    const p50X = p50PriceCents > 0 ? toX(p50PriceCents) : PAD.left + PLOT_W / 2;
    const medY = toY(medianReviews);
    const targetX =
      targetPriceCents && targetPriceCents > 0
        ? Math.min(PAD.left + PLOT_W, Math.max(PAD.left, toX(targetPriceCents)))
        : null;

    const points = valid.map((item, idx) => {
      const sales = realSalesOf(item);
      const radius = sales !== null
        ? 11 + Math.sqrt(sales / maxSales) * 15
        : 12;
      const verified = isVerifiedCompetitorField(item, "priceCents");
      const effPrice = effectivePriceOf(item);
      const isDarkHorse = darkHorseSet.has((item.asin || "").toUpperCase());
      const isBenchmark = Boolean(benchmarkAsin && item.asin.toUpperCase() === benchmarkAsin.toUpperCase());
      return {
        idx,
        item,
        effPrice,
        realSales: sales,
        cx: toX(effPrice),
        cy: toY(item.reviewCount),
        r: Math.round(radius),
        color: ratingColor(item.rating),
        verified,
        isDarkHorse,
        isBenchmark,
      };
    });

    // 价格带分布直方图（4 档）
    const actualPrices = valid.map(effectivePriceOf);
    const actualMin = Math.min(...actualPrices);
    const actualMax = Math.max(...actualPrices);
    const bucketCount = 4;
    const step = Math.max(100, Math.ceil((actualMax - actualMin + 1) / bucketCount));
    const buckets = Array.from({ length: bucketCount }, (_, i) => {
      const lo = actualMin + i * step;
      const hi = i === bucketCount - 1 ? Math.max(actualMax, lo + step) : lo + step - 1;
      const count = actualPrices.filter((p) => (i === bucketCount - 1 ? p >= lo : p >= lo && p <= hi)).length;
      return { lo, hi, count };
    });
    const maxBucketCount = Math.max(1, ...buckets.map((b) => b.count));

    const xTicks = [xMin, Math.round((xMin + xMax) / 2), xMax];
    const yTickValues = [50, 300, 1500, 8000].filter(
      (v) => logReview(v) >= yMin && logReview(v) <= yMax,
    );

    return {
      points,
      p50X,
      medY,
      medianReviews,
      targetX,
      xTicks,
      yTickValues,
      hasAnyRealSales,
      buckets,
      maxBucketCount,
      toX,
      toY,
    };
  }, [competitors, p50PriceCents, targetPriceCents, darkHorseSet, benchmarkAsin]);

  if (!chart) {
    return (
      <section className="panel" style={{ padding: "20px 24px" }}>
        <div className="eyebrow" style={{ color: "var(--muted)" }}>市场格局四象限</div>
        <h4 style={{ margin: "4px 0 6px 0", fontSize: "15px", color: "var(--ink)" }}>
          等待真实售价与评论样本（至少需要 2 款已采集真实价格）
        </h4>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>
          为避免假数字误导定价，系统不会用估算值绘制四象限气泡图。请在 Amazon 搜索页或详情页点击 <strong>AITrade 二合一 Chrome 扩展</strong> 一键采集真实售价与评论数。
        </p>
      </section>
    );
  }

  const activePoint = chart.points[activeIndex] ?? chart.points[0]!;
  const activeItem = activePoint.item;
  const hasCouponDiscount = Boolean(
    activeItem.effectivePriceCents
    && activeItem.priceCents > 0
    && activeItem.effectivePriceCents < activeItem.priceCents,
  );

  return (
    <section className="panel quadrant-panel">
      <div className="quadrant-head">
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>市场格局四象限</div>
          <h4>券后实付价 × 评论壁垒 × 真实动销气泡图</h4>
          <p className="muted">
            横轴为券后实付价，纵轴为评论门槛（对数刻度），{chart.hasAnyRealSales ? "气泡面积代表 Amazon 官方抓到的真实月销下限" : "当前未抓到官方月销标签，气泡采用等大中性展示"}；双圈高亮代表「黑马新品 / 选定标杆」。
          </p>
        </div>
        <div className="quadrant-legend">
          <span><i className="legend-dot" style={{ background: "#b8322a" }} /> &lt;4.2星（痛点重）</span>
          <span><i className="legend-dot" style={{ background: "#8a5309" }} /> 4.2–4.5星</span>
          <span><i className="legend-dot" style={{ background: "#1f7a55" }} /> ≥4.5星（强壁垒）</span>
          <span><i className="legend-ring" /> 双圈=黑马/标杆</span>
        </div>
      </div>

      <div className="quadrant-layout">
        <div className="quadrant-svg-wrap">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="quadrant-svg"
            role="img"
            aria-label="竞品市场格局四象限气泡图"
          >
            {/* 黄金进攻区：高价 × 低评论壁垒 */}
            <rect
              x={chart.p50X}
              y={chart.medY}
              width={Math.max(0, PAD.left + PLOT_W - chart.p50X)}
              height={Math.max(0, PAD.top + PLOT_H - chart.medY)}
              fill="rgba(31, 122, 85, 0.07)"
            />
            <text
              x={Math.min(PAD.left + PLOT_W - 8, chart.p50X + 10)}
              y={PAD.top + PLOT_H - 10}
              fill="#1f7a55"
              fontSize="12"
              fontWeight="600"
            >
              高客单 · 低评论区（优先看有真实月销的黑马）
            </text>

            {/* 坐标轴边框 */}
            <line
              x1={PAD.left}
              y1={PAD.top}
              x2={PAD.left}
              y2={PAD.top + PLOT_H}
              stroke="#cfd8d1"
              strokeWidth="1"
            />
            <line
              x1={PAD.left}
              y1={PAD.top + PLOT_H}
              x2={PAD.left + PLOT_W}
              y2={PAD.top + PLOT_H}
              stroke="#cfd8d1"
              strokeWidth="1"
            />

            {/* Y 轴网格与标签 */}
            {chart.yTickValues.map((v) => {
              const y = chart.toY(v);
              return (
                <g key={v}>
                  <line
                    x1={PAD.left}
                    y1={y}
                    x2={PAD.left + PLOT_W}
                    y2={y}
                    stroke="#eef2ee"
                    strokeWidth="1"
                  />
                  <text
                    x={PAD.left - 10}
                    y={y + 4}
                    textAnchor="end"
                    fill="#5a6b61"
                    fontSize="12"
                    fontFamily="var(--font-mono), monospace"
                  >
                    {v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : v}
                  </text>
                </g>
              );
            })}

            {/* 中位线：P50 价格线与评论中位线 */}
            <line
              x1={chart.p50X}
              y1={PAD.top}
              x2={chart.p50X}
              y2={PAD.top + PLOT_H}
              stroke="#8ba194"
              strokeDasharray="4 4"
              strokeWidth="1.2"
            />
            <text
              x={chart.p50X + 6}
              y={PAD.top + 14}
              fill="#4d6055"
              fontSize="12"
              fontFamily="var(--font-mono), monospace"
            >
              P50 {moneyIn(currency, p50PriceCents)}
            </text>

            <line
              x1={PAD.left}
              y1={chart.medY}
              x2={PAD.left + PLOT_W}
              y2={chart.medY}
              stroke="#8ba194"
              strokeDasharray="4 4"
              strokeWidth="1.2"
            />
            <text
              x={PAD.left + 8}
              y={chart.medY - 6}
              fill="#4d6055"
              fontSize="12"
              fontFamily="var(--font-mono), monospace"
            >
              评论中位 {chart.medianReviews}
            </text>

            {/* 本品拟定价参考线 */}
            {chart.targetX !== null && targetPriceCents ? (
              <g>
                <line
                  x1={chart.targetX}
                  y1={PAD.top}
                  x2={chart.targetX}
                  y2={PAD.top + PLOT_H}
                  stroke="#10251c"
                  strokeDasharray="2 3"
                  strokeWidth="1.8"
                />
                <text
                  x={Math.min(PAD.left + PLOT_W - 88, chart.targetX + 6)}
                  y={PAD.top + 30}
                  fill="#10251c"
                  fontSize="12"
                  fontWeight="700"
                  fontFamily="var(--font-mono), monospace"
                >
                  拟定 {moneyIn(currency, targetPriceCents)}
                </text>
              </g>
            ) : null}

            {/* X 轴刻度 */}
            {chart.xTicks.map((tick) => (
              <text
                key={tick}
                x={chart.toX(tick)}
                y={PAD.top + PLOT_H + 22}
                textAnchor="middle"
                fill="#5a6b61"
                fontSize="12"
                fontFamily="var(--font-mono), monospace"
              >
                {moneyIn(currency, tick)}
              </text>
            ))}
            <text
              x={PAD.left + PLOT_W / 2}
              y={HEIGHT - 6}
              textAnchor="middle"
              fill="#4d6055"
              fontSize="12"
            >
              竞品券后实付价 ({currency})
            </text>
            <text
              x={16}
              y={PAD.top + PLOT_H / 2}
              textAnchor="middle"
              fill="#4d6055"
              fontSize="12"
              transform={`rotate(-90 16 ${PAD.top + PLOT_H / 2})`}
            >
              评论数（对数）
            </text>

            {/* 竞品气泡 */}
            {chart.points.map((pt) => {
              const isActive = pt.idx === activePoint.idx;
              return (
                <g
                  key={`${pt.item.asin || pt.item.title}-${pt.idx}`}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setActiveIndex(pt.idx)}
                  onClick={() => setActiveIndex(pt.idx)}
                >
                  {(pt.isDarkHorse || pt.isBenchmark) && (
                    <circle
                      cx={pt.cx}
                      cy={pt.cy}
                      r={pt.r + 5}
                      fill="none"
                      stroke={pt.isBenchmark ? "#10251c" : "#1f7a55"}
                      strokeWidth={1.6}
                      strokeDasharray={pt.isBenchmark ? undefined : "3 2"}
                    />
                  )}
                  <circle
                    cx={pt.cx}
                    cy={pt.cy}
                    r={pt.r}
                    fill={pt.color}
                    fillOpacity={isActive ? 0.34 : 0.18}
                    stroke={pt.color}
                    strokeWidth={isActive ? 2.5 : 1.6}
                    strokeDasharray={pt.verified ? undefined : "4 3"}
                  />
                  <text
                    x={pt.cx}
                    y={pt.cy + 4}
                    textAnchor="middle"
                    fill="#18221d"
                    fontSize="12"
                    fontWeight="700"
                    fontFamily="var(--font-mono), monospace"
                  >
                    #{pt.idx + 1}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* 价格带密度分布直方图 */}
          <div style={{ marginTop: "10px", padding: "10px 12px", borderRadius: "10px", background: "var(--surface)", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", fontSize: "12px", color: "var(--muted)" }}>
              <span>价格带密度分布（识别密集红海区 vs 价格真空带）</span>
              <span className="mono">{chart.points.length} 款实价样本</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {chart.buckets.map((b, i) => {
                const pct = Math.round((b.count / chart.maxBucketCount) * 100);
                const isGap = b.count === 0;
                return (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ height: "28px", display: "flex", alignItems: "flex-end", background: "var(--panel)", borderRadius: "6px", padding: "3px", border: "1px solid var(--line)" }}>
                      <div
                        style={{
                          width: "100%",
                          height: `${Math.max(isGap ? 0 : 18, pct)}%`,
                          borderRadius: "4px",
                          background: isGap ? "transparent" : "var(--green)",
                          opacity: isGap ? 0.2 : 0.72,
                        }}
                      />
                    </div>
                    <div className="mono" style={{ fontSize: "11px", color: "var(--ink)", textAlign: "center" }}>
                      {moneyIn(currency, b.lo)}–{moneyIn(currency, b.hi)}
                    </div>
                    <div style={{ fontSize: "11px", textAlign: "center", color: isGap ? "var(--green)" : "var(--muted)", fontWeight: isGap ? 600 : 400 }}>
                      {isGap ? "真空档 (0款)" : `${b.count} 款`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 右侧选中竞品详情卡 */}
        <aside className="quadrant-detail-card">
          <div className="quadrant-detail-top">
            <span className="badge badge-neutral mono">#{activePoint.idx + 1}</span>
            <span
              className="badge"
              style={{
                background: `${activePoint.color}18`,
                color: activePoint.color,
              }}
            >
              {ratingLabel(activeItem.rating)}
            </span>
            {activePoint.isDarkHorse ? (
              <span className="badge" style={{ background: "rgba(31,122,85,0.14)", color: "var(--green)" }}>黑马新品</span>
            ) : null}
            {activeItem.isSponsored ? (
              <span className="badge" style={{ background: "rgba(180,83,9,0.12)", color: "var(--amber)" }}>广告位</span>
            ) : null}
            {activeItem.fulfillmentType === "amazon_1p" ? (
              <span className="badge" style={{ background: "rgba(184,50,42,0.12)", color: "var(--red)" }}>Amazon 自营</span>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            {activeItem.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activeItem.imageUrl}
                alt={activeItem.title}
                style={{ width: "54px", height: "54px", objectFit: "contain", borderRadius: "8px", background: "var(--panel)", border: "1px solid var(--line)", flexShrink: 0 }}
              />
            ) : null}
            <div style={{ minWidth: 0 }}>
              <h5 style={{ margin: 0 }}>{activeItem.brand ? `${activeItem.brand} · ` : ""}{activeItem.title}</h5>
              {activeItem.asin ? <div className="muted mono" style={{ fontSize: 12, marginTop: "2px" }}>ASIN: {activeItem.asin}</div> : null}
            </div>
          </div>

          <div className="quadrant-detail-metrics">
            <div>
              <span>售价</span>
              <strong className="mono">{moneyIn(currency, activeItem.priceCents)}</strong>
              {activeItem.listPriceCents && activeItem.listPriceCents > activeItem.priceCents ? (
                <div style={{ fontSize: "11px", color: "var(--muted)" }}>
                  <span style={{ textDecoration: "line-through" }}>{moneyIn(currency, activeItem.listPriceCents)}</span>
                  <span style={{ color: "var(--red)", marginLeft: "4px" }}>
                    -{Math.round(((activeItem.listPriceCents - activeItem.priceCents) / activeItem.listPriceCents) * 100)}%
                  </span>
                </div>
              ) : null}
              {hasCouponDiscount ? (
                <div style={{ fontSize: "11px", color: "var(--amber)" }}>
                  券后 {moneyIn(currency, activePoint.effPrice)} (-{Math.round(((activeItem.priceCents - activePoint.effPrice) / activeItem.priceCents) * 100)}%)
                </div>
              ) : null}
            </div>
            <div>
              <span>评分</span>
              <strong className="mono">{activeItem.rating ? activeItem.rating.toFixed(1) : "—"}</strong>
            </div>
            <div>
              <span>评论数</span>
              <strong className="mono">{isVerifiedCompetitorField(activeItem, "reviewCount") ? activeItem.reviewCount.toLocaleString() : "—"}</strong>
            </div>
            <div>
              <span>官方月销</span>
              <strong className="mono">{activePoint.realSales !== null ? `${activePoint.realSales.toLocaleString()}+` : "未显示"}</strong>
            </div>
          </div>

          {onSelectBenchmark ? (
            <button
              type="button"
              className={activePoint.isBenchmark ? "button primary" : "button secondary"}
              style={{ width: "100%", marginTop: "8px", fontSize: "12px", padding: "8px 12px" }}
              onClick={() => onSelectBenchmark(activePoint.isBenchmark ? null : activeItem)}
            >
              {activePoint.isBenchmark
                ? "✓ 已设为立项主攻标杆（点击取消）"
                : "设为立项主攻标杆（带入拟定价与测算）"}
            </button>
          ) : null}

          {activeItem.drawbacks?.length ? (
            <div className="quadrant-detail-weaknesses">
              <div className="quadrant-detail-sub">核心差评痛点（反制切入点）</div>
              <ul>
                {activeItem.drawbacks.slice(0, 3).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
