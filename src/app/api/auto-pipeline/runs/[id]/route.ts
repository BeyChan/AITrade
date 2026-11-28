import { NextResponse } from "next/server";
import { deleteAutoPipelineRun, renameAutoPipelineRun } from "@/lib/auto-pipeline/repository";
import { getAppMode } from "@/lib/app-mode";


export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id } = await context.params;
    const body = (await request.json()) as { sourceLabel?: string; actor?: string };
    const run = await renameAutoPipelineRun(
      id,
      String(body.sourceLabel || ""),
      body.actor?.trim() || "运营人员",
      { mode },
    );
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重命名批次失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id } = await context.params;
    const result = await deleteAutoPipelineRun(id, "运营人员", { mode });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除批次失败" },
      { status: 400 },
    );
  }
}
