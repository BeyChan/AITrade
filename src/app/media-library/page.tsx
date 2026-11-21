import { MediaLibraryClient } from "@/components/media-library-client";
import { PageHeader } from "@/components/ui";
import { listSourcingCases } from "@/lib/repository";
import { listStandaloneStudioAssets } from "@/lib/standalone-image-studio";
import { listStandaloneVideoAssets } from "@/lib/standalone-video-studio";

export const dynamic = "force-dynamic";

export default async function MediaLibraryPage() {
  const [studioImages, studioVideos, sourcingCases] = await Promise.all([
    listStandaloneStudioAssets(),
    listStandaloneVideoAssets(),
    listSourcingCases(),
  ]);

  const cases = sourcingCases
    .filter((entry) => Boolean(entry.selection))
    .map((entry) => ({
      id: entry.productCase.id,
      title: entry.productCase.title,
      marketplace: entry.productCase.marketplace || "US",
    }));

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[
          { label: "工作台", href: "/" },
          { label: "内容工作台", href: "/content" },
          { label: "资源库" },
        ]}
        title="资源库"
        titleBadges={
          <>
            <span className="badge badge-neutral">图片 {studioImages.length}</span>
            <span className="badge badge-neutral">视频 {studioVideos.length}</span>
          </>
        }
      />

      <MediaLibraryClient
        initialImages={studioImages}
        initialVideos={studioVideos}
        cases={cases}
      />
    </div>
  );
}
