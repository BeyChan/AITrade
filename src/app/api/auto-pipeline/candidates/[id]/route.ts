import { NextResponse } from "next/server";
import { deleteAutoCandidates } from "@/lib/auto-pipeline/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId") || "";
    const result = await deleteAutoCandidates({
      ids: [id],
      runId,
      actor: "运营人员",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除候选记录失败" },
      { status: 400 },
    );
  }
}
