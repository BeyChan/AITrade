import { NextResponse } from "next/server";
import { deleteAutoCandidates } from "@/lib/auto-pipeline/repository";
import { getAppMode } from "@/lib/app-mode";


export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") || "";
    const result = await deleteAutoCandidates({
      ids: [id],
      runId,
      actor: "运营人员",
    }, { mode });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除候选记录失败" },
      { status: 400 },
    );
  }
}
