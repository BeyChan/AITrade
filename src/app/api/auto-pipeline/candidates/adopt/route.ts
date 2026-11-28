import { NextResponse } from "next/server";
import { adoptAutoCandidatesToKanban, unadoptAutoCandidate } from "@/lib/auto-pipeline/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      candidateId?: string;
      candidateIds?: string[];
      actor?: string;
    };
    const ids = Array.isArray(body.candidateIds)
      ? body.candidateIds
      : body.candidateId
        ? [body.candidateId]
        : [];
    const result = await adoptAutoCandidatesToKanban({
      candidateIds: ids,
      actor: typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "运营人员",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采纳入选品看板失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let candidateId = searchParams.get("candidateId")?.trim() || "";
    let actor = "运营人员";
    if (!candidateId) {
      const body = (await request.json().catch(() => ({}))) as { candidateId?: string; actor?: string };
      candidateId = body.candidateId?.trim() || "";
      if (typeof body.actor === "string" && body.actor.trim()) actor = body.actor.trim();
    }
    if (!candidateId) {
      return NextResponse.json({ error: "缺少 candidateId" }, { status: 400 });
    }
    const result = await unadoptAutoCandidate(candidateId, actor);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "取消采纳失败" },
      { status: 400 },
    );
  }
}
