"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
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
  defaultMarket?: string;
  defaultPlatform?: string;
  leftSlot?: ReactNode;
};

export function TopbarSiteScope({
  markets,
  platforms,
  defaultMarket = "US",
  defaultPlatform = "amazon",
  leftSlot,
}: TopbarSiteScopeProps) {
  const searchParams = useSearchParams();

  const requestedMarket = searchParams.get("market")?.trim().toUpperCase();
  const requestedPlatform = searchParams.get("platform")?.trim().toLowerCase();

  const selectedMarket =
    markets.find((market) => market.code === requestedMarket)?.code ??
    markets.find((market) => market.code === defaultMarket)?.code ??
    markets.find((market) => market.code === "US")?.code ??
    markets[0]?.code;
  const selectedPlatform =
    platforms.find((platform) => platform.code === requestedPlatform)?.code ??
    platforms.find((platform) => platform.code === defaultPlatform)?.code ??
    platforms.find((platform) => platform.code === "amazon")?.code ??
    platforms[0]?.code;

  return (
    <div className="topbar-inner">
      <div className="topbar-left">{leftSlot}</div>
      {selectedMarket && selectedPlatform ? (
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
