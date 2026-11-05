import { getAiInboxTask } from "@/lib/ai-inbox/repository";
import { retryAiInboxTask } from "@/lib/ai-inbox/worker";
import { apiError, readJsonObject, stringField } from "../../../http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonObject(request);
    const existing = await getAiInboxTask(taskId);
    if (!existing) return Response.json({ error: "AI 证据任务不存在" }, { status: 404 });
    const actor = stringField(body, "actor", { maxLength: 80 }) || existing.task.requestedBy;
    const task = await retryAiInboxTask(taskId, actor);
    return Response.json({ task });
  } catch (error) {
    return apiError(error);
  }
}
