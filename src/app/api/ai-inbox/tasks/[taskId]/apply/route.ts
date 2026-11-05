import { applyAiInboxTask } from "@/lib/ai-inbox/apply";
import { apiError, readJsonObject, stringField } from "../../../http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  try {
    const { taskId } = await params;
    const body = await readJsonObject(request);
    const task = await applyAiInboxTask({
      taskId,
      actor: stringField(body, "actor", { required: true, maxLength: 80 }),
    });
    return Response.json({ task });
  } catch (error) {
    return apiError(error);
  }
}
