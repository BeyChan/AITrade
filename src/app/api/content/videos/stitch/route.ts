import { ApiInputError, apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http";
import { recordAuditLog } from "@/lib/audit-logs";
import { createVideoAssetRecord, getAssetRecord, getContentDetail } from "@/lib/repository";
import { saveVideoBuffer } from "@/lib/storage";
import { stitchVideoClipsWithFfmpeg } from "@/lib/video-jobs";
import { normalizeVideoAspectRatio } from "@/lib/video-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const caseId = stringField(body, "caseId", { required: true, maxLength: 120 });
    const actor = stringField(body, "actor", { required: true, maxLength: 80 });
    const aspectRatio = normalizeVideoAspectRatio(stringField(body, "aspectRatio", { maxLength: 10 }), "16:9");
    const rawAssetIds = Array.isArray(body.assetIds) ? body.assetIds : [];
    const assetIds = rawAssetIds
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());

    if (assetIds.length < 2) {
      throw new ApiInputError("请至少勾选 2 段已生成的视频片段再合成成片", 400);
    }

    const detail = await getContentDetail(caseId);
    if (!detail) throw new ApiInputError("商品机会不存在", 404);
    if (detail.productCase.status !== "approved" || !detail.selection) {
      throw new ApiInputError("请先完成立项与供应商定标后再合成视频", 400);
    }

    const storageKeys: string[] = [];
    let totalDurationSec = 0;
    for (const assetId of assetIds) {
      const asset = await getAssetRecord(assetId);
      if (!asset || asset.case_id !== caseId || asset.asset_type !== "product_video") {
        throw new ApiInputError(`视频片段 ${assetId} 不存在或不属于当前商品`, 400);
      }
      const key = typeof asset.metadata.storageKey === "string" ? asset.metadata.storageKey : "";
      if (!key) throw new ApiInputError("所选视频片段缺少本地文件键", 400);
      storageKeys.push(key);
      totalDurationSec += Number(asset.metadata.durationSec) || 5;
    }

    const stitchedBytes = await stitchVideoClipsWithFfmpeg({
      clipStorageKeys: storageKeys,
      aspectRatio,
    });

    const saved = await saveVideoBuffer(
      stitchedBytes,
      `stitched-${assetIds.length}shots-${aspectRatio.replace(":", "x")}-${totalDurationSec}s.mp4`,
    );

    const record = await createVideoAssetRecord(
      caseId,
      {
        storageKey: saved.storageKey,
        originalName: saved.originalName,
        mimeType: saved.mimeType,
        size: saved.size,
        parentAssetId: assetIds[0] ?? null,
        extraMetadata: {
          source: "ffmpeg_stitched",
          clipAssetIds: assetIds,
          shotCount: assetIds.length,
          aspectRatio,
          durationSec: totalDurationSec,
        },
      },
      actor,
    );

    await recordAuditLog({
      actor,
      action: "asset.video_stitched",
      entityType: "product_case",
      entityId: caseId,
      details: {
        assetId: record.assetId,
        count: assetIds.length,
        aspectRatio,
        durationSec: totalDurationSec,
      },
    }).catch(() => {});

    return Response.json({
      ok: true,
      createdAsset: record,
      note: `已使用本机 ffmpeg 无损拼接 ${assetIds.length} 段镜头（约 ${totalDurationSec}s · ${aspectRatio}），已写入资产库待人工审核。`,
    });
  } catch (error) {
    return apiError(error);
  }
}
