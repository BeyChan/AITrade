import Link from "next/link";
import { StandaloneImageStudioClient } from "@/components/standalone-image-studio-client";
import { PageHeader } from "@/components/ui";
import { getImageProviderStatus } from "@/lib/image-provider";
import { listAvailableImageSkills } from "@/lib/image-skills";
import { getSiteOptions, listSourcingCases } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ caseId?: string; market?: string; platform?: string }>;
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
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "内容工作台", href: "/content" },
          { label: "AI 生图工坊" },
        ]}
        title="AI 生图工坊"
        titleBadges={
          <>
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
          </>
        }
        actions={
          <>
            {query.caseId ? (
              <Link href={`/cases/${encodeURIComponent(query.caseId)}/content`} className="button primary">
                ← 返回商品案卷
              </Link>
            ) : null}
            <Link href="/settings" className="button secondary">配置生图模型</Link>
          </>
        }
      />

      <StandaloneImageStudioClient
        skills={skills}
        providerStatus={providerStatus}
        initialAssets={initialAssets}
        cases={cases}
        initialCaseId={query.caseId ?? ""}
        activeMarketCode={marketCode}
        activeMarketName={marketName}
      />
    </div>
  );
}
