"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MediaLibraryClient } from "@/components/media-library-client";
import {
  StandaloneImageStudioClient,
  type StudioCaseOption,
} from "@/components/standalone-image-studio-client";
import { StandaloneVideoStudioClient } from "@/components/standalone-video-studio-client";
import type { QuickPickImage } from "@/components/studio/studio-reference-dropzone";
import type { ImageProviderStatus } from "@/lib/image-provider";
import type { ImageSkillDefinition } from "@/lib/image-skills-types";
import type { StandaloneStudioAsset } from "@/lib/standalone-image-studio";
import type { StandaloneVideoAsset } from "@/lib/standalone-video-studio";
import type { VideoGenerationJob } from "@/lib/video-jobs";
import type { VideoProviderStatus } from "@/lib/video-provider";
import type { VideoSkillDefinition } from "@/lib/video-skills";

export type StudioTabKey = "image" | "video" | "library";

type Props = {
  initialTab: StudioTabKey;
  initialCaseId: string;
  activeMarketCode: string;
  activeMarketName: string;
  cases: StudioCaseOption[];
  imageSkills: ImageSkillDefinition[];
  imageProviderStatus: ImageProviderStatus;
  initialImages: StandaloneStudioAsset[];
  videoSkills: VideoSkillDefinition[];
  videoProviderStatus: VideoProviderStatus;
  initialVideos: StandaloneVideoAsset[];
  initialVideoJobs: VideoGenerationJob[];
  caseQuickImages: QuickPickImage[];
  ffmpegReady: boolean;
};

export function UnifiedStudioClient({
  initialTab,
  initialCaseId,
  activeMarketCode,
  activeMarketName,
  cases,
  imageSkills,
  imageProviderStatus,
  initialImages,
  videoSkills,
  videoProviderStatus,
  initialVideos,
  initialVideoJobs,
  caseQuickImages,
  ffmpegReady,
}: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<StudioTabKey>(initialTab);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(initialCaseId);

  // 当通过侧边栏或浏览器前进/后退改变 URL ?tab= / ?caseId= 时，同步本地状态
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setSelectedCaseId(initialCaseId);
  }, [initialCaseId]);

  const selectedCase = cases.find((c) => c.id === selectedCaseId) ?? null;

  function syncUrl(nextTab: StudioTabKey, nextCaseId: string) {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    if (nextCaseId) params.set("caseId", nextCaseId);
    router.replace(`/studio?${params.toString()}`, { scroll: false });
  }

  function handleTabChange(nextTab: StudioTabKey) {
    setActiveTab(nextTab);
    syncUrl(nextTab, selectedCaseId);
  }

  function handleCaseChange(nextCaseId: string) {
    setSelectedCaseId(nextCaseId);
    syncUrl(activeTab, nextCaseId);
    router.refresh();
  }

  const tabs: Array<{ key: StudioTabKey; label: string; count?: number }> = [
    { key: "image", label: "AI 生图", count: initialImages.length },
    { key: "video", label: "AI 视频", count: initialVideos.length },
    { key: "library", label: "统一素材库", count: initialImages.length + initialVideos.length },
  ];

  return (
    <div className="stack" style={{ gap: "18px" }}>
      <section
        className="panel"
        style={{
          padding: "14px 18px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }} role="tablist" aria-label="视觉工坊模块">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(tab.key)}
                className={`button ${isActive ? "primary" : "secondary"}`}
              >
                {tab.label}
                {typeof tab.count === "number" ? (
                  <span style={{ opacity: 0.78, marginLeft: "6px", fontVariantNumeric: "tabular-nums" }}>
                    ({tab.count})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <label htmlFor="studio-case-select" style={{ fontSize: "13px", color: "var(--muted)", fontWeight: 600 }}>
            当前创作商品
          </label>
          <select
            id="studio-case-select"
            value={selectedCaseId}
            onChange={(e) => handleCaseChange(e.target.value)}
            style={{
              minWidth: "220px",
              maxWidth: "320px",
              padding: "7px 32px 7px 10px",
              borderRadius: "8px",
              border: "1px solid var(--line)",
              background: "var(--paper)",
              color: "var(--ink)",
              fontSize: "13px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <option value="">自由创作（暂不绑定商品）</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                [{c.marketplace}] {c.asin} · {c.title.slice(0, 28)}
              </option>
            ))}
          </select>

          {selectedCase ? (
            <>
              <Link href={`/cases/${encodeURIComponent(selectedCase.id)}/content`} className="button secondary">
                ← 返回文案页
              </Link>
              <a
                href={`/api/cases/${encodeURIComponent(selectedCase.id)}/media-pack`}
                className="button secondary"
                download
              >
                打包该商品素材 ZIP
              </a>
            </>
          ) : null}
        </div>
      </section>

      {activeTab === "image" ? (
        <StandaloneImageStudioClient
          key={`img-${selectedCaseId || "free"}`}
          skills={imageSkills}
          providerStatus={imageProviderStatus}
          initialAssets={initialImages}
          cases={cases}
          initialCaseId={selectedCaseId}
          activeMarketCode={activeMarketCode}
          activeMarketName={activeMarketName}
        />
      ) : null}

      {activeTab === "video" ? (
        <StandaloneVideoStudioClient
          key={`vid-${selectedCaseId || "free"}`}
          initialAssets={initialVideos}
          initialJobs={initialVideoJobs}
          studioImages={initialImages}
          caseQuickImages={caseQuickImages}
          providerStatus={videoProviderStatus}
          initialSkills={videoSkills}
          cases={cases}
          initialCaseId={selectedCaseId}
          ffmpegReady={ffmpegReady}
          activeMarketCode={activeMarketCode}
        />
      ) : null}

      {activeTab === "library" ? (
        <MediaLibraryClient
          initialImages={initialImages}
          initialVideos={initialVideos}
          cases={cases.map((c) => ({ id: c.id, asin: c.asin, title: c.title, marketplace: c.marketplace }))}
        />
      ) : null}
    </div>
  );
}
