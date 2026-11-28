import { NextResponse } from "next/server";
import { deleteAutoCandidates } from "@/lib/auto-pipeline/repository";
import type { AutoGrade } from "@/lib/auto-pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_GRADES = new Set<AutoGrade>(["S", "A", "B", "HOLD", "ELIMINATED"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      ids?: string[];
      runId?: string;
      grade?: string;
      platformCode?: string;
      marketCode?: string;
      actor?: string;
    };

    const grade =
      typeof body.grade === "string" && ALLOWED_GRADES.has(body.grade as AutoGrade)
        ? (body.grade as AutoGrade)
        : undefined;

    const result = await deleteAutoCandidates({
      ids: Array.isArray(body.ids) ? body.ids : undefined,
      runId: typeof body.runId === "string" ? body.runId : "",
      grade,
      actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "运营人员",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "批量清理候选记录失败" },
      { status: 400 },
    );
  }
}
