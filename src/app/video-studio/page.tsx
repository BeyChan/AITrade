import Link from "next/link";
import { StandaloneVideoStudioClient } from "@/components/standalone-video-studio-client";
import { getSiteOptions } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";
import { listStandaloneVideoAssets } from "@/lib/standalone-video-studio";
import { isFfmpegAvailable, listVideoJobsForCase } from "@/lib/video-jobs";
import { getVideoProviderStatus } from "@/lib/video-provider";
import { listAvailableVideoSkills } from "@/lib/video-skills";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; platform?: string }>;
};

export default async function StandaloneVideoStudioPage({ searchParams }: PageProps) {
  const [query, options, providerStatus, initialAssets, initialJobs, studioImages, ffmpegReady, videoSkills] = await Promise.all([
    searchParams,
    getSiteOptions(),
    getVideoProviderStatus(),
    listStandaloneVideoAssets(),
    listVideoJobsForCase("standalone").catch(() => []),
    listStandaloneStudioAssets(),
    isFfmpegAvailable(),
    listAvailableVideoSkills(),
  ]);
  const siteScope = await resolvePersistedSiteScope(query.market, query.platform);
  const selectedMarket =
    options.markets.find((market) => market.code === siteScope.marketCode) ??
    options.markets.find((market) => market.code === "US") ??
    options.markets[0];

  const marketCode = selectedMarket?.code ?? "US";
  const marketName = selectedMarket?.name ?? "美国";

  return (
    <div className="page">
      <header className="studio-topbar">
        <div className="studio-topbar-title">
          <h1>AI 视频工坊</h1>
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
        </div>
        <div className="button-row">
          <Link href="/settings" className="button secondary">配置视频模型</Link>
          <Link href="/image-studio" className="button ghost">AI 生图工坊</Link>
          <Link href="/content" className="button ghost">内容工作台</Link>
        </div>
      </header>

      <StandaloneVideoStudioClient
        initialAssets={initialAssets}
        initialJobs={initialJobs}
        studioImages={studioImages}
        providerStatus={providerStatus}
        initialSkills={videoSkills}
        ffmpegReady={ffmpegReady}
        activeMarketCode={marketCode}
      />
    </div>
  );
}
