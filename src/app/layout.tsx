import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { Noto_Sans_SC, JetBrains_Mono } from "next/font/google";
import { AppSidebar } from "@/components/app-sidebar";
import type { AppTheme } from "@/components/theme-switcher";
import { SandboxBanner } from "@/components/sandbox-banner";
import { TopbarSiteScope } from "@/components/topbar-site-scope";
import { WorkContextBar } from "@/components/work-context-bar";
import { GlobalSearch } from "@/components/global-search";
import { getAppMode } from "@/lib/app-mode";
import { getCurrentMember } from "@/lib/operator";
import { getSiteOptions } from "@/lib/repository";
import { loadWorkContext } from "@/lib/work-context";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import "./globals.css";

export const metadata: Metadata = {
  title: "AITrade · 跨境电商 AI 工作台",
  description: "从选品、成本模型、供应商定标到内容发布预检的可审计工作流。",
};

// 自托管字体：消除外链请求与布局抖动，并保证 Windows 上不再退回字形更差的微软雅黑。
// 中文用 Noto Sans SC，数字与拉丁用 JetBrains Mono（对账类产品需要等宽数字）。
const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700", "800"],
  display: "swap",
  variable: "--font-sans",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  variable: "--font-mono",
  preload: false,
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // PGlite is process-local and must not be opened by parallel build workers.
  await connection();
  const [options, workContext, mode, persistedScope, cookieStore, currentMember] = await Promise.all([
    getSiteOptions(),
    loadWorkContext().catch(() => []),
    getAppMode(),
    resolvePersistedSiteScope(),
    cookies(),
    getCurrentMember(),
  ]);
  const initialTheme: AppTheme = cookieStore.get("aitrade_theme")?.value === "dark" ? "dark" : "light";
  const markets = options.markets.map(({ code, name, currency }) => ({ code, name, currency }));
  const platforms = options.platforms.map(({ code, name }) => ({ code, name }));

  // 浏览器扩展（如沉浸式翻译）会在 hydration 前往 <html> 注入 data-* 属性，
  // 造成与服务端 HTML 不一致的误报；仅抑制该元素的属性差异警告。
  return (
    <html
      lang="zh-CN"
      data-theme={initialTheme}
      suppressHydrationWarning
      className={`${notoSansSC.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        <div className="app-shell" data-mode={mode}>
          <Suspense fallback={<aside className="sidebar" />}>
            <AppSidebar
              mode={mode}
              initialTheme={initialTheme}
              initialOperator={currentMember.name}
              initialRole={currentMember.role}
            />
          </Suspense>
          <div className="app-workspace">
            <SandboxBanner mode={mode} />
            <header className="topbar">
              <Suspense fallback={<div className="topbar-inner" />}>
                <TopbarSiteScope
                  markets={markets}
                  platforms={platforms}
                  defaultMarket={persistedScope.marketCode}
                  defaultPlatform={persistedScope.platformCode}
                  leftSlot={<WorkContextBar items={workContext} />}
                />
              </Suspense>
            </header>
            <main>{children}</main>
            <GlobalSearch />
          </div>
        </div>
      </body>
    </html>
  );
}
