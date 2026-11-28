import { applyAiInboxTask } from "@/lib/ai-inbox/apply";
import { readJsonObject, stringField, withApiRoute } from "@/lib/api-http";

export const POST = withApiRoute(
  async (request: Request, { params }: { params: Promise<{ taskId: string }> }) => {
    const { taskId } = await params;
    const body = await readJsonObject(request);
    const task = await applyAiInboxTask({
      taskId,
      actor: stringField(body, "actor", { required: true, maxLength: 80 }),
    });
    return Response.json({ task });
  },
);
