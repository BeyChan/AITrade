"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { SiteScopeSwitcher } from "@/components/site-scope-switcher";

type MarketOption = {
  code: string;
  name: string;
  currency: string;
};

type PlatformOption = {
  code: string;
  name: string;
};

type TopbarSiteScopeProps = {
  markets: MarketOption[];
  platforms: PlatformOption[];
};

export function TopbarSiteScope({ markets, platforms }: TopbarSiteScopeProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sectionLabel = getSectionLabel(pathname);

  const requestedMarket = searchParams.get("market")?.trim().toUpperCase();
  const requestedPlatform = searchParams.get("platform")?.trim().toLowerCase();
  const selectedMarket =
    markets.find((market) => market.code === requestedMarket)?.code ??
    markets.find((market) => market.code === "US")?.code ??
    markets[0]?.code;
  const selectedPlatform =
    platforms.find((platform) => platform.code === requestedPlatform)?.code ??
    platforms.find((platform) => platform.code === "amazon")?.code ??
    platforms[0]?.code;

  return (
    <div className="topbar-inner">
      <div className="topbar-context">{sectionLabel}</div>
      {(pathname === "/" || pathname.startsWith("/competitors")) && selectedMarket && selectedPlatform ? (
        <SiteScopeSwitcher
          markets={markets}
          platforms={platforms}
          selectedMarket={selectedMarket}
          selectedPlatform={selectedPlatform}
          variant="topbar"
        />
      ) : null}
    </div>
  );
}

function getSectionLabel(pathname: string) {
  if (pathname === "/") return "工作台";
  if (pathname.startsWith("/ai-sourcing")) return "选品验证";
  if (pathname.startsWith("/competitors")) return "竞品对比";
  if (pathname.startsWith("/ai-inbox")) return "证据收件箱";
  if (pathname.startsWith("/cases/")) {
    if (/\/sourcing(\/|$)/.test(pathname)) return "供应商 · 商品详情";
    if (/\/content(\/|$)|\/channels(\/|$)/.test(pathname)) return "内容与上架 · 商品详情";
    return "商品工作台";
  }
  if (pathname === "/import" || pathname.startsWith("/data-sources")) return "数据导入";
  if (pathname.startsWith("/sourcing")) return "供应商";
  if (pathname.startsWith("/content") || pathname.startsWith("/approvals")) return "内容与上架";
  if (pathname.startsWith("/connections")) return "连接中心";
  if (pathname.startsWith("/settings")) return "系统设置";
  return "AITrade";
}
