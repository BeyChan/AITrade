import { NextResponse } from "next/server";
import { eliminateAutoCandidatesToBlacklist } from "@/lib/auto-pipeline/repository";
import { getAppMode } from "@/lib/app-mode";


export async function POST(request: Request) {
  try {
    const mode = await getAppMode();
    const body = (await request.json()) as {
      candidateId?: string;
      candidateIds?: string[];
      reason?: string;
      note?: string;
      actor?: string;
    };
    const ids = Array.isArray(body.candidateIds)
      ? body.candidateIds
      : body.candidateId
        ? [body.candidateId]
        : [];
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "其他";
    const result = await eliminateAutoCandidatesToBlacklist({
      candidateIds: ids,
      reason,
      note: typeof body.note === "string" ? body.note.trim() : undefined,
      actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "运营人员",
    }, { mode });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "淘汰入避坑库失败" },
      { status: 400 },
    );
  }
}
