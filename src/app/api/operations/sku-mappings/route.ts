import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import {
  deleteChannelSkuMapping,
  listChannelSkuMappings,
  upsertChannelSkuMapping,
} from "@/lib/operations-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const marketplace = searchParams.get("marketplace")?.trim() || undefined;
    const mappings = await listChannelSkuMappings(marketplace);
    return NextResponse.json({ mappings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取 SKU 映射失败" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      marketplace?: string;
      channelSku?: string;
      caseId?: string | null;
      unitLandedCostCentsOverride?: number | null;
      notes?: string;
      actor?: string;
    };
    const channelSku = String(body.channelSku ?? "").trim();
    const marketplace = String(body.marketplace ?? "US").trim().toUpperCase();
    if (!channelSku) {
      return NextResponse.json({ error: "channelSku 不能为空" }, { status: 400 });
    }

    const { mapping, updatedSnapshotCount } = await upsertChannelSkuMapping({
      marketplace,
      channelSku,
      caseId: body.caseId ?? null,
      unitLandedCostCentsOverride:
        typeof body.unitLandedCostCentsOverride === "number"
          ? body.unitLandedCostCentsOverride
          : null,
      notes: body.notes ?? "",
    });

    await recordAuditLog({
      actor: body.actor?.trim() || "本机用户",
      action: "operations.sku_mapping_upserted",
      entityType: "channel_sku_mapping",
      entityId: mapping.id,
      details: {
        marketplace: mapping.marketplace,
        channelSku: mapping.channelSku,
        caseId: mapping.caseId,
        caseAsin: mapping.caseAsin,
        unitLandedCostCentsOverride: mapping.unitLandedCostCentsOverride,
        effectiveUnitLandedCostCents: mapping.effectiveUnitLandedCostCents,
        updatedSnapshotCount,
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, mapping, updatedSnapshotCount });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存 SKU 映射失败" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "缺少映射 ID" }, { status: 400 });
    }
    await deleteChannelSkuMapping(id);
    await recordAuditLog({
      actor: "本机用户",
      action: "operations.sku_mapping_deleted",
      entityType: "channel_sku_mapping",
      entityId: id,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除 SKU 映射失败" },
      { status: 500 },
    );
  }
}
