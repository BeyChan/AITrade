import { ApiInputError, apiError, readJsonObject, stringField } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  deleteLocalImageSkill,
  listAvailableImageSkills,
  saveLocalImageSkill,
} from "@/lib/image-skills";


export async function POST(request: Request) {
  const mode = await getAppMode();
  try {
    const body = await readJsonObject(request);
    const name = stringField(body, "name", { required: true, maxLength: 80 });
    const description = stringField(body, "description", { maxLength: 300 });
    const slot = stringField(body, "slot", { maxLength: 40 }) || "lifestyle_image";
    const aspectRatio = stringField(body, "aspectRatio", { maxLength: 10 }) || "1:1";
    const styleDirectives = stringField(body, "styleDirectives", { required: true, maxLength: 2000 });
    const negativeDirectives = stringField(body, "negativeDirectives", { maxLength: 1000 });

    const skill = await saveLocalImageSkill({
      name,
      description,
      slot,
      aspectRatio,
      styleDirectives,
      negativeDirectives,
    });
    const skills = await listAvailableImageSkills();

    await recordAuditLog({
      mode,
      actor: "本地操作员",
      action: "image_skill.saved",
      entityType: "image_skill",
      entityId: skill.id,
      details: { name: skill.name, slot: skill.slot, aspectRatio: skill.aspectRatio },
    }).catch(() => {});

    return Response.json({ skill, skills });
  } catch (error) {
    if (error instanceof ApiInputError) return apiError(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "保存自定义规范失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const mode = await getAppMode();
  try {
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id) {
      throw new ApiInputError("缺少要删除的规范 ID", 400);
    }

    await deleteLocalImageSkill(id);
    await recordAuditLog({
      mode,
      actor: "本地操作员",
      action: "image_skill.deleted",
      entityType: "image_skill",
      entityId: id,
    }).catch(() => {});
    const skills = await listAvailableImageSkills();
    return Response.json({ deletedId: id, skills });
  } catch (error) {
    if (error instanceof ApiInputError) return apiError(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "删除本地规范失败" },
      { status: 400 },
    );
  }
}
