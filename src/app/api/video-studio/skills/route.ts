import { ApiInputError, readJsonObject, stringField, withApiRoute } from "@/lib/api-http";
import { getAppMode } from "@/lib/app-mode";
import { recordAuditLog } from "@/lib/audit-logs";
import { normalizeVideoAspectRatio, normalizeVideoDuration } from "@/lib/video-provider";
import {
  deleteLocalVideoSkill,
  listAvailableVideoSkills,
  saveLocalVideoSkill,
} from "@/lib/video-skills";

export const GET = withApiRoute(async () => {
  const skills = await listAvailableVideoSkills();
  return Response.json({ skills });
});

export const POST = withApiRoute(async (request: Request) => {
  const mode = await getAppMode();
  const body = await readJsonObject(request);
  const name = stringField(body, "name", { required: true, maxLength: 80 });
  const description = stringField(body, "description", { maxLength: 200 });
  const channelHint = stringField(body, "channelHint", { maxLength: 60 });
  const aspectRatio = normalizeVideoAspectRatio(stringField(body, "aspectRatio", { maxLength: 10 }), "16:9");
  const durationSec = normalizeVideoDuration(body.durationSec, 5);
  const motionDirectives = stringField(body, "motionDirectives", { required: true, maxLength: 1500 });
  const lightingDirectives = stringField(body, "lightingDirectives", { maxLength: 800 });
  const negativeDirectives = stringField(body, "negativeDirectives", { maxLength: 800 });

  const created = await saveLocalVideoSkill({
    name,
    description,
    channelHint,
    aspectRatio,
    durationSec,
    motionDirectives,
    lightingDirectives,
    negativeDirectives,
  });
  const skills = await listAvailableVideoSkills();
  await recordAuditLog({
    mode,
    actor: "本地操作员",
    action: "video_skill.saved",
    entityType: "video_skill",
    entityId: created.id,
    details: { name: created.name, aspectRatio: created.aspectRatio, durationSec: created.durationSec },
  }).catch(() => {});
  return Response.json({ ok: true, created, skills });
});

export const DELETE = withApiRoute(async (request: Request) => {
  const mode = await getAppMode();
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim() || "";
  if (!id) throw new ApiInputError("缺少 skill id", 400);
  await deleteLocalVideoSkill(id);
  await recordAuditLog({
    mode,
    actor: "本地操作员",
    action: "video_skill.deleted",
    entityType: "video_skill",
    entityId: id,
  }).catch(() => {});
  const skills = await listAvailableVideoSkills();
  return Response.json({ ok: true, deletedId: id, skills });
});
