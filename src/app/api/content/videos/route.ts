import { ApiInputError, apiError, readJsonObject, stringField } from "@/lib/api-http";
import { loadCaseCompetitorBenchmark } from "@/lib/ai-sourcing-repository";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  createVideoAssetRecord,
  getAssetRecord,
  getContentDetail,
  reviewVideoAsset,
} from "@/lib/repository";
import { readStoredImage, saveVideoBuffer } from "@/lib/storage";
import { createVideoJob, isFfmpegAvailable, listVideoJobsForCase } from "@/lib/video-jobs";
import {
  VIDEO_TEMPLATES,
  composeVideoPrompt,
  getVideoProviderStatus,
  getVideoTemplateById,
  normalizeVideoAspectRatio,
  normalizeVideoDuration,
  submitVideoGenerationJob,
} from "@/lib/video-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const caseId = searchParams.get("caseId")?.trim() || "";
    if (!caseId) throw new ApiInputError("缺少 caseId 参数", 400);

    const [detail, jobs, providerStatus, ffmpegReady] = await Promise.all([
      getContentDetail(caseId),
      listVideoJobsForCase(caseId),
      getVideoProviderStatus(),
      isFfmpegAvailable(),
    ]);
    if (!detail) throw new ApiInputError("商品机会不存在", 404);

    const videoAssets = detail.assets.filter((item) => item.asset_type === "product_video");
    return Response.json({
      providerStatus,
      ffmpegReady,
      templates: VIDEO_TEMPLATES,
      jobs,
      videoAssets,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const caseId = stringField(body, "caseId", { required: true, maxLength: 120 });
    const rawAction = stringField(body, "action", { maxLength: 24 }) || "preview";

    if (rawAction === "review") {
      const assetId = stringField(body, "assetId", { required: true, maxLength: 120 });
      const decision = stringField(body, "decision", { required: true, maxLength: 20 }) === "approved"
        ? "approved"
        : "rejected";
      const reviewer = stringField(body, "reviewer", { required: true, maxLength: 80 });
      const notes = stringField(body, "notes", { maxLength: 500 });
      const updated = await reviewVideoAsset(caseId, assetId, decision, reviewer, notes);
      return Response.json({ ok: true, asset: updated });
    }

    const detail = await getContentDetail(caseId);
    if (!detail) throw new ApiInputError("商品机会不存在", 404);
    if (detail.productCase.status !== "approved") {
      throw new ApiInputError("只有已立项商品可以进入商品视频工作台", 400);
    }
    if (!detail.selection) {
      throw new ApiInputError("请先完成供应商人工定标，再发起视频生成", 400);
    }

    const template = getVideoTemplateById(stringField(body, "templateId", { maxLength: 60 }));
    const aspectRatio = normalizeVideoAspectRatio(
      stringField(body, "aspectRatio", { maxLength: 10 }),
      template.defaultAspectRatio,
    );
    const durationSec = normalizeVideoDuration(body.durationSec, template.defaultDurationSec);
    const sourceAssetId = stringField(body, "sourceAssetId", { maxLength: 120 });
    const customInstruction = stringField(body, "customInstruction", { maxLength: 1000 });
    const promptOverride = stringField(body, "promptOverride", { maxLength: 4000 });
    const negativePromptOverride = stringField(body, "negativePromptOverride", { maxLength: 1500 });
    const actor = stringField(body, "actor", { maxLength: 80 });

    const [providerStatus, benchmarkLookup] = await Promise.all([
      getVideoProviderStatus(),
      loadCaseCompetitorBenchmark(caseId).catch(() => null),
    ]);

    const topPainPoints =
      benchmarkLookup && benchmarkLookup.status === "ok" && benchmarkLookup.benchmark
        ? benchmarkLookup.benchmark.themes.slice(0, 3).map((item) => item.theme)
        : [];

    const preview = composeVideoPrompt(
      {
        productName: detail.profile?.product_name || detail.productCase.title,
        targetCustomer: detail.profile?.target_customer || "",
        coreDifferentiator: detail.profile?.core_differentiator || "",
        specifications: detail.profile?.specifications || "",
        claimsToAvoid: detail.profile?.claims_to_avoid || "",
        marketplace: detail.productCase.marketplace || "US",
        topPainPoints,
        templateId: template.id,
        aspectRatio,
        durationSec,
        customInstruction,
      },
      providerStatus.provider,
    );

    if (rawAction === "preview") {
      return Response.json({
        mode: "preview",
        preview,
        providerStatus,
      });
    }

    if (body.confirmed !== true) {
      throw new ApiInputError("请先预览分镜脚本并勾选「确认费用预估并调用视频生成」后再提交", 400);
    }
    if (!actor) {
      throw new ApiInputError("请输入操作人姓名后再发起视频生成", 400);
    }
    if (!sourceAssetId) {
      throw new ApiInputError("必须选择一张已有商品图片作为首帧底图（禁止无底图纯文生视频）", 400);
    }

    const sourceAsset = await getAssetRecord(sourceAssetId);
    if (!sourceAsset || sourceAsset.case_id !== caseId) {
      throw new ApiInputError("所选参考底图不存在或不属于当前商品", 400);
    }
    const storageKey = typeof sourceAsset.metadata.storageKey === "string" ? sourceAsset.metadata.storageKey : "";
    if (!storageKey) {
      throw new ApiInputError("所选参考底图缺少本地文件键，请重新上传实拍底图", 400);
    }

    const refBytes = await readStoredImage(storageKey);
    const finalPrompt = promptOverride || preview.prompt;
    const finalNegative = negativePromptOverride || preview.negativePrompt;

    const submitted = await submitVideoGenerationJob({
      prompt: finalPrompt,
      negativePrompt: finalNegative,
      aspectRatio: preview.aspectRatio,
      durationSec: preview.durationSec,
      referenceImage: {
        bytes: refBytes,
        mimeType: typeof sourceAsset.metadata.mimeType === "string" ? sourceAsset.metadata.mimeType : "image/png",
        fileName: typeof sourceAsset.metadata.originalName === "string" ? sourceAsset.metadata.originalName : "hero.png",
      },
    });

    if (submitted.mode === "prompt_only") {
      return Response.json({
        mode: "prompt_only",
        preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegative },
        providerStatus,
        note: submitted.note,
      });
    }

    let resultAssetId: string | null = null;
    let jobStatus: "queued" | "running" | "succeeded" = submitted.status === "succeeded" ? "succeeded" : "queued";

    if (submitted.status === "succeeded" && submitted.videoBytes) {
      const saved = await saveVideoBuffer(submitted.videoBytes, `${template.id}-${aspectRatio.replace(":", "x")}.mp4`);
      const record = await createVideoAssetRecord(
        caseId,
        {
          storageKey: saved.storageKey,
          originalName: saved.originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          parentAssetId: sourceAssetId,
          extraMetadata: {
            source: "ai_video_generated",
            provider: submitted.provider,
            model: submitted.model,
            templateId: template.id,
            aspectRatio: preview.aspectRatio,
            durationSec: preview.durationSec,
            prompt: finalPrompt,
            estimatedCostUsd: submitted.estimatedCostUsd,
          },
        },
        actor,
      );
      resultAssetId = record.assetId;
      jobStatus = "succeeded";
    }

    const job = await createVideoJob({
      caseId,
      sourceAssetId,
      templateId: template.id,
      aspectRatio: preview.aspectRatio,
      durationSec: preview.durationSec,
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
      action: "asset.video_job_submitted",
      entityType: "product_case",
      entityId: caseId,
      details: {
        jobId: job.id,
        templateId: template.id,
        provider: submitted.provider,
        model: submitted.model,
        durationSec: preview.durationSec,
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
