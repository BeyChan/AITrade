import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import type { PipelineResult } from "@/lib/operations-pipeline";
import {
  deleteOperationsBatch,
  listOperationsBatches,
  saveOperationsBatch,
} from "@/lib/operations-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const batches = await listOperationsBatches(30);
    return NextResponse.json({ batches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取实盘账本失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      label?: string;
      marketplace?: string;
      currency?: string;
      result?: PipelineResult;
    };
    if (!body.result || !Array.isArray(body.result.periods)) {
      return NextResponse.json({ error: "缺少可保存的结算试算结果" }, { status: 400 });
    }
    const saved = await saveOperationsBatch({
      label: body.label || "",
      marketplace: body.marketplace || "US",
      currency: body.currency || "USD",
      createdBy: "本机用户",
      result: body.result,
    });
    await recordAuditLog({
      actor: "本机用户",
      action: "operations.batch_saved",
      entityType: "operations_batch",
      entityId: saved.id,
      details: {
        label: saved.label,
        marketplace: saved.marketplace,
        currency: saved.currency,
        periodCount: body.result.periods.length,
        totalRevenueCents: saved.totalRevenueCents,
        totalContributionCents: saved.totalContributionCents,
        totalNetProfitCents: saved.totalNetProfitCents,
        landedCostCoveredCount: saved.landedCostCoveredCount,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, batch: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存实盘账本失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "缺少批次 ID" }, { status: 400 });
    }
    await deleteOperationsBatch(id);
    await recordAuditLog({
      actor: "本机用户",
      action: "operations.batch_deleted",
      entityType: "operations_batch",
      entityId: id,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除账本批次失败" },
      { status: 500 },
    );
  }
}
