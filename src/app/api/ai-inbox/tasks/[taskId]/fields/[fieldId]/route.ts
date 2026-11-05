import { reviewAiInboxField } from "@/lib/ai-inbox/apply";
import { apiError, readJsonObject, stringField } from "../../../../http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string; fieldId: string }> },
) {
  try {
    const { taskId, fieldId } = await params;
    const body = await readJsonObject(request);
    const action = stringField(body, "action", { required: true, maxLength: 20 });
    if (action !== "accept" && action !== "correct" && action !== "reject") {
      return Response.json({ error: "action 必须是 accept、correct 或 reject" }, { status: 400 });
    }
    const task = await reviewAiInboxField({
      taskId,
      fieldId,
      action,
      actor: stringField(body, "actor", { required: true, maxLength: 80 }),
      value: body.value === undefined ? undefined : body.value as string | number | boolean | null,
      notes: stringField(body, "notes", { maxLength: 500 }),
    });
    return Response.json({ task });
  } catch (error) {
    return apiError(error);
  }
}
