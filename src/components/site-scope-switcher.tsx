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
  api_name: string | null;
};

type SiteScopeSwitcherProps = {
  markets: MarketOption[];
  platforms: PlatformOption[];
  selectedMarket: string;
  selectedPlatform: string;
};

export function SiteScopeSwitcher({
  markets,
  platforms,
  selectedMarket,
  selectedPlatform,
}: SiteScopeSwitcherProps) {
  const router = useRouter();
  const [market, setMarket] = useState(selectedMarket);
  const [platform, setPlatform] = useState(selectedPlatform);
  const [isPending, startTransition] = useTransition();

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
    <div className="hero-site-switcher" aria-label="国家与平台站点" aria-busy={isPending}>
      <div className="site-switcher-heading">
        <span className="site-switcher-kicker">当前站点</span>
        <span className="site-switcher-status">{isPending ? "正在切换…" : "选择后自动更新"}</span>
      </div>
      <div className="site-switcher-fields">
        <label className="site-switcher-field" htmlFor="marketCode">
          <span>国家 / 市场</span>
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
                {item.name} · {item.code} · {item.currency}
              </option>
            ))}
          </select>
        </label>
        <label className="site-switcher-field" htmlFor="platformCode">
          <span>平台 / 站点</span>
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
                {item.name}{item.api_name ? ` · ${item.api_name}` : " · 人工导出"}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
