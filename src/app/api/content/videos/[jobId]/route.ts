import { ApiInputError, apiError } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";
import { createVideoAssetRecord } from "@/lib/repository";
import { saveVideoBuffer } from "@/lib/storage";
import { getVideoJob, updateVideoJob } from "@/lib/video-jobs";
import { pollVideoGenerationJob } from "@/lib/video-provider";


export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    const mode = await getAppMode();
    const { jobId } = await params;
    const job = await getVideoJob(jobId, { mode });
    if (!job) throw new ApiInputError("视频任务不存在", 404);

    if (job.status === "succeeded" || job.status === "failed") {
      return Response.json({ job });
    }

    const polled = await pollVideoGenerationJob(
      {
        provider: job.provider,
        model: job.model,
        externalTaskId: job.external_task_id,
        pollUrl: job.poll_url || undefined,
      },
      fetch,
      { mode },
    );

    if (polled.status === "succeeded" && polled.videoBytes) {
      const saved = await saveVideoBuffer(
        polled.videoBytes,
        `${job.template_id}-${job.aspect_ratio.replace(":", "x")}-${job.duration_sec}s.mp4`,
      );
      const record = await createVideoAssetRecord(
        job.case_id,
        {
          storageKey: saved.storageKey,
          originalName: saved.originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          parentAssetId: job.source_asset_id,
          extraMetadata: {
            source: "ai_video_generated",
            provider: job.provider,
            model: job.model,
            templateId: job.template_id,
            aspectRatio: job.aspect_ratio,
            durationSec: job.duration_sec,
            prompt: job.prompt,
            estimatedCostUsd: job.estimated_cost_usd,
            videoJobId: job.id,
          },
        },
        job.created_by,
        { mode },
      );
      const updated = await updateVideoJob(job.id, {
        status: "succeeded",
        resultAssetId: record.assetId,
        errorMessage: null,
      }, { mode });
      return Response.json({ job: updated, createdAsset: record });
    }

    if (polled.status === "failed") {
      const updated = await updateVideoJob(job.id, {
        status: "failed",
        errorMessage: polled.errorMessage || "外部视频生成失败",
      }, { mode });
      return Response.json({ job: updated });
    }

    const updated =
      polled.status !== job.status
        ? await updateVideoJob(job.id, { status: polled.status, errorMessage: null }, { mode })
        : job;
    return Response.json({ job: updated });
  } catch (error) {
    return apiError(error);
  }
}
