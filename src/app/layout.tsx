import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
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
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark">A</span>
              <span>
                <strong>AITrade</strong>
                <small>Cross-border Ops</small>
              </span>
            </Link>
            <nav className="nav" aria-label="主导航">
              <Link href="/">商品机会</Link>
              <Link href="/approvals">审批中心</Link>
              <Link href="/sourcing">供应商询价</Link>
              <Link href="/data-sources">数据源</Link>
              <Link href="/connections">连接中心</Link>
            </nav>
            <div className="topbar-actions">
              <Suspense fallback={null}>
                <TopbarSiteScope markets={markets} platforms={platforms} />
              </Suspense>
              <div className="environment-pill">
                <span className="dot" />
                P1.1 · 连接验证
              </div>
            </div>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
