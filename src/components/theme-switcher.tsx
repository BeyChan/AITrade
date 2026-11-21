"use client";

import { useEffect, useState } from "react";

export type AppTheme = "light" | "dark";

export function ThemeSwitcher({ initialTheme = "light" }: { initialTheme?: AppTheme }) {
  const [theme, setTheme] = useState<AppTheme>(initialTheme);

  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("theme");
    if (param === "dark" || param === "light") {
      setTheme(param);
      document.documentElement.dataset.theme = param;
      return;
    }
    const saved = window.localStorage.getItem("aitrade-theme");
    if (saved === "dark" || saved === "light") {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    } else {
      document.documentElement.dataset.theme = initialTheme;
    }
  }, [initialTheme]);

  function applyTheme(next: AppTheme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("aitrade-theme", next);
      document.cookie = `aitrade_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // 忽略本地存储受限场景
    }
  }

  return (
    <div className="theme-switcher" role="group" aria-label="外观模式切换">
      <button
        type="button"
        data-theme-opt="light"
        className={`theme-seg-btn${theme === "light" ? " is-active" : ""}`}
        onClick={() => applyTheme("light")}
        title="切换至白天模式"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
        <span>白天</span>
      </button>
      <button
        type="button"
        data-theme-opt="dark"
        className={`theme-seg-btn${theme === "dark" ? " is-active" : ""}`}
        onClick={() => applyTheme("dark")}
        title="切换至黑夜模式"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
        <span>黑夜</span>
      </button>
    </div>
  );
}
