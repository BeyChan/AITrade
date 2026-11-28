import { revalidatePath } from "next/cache";
import { ApiInputError, readJsonObject, stringField, withApiRoute } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  deleteModelProfile,
  setDefaultModelProfile,
  testSavedModelProfile,
} from "@/lib/model-profiles";

export const POST = withApiRoute(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const mode = await getAppMode();
    const { id } = await params;
    const body = await readJsonObject(request);
    const action = stringField(body, "action", { required: true, maxLength: 20 });

    if (action === "default") {
      const profile = await setDefaultModelProfile(id, "本机管理员", { mode });
      await recordAuditLog({
        mode,
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
      const result = await testSavedModelProfile(id, { mode });
      return Response.json({
        ok: true,
        result,
        message: `${result.message}（${result.model} · ${result.latencyMs} ms）`,
      });
    }

    throw new ApiInputError("不支持的操作类型", 400);
  },
);

export const DELETE = withApiRoute(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const mode = await getAppMode();
    const { id } = await params;
    await deleteModelProfile(id, { mode });
    await recordAuditLog({
      mode,
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
  },
);
