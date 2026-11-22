"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getUpcomingCrossBorderMilestone } from "@/lib/market-clock";
import type { MarketIntelSnapshot } from "@/lib/market-intel";

export type InternalAlertItem = {
  id: string;
  tag: string;
  tone: "danger" | "warn" | "info" | "success";
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
};

type DashboardIntelBriefingProps = {
  marketCode: string;
  initialNowIso: string;
  initialIntel: MarketIntelSnapshot;
  internalAlerts: InternalAlertItem[];
  fxNotice?: {
    title: string;
    detail: string;
  } | null;
  embedded?: boolean;
};

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffMin = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const d = new Date(ts);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DashboardIntelBriefing({
  marketCode,
  initialNowIso,
  initialIntel,
  internalAlerts,
  fxNotice,
  embedded = false,
}: DashboardIntelBriefingProps) {
  const [intel, setIntel] = useState<MarketIntelSnapshot>(initialIntel);
  const [expanded, setExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const autoFetchedRef = useRef(false);

  const milestone = getUpcomingCrossBorderMilestone(marketCode, new Date(initialNowIso));

  useEffect(() => {
    try {
      if (localStorage.getItem("aitrade_intel_expanded") === "1") {
        setExpanded(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (autoFetchedRef.current || (!initialIntel.isStale && initialIntel.items.length > 0)) return;
    autoFetchedRef.current = true;
    let cancelled = false;
    fetch("/api/intel?auto=1", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { snapshot?: MarketIntelSnapshot } | null) => {
        if (!cancelled && data?.snapshot) {
          setIntel(data.snapshot);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialIntel.isStale, initialIntel.items.length]);

  function toggleExpanded() {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("aitrade_intel_expanded", next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/intel", { method: "POST" });
      const data = (await res.json()) as { snapshot?: MarketIntelSnapshot; error?: string };
      if (data.snapshot) setIntel(data.snapshot);
      if (!res.ok || data.error) {
        setErrorMsg(data.error || "快讯拉取失败");
      }
    } catch {
      setErrorMsg("网络异常，暂时无法拉取外部快讯");
    } finally {
      setRefreshing(false);
    }
  }

  const visibleExternal = intel.items.slice(0, fxNotice ? 3 : 4);
  const visibleInternal = internalAlerts.slice(0, 4);
  const totalCount = visibleExternal.length + visibleInternal.length + (fxNotice ? 1 : 0);

  // 提炼单行头条（优先级：站内高危/预警 > 汇率异动 > 最新外部快讯 > 旺季备货提示）
  const priorityAlert = internalAlerts.find((a) => a.tone === "danger" || a.tone === "warn");
  const headline = priorityAlert
    ? {
        tag: priorityAlert.tag,
        tone: priorityAlert.tone,
        text: `${priorityAlert.title} · ${priorityAlert.detail}`,
        href: priorityAlert.href,
        external: false,
      }
    : fxNotice
      ? {
          tag: "汇率异动",
          tone: "warn" as const,
          text: fxNotice.title,
          href: "/fx-rates",
          external: false,
        }
      : visibleExternal[0]
        ? {
            tag: visibleExternal[0].categoryLabel,
            tone: visibleExternal[0].category,
            text: `${visibleExternal[0].title}（${visibleExternal[0].source}）`,
            href: visibleExternal[0].link,
            external: true,
          }
        : {
            tag: "跨境简报",
            tone: "info" as const,
            text: `${milestone.name}（${milestone.daysLeft} 天后）· ${milestone.shippingTip}`,
            href: "",
            external: false,
          };

  return (
    <div
      className={`${embedded ? "intel-briefing-embedded" : "panel intel-briefing-panel"} ${expanded ? "is-expanded" : "is-compact"}`}
      aria-label="跨境情报简报"
    >
      {/* 始终可见的单行头条栏 */}
      <div className="intel-ticker-bar">
        <div className="intel-ticker-main">
          <span className={`intel-tag is-${headline.tone}`}>{headline.tag}</span>
          {headline.href ? (
            headline.external ? (
              <a
                href={headline.href}
                target="_blank"
                rel="noreferrer noopener"
                className="intel-ticker-link"
              >
                {headline.text}
              </a>
            ) : (
              <Link href={headline.href} className="intel-ticker-link">
                {headline.text}
              </Link>
            )
          ) : (
            <span className="intel-ticker-text">{headline.text}</span>
          )}
        </div>

        <div className="intel-ticker-right">
          <span
            className="intel-ticker-milestone"
            title={`${milestone.name}（${milestone.dateText}）· ${milestone.shippingTip}`}
          >
            {milestone.name.replace(/\s*\([^)]*\)/g, "")} ·{" "}
            <strong>{milestone.daysLeft === 0 ? "今天" : `${milestone.daysLeft}天后`}</strong>
          </span>
          {expanded ? (
            <button
              type="button"
              className="intel-ticker-btn"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              {refreshing ? "拉取中…" : "刷新"}
            </button>
          ) : null}
          <button
            type="button"
            className="intel-ticker-btn is-toggle"
            onClick={toggleExpanded}
            aria-expanded={expanded}
          >
            {expanded ? "收起 ▴" : `全部情报${totalCount > 0 ? ` (${totalCount})` : ""} ▾`}
          </button>
        </div>
      </div>

      {errorMsg ? <div className="intel-error-bar">{errorMsg}</div> : null}

      {/* 展开后显示双栏完整情报 */}
      {expanded ? (
        <div className="intel-briefing-grid">
          <div className="intel-col">
            <div className="intel-col-head">
              <span className="intel-col-title">外部行业快讯</span>
              <span className="intel-col-meta">
                {intel.updatedAt ? `更新于 ${formatRelativeTime(intel.updatedAt)}` : "平台政策 · 物流船期 · 关税动态"}
              </span>
            </div>

            <div className="intel-list">
              {fxNotice ? (
                <Link href="/fx-rates" className="intel-item is-highlight">
                  <span className="intel-tag is-warn">汇率异动</span>
                  <div className="intel-item-body">
                    <strong>{fxNotice.title}</strong>
                    <span>{fxNotice.detail}</span>
                  </div>
                  <span className="intel-item-arrow">查看 →</span>
                </Link>
              ) : null}

              {visibleExternal.length > 0 ? (
                visibleExternal.map((item) => (
                  <a
                    key={item.id}
                    href={item.link}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="intel-item"
                  >
                    <span className={`intel-tag is-${item.category}`}>{item.categoryLabel}</span>
                    <div className="intel-item-body">
                      <strong>{item.title}</strong>
                      <span>
                        {item.source}
                        {item.publishedAt ? ` · ${formatRelativeTime(item.publishedAt)}` : ""}
                      </span>
                    </div>
                    <span className="intel-item-arrow">↗</span>
                  </a>
                ))
              ) : (
                <div className="intel-empty">
                  {refreshing ? "正在聚合最新跨境快讯…" : "暂无缓存快讯，点击右上角「刷新」拉取最新行业动态。"}
                </div>
              )}
            </div>
          </div>

          <div className="intel-col">
            <div className="intel-col-head">
              <span className="intel-col-title">站内经营异动</span>
              <span className="intel-col-meta">利润门禁 · 竞品变化 · FBA 库存</span>
            </div>

            <div className="intel-list">
              {visibleInternal.length > 0 ? (
                visibleInternal.map((alert) => (
                  <Link key={alert.id} href={alert.href} className="intel-item">
                    <span className={`intel-tag is-${alert.tone}`}>{alert.tag}</span>
                    <div className="intel-item-body">
                      <strong>{alert.title}</strong>
                      <span>{alert.detail}</span>
                    </div>
                    <span className="intel-item-arrow">{alert.actionLabel} →</span>
                  </Link>
                ))
              ) : (
                <div className="intel-empty is-ok">
                  当前站点暂无利润破线或断货红灯，在办商品均处于健康区间。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
