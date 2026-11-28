"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ThemeSwitcher, type AppTheme } from "./theme-switcher";
import type { AppMode } from "@/lib/app-mode";

type SubItem = {
  href: string;
  label: string;
  badge?: string;
  dividerLabel?: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: "ai" | "competitor" | "case" | "sourcing" | "content" | "data" | "settings";
  subItems?: SubItem[];
};

const MAIN_NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "工作台",
    icon: "ai",
  },
  {
    href: "/ai-sourcing",
    label: "选品",
    icon: "competitor",
    subItems: [
      { href: "/auto-pipeline", label: "选品初筛" },
      { href: "/ai-sourcing", label: "选品看板" },
      { href: "/competitors", label: "竞品研报", dividerLabel: "分析工具" },
      { href: "/costing", label: "成本核算" },
    ],
  },
  {
    href: "/cases",
    label: "我的商品",
    icon: "case",
  },
  {
    href: "/studio",
    label: "视觉工坊",
    icon: "content",
    subItems: [
      { href: "/studio?tab=image", label: "AI 生图" },
      { href: "/studio?tab=video", label: "AI 视频" },
      { href: "/studio?tab=library", label: "统一素材库" },
    ],
  },
  {
    href: "/sourcing",
    label: "供应商管理",
    icon: "sourcing",
  },
  {
    href: "/operations",
    label: "实盘账本",
    icon: "data",
  },
];

const SETTINGS_NAV_ITEMS: NavItem[] = [
  {
    href: "/settings",
    label: "设置",
    icon: "settings",
    subItems: [
      { href: "/settings?tab=general", label: "常规设置" },
      { href: "/settings?tab=models", label: "大模型设置" },
      { href: "/settings?tab=backup", label: "数据与备份" },
      { href: "/fx-rates", label: "实时汇率" },
      { href: "/audit-logs", label: "日志" },
    ],
  },
];

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "ai") {
    return (
      <svg {...common}>
        <path d="m12 3 1.1 3.2a4.2 4.2 0 0 0 2.7 2.7L19 10l-3.2 1.1a4.2 4.2 0 0 0-2.7 2.7L12 17l-1.1-3.2a4.2 4.2 0 0 0-2.7-2.7L5 10l3.2-1.1a4.2 4.2 0 0 0 2.7-2.7L12 3Z" />
        <path d="m18.5 16 .6 1.9a2 2 0 0 0 1.3 1.3l1.6.8-1.6.8a2 2 0 0 0-1.3 1.3l-.6 1.9-.6-1.9a2 2 0 0 0-1.3-1.3l-1.6-.8 1.6-.8a2 2 0 0 0 1.3-1.3l.6-1.9Z" />
        <path d="M4 17.5h3M5.5 16v3" />
      </svg>
    );
  }

  if (name === "case") {
    return (
      <svg {...common}>
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      </svg>
    );
  }

  if (name === "competitor") {
    return (
      <svg {...common}>
        <path d="m16 16 3-8 3 8a3 3 0 0 1-6 0ZM2 16l3-8 3 8a3 3 0 0 1-6 0Z" />
        <path d="M7 21h10" />
        <path d="M12 3v18" />
        <path d="M3 7h18" />
      </svg>
    );
  }

  if (name === "content") {
    return (
      <svg {...common}>
        <path d="M5 3.5h9l5 5V20.5H5V3.5Z" />
        <path d="M14 3.5v5h5" />
        <path d="m8 16 1.1-3.1 4.7-4.7 2 2-4.7 4.7L8 16Z" />
      </svg>
    );
  }

  if (name === "sourcing") {
    return (
      <svg {...common}>
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" />
        <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
      </svg>
    );
  }

  if (name === "data") {
    return (
      <svg {...common}>
        <ellipse cx="12" cy="5" rx="7" ry="3" />
        <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.7l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.69.6 1 .3.27.68.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  );
}

function matchParentNav(item: NavItem, pathname: string): boolean {
  if (item.href === "/" && pathname === "/") return true;
  if (item.href === "/ai-sourcing" && (pathname.startsWith("/auto-pipeline") || pathname.startsWith("/ai-sourcing") || pathname.startsWith("/discover") || pathname.startsWith("/competitors") || pathname.startsWith("/costing") || pathname.startsWith("/selection-records") || pathname === "/import")) return true;
  if (item.href === "/cases" && pathname.startsWith("/cases")) return true;
  if (item.href === "/sourcing" && pathname.startsWith("/sourcing")) return true;
  if (
    item.href === "/studio" &&
    (pathname.startsWith("/studio") ||
      pathname.startsWith("/image-studio") ||
      pathname.startsWith("/video-studio") ||
      pathname.startsWith("/media-library"))
  ) return true;
  if (item.href === "/operations" && pathname.startsWith("/operations")) return true;
  if (
    item.href === "/settings" &&
    (pathname.startsWith("/settings") || pathname.startsWith("/fx-rates") || pathname.startsWith("/audit-logs"))
  ) return true;
  return false;
}

