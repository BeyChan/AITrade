"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type MarketOption = {
  code: string;
  name: string;
  currency: string;
};

type PlatformOption = {
  code: string;
  name: string;
};

type SiteScopeSwitcherProps = {
  markets: MarketOption[];
  platforms: PlatformOption[];
  selectedMarket: string;
  selectedPlatform: string;
  variant?: "default" | "topbar";
};

export function SiteScopeSwitcher({
  markets,
  platforms,
  selectedMarket,
  selectedPlatform,
  variant = "default",
}: SiteScopeSwitcherProps) {
  const router = useRouter();
  const [market, setMarket] = useState(selectedMarket);
  const [platform, setPlatform] = useState(selectedPlatform);
  const [isPending, startTransition] = useTransition();
  const isTopbar = variant === "topbar";

  useEffect(() => {
    setMarket(selectedMarket);
  }, [selectedMarket]);

  useEffect(() => {
    setPlatform(selectedPlatform);
  }, [selectedPlatform]);

  function changeScope(nextMarket: string, nextPlatform: string) {
    const params = new URLSearchParams({ market: nextMarket, platform: nextPlatform });
    startTransition(() => {
      router.push(`/?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className={`site-scope-switcher ${isTopbar ? "topbar-site-switcher" : ""}`}
      aria-label="国家与平台站点"
      aria-busy={isPending}
    >
      <span className="site-switcher-kicker">{isTopbar ? "站点" : "当前站点"}</span>
      <div className="site-switcher-fields">
        <label className="site-switcher-field" htmlFor="marketCode">
          <span>{isTopbar ? "国家" : "国家 / 市场"}</span>
          <select
            id="marketCode"
            value={market}
            disabled={isPending}
            onChange={(event) => {
              const nextMarket = event.target.value;
              setMarket(nextMarket);
              changeScope(nextMarket, platform);
            }}
          >
            {markets.map((item) => (
              <option key={item.code} value={item.code}>
                {isTopbar ? `${item.name} · ${item.code}` : `${item.name} · ${item.code} · ${item.currency}`}
              </option>
            ))}
          </select>
        </label>
        <label className="site-switcher-field" htmlFor="platformCode">
          <span>{isTopbar ? "平台" : "平台 / 站点"}</span>
          <select
            id="platformCode"
            value={platform}
            disabled={isPending}
            onChange={(event) => {
              const nextPlatform = event.target.value;
              setPlatform(nextPlatform);
              changeScope(market, nextPlatform);
            }}
          >
            {platforms.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <span className="site-switcher-status">{isPending ? "切换中…" : isTopbar ? "即时生效" : "选择后自动更新"}</span>
    </div>
  );
}
