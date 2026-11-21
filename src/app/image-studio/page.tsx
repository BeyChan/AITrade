import Link from "next/link";
import { StandaloneImageStudioClient } from "@/components/standalone-image-studio-client";
import { getImageProviderStatus } from "@/lib/image-provider";
import { listAvailableImageSkills } from "@/lib/image-skills";
import { getSiteOptions, listSourcingCases } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string }>;
};

export default async function StandaloneImageStudioPage({ searchParams }: PageProps) {
  const [query, options, skills, providerStatus, initialAssets, sourcingCases] = await Promise.all([
    searchParams,
    getSiteOptions(),
    listAvailableImageSkills(),
    getImageProviderStatus(),
    listStandaloneStudioAssets(),
    listSourcingCases(),
  ]);
  const siteScope = await resolvePersistedSiteScope(query.market, query.platform);
  const selectedMarket =
    options.markets.find((market) => market.code === siteScope.marketCode) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];

  const cases = sourcingCases.map((entry) => ({
    id: entry.productCase.id,
    asin: entry.productCase.asin,
    title: entry.productCase.title,
    marketplace: entry.productCase.marketplace || "US",
    hasSelection: Boolean(entry.selection),
  }));

  const marketCode = selectedMarket?.code ?? "US";
  const marketName = selectedMarket?.name ?? "美国";

  return (
    <div className="page">
      <header className="studio-topbar">
        <div className="studio-topbar-title">
          <h1>AI 生图工坊</h1>
          <span className="badge badge-neutral">{marketName} · {marketCode}</span>
          <span
            className={`badge ${
              providerStatus.provider !== "template" && providerStatus.configured
                ? "badge-success"
                : "badge-neutral"
            }`}
          >
            {providerStatus.label} · {providerStatus.model}
          </span>
        </div>
        <div className="button-row">
          <Link href="/settings" className="button secondary">配置生图模型</Link>
          <Link href="/content" className="button ghost">内容工作台</Link>
        </div>
      </header>

      <StandaloneImageStudioClient
        skills={skills}
        providerStatus={providerStatus}
        initialAssets={initialAssets}
        cases={cases}
        activeMarketCode={marketCode}
        activeMarketName={marketName}
      />
    </div>
  );
}
