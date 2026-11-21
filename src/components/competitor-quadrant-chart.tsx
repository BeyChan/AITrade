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
};

const WIDTH = 760;
const HEIGHT = 360;
const PAD = { top: 48, right: 42, bottom: 50, left: 68 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

function logReview(count: number) {
  return Math.log10(Math.max(10, count + 10));
}

function ratingColor(rating: number) {
  if (rating > 0 && rating < 4.2) return "#b8322a";
  if (rating > 0 && rating < 4.5) return "#8a5309";
  return "#1f7a55";
}

function ratingLabel(rating: number) {
  if (rating > 0 && rating < 4.2) return "痛点集中 · 易切入";
  if (rating > 0 && rating < 4.5) return "存在改良空间";
  return "口碑壁垒较强";
}

export function CompetitorQuadrantChart({
  competitors,
  currency,
  p50PriceCents,
  targetPriceCents,
}: Props) {
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const chart = useMemo(() => {
    const valid = competitors.filter((c) => c.priceCents > 0 && isVerifiedCompetitorField(c, "priceCents"));
    if (valid.length < 2) return null;

    const prices = valid.map((c) => c.priceCents);
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

    const maxSales = Math.max(500, ...valid.map((c) => c.monthlySalesEst || 300));

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
      const sales = Math.max(100, item.monthlySalesEst || 300);
      const radius = 10 + Math.sqrt(sales / maxSales) * 16;
      const verified = isVerifiedCompetitorField(item, "priceCents");
      return {
        idx,
        item,
        cx: toX(item.priceCents),
        cy: toY(item.reviewCount),
        r: Math.round(radius),
        color: ratingColor(item.rating),
        verified,
      };
    });

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
      toX,
      toY,
    };
  }, [competitors, p50PriceCents, targetPriceCents]);

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

  return (
    <section className="panel quadrant-panel">
      <div className="quadrant-head">
        <div>
          <div className="eyebrow" style={{ color: "var(--green)" }}>市场格局四象限</div>
          <h4>售价 × 评论壁垒 × 痛点气泡图</h4>
          <p className="muted">
            横轴为售价，纵轴为评论门槛（对数刻度），气泡面积代表预估月销，颜色代表评分口碑；右下阴影区为「高客单 × 低评论壁垒」黄金切入带。
          </p>
        </div>
        <div className="quadrant-legend">
          <span><i className="legend-dot" style={{ background: "#b8322a" }} /> &lt;4.2星（痛点重）</span>
          <span><i className="legend-dot" style={{ background: "#8a5309" }} /> 4.2–4.5星</span>
          <span><i className="legend-dot" style={{ background: "#1f7a55" }} /> ≥4.5星（强壁垒）</span>
          <span><i className="legend-ring" /> 虚线=AI 推断价</span>
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
              黄金切入区（高客单 · 低评论壁垒）
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
              竞品售价 ({currency})
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
            <span className="badge badge-neutral">
              {activePoint.verified ? "已采集实价" : "待核实估算"}
            </span>
          </div>
          <h5>{activeItem.brand ? `${activeItem.brand} · ` : ""}{activeItem.title}</h5>
          {activeItem.asin ? <div className="muted mono" style={{ fontSize: 12 }}>ASIN: {activeItem.asin}</div> : null}

          <div className="quadrant-detail-metrics">
            <div>
              <span>售价</span>
              <strong className="mono">{moneyIn(currency, activeItem.priceCents)}</strong>
            </div>
            <div>
              <span>评分</span>
              <strong className="mono">{activeItem.rating ? activeItem.rating.toFixed(1) : "—"}</strong>
            </div>
            <div>
              <span>评论数</span>
              <strong className="mono">{activeItem.reviewCount.toLocaleString()}</strong>
            </div>
            <div>
              <span>预估月销</span>
              <strong className="mono">{activeItem.monthlySalesEst ? activeItem.monthlySalesEst.toLocaleString() : "—"}</strong>
            </div>
          </div>

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
