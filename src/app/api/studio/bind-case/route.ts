import { revalidatePath } from "next/cache";
import { ApiInputError, apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http";
import { isSupportedImageSlot, type ImageAssetSlot } from "@/lib/image-skills";
import { createAssetRecord, getContentDetail } from "@/lib/repository";
import { createVideoAssetRecord } from "@/lib/video-asset-repository";
import { getStandaloneStudioAsset, markStandaloneImageBound } from "@/lib/standalone-image-studio";
import { getStandaloneVideoAsset, markStandaloneVideoBound } from "@/lib/standalone-video-studio";
import { readStoredImage, saveImageBuffer, saveVideoBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const kind = stringField(body, "kind", { required: true, maxLength: 16 });
    const studioAssetId = stringField(body, "studioAssetId", { required: true, maxLength: 120 });
    const caseId = stringField(body, "caseId", { required: true, maxLength: 120 });
    const actor = stringField(body, "actor", { maxLength: 80 }) || "本机管理员";

    const detail = await getContentDetail(caseId);
    if (!detail) throw new ApiInputError("目标商品案卷不存在", 404);
    if (detail.productCase.status !== "approved" || !detail.selection) {
      throw new ApiInputError("目标商品需先完成立项与供应商人工定标，才能入库内容资产", 400);
    }

    // 幂等去重：同一工坊素材在同一案卷内只入库一次，防止重复点击产生多条记录
    const alreadyExisting = detail.assets.find(
      (a) => typeof a.metadata?.importedFromStudioId === "string" && a.metadata.importedFromStudioId === studioAssetId,
    );
    if (alreadyExisting) {
      if (kind === "image") {
        await markStandaloneImageBound(studioAssetId, { caseId, caseTitle: detail.productCase.title });
      } else if (kind === "video") {
        await markStandaloneVideoBound(studioAssetId, { caseId, caseTitle: detail.productCase.title });
      }
      return Response.json({
        ok: true,
        alreadyBound: true,
        assetId: alreadyExisting.id,
        boundCase: { caseId, caseTitle: detail.productCase.title, boundAt: new Date().toISOString() },
        message: `该素材已入库至「${detail.productCase.title}」，无需重复入库。`,
      });
    }

    if (kind === "image") {
      const studioAsset = await getStandaloneStudioAsset(studioAssetId);
      if (!studioAsset) throw new ApiInputError("生图工坊图片不存在", 404);
      const bytes = await readStoredImage(studioAsset.storageKey);
      const saved = await saveImageBuffer(bytes, studioAsset.originalName);
      const rawSlot = stringField(body, "slot", { maxLength: 40 });
      const assetType: ImageAssetSlot = rawSlot && isSupportedImageSlot(rawSlot) ? rawSlot : studioAsset.slot;

      const record = await createAssetRecord(
        caseId,
        {
          assetType,
          storageKey: saved.storageKey,
          originalName: saved.originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          width: saved.width,
          height: saved.height,
          extraMetadata: {
            source: "ai_generated",
            provider: studioAsset.provider,
            model: studioAsset.model,
            skillId: studioAsset.skillId,
            skillName: studioAsset.skillName,
            aspectRatio: studioAsset.aspectRatio,
            prompt: studioAsset.prompt,
            negativePrompt: studioAsset.negativePrompt,
            importedFromStudioId: studioAsset.id,
          },
        },
        actor,
      );
      await markStandaloneImageBound(studioAssetId, { caseId, caseTitle: detail.productCase.title });
      revalidatePath(`/cases/${caseId}/content`);
      revalidatePath("/image-studio");
      revalidatePath("/content");
      revalidatePath("/media-library");
      return Response.json({
        ok: true,
        assetId: record.assetId,
        boundCase: { caseId, caseTitle: detail.productCase.title, boundAt: new Date().toISOString() },
        message: `已将图片入库至「${detail.productCase.title}」（状态：待人工审核）。`,
      });
    }

    if (kind === "video") {
      const studioVideo = await getStandaloneVideoAsset(studioAssetId);
      if (!studioVideo) throw new ApiInputError("视频工坊视频不存在", 404);
      const bytes = await readStoredImage(studioVideo.storageKey);
      const saved = await saveVideoBuffer(bytes, studioVideo.originalName);

      // 将独立视频工坊产物入库到目标商品案卷的 assets 表（待人工审核）
      const record = await createVideoAssetRecord(
        caseId,
        {
          storageKey: saved.storageKey,
          originalName: saved.originalName,
          mimeType: saved.mimeType,
          size: saved.size,
          extraMetadata: {
            source: studioVideo.templateId === "stitched" ? "ffmpeg_stitched" : "ai_video_generated",
            provider: studioVideo.provider,
            model: studioVideo.model,
            templateId: studioVideo.templateId,
            aspectRatio: studioVideo.aspectRatio,
            durationSec: studioVideo.durationSec,
            prompt: studioVideo.prompt,
            estimatedCostUsd: studioVideo.estimatedCostUsd,
            importedFromStudioId: studioVideo.id,
          },
        },
        actor,
      );
      await markStandaloneVideoBound(studioAssetId, { caseId, caseTitle: detail.productCase.title });
      revalidatePath(`/cases/${caseId}/content`);
      revalidatePath("/video-studio");
      revalidatePath("/content");
      revalidatePath("/media-library");
      return Response.json({
        ok: true,
        assetId: record.assetId,
        boundCase: { caseId, caseTitle: detail.productCase.title, boundAt: new Date().toISOString() },
        message: `已将视频入库至「${detail.productCase.title}」（状态：待人工审核）。`,
      });
    }

    throw new ApiInputError("不支持的素材类型", 400);
  } catch (error) {
    return apiError(error);
  }
}
