import Link from "next/link";
import { StandaloneVideoStudioClient } from "@/components/standalone-video-studio-client";
import { PageHeader } from "@/components/ui";
import { getContentDetail, getSiteOptions, listSourcingCases } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";
import { listStandaloneVideoAssets } from "@/lib/standalone-video-studio";
import { isFfmpegAvailable, listVideoJobsForCase } from "@/lib/video-jobs";
import { getVideoProviderStatus } from "@/lib/video-provider";
import { listAvailableVideoSkills } from "@/lib/video-skills";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ caseId?: string; market?: string; platform?: string }>;
};

export default async function StandaloneVideoStudioPage({ searchParams }: PageProps) {
  const [query, options, providerStatus, initialAssets, initialJobs, studioImages, ffmpegReady, videoSkills, sourcingCases] =
    await Promise.all([
      searchParams,
      getSiteOptions(),
      getVideoProviderStatus(),
      listStandaloneVideoAssets(),
      listVideoJobsForCase("standalone").catch(() => []),
      listStandaloneStudioAssets(),
      isFfmpegAvailable(),
      listAvailableVideoSkills(),
      listSourcingCases(),
    ]);
  const linkedCaseDetail = query.caseId ? await getContentDetail(query.caseId).catch(() => null) : null;
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
  }));

  const caseQuickImages = (linkedCaseDetail?.assets ?? [])
    .filter((a) => a.asset_type !== "product_video")
    .map((a) => ({
      id: `case:${a.id}`,
      fileUrl: a.file_url,
      label: typeof a.metadata?.originalName === "string" ? a.metadata.originalName : a.asset_type,
      sublabel: a.status === "approved" ? "案卷已审主图" : "案卷底图",
    }));

  const marketCode = selectedMarket?.code ?? "US";
  const marketName = selectedMarket?.name ?? "美国";

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "内容工作台", href: "/content" },
          { label: "AI 视频工坊" },
        ]}
        title="AI 视频工坊"
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
            <span className={`badge ${ffmpegReady ? "badge-success" : "badge-neutral"}`}>
              {ffmpegReady ? "ffmpeg 已就绪" : "未检测到 ffmpeg"}
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
            <Link href="/settings" className="button secondary">配置视频模型</Link>
          </>
        }
      />

      <StandaloneVideoStudioClient
        initialAssets={initialAssets}
        initialJobs={initialJobs}
        studioImages={studioImages}
        caseQuickImages={caseQuickImages}
        providerStatus={providerStatus}
        initialSkills={videoSkills}
        cases={cases}
        initialCaseId={query.caseId ?? ""}
        ffmpegReady={ffmpegReady}
        activeMarketCode={marketCode}
      />
    </div>
  );
}
