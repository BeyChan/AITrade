import { randomUUID } from "node:crypto";
import { ApiInputError, apiError } from "@/app/api/ai-inbox/http";
import { recordAuditLog } from "@/lib/audit-logs";
import { getStandaloneStudioAsset } from "@/lib/standalone-image-studio";
import {
  getStandaloneVideoAsset,
  listStandaloneVideoAssets,
  saveStandaloneVideoAsset,
} from "@/lib/standalone-video-studio";
import { detectImageType, readStoredImage, saveVideoBuffer } from "@/lib/storage";
import {
  createVideoJob,
  deleteVideoJob,
  getVideoJob,
  isFfmpegAvailable,
  listVideoJobsForCase,
  stitchVideoClipsWithFfmpeg,
  updateVideoJob,
} from "@/lib/video-jobs";
import {
  VIDEO_TEMPLATES,
  composeVideoPrompt,
  getVideoProviderStatus,
  getVideoTemplateById,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  pollVideoGenerationJob,
  submitVideoGenerationJob,
} from "@/lib/video-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STANDALONE_CASE_KEY = "standalone";

export async function GET() {
  try {
    const [assets, jobs, providerStatus, ffmpegReady] = await Promise.all([
      listStandaloneVideoAssets(),
      listVideoJobsForCase(STANDALONE_CASE_KEY),
      getVideoProviderStatus(),
      isFfmpegAvailable(),
    ]);
    return Response.json({
      assets,
      jobs,
      providerStatus,
      ffmpegReady,
      templates: VIDEO_TEMPLATES,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    const isMultipart = contentType.includes("multipart/form-data");

    if (!isMultipart) {
      const body = (await request.json()) as Record<string, unknown>;
      const action = String(body.action || "preview").trim();

      if (action === "poll") {
        const jobId = String(body.jobId || "").trim();
        if (!jobId) throw new ApiInputError("缺少 jobId", 400);
        const job = await getVideoJob(jobId);
        if (!job) throw new ApiInputError("任务不存在", 404);
        if (job.status === "succeeded" || job.status === "failed") {
          return Response.json({ job });
        }
        const polled = await pollVideoGenerationJob({
          provider: job.provider,
          model: job.model,
          externalTaskId: job.external_task_id,
          pollUrl: job.poll_url || undefined,
        });
        if (polled.status === "succeeded" && polled.videoBytes) {
          const saved = await saveVideoBuffer(
            polled.videoBytes,
            `studio-${job.template_id}-${job.aspect_ratio.replace(":", "x")}-${job.duration_sec}s.mp4`,
          );
          const assetId = randomUUID();
          await saveStandaloneVideoAsset({
            id: assetId,
            storageKey: saved.storageKey,
            fileUrl: `/api/video-studio/file/${assetId}`,
            originalName: saved.originalName,
            mimeType: saved.mimeType,
            size: saved.size,
            aspectRatio: job.aspect_ratio,
            durationSec: job.duration_sec,
            templateId: job.template_id,
            provider: job.provider,
            model: job.model,
            prompt: job.prompt,
            productName: job.source_asset_id || "独立创作商品",
            actor: job.created_by,
            estimatedCostUsd: job.estimated_cost_usd,
            createdAt: new Date().toISOString(),
          });
          const updated = await updateVideoJob(job.id, {
            status: "succeeded",
            resultAssetId: assetId,
            errorMessage: null,
          });
          return Response.json({ job: updated });
        }
        if (polled.status === "failed") {
          const updated = await updateVideoJob(job.id, {
            status: "failed",
            errorMessage: polled.errorMessage || "外部视频渲染失败",
          });
          return Response.json({ job: updated });
        }
        const updated =
          polled.status !== job.status
            ? await updateVideoJob(job.id, { status: polled.status, errorMessage: null })
            : job;
        return Response.json({ job: updated });
      }

      if (action === "delete_job") {
        const jobId = String(body.jobId || "").trim();
        if (!jobId) throw new ApiInputError("缺少 jobId", 400);
        await deleteVideoJob(jobId);
        return Response.json({ ok: true, deletedJobId: jobId });
      }

      if (action === "stitch") {
        const assetIds = Array.isArray(body.assetIds)
          ? body.assetIds.filter((id): id is string => typeof id === "string" && Boolean(id.trim()))
          : [];
        const aspectRatio = normalizeVideoAspectRatio(String(body.aspectRatio || "16:9"));
        const actor = String(body.actor || "本机管理员").trim();
        if (assetIds.length < 2) throw new ApiInputError("请至少勾选 2 段视频片段进行合成", 400);

        const storageKeys: string[] = [];
        let totalDur = 0;
        let productName = "多镜头成片";
        for (const id of assetIds) {
          const asset = await getStandaloneVideoAsset(id);
          if (!asset) throw new ApiInputError(`视频片段 ${id} 不存在`, 404);
          storageKeys.push(asset.storageKey);
          totalDur += Number(asset.durationSec) || 5;
          if (asset.productName) productName = asset.productName;
        }
        const stitchedBytes = await stitchVideoClipsWithFfmpeg({ clipStorageKeys: storageKeys, aspectRatio });
        const saved = await saveVideoBuffer(
          stitchedBytes,
          `studio-stitched-${assetIds.length}shots-${aspectRatio.replace(":", "x")}-${totalDur}s.mp4`,
        );
        const assetId = randomUUID();
        const record = {
          id: assetId,
          storageKey: saved.storageKey,
          fileUrl: `/api/video-studio/file/${assetId}`,
          originalName: saved.originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          aspectRatio,
          durationSec: totalDur,
          templateId: "stitched" as const,
          provider: "ffmpeg 多镜头合成",
          model: `${assetIds.length} 镜拼接`,
          prompt: `ffmpeg stitched ${assetIds.length} clips`,
          productName,
          actor,
          estimatedCostUsd: 0,
          createdAt: new Date().toISOString(),
        };
        await saveStandaloneVideoAsset(record);
        await recordAuditLog({
          actor,
          action: "video_studio.stitched",
          entityType: "studio_video",
          entityId: record.id,
          details: { count: assetIds.length, aspectRatio, durationSec: totalDur },
        }).catch(() => {});

        return Response.json({
          ok: true,
          createdAsset: record,
          note: `已使用本机 ffmpeg 拼接 ${assetIds.length} 段镜头（约 ${totalDur}s · ${aspectRatio}）。`,
        });
      }

      // action === "preview"
      const productName = String(body.productName || "").trim() || "跨境电商品牌主推单品";
      const coreDifferentiator = String(body.coreDifferentiator || "").trim();
      const customInstruction = String(body.customInstruction || "").trim();
      const template = getVideoTemplateById(String(body.templateId || ""));
      const aspectRatio = normalizeVideoAspectRatio(String(body.aspectRatio || ""), template.defaultAspectRatio);
      const durationSec = normalizeVideoDuration(body.durationSec, template.defaultDurationSec);
      const providerStatus = await getVideoProviderStatus();

      const preview = composeVideoPrompt(
        {
          productName,
          targetCustomer: "",
          coreDifferentiator,
          specifications: "",
          claimsToAvoid: "",
          marketplace: String(body.marketplace || "US"),
          topPainPoints: [],
          templateId: template.id,
          aspectRatio,
          durationSec,
          customInstruction,
        },
        providerStatus.provider,
      );
      return Response.json({ mode: "preview", preview, providerStatus });
    }

    // multipart/form-data → action === "generate"
    const form = await request.formData();
    const confirmed = String(form.get("confirmed") || "") === "true";
    if (!confirmed) {
      throw new ApiInputError("请先预览分镜脚本并勾选「确认预估费用并提交异步生成」", 400);
    }
    const actor = String(form.get("actor") || "").trim() || "本机管理员";
    const productName = String(form.get("productName") || "").trim() || "独立创作商品";
    const template = getVideoTemplateById(String(form.get("templateId") || ""));
    const aspectRatio = normalizeVideoAspectRatio(String(form.get("aspectRatio") || ""), template.defaultAspectRatio);
    const durationSec = normalizeVideoDuration(form.get("durationSec"), template.defaultDurationSec);
    const promptOverride = String(form.get("promptOverride") || "").trim();
    const negativePromptOverride = String(form.get("negativePromptOverride") || "").trim();
    const studioImageId = String(form.get("studioImageId") || "").trim();
    const uploadedFile = form.get("referenceFile");

    const providerStatus = await getVideoProviderStatus();
    const preview = composeVideoPrompt(
      {
        productName,
        targetCustomer: "",
        coreDifferentiator: String(form.get("coreDifferentiator") || "").trim(),
        specifications: "",
        claimsToAvoid: "",
        marketplace: String(form.get("marketplace") || "US"),
        topPainPoints: [],
        templateId: template.id,
        aspectRatio,
        durationSec,
        customInstruction: String(form.get("customInstruction") || "").trim(),
      },
      providerStatus.provider,
    );

    let refPayload: { bytes: Buffer; mimeType: string; fileName: string } | null = null;
    if (uploadedFile instanceof File && uploadedFile.size > 0) {
      const bytes = Buffer.from(await uploadedFile.arrayBuffer());
      const detected = detectImageType(bytes);
      if (!detected) throw new ApiInputError("参考底图仅支持 JPG、PNG 或 WebP 格式", 400);
      refPayload = { bytes, mimeType: detected.mimeType, fileName: uploadedFile.name || `ref.${detected.extension}` };
    } else if (studioImageId) {
      const studioImg = await getStandaloneStudioAsset(studioImageId);
      if (!studioImg) throw new ApiInputError("所选生图工坊图片不存在", 404);
      const bytes = await readStoredImage(studioImg.storageKey);
      refPayload = { bytes, mimeType: studioImg.mimeType || "image/png", fileName: studioImg.originalName || "ref.png" };
    }

    if (providerStatus.provider !== "template" && !refPayload) {
      throw new ApiInputError("请上传一张本地商品图，或从下方「生图工坊图库」点选一张首帧底图", 400);
    }

    const finalPrompt = promptOverride || preview.prompt;
    const finalNegative = negativePromptOverride || preview.negativePrompt;

    const submitted = await submitVideoGenerationJob({
      prompt: finalPrompt,
      negativePrompt: finalNegative,
      aspectRatio,
      durationSec,
      referenceImage: refPayload ?? { bytes: Buffer.alloc(0), mimeType: "image/png", fileName: "template.png" },
    });

    if (submitted.mode === "prompt_only") {
      return Response.json({
        mode: "prompt_only",
        preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegative },
        note: submitted.note,
      });
    }

    let resultAssetId: string | null = null;
    let jobStatus: "queued" | "running" | "succeeded" = submitted.status === "succeeded" ? "succeeded" : "queued";

    if (submitted.status === "succeeded" && submitted.videoBytes) {
      const saved = await saveVideoBuffer(
        submitted.videoBytes,
        `studio-${template.id}-${aspectRatio.replace(":", "x")}-${durationSec}s.mp4`,
      );
      const assetId = randomUUID();
      await saveStandaloneVideoAsset({
        id: assetId,
        storageKey: saved.storageKey,
        fileUrl: `/api/video-studio/file/${assetId}`,
        originalName: saved.originalName,
        mimeType: saved.mimeType,
        size: saved.size,
        aspectRatio,
        durationSec,
        templateId: template.id,
        provider: submitted.provider,
        model: submitted.model,
        prompt: finalPrompt,
        productName,
        actor,
        estimatedCostUsd: submitted.estimatedCostUsd,
        createdAt: new Date().toISOString(),
      });
      resultAssetId = assetId;
      jobStatus = "succeeded";
    }

    const job = await createVideoJob({
      caseId: STANDALONE_CASE_KEY,
      sourceAssetId: productName,
      templateId: template.id,
      aspectRatio,
      durationSec,
      provider: submitted.provider,
      model: submitted.model,
      prompt: finalPrompt,
      negativePrompt: finalNegative,
      status: jobStatus,
      externalTaskId: submitted.externalTaskId,
      pollUrl: submitted.pollUrl,
      estimatedCostUsd: submitted.estimatedCostUsd,
      actor,
    });

    await recordAuditLog({
      actor,
      action: "video_studio.job_submitted",
      entityType: "studio_video",
      entityId: job.id,
      details: {
        productName,
        templateId: template.id,
        provider: submitted.provider,
        model: submitted.model,
        durationSec,
        estimatedCostUsd: submitted.estimatedCostUsd,
        status: jobStatus,
      },
    }).catch(() => {});

    return Response.json({
      mode: "model",
      job: { ...job, result_asset_id: resultAssetId },
      note: submitted.note,
    });
  } catch (error) {
    return apiError(error);
  }
}
