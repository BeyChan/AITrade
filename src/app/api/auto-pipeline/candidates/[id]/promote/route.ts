import { NextResponse } from "next/server";
import { promoteAutoCandidateToCase } from "@/lib/auto-pipeline/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await promoteAutoCandidateToCase(id, "运营人员");
    return NextResponse.json({
      ok: true,
      caseId: result.caseId,
      alreadyExisted: result.alreadyExisted,
      redirectUrl: `/cases/${result.caseId}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "推进为商品案卷失败" },
      { status: 400 },
    );
  }
}
