import {
  createAiInboxTask,
  listAiInboxTasks,
  normalizeSourceKind,
  type AiInboxTaskStatus,
} from "@/lib/ai-inbox/repository";
import { runAiInboxTask } from "@/lib/ai-inbox/worker";
import { apiError, readJsonObject, stringField } from "../http";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? "all";
    const sourceKind = url.searchParams.get("sourceKind") ?? "all";
    const requestedLimit = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, Math.round(requestedLimit))) : 50;
    const tasks = await listAiInboxTasks({
      status: status as AiInboxTaskStatus | "all",
      sourceKind: sourceKind === "all" ? "all" : normalizeSourceKind(sourceKind),
      limit,
    });
    return Response.json({ tasks });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonObject(request);
    const created = await createAiInboxTask({
      content: stringField(body, "content", { required: true, maxLength: 250_000 }),
      sourceKind: normalizeSourceKind(stringField(body, "sourceKind") || "paste"),
      targetHypothesisId: stringField(body, "targetHypothesisId", { required: true, maxLength: 120 }),
      requestedBy: stringField(body, "requestedBy", { required: true, maxLength: 80 }),
      fileName: stringField(body, "fileName", { maxLength: 180 }) || null,
      mimeType: stringField(body, "mimeType", { maxLength: 120 }) || null,
    });
    if (!created) throw new Error("AI 证据任务创建失败");
    if (body.run === false) return Response.json({ task: created }, { status: 201 });
    const result = await runAiInboxTask(created.task.id, { actor: created.task.requestedBy });
    return Response.json({ task: result }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
