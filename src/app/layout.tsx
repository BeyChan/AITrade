import type { Metadata } from "next";
import { Suspense } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { TopbarSiteScope } from "@/components/topbar-site-scope";
import { getSiteOptions } from "@/lib/repository";
import "./globals.css";

export const metadata: Metadata = {
  title: "AITrade · 跨境电商 AI 工作台",
  description: "从选品、成本模型、供应商定标到内容发布预检的可审计工作流。",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const options = await getSiteOptions();
  const markets = options.markets.map(({ code, name, currency }) => ({ code, name, currency }));
  const platforms = options.platforms.map(({ code, name }) => ({ code, name }));

  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <AppSidebar />
          <div className="app-workspace">
            <header className="topbar">
              <Suspense fallback={<div className="topbar-inner" />}>
                <TopbarSiteScope markets={markets} platforms={platforms} />
              </Suspense>
            </header>
            <main>{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
