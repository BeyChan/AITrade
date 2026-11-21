import Link from "next/link";
import { UnifiedStudioClient, type StudioTabKey } from "@/components/unified-studio-client";
import { PageHeader } from "@/components/ui";
import { getImageProviderStatus } from "@/lib/image-provider";
import { listAvailableImageSkills } from "@/lib/image-skills";
import { getContentDetail, getSiteOptions, listSourcingCases } from "@/lib/repository";
import { resolvePersistedSiteScope } from "@/lib/site-scope";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";
import { listStandaloneVideoAssets } from "@/lib/standalone-video-studio";
import { isFfmpegAvailable, listVideoJobsForCase } from "@/lib/video-jobs";
import { getVideoProviderStatus } from "@/lib/video-provider";
import { listAvailableVideoSkills } from "@/lib/video-skills";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ tab?: string; caseId?: string; market?: string; platform?: string }>;
};

function resolveTab(raw?: string): StudioTabKey {
  if (raw === "video" || raw === "library") return raw;
  return "image";
}

export default async function UnifiedStudioPage({ searchParams }: PageProps) {
  const [
    query,
    options,
    imageSkills,
    imageProviderStatus,
    initialImages,
    videoSkills,
    videoProviderStatus,
    initialVideos,
    initialVideoJobs,
    ffmpegReady,
    sourcingCases,
  ] = await Promise.all([
    searchParams,
    getSiteOptions(),
    listAvailableImageSkills(),
    getImageProviderStatus(),
    listStandaloneStudioAssets(),
    listAvailableVideoSkills(),
    getVideoProviderStatus(),
    listStandaloneVideoAssets(),
    listVideoJobsForCase("standalone").catch(() => []),
    isFfmpegAvailable(),
    listSourcingCases(),
  ]);

  const tab = resolveTab(query.tab);
  const caseId = query.caseId?.trim() || "";
  const linkedCaseDetail = caseId ? await getContentDetail(caseId).catch(() => null) : null;
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
          { label: "视觉工坊" },
        ]}
        title="视觉工坊"
        description="统一管理 AI 主图/场景图生成、I2V 短视频渲染与商品素材库；选定商品后可直接联动卖点并一键打包下载上架素材。"
        titleBadges={
          <>
            <span
              className={`badge ${
                imageProviderStatus.provider !== "template" && imageProviderStatus.configured
                  ? "badge-success"
                  : "badge-neutral"
              }`}
            >
              生图：{imageProviderStatus.label}
            </span>
            <span
              className={`badge ${
                videoProviderStatus.provider !== "template" && videoProviderStatus.configured
                  ? "badge-success"
                  : "badge-neutral"
              }`}
            >
              视频：{videoProviderStatus.label}
            </span>
          </>
        }
        actions={
          <Link href="/settings" className="button secondary">
            配置图片 / 视频模型
          </Link>
        }
      />

      <UnifiedStudioClient
        initialTab={tab}
        initialCaseId={caseId}
        activeMarketCode={marketCode}
        activeMarketName={marketName}
        cases={cases}
        imageSkills={imageSkills}
        imageProviderStatus={imageProviderStatus}
        initialImages={initialImages}
        videoSkills={videoSkills}
        videoProviderStatus={videoProviderStatus}
        initialVideos={initialVideos}
        initialVideoJobs={initialVideoJobs}
        caseQuickImages={caseQuickImages}
        ffmpegReady={ffmpegReady}
      />
    </div>
  );
}
