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

  if (pathname !== "/") return null;

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

  if (!selectedMarket || !selectedPlatform) return null;

  return (
    <SiteScopeSwitcher
      markets={markets}
      platforms={platforms}
      selectedMarket={selectedMarket}
      selectedPlatform={selectedPlatform}
      variant="topbar"
    />
  );
}