function extractActiveCaseId(pathname: string): string | null {
  const match = /^\/cases\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

function SidebarItem({
  item,
  pathname,
  currentTab,
  currentStatus,
  mode,
}: {
  item: NavItem;
  pathname: string;
  currentTab: string | null;
  currentStatus: string | null;
  mode: AppMode;
}) {
  const isMatch = matchParentNav(item, pathname);
  const [isExpanded, setIsExpanded] = useState(isMatch);
  const [currentHash, setCurrentHash] = useState("");

  // 当路由变动匹配到本组时，自动展开
  useEffect(() => {
    if (isMatch) {
      setIsExpanded(true);
    }
  }, [isMatch]);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash || "");
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, [pathname]);

  const activeCaseId = item.href === "/cases" ? extractActiveCaseId(pathname) : null;
  const caseStageItems: SubItem[] = activeCaseId
    ? [
        { href: `/cases/${activeCaseId}`, label: "商品总览与核算" },
        { href: `/cases/${activeCaseId}/sourcing`, label: "1. 锁厂定标" },
        {
          href: `/cases/${activeCaseId}/content${mode === "sandbox" ? "?preview=1" : ""}`,
          label: "2. 文案与视觉",
        },
        {
          href: `/cases/${activeCaseId}/content${mode === "sandbox" ? "?preview=1" : ""}#launch-ready`,
          label: "3. 上架就绪",
        },
        { href: `/cases/${activeCaseId}/report`, label: "立项决策战报" },
      ]
    : [];

  const hasSub = Boolean((item.subItems && item.subItems.length > 0) || caseStageItems.length > 0);

  return (
    <div className={`sidebar-item${isMatch ? " active" : ""}`} style={{ marginBottom: "2px" }}>
      <div className={`sidebar-row${isMatch ? " active" : ""}`}>
        <Link
          href={item.href}
          className={`sidebar-link${isMatch ? " active" : ""}`}
          style={{ flex: 1, minWidth: 0 }}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          <span className="sidebar-icon"><NavIcon name={item.icon} /></span>
          <span style={{ flex: 1 }}>{item.label}</span>
        </Link>

        {hasSub && (
          <button
            type="button"
            className="sidebar-chevron"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            aria-label={`展开或收起 ${item.label}`}
          >
            <span
              style={{
                display: "inline-block",
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            >
              ▸
            </span>
          </button>
        )}
      </div>

      {/* 二级菜单展开 */}
      {hasSub && isExpanded && (
        <ul className="sidebar-subnav" style={{ marginTop: "2px" }}>
          {(item.subItems ?? []).map((sub) => {
            const [subPath, subQuery] = sub.href.split("?");
            const subParams = subQuery ? new URLSearchParams(subQuery) : null;
            const subTab = subParams?.get("tab") ?? null;
            const subStatus = subParams?.get("status") ?? null;
            const defaultTab = subPath === "/settings" ? "general" : "image";

            let isSubActive = false;
            if (subTab) {
              isSubActive = pathname === subPath && (currentTab || defaultTab) === subTab;
            } else if (subStatus) {
              isSubActive = pathname === subPath && currentStatus === subStatus;
            } else if (subPath === "/cases") {
              isSubActive = pathname === "/cases" && !currentStatus;
            } else {
              isSubActive = pathname === sub.href || (sub.href !== "/" && pathname.startsWith(subPath));
            }

            return (
              <div key={sub.href + sub.label} style={{ display: "contents" }}>
                {sub.dividerLabel && (
                  <li className="sidebar-subnav-divider" aria-hidden="true">
                    <span>{sub.dividerLabel}</span>
                  </li>
                )}
                <li>
                  <Link
                    href={sub.href}
                    className={`sidebar-sublink${isSubActive ? " active" : ""}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>{sub.label}</span>
                    {sub.badge && (
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          background: "rgba(255,255,255,0.1)",
                          color: "var(--lime)",
                        }}
                      >
                        {sub.badge}
                      </span>
                    )}
                  </Link>
                </li>
              </div>
            );
          })}

          {caseStageItems.length > 0 && (
            <>
              <li className="sidebar-subnav-divider" aria-hidden="true">
                <span>当前商品阶段</span>
              </li>
              {caseStageItems.map((stageItem) => {
                const [withoutHash, rawHash] = stageItem.href.split("#");
                const stagePath = withoutHash.split("?")[0];
                const stageHash = rawHash ? `#${rawHash}` : "";
                const siblingHashes = caseStageItems
                  .map((s) => {
                    const [p, h] = s.href.split("#");
                    return p.split("?")[0] === stagePath && h ? `#${h}` : "";
                  })
                  .filter(Boolean);

                const isPathMatch =
                  stagePath === `/cases/${activeCaseId}`
                    ? pathname === stagePath
                    : pathname === stagePath || pathname.startsWith(`${stagePath}/`);

                const isStageActive = isPathMatch
                  ? stageHash
                    ? currentHash === stageHash
                    : !siblingHashes.includes(currentHash)
                  : false;

                return (
                  <li key={stageItem.href}>
                    <Link
                      href={stageItem.href}
                      onClick={() => setCurrentHash(stageHash)}
                      className={`sidebar-sublink sidebar-stage-link${isStageActive ? " active" : ""}`}
                    >
                      <span>{stageItem.label}</span>
                    </Link>
                  </li>
                );
              })}
            </>
          )}
        </ul>
      )}
    </div>
  );
}

export function AppSidebar({
  mode = "sandbox",
  initialTheme = "light",
}: {
  mode?: AppMode;
  initialTheme?: AppTheme;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const currentStatus = searchParams.get("status");

  return (
    <aside className="sidebar" data-mode={mode}>
      <Link href="/" className="brand sidebar-brand">
        <span className="brand-mark">A</span>
        <span>
          <strong>AITrade</strong>
          <small>跨境实战工作台</small>
        </span>
      </Link>

      <nav className="sidebar-nav" aria-label="主导航">
        <div>
          {MAIN_NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.href}
              item={item}
              pathname={pathname}
              currentTab={currentTab}
              currentStatus={currentStatus}
              mode={mode}
            />
          ))}
        </div>

        <div className="sidebar-utility">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <SidebarItem
              key={item.href}
              item={item}
              pathname={pathname}
              currentTab={currentTab}
              currentStatus={currentStatus}
              mode={mode}
            />
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <ThemeSwitcher initialTheme={initialTheme} />
      </div>
    </aside>
  );
}
