"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: "ai" | "content" | "sourcing" | "data" | "settings" | "connection";
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "业务工作台",
    items: [
      { href: "/", label: "AI 选品", icon: "ai" },
      { href: "/content", label: "内容工作台", icon: "content" },
      { href: "/data-sources", label: "数据源", icon: "data" },
    ],
  },
  {
    label: "系统",
    items: [
      { href: "/connections", label: "连接中心", icon: "connection" },
      { href: "/settings", label: "系统设置", icon: "settings" },
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

  if (name === "sourcing") {
    return (
      <svg {...common}>
        <path d="m4 8 8-4 8 4-8 4-8-4Z" />
        <path d="m4 8 8 4 8-4v8l-8 4-8-4V8Z" />
        <path d="M12 12v8" />
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

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/" || pathname === "/import" || (pathname.startsWith("/cases/") && !pathname.endsWith("/content"));
  }
  if (href === "/content") {
    return pathname === "/content" || pathname.endsWith("/content");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
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
        {NAV_GROUPS.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <div className="sidebar-label">{group.label}</div>
            <div className="sidebar-links">
              {group.items.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-link${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="sidebar-icon"><NavIcon name={item.icon} /></span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
