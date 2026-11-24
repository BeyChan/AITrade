"use client";

import { usePathname, useRouter } from "next/navigation";
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
  locked?: boolean;
  lockReason?: string;
};

export function SiteScopeSwitcher({
  markets,
  platforms,
  selectedMarket,
  selectedPlatform,
  variant = "default",
  locked = false,
  lockReason = "当前页面已按候选口径锁定站点",
}: SiteScopeSwitcherProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [market, setMarket] = useState(selectedMarket);
  const [platform, setPlatform] = useState(selectedPlatform);
  const [isPending, startTransition] = useTransition();
  const isTopbar = variant === "topbar";
  const isDisabled = isPending || locked;

  useEffect(() => {
    setMarket(selectedMarket);
  }, [selectedMarket]);

  useEffect(() => {
    setPlatform(selectedPlatform);
  }, [selectedPlatform]);

  function changeScope(nextMarket: string, nextPlatform: string) {
    try {
      document.cookie = `aitrade_site_market=${encodeURIComponent(nextMarket)}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `aitrade_site_platform=${encodeURIComponent(nextPlatform)}; path=/; max-age=31536000; SameSite=Lax`;
      localStorage.setItem("aitrade_site_market", nextMarket);
      localStorage.setItem("aitrade_site_platform", nextPlatform);
    } catch {}

    const currentParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    currentParams.set("market", nextMarket);
    currentParams.set("platform", nextPlatform);
    startTransition(() => {
      router.push(`${pathname}?${currentParams.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  return (
    <div
      className={`site-scope-switcher ${isTopbar ? "topbar-site-switcher" : ""}`}
      aria-label="国家与平台站点"
      aria-busy={isPending}
      title={locked ? lockReason : undefined}
    >
      {isTopbar ? null : <span className="site-switcher-kicker">当前站点</span>}
      <div className="site-switcher-fields">
        {isTopbar ? (
          <>
            <TopbarScopeSelect
              id="topbar-market-code"
              ariaLabel="国家与市场"
              value={market}
              disabled={isDisabled}
              options={markets.map((item) => ({ value: item.code, label: `${item.name} · ${item.code}` }))}
              onChange={(next) => {
                setMarket(next);
                changeScope(next, platform);
              }}
            />
            <TopbarScopeSelect
              id="topbar-platform-code"
              ariaLabel="平台与站点"
              value={platform}
              disabled={isDisabled}
              options={platforms.map((item) => ({ value: item.code, label: item.name }))}
              onChange={(next) => {
                setPlatform(next);
                changeScope(market, next);
              }}
            />
          </>
        ) : (
          <>
            <label className="site-switcher-field" htmlFor="marketCode">
              <span>国家 / 市场</span>
              <select
                id="marketCode"
                aria-label="国家与市场"
                value={market}
                disabled={isDisabled}
                onChange={(event) => {
                  const nextMarket = event.target.value;
                  setMarket(nextMarket);
                  changeScope(nextMarket, platform);
                }}
              >
                {markets.map((item) => (
                  <option key={item.code} value={item.code}>
                    {`${item.name} · ${item.code} · ${item.currency}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="site-switcher-field" htmlFor="platformCode">
              <span>平台 / 站点</span>
              <select
                id="platformCode"
                aria-label="平台与站点"
                value={platform}
                disabled={isDisabled}
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
          </>
        )}
      </div>
      {isTopbar ? null : (
        <span className="site-switcher-status">
          {locked ? "已按候选口径锁定" : isPending ? "切换中…" : "选择后自动更新"}
        </span>
      )}
    </div>
  );
}

type TopbarScopeSelectProps = {
  id: string;
  ariaLabel: string;
  value: string;
  disabled: boolean;
  options: Array<{ value: string; label: string }>;
  onChange: (next: string) => void;
};

/** Compact topbar variant: the width follows the selected label, so the chevron sits next to the text. */
function TopbarScopeSelect({ id, ariaLabel, value, disabled, options, onChange }: TopbarScopeSelectProps) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <label className={`site-switcher-field topbar-scope-field${disabled ? " is-locked" : ""}`} htmlFor={id}>
      <span className="topbar-scope-control">
        <span className="topbar-scope-value" aria-hidden="true">{selectedLabel}</span>
        {disabled ? (
          <svg className="topbar-scope-lock-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M3.5 5V3.8a2.5 2.5 0 0 1 5 0V5M3 5h6v5H3z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg className="topbar-scope-chevron" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        <select
          id={id}
          aria-label={ariaLabel}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </span>
    </label>
  );
}
