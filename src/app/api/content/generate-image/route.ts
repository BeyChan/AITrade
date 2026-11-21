import { ApiInputError, apiError, readJsonObject, stringField } from "@/app/api/ai-inbox/http";
import { loadCaseCompetitorBenchmark } from "@/lib/ai-sourcing-repository";
import { recordAuditLog } from "@/lib/audit-logs";
import { generateImagesWithProvider, getImageProviderStatus } from "@/lib/image-provider";
import {
  buildCustomImageSkill,
  composeImagePrompt,
  getImageSkillById,
  isSupportedImageSlot,
  normalizeAspectRatio,
} from "@/lib/image-skills";
import { createAssetRecord, getAssetRecord, getContentDetail } from "@/lib/repository";
import { deleteStoredImage, readStoredImage, saveImageBuffer } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const caseId = stringField(body, "caseId", { required: true, maxLength: 120 });
    const skillId = stringField(body, "skillId", { required: true, maxLength: 120 });
    const rawAction = stringField(body, "action", { maxLength: 20 }) || "preview";
    const action = rawAction === "generate" ? "generate" : "preview";
    const rawSlot = stringField(body, "slot", { maxLength: 40 });
    const rawAspectRatio = stringField(body, "aspectRatio", { maxLength: 10 });
    const referenceAssetId = stringField(body, "referenceAssetId", { maxLength: 120 });
    const customInstruction = stringField(body, "customInstruction", { maxLength: 1000 });
    const customSkillName = stringField(body, "customSkillName", { maxLength: 120 });
    const customStyleDirectives = stringField(body, "customStyleDirectives", { maxLength: 2000 });
    const customNegativeDirectives = stringField(body, "customNegativeDirectives", { maxLength: 1000 });
    const promptOverride = stringField(body, "promptOverride", { maxLength: 6000 });
    const negativePromptOverride = stringField(body, "negativePromptOverride", { maxLength: 2000 });
    const actor = stringField(body, "actor", { maxLength: 80 });
    const rawCount = typeof body.count === "number" ? body.count : Number(body.count ?? 1);
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(2, Math.round(rawCount))) : 1;

    const detail = await getContentDetail(caseId);
    if (!detail) throw new ApiInputError("商品机会不存在", 404);
    if (detail.productCase.status !== "approved") {
      throw new ApiInputError("只有已立项商品可以进入内容与生图工作台", 400);
    }
    if (!detail.selection) {
      throw new ApiInputError("请先完成供应商人工定标，再使用视觉生图工作台", 400);
    }

    let referenceAsset = null;
    if (referenceAssetId) {
      referenceAsset = await getAssetRecord(referenceAssetId);
      if (!referenceAsset || referenceAsset.case_id !== caseId) {
        throw new ApiInputError("所选参考底图不存在或不属于当前商品", 400);
      }
    }

    const [skill, providerStatus, benchmarkLookup] = await Promise.all([
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
      getImageProviderStatus(),
      loadCaseCompetitorBenchmark(caseId).catch(() => null),
    ]);

    const topPainPoints =
      benchmarkLookup && benchmarkLookup.status === "ok" && benchmarkLookup.benchmark
        ? benchmarkLookup.benchmark.themes.slice(0, 3).map((item) => item.theme)
        : [];

    const slot = rawSlot && isSupportedImageSlot(rawSlot) ? rawSlot : skill.slot;
    const aspectRatio = normalizeAspectRatio(rawAspectRatio, skill.aspectRatio);

    const preview = composeImagePrompt(skill, {
      productName: detail.profile?.product_name || detail.productCase.title,
      targetCustomer: detail.profile?.target_customer || "",
      coreDifferentiator: detail.profile?.core_differentiator || "",
      specifications: detail.profile?.specifications || "",
      packageContents: detail.profile?.package_contents || "",
      claimsToAvoid: detail.profile?.claims_to_avoid || "",
      marketplace: detail.productCase.marketplace || "US",
      topPainPoints,
      hasReferenceImage: Boolean(referenceAsset),
      customInstruction,
      slot,
      aspectRatio,
    });

    if (action === "preview") {
      return Response.json({
        mode: "preview",
        preview,
        providerStatus,
        referenceAsset: referenceAsset
          ? {
              id: referenceAsset.id,
              originalName: String(referenceAsset.metadata.originalName ?? "参考底图"),
            }
          : null,
      });
    }

    if (body.confirmed !== true) {
      throw new ApiInputError("请先预览提示词并勾选「确认调用生图服务」后再生成", 400);
    }
    if (!actor) {
      throw new ApiInputError("请输入操作人姓名后再生成素材", 400);
    }

    const finalPrompt = promptOverride || preview.prompt;
    const finalNegativePrompt = negativePromptOverride || preview.negativePrompt;

    let referencePayload: { bytes: Buffer; mimeType: string; fileName?: string } | null = null;
    if (referenceAsset) {
      const storageKey = typeof referenceAsset.metadata.storageKey === "string"
        ? referenceAsset.metadata.storageKey
        : "";
      if (!storageKey) {
        throw new ApiInputError("所选参考底图缺少本地文件键，请重新上传实拍底图", 400);
      }
      const refBytes = await readStoredImage(storageKey);
      referencePayload = {
        bytes: refBytes,
        mimeType: typeof referenceAsset.metadata.mimeType === "string"
          ? referenceAsset.metadata.mimeType
          : "image/png",
        fileName: typeof referenceAsset.metadata.originalName === "string"
          ? referenceAsset.metadata.originalName
          : "reference.png",
      };
    }

    const generated = await generateImagesWithProvider({
      prompt: finalPrompt,
      negativePrompt: finalNegativePrompt,
      aspectRatio: preview.aspectRatio,
      count,
      referenceImage: referencePayload,
    });

    if (generated.mode === "prompt_only" || generated.images.length === 0) {
      return Response.json({
        mode: "prompt_only",
        preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegativePrompt },
        providerStatus,
        note: generated.note,
        createdAssets: [],
      });
    }

    const createdAssets = [];
    for (let index = 0; index < generated.images.length; index += 1) {
      const item = generated.images[index]!;
      const saved = await saveImageBuffer(item.bytes, `${preview.skillId}-${index + 1}-${item.suggestedName}`);
      try {
        const record = await createAssetRecord(
          caseId,
          {
            ...saved,
            assetType: preview.slot,
            parentAssetId: referenceAsset?.id ?? null,
            extraMetadata: {
              source: "ai_generated",
              skillId: preview.skillId,
              skillName: preview.skillName,
              provider: generated.provider,
              model: generated.model,
              prompt: finalPrompt,
              negativePrompt: finalNegativePrompt,
              aspectRatio: preview.aspectRatio,
              latencyMs: generated.latencyMs,
            },
          },
          actor,
        );
        createdAssets.push(record);
      } catch (error) {
        await deleteStoredImage(saved.storageKey);
        throw error;
      }
    }

    await recordAuditLog({
      actor,
      action: "asset.image_generated",
      entityType: "product_case",
      entityId: caseId,
      details: {
        skillId: preview.skillId,
        slot: preview.slot,
        provider: generated.provider,
        model: generated.model,
        count: createdAssets.length,
      },
    }).catch(() => {});

    return Response.json({
      mode: "model",
      preview: { ...preview, prompt: finalPrompt, negativePrompt: finalNegativePrompt },
      providerStatus,
      note: generated.note,
      createdAssets,
    });
  } catch (error) {
    if (error instanceof ApiInputError) return apiError(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "生图请求处理失败" },
      { status: 400 },
    );
  }
}
