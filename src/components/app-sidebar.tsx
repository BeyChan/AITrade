"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: "opportunity" | "sourcing" | "data" | "approval" | "connection";
};

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "业务工作台",
    items: [
      { href: "/", label: "商品机会", icon: "opportunity" },
      { href: "/sourcing", label: "供应商询价", icon: "sourcing" },
      { href: "/data-sources", label: "数据源", icon: "data" },
    ],
  },
  {
    label: "协作与治理",
    items: [
      { href: "/approvals", label: "审批中心", icon: "approval" },
      { href: "/connections", label: "连接中心", icon: "connection" },
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

  if (name === "sourcing") {
    return (
      <svg {...common}>
        <path d="m4 8 8-4 8 4-8 4-8-4Z" />
        <path d="m4 8 8 4 8-4v8l-8 4-8-4V8Z" />
        <path d="M12 12v8" />
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

  if (name === "approval") {
    return (
      <svg {...common}>
        <path d="M9 11.5 11 14l4-5" />
        <path d="M6 3h9l3 3v15H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
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
    return pathname === "/" || pathname === "/import" || pathname.startsWith("/cases/");
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
