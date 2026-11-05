import { getAiInboxTask } from "@/lib/ai-inbox/repository";
import { apiError } from "../../http";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const task = await getAiInboxTask(taskId);
    if (!task) return Response.json({ error: "AI 证据任务不存在" }, { status: 404 });
    return Response.json({ task });
  } catch (error) {
    return apiError(error);
  }
}
