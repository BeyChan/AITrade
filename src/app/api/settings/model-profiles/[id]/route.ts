import { revalidatePath } from "next/cache";
import { ApiInputError, apiError, readJsonObject, stringField } from "@/lib/api-http";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  deleteModelProfile,
  setDefaultModelProfile,
  testSavedModelProfile,
} from "@/lib/model-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJsonObject(request);
    const action = stringField(body, "action", { required: true, maxLength: 20 });

    if (action === "default") {
      const profile = await setDefaultModelProfile(id);
      await recordAuditLog({
        actor: "本机管理员",
        action: "model_profile.default_changed",
        entityType: "model_profile",
        entityId: profile.id,
        details: { name: profile.name, serviceType: profile.serviceType, defaultModel: profile.defaultModel },
      }).catch(() => {});
      revalidatePath("/settings");
      revalidatePath("/image-studio");
      revalidatePath("/video-studio");
      revalidatePath("/content");
      return Response.json({ ok: true, profile, message: `已将「${profile.name}」设为默认模型。` });
    }

    if (action === "test") {
      const result = await testSavedModelProfile(id);
      return Response.json({
        ok: true,
        result,
        message: `${result.message}（${result.model} · ${result.latencyMs} ms）`,
      });
    }

    throw new ApiInputError("不支持的操作类型", 400);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await deleteModelProfile(id);
    await recordAuditLog({
      actor: "本机管理员",
      action: "model_profile.deleted",
      entityType: "model_profile",
      entityId: id,
    }).catch(() => {});
    revalidatePath("/settings");
    revalidatePath("/image-studio");
    revalidatePath("/video-studio");
    revalidatePath("/content");
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
