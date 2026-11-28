import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAppMode } from "@/lib/app-mode";
import { recordAuditLog } from "@/lib/audit-logs";
import { generateImagesWithProvider, getImageProviderStatus } from "@/lib/image-provider";
import {
  buildCustomImageSkill,
  composeImagePrompt,
  getImageSkillById,
  isSupportedImageSlot,
  normalizeAspectRatio,
} from "@/lib/image-skills";
import { createAssetRecord, getContentDetail } from "@/lib/repository";
import {
  getStandaloneStudioAsset,
  markStandaloneImageBound,
  saveStandaloneStudioAsset,
  type StandaloneStudioAsset,
} from "@/lib/standalone-image-studio";
import { deleteStoredImage, detectImageType, readStoredImage, saveImageBuffer } from "@/lib/storage";


const MAX_REFERENCE_BYTES = 8 * 1024 * 1024;

function readField(formData: FormData, key: string, maxLength = 2000): string {
  const value = formData.get(key);
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  try {
    const mode = await getAppMode();
    const formData = await request.formData();
    const rawAction = readField(formData, "action", 20) || "preview";
    const action = rawAction === "generate" ? "generate" : "preview";
    const skillId = readField(formData, "skillId", 120) || "amazon-main-white";
    const rawSlot = readField(formData, "slot", 40);
    const rawAspectRatio = readField(formData, "aspectRatio", 10);
    const rawCount = Number(readField(formData, "count", 10) || "1");
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(2, Math.round(rawCount))) : 1;

    const productName = readField(formData, "productName", 300);
    const marketplace = (readField(formData, "marketplace", 20) || "US").toUpperCase();
    const targetCustomer = readField(formData, "targetCustomer", 500);
    const coreDifferentiator = readField(formData, "coreDifferentiator", 1000);
    const specifications = readField(formData, "specifications", 1000);
    const packageContents = readField(formData, "packageContents", 1000);
    const claimsToAvoid = readField(formData, "claimsToAvoid", 600);
    const customInstruction = readField(formData, "customInstruction", 1000);
    const customSkillName = readField(formData, "customSkillName", 120);
    const customStyleDirectives = readField(formData, "customStyleDirectives", 2000);
    const customNegativeDirectives = readField(formData, "customNegativeDirectives", 1000);
    const promptOverride = readField(formData, "promptOverride", 6000);
    const negativePromptOverride = readField(formData, "negativePromptOverride", 2000);
    const actor = readField(formData, "actor", 80);
    const referenceAssetId = readField(formData, "referenceAssetId", 120);
    const referenceFile = formData.get("referenceFile");
    const hasUploadedReference = referenceFile instanceof File && referenceFile.size > 0;
    const hasReferenceImage = hasUploadedReference || Boolean(referenceAssetId);

    if (!productName) {
      return Response.json({ error: "请填写商品名称（用于组装贴合品类的画面提示词）" }, { status: 400 });
    }

    const [skill, providerStatus] = await Promise.all([
      skillId === "custom"
        ? Promise.resolve(
            buildCustomImageSkill({
              name: customSkillName,
              slot: rawSlot || "lifestyle_image",
              aspectRatio: rawAspectRatio || "1:1",
              styleDirectives: customStyleDirectives || customInstruction,
              negativeDirectives: customNegativeDirectives,
            }),
          )
        : getImageSkillById(skillId),
      getImageProviderStatus({ mode }),
    ]);
    const slot = rawSlot && isSupportedImageSlot(rawSlot) ? rawSlot : skill.slot;
    const aspectRatio = normalizeAspectRatio(rawAspectRatio, skill.aspectRatio);

    const preview = composeImagePrompt(skill, {
      productName,
      targetCustomer,
      coreDifferentiator,
      specifications,
      packageContents,
      claimsToAvoid,
      marketplace,
      hasReferenceImage,
      customInstruction,
      slot,
      aspectRatio,
    });

    if (action === "preview") {
      return Response.json({
        mode: "preview",
        preview,
        providerStatus,
      });
    }

    if (readField(formData, "confirmed", 10) !== "true") {
      return Response.json({ error: "请先预览提示词并勾选确认生成" }, { status: 400 });
    }
    if (!actor) {
      return Response.json({ error: "请输入操作人姓名后再生成素材" }, { status: 400 });
    }

    let referencePayload: { bytes: Buffer; mimeType: string; fileName?: string } | null = null;
    if (hasUploadedReference) {
      if (referenceFile.size > MAX_REFERENCE_BYTES) {
        return Response.json({ error: "参考底图大小不能超过 8 MB" }, { status: 400 });
      }
      const bytes = Buffer.from(await referenceFile.arrayBuffer());
      const detected = detectImageType(bytes);
      if (!detected) {
        return Response.json({ error: "参考底图仅支持真实 JPG、PNG 或 WebP 文件" }, { status: 400 });
      }
      referencePayload = {
        bytes,
        mimeType: detected.mimeType,
        fileName: referenceFile.name || `reference.${detected.extension}`,
      };
    } else if (referenceAssetId) {
      const refAsset = await getStandaloneStudioAsset(referenceAssetId, { mode });
      if (!refAsset) {
        return Response.json({ error: "所选历史参考底图不存在" }, { status: 400 });
      }
      const refBytes = await readStoredImage(refAsset.storageKey);
      referencePayload = {
        bytes: refBytes,
        mimeType: refAsset.mimeType,
        fileName: refAsset.originalName,
      };
    }

    const finalPrompt = promptOverride || preview.prompt;
    const finalNegativePrompt = negativePromptOverride || preview.negativePrompt;

    const generated = await generateImagesWithProvider(
      {
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        aspectRatio: preview.aspectRatio,
        count,
        referenceImage: referencePayload,
      },
      fetch,
      undefined,
      { mode },
    );

    if (generated.mode === "prompt_only" || generated.images.length === 0) {
      return Response.json({
        mode: "prompt_only",
        preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegativePrompt },
        providerStatus,
        note: generated.note,
        createdAssets: [],
      });
    }

    const createdAssets: StandaloneStudioAsset[] = [];
    for (let index = 0; index < generated.images.length; index += 1) {
      const item = generated.images[index]!;
      const saved = await saveImageBuffer(item.bytes, `${preview.skillId}-${index + 1}-${item.suggestedName}`);
      const id = randomUUID();
      const record: StandaloneStudioAsset = {
        id,
        storageKey: saved.storageKey,
        fileUrl: `/api/image-studio/file/${id}`,
        originalName: saved.originalName,
        mimeType: saved.mimeType,
        size: saved.size,
        width: saved.width,
        height: saved.height,
        slot: preview.slot,
        aspectRatio: preview.aspectRatio,
        skillId: preview.skillId,
        skillName: preview.skillName,
        provider: generated.provider,
        model: generated.model,
        prompt: finalPrompt,
        negativePrompt: finalNegativePrompt,
        productName,
        marketplace,
        actor,
        parentAssetId: referenceAssetId || null,
        createdAt: new Date().toISOString(),
      };
      try {
        await saveStandaloneStudioAsset(record, { mode });
        createdAssets.push(record);
      } catch (error) {
        await deleteStoredImage(saved.storageKey);
        throw error;
      }
    }

    // 若已绑定商品案卷且该案卷已解锁内容阶段，自动同步入库（无需手动再点「入库到案卷」）
    const linkedCaseId = readField(formData, "caseId", 120);
    let autoBoundCount = 0;
    if (linkedCaseId && createdAssets.length > 0) {
      const detail = await getContentDetail(linkedCaseId, { mode }).catch(() => null);
      if (detail && detail.productCase.status === "approved" && detail.selection) {
        for (const asset of createdAssets) {
          try {
            const bytes = await readStoredImage(asset.storageKey);
            const copied = await saveImageBuffer(bytes, asset.originalName);
            await createAssetRecord(
              linkedCaseId,
              {
                assetType: asset.slot,
                storageKey: copied.storageKey,
                originalName: copied.originalName,
                mimeType: copied.mimeType,
                size: copied.size,
                width: copied.width,
                height: copied.height,
                extraMetadata: {
                  source: "ai_generated",
                  provider: asset.provider,
                  model: asset.model,
                  skillId: asset.skillId,
                  skillName: asset.skillName,
                  aspectRatio: asset.aspectRatio,
                  prompt: asset.prompt,
                  negativePrompt: asset.negativePrompt,
                  importedFromStudioId: asset.id,
                },
              },
              actor,
              { mode },
            );
            await markStandaloneImageBound(
              asset.id,
              { caseId: linkedCaseId, caseTitle: detail.productCase.title },
              { mode },
            );
            autoBoundCount += 1;
          } catch {
            // 不阻断主流程，失败时仍可手动点入库
          }
        }
        if (autoBoundCount > 0) {
          revalidatePath(`/cases/${linkedCaseId}/content`);
        }
      }
    }

    await recordAuditLog({
      mode,
      actor,
      action: "image_studio.generated",
      entityType: "studio_image",
      entityId: createdAssets[0]?.id ?? "batch",
      details: {
        productName,
        marketplace,
        skillId: preview.skillId,
        provider: generated.provider,
        model: generated.model,
        count: createdAssets.length,
        mode,
      },
    }).catch(() => {});

    return Response.json({
      mode: "model",
      preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegativePrompt },
      providerStatus,
      autoBoundCount,
      note:
        autoBoundCount > 0
          ? `${generated.note} 已自动同步入库 ${autoBoundCount} 张至当前商品案卷（待人工审核）。`
          : generated.note,
      createdAssets,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "独立生图工坊请求失败" },
      { status: 400 },
    );
  }
}
