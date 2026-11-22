"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { SiteScopeSwitcher } from "@/components/site-scope-switcher";
import { TopbarFxWidget } from "@/components/topbar-fx-widget";
import type { FxRatesSnapshot } from "@/lib/fx-rates";

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
  fxSnapshot?: FxRatesSnapshot;
  initialNowIso?: string;
};

export function TopbarSiteScope({
  markets,
  platforms,
  defaultMarket = "US",
  defaultPlatform = "amazon",
  leftSlot,
  fxSnapshot,
  initialNowIso,
}: TopbarSiteScopeProps) {
  const searchParams = useSearchParams();

  const requestedMarket = searchParams.get("market")?.trim().toUpperCase();
  const requestedPlatform = searchParams.get("platform")?.trim().toLowerCase();

  const selectedMarketOption =
    markets.find((market) => market.code === requestedMarket) ??
    markets.find((market) => market.code === defaultMarket) ??
    markets.find((market) => market.code === "US") ??
    markets[0];
  const selectedMarket = selectedMarketOption?.code;
  const selectedCurrency = selectedMarketOption?.currency ?? "USD";
  const selectedPlatform =
    platforms.find((platform) => platform.code === requestedPlatform)?.code ??
    platforms.find((platform) => platform.code === defaultPlatform)?.code ??
    platforms.find((platform) => platform.code === "amazon")?.code ??
    platforms[0]?.code;

  return (
    <div className="topbar-inner">
      <div className="topbar-left">{leftSlot}</div>
      <div className="topbar-right">
        {fxSnapshot ? (
          <TopbarFxWidget
            currency={selectedCurrency}
            marketCode={selectedMarket ?? "US"}
            initialNowIso={initialNowIso}
            initialSnapshot={fxSnapshot}
          />
        ) : null}
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
    </div>
  );
}
