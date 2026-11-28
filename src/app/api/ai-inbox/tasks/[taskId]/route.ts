import { getAiInboxTask } from "@/lib/ai-inbox/repository";
import { withApiRoute } from "@/lib/api-http";

export const GET = withApiRoute(
  async (_request: Request, { params }: { params: Promise<{ taskId: string }> }) => {
    const { taskId } = await params;
    const task = await getAiInboxTask(taskId);
    if (!task) return Response.json({ error: "AI 证据任务不存在" }, { status: 404 });
    return Response.json({ task });
  },
);
