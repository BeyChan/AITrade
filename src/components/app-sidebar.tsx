"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeSwitcher } from "./mode-switcher";
import type { AppMode } from "@/lib/app-mode";

type SubItem = {
  href: string;
  label: string;
  badge?: string;
};

type NavItem = {
  href: string;
  label: string;
  icon: "ai" | "verify" | "competitor" | "case" | "sourcing" | "content" | "inbox" | "data" | "settings" | "connection";
  subItems?: SubItem[];
};

const MAIN_NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "工作台大盘",
    icon: "ai",
    subItems: [
      { href: "/", label: "5 阶流水线看板" },
      { href: "/#todos", label: "今日行动待办" },
    ],
  },
  {
    href: "/competitors",
    label: "选品与研报",
    icon: "competitor",
    subItems: [
      { href: "/competitors", label: "竞品多维横评 PK" },
      { href: "/import", label: "批量录入/导入商品" },
      { href: "/ai-sourcing", label: "AI 类目假设推演" },
    ],
  },
  {
    href: "/cases",
    label: "商品工作台",
    icon: "case",
    subItems: [
      { href: "/cases", label: "全部立项案卷" },
      { href: "/cases?status=approved", label: "已立项通过" },
      { href: "/cases?status=review_pending", label: "待财务定标" },
    ],
  },
  {
    href: "/sourcing",
    label: "寻源与供应商",
    icon: "sourcing",
    subItems: [
      { href: "/sourcing", label: "供应商资产名录" },
      { href: "/sourcing?view=candidates", label: "1688 寻源候选" },
    ],
  },
  {
    href: "/content",
    label: "内容与上架",
    icon: "content",
    subItems: [
      { href: "/content", label: "反制五点文案打磨" },
      { href: "/cases", label: "批量导出 Flat File" },
    ],
  },
];

const SETTINGS_NAV_ITEMS: NavItem[] = [
  { href: "/connections", label: "店铺连接", icon: "connection" },
  { href: "/settings", label: "大模型设置", icon: "settings" },
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

  if (name === "verify") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4M8 11h6M11 8v6" />
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

  if (name === "inbox") {
    return (
      <svg {...common}>
        <path d="M3.5 13.5h4l1.5 2.5h6l1.5-2.5h4" />
        <path d="M5.5 5.5h13l2 8v5H3.5v-5l2-8Z" />
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

  if (name === "settings") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.7l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.5 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.69.6 1 .3.27.68.42 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
      </svg>
    );
  }

  if (name === "connection") {
    return (
      <svg {...common}>
        <path d="M9.5 14.5 14.5 9" />
        <path d="m7 16 1.4-1.4M16 8l1-1" />
        <path d="M10.5 6.5 12 5a4.2 4.2 0 0 1 6 6l-1.5 1.5" />
        <path d="M13.5 17.5 12 19a4.2 4.2 0 0 1-6-6l1.5-1.5" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M4 19V9" />
      <path d="M10 19V5" />
      <path d="M16 19v-7" />
      <path d="M22 19V3" />
    </svg>
  );
}

function matchParentNav(item: NavItem, pathname: string): boolean {
  if (item.href === "/" && pathname === "/") return true;
  if (item.href === "/competitors" && (pathname.startsWith("/competitors") || pathname === "/import" || pathname.startsWith("/ai-sourcing"))) return true;
  if (item.href === "/cases" && pathname.startsWith("/cases")) return true;
  if (item.href === "/sourcing" && pathname.startsWith("/sourcing")) return true;
  if (item.href === "/content" && (pathname.startsWith("/content") || pathname.startsWith("/approvals"))) return true;
  if (item.href === "/connections" && pathname.startsWith("/connections")) return true;
  if (item.href === "/settings" && pathname.startsWith("/settings")) return true;
  return false;
}

function SidebarItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const isMatch = matchParentNav(item, pathname);
  const [isExpanded, setIsExpanded] = useState(isMatch);

  // 当路由变动匹配到本组时，自动展开
  useEffect(() => {
    if (isMatch) {
      setIsExpanded(true);
    }
  }, [isMatch]);

  const hasSub = Boolean(item.subItems && item.subItems.length > 0);

  return (
    <div className={`sidebar-item${isMatch ? " active" : ""}`} style={{ marginBottom: "2px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Link
          href={item.href}
          className={`sidebar-link${isMatch ? " active" : ""}`}
          style={{ flex: 1 }}
          aria-current={pathname === item.href ? "page" : undefined}
        >
          <span className="sidebar-icon"><NavIcon name={item.icon} /></span>
          <span style={{ flex: 1 }}>{item.label}</span>
        </Link>

        {hasSub && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsExpanded((prev) => !prev);
            }}
            aria-label={`展开或收起 ${item.label}`}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255, 255, 255, 0.4)",
              cursor: "pointer",
              padding: "6px 8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              transition: "transform 0.2s ease, color 0.15s ease",
            }}
          >
            <span
              style={{
                display: "inline-block",
                transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            >
              ▶
            </span>
          </button>
        )}
      </div>

      {/* 二级菜单展开 */}
      {hasSub && isExpanded && (
        <ul className="sidebar-subnav" style={{ marginTop: "2px" }}>
          {item.subItems!.map((sub) => {
            const isSubActive =
              pathname === sub.href ||
              (sub.href !== "/" && pathname.startsWith(sub.href.split("?")[0]));

            return (
              <li key={sub.href + sub.label}>
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
                        fontSize: "9px",
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
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AppSidebar({ mode = "sandbox" }: { mode?: AppMode }) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <Link href="/" className="brand sidebar-brand">
        <span className="brand-mark">A</span>
        <span>
          <strong>AITrade</strong>
          <small>Cross-border Ops</small>
        </span>
      </Link>

      <nav className="sidebar-nav" aria-label="主导航">
        <div style={{ marginBottom: "14px" }}>
          <div
            style={{
              padding: "0 12px 6px 12px",
              fontSize: "10px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "rgba(255, 255, 255, 0.35)",
            }}
          >
            业务全生命周期
          </div>
          {MAIN_NAV_ITEMS.map((item) => (
            <SidebarItem key={item.href} item={item} pathname={pathname} />
          ))}
        </div>

        <div className="sidebar-utility">
          <div
            style={{
              padding: "0 12px 6px 12px",
              fontSize: "10px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "rgba(255, 255, 255, 0.35)",
            }}
          >
            设置
          </div>
          {SETTINGS_NAV_ITEMS.map((item) => (
            <SidebarItem key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      </nav>

      <div className="sidebar-footer">
        <ModeSwitcher currentMode={mode} />
      </div>
    </aside>
  );
}
