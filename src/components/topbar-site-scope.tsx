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
      {pathname === "/" && selectedMarket && selectedPlatform ? (
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
  if (pathname === "/") return "商品机会";
  if (pathname === "/import") return "导入数据";
  if (pathname.startsWith("/cases/")) return "商品工作台";
  if (pathname === "/sourcing") return "供应商询价";
  if (pathname === "/data-sources") return "数据源";
  if (pathname === "/approvals") return "审批中心";
  if (pathname === "/connections") return "连接中心";
  return "AITrade";
}
