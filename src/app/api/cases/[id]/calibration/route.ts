import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { applyCalibrationToCase } from "@/lib/calibration-repository";


export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "apply" | "dismiss";
      actor?: string;
      reason?: string;
    };
    const action = body.action === "dismiss" ? "dismiss" : "apply";
    const outcome = await applyCalibrationToCase({
      caseId: id,
      actor: body.actor || "本机用户",
      action,
      reason: body.reason,
    });

    revalidatePath(`/cases/${id}`);
    revalidatePath("/cases");
    revalidatePath("/audit-logs");

    return NextResponse.json(outcome);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "应用实盘校准失败" },
      { status: 400 },
    );
  }
}
