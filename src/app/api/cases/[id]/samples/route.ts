import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getAppMode, isDemoMode, type AppMode } from "@/lib/app-mode";
import { getDb } from "@/lib/db";


export type SampleLogStatus = "ordered" | "received" | "passed" | "failed" | "returned";

export type SampleLogRecord = {
  id: string;
  caseId: string;
  supplierName: string;
  sampleCostCny: number;
  shippingCostCny: number;
  trackingNo: string;
  status: SampleLogStatus;
  qualityRating: number | null;
  pros: string;
  defects: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

const VALID_STATUSES: SampleLogStatus[] = ["ordered", "received", "passed", "failed", "returned"];

function normalizeStatus(raw: unknown): SampleLogStatus {
  return typeof raw === "string" && VALID_STATUSES.includes(raw as SampleLogStatus)
    ? (raw as SampleLogStatus)
    : "ordered";
}

function mapRow(r: Record<string, unknown>): SampleLogRecord {
  return {
    id: String(r.id),
    caseId: String(r.case_id),
    supplierName: String(r.supplier_name ?? ""),
    sampleCostCny: Number(r.sample_cost_cny ?? 0),
    shippingCostCny: Number(r.shipping_cost_cny ?? 0),
    trackingNo: String(r.tracking_no ?? ""),
    status: normalizeStatus(r.status),
    qualityRating: r.quality_rating != null ? Number(r.quality_rating) : null,
    pros: String(r.pros ?? ""),
    defects: String(r.defects ?? ""),
    notes: String(r.notes ?? ""),
    createdBy: String(r.created_by ?? "管理员"),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

async function caseExistsInMode(
  db: Awaited<ReturnType<typeof getDb>>,
  caseId: string,
  mode: AppMode,
): Promise<boolean> {
  const result = await db.query<{ id: string }>(
    `SELECT id FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1`,
    [caseId, isDemoMode(mode)],
  );
  return Boolean(result.rows[0]);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id } = await context.params;
    const db = await getDb();
    if (!(await caseExistsInMode(db, id, mode))) {
      return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
    }
    const res = await db.query<Record<string, unknown>>(
      `SELECT ssl.*
       FROM sourcing_sample_logs ssl
       JOIN product_cases pc ON pc.id = ssl.case_id
       WHERE ssl.case_id = $1 AND pc.is_demo = $2
       ORDER BY ssl.created_at DESC`,
      [id, isDemoMode(mode)],
    );
    return NextResponse.json({ samples: res.rows.map(mapRow) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取拿样记录失败" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id: caseId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const supplierName = String(body.supplierName ?? "").trim();
    if (!supplierName) {
      return NextResponse.json({ error: "请填写工厂或供应商名称" }, { status: 400 });
    }
    const sampleCostCny = Math.max(0, Number(body.sampleCostCny ?? 0) || 0);
    const shippingCostCny = Math.max(0, Number(body.shippingCostCny ?? 0) || 0);
    const trackingNo = String(body.trackingNo ?? "").trim().slice(0, 80);
    const status = normalizeStatus(body.status);
    const rawRating = body.qualityRating != null && body.qualityRating !== "" ? Number(body.qualityRating) : null;
    const qualityRating = rawRating !== null && Number.isFinite(rawRating)
      ? Math.min(5, Math.max(1, Math.round(rawRating)))
      : null;
    const pros = String(body.pros ?? "").trim().slice(0, 500);
    const defects = String(body.defects ?? "").trim().slice(0, 500);
    const notes = String(body.notes ?? "").trim().slice(0, 500);

    const operator = String(body.actor ?? "").trim() || "本机用户";
    const db = await getDb();
    if (!(await caseExistsInMode(db, caseId, mode))) {
      return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
    }
    const sampleId = `smp-${randomUUID().slice(0, 12)}`;
    const inserted = await db.query<Record<string, unknown>>(
      `INSERT INTO sourcing_sample_logs
        (id, case_id, supplier_name, sample_cost_cny, shipping_cost_cny, tracking_no, status, quality_rating, pros, defects, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [sampleId, caseId, supplierName, sampleCostCny, shippingCostCny, trackingNo, status, qualityRating, pros, defects, notes, operator],
    );
    await recordAuditLog({
      mode,
      actor: operator,
      action: "sourcing.sample_created",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId, supplierName, status, sampleCostCny, shippingCostCny, mode },
    }).catch(() => {});
    return NextResponse.json({ ok: true, sample: mapRow(inserted.rows[0]!) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存拿样记录失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id: caseId } = await context.params;
    const body = (await request.json()) as Record<string, unknown>;
    const sampleId = String(body.sampleId ?? "").trim();
    if (!sampleId) {
      return NextResponse.json({ error: "缺少 sampleId" }, { status: 400 });
    }
    const status = normalizeStatus(body.status);
    const rawRating = body.qualityRating != null && body.qualityRating !== "" ? Number(body.qualityRating) : null;
    const qualityRating = rawRating !== null && Number.isFinite(rawRating)
      ? Math.min(5, Math.max(1, Math.round(rawRating)))
      : null;

    const db = await getDb();
    if (!(await caseExistsInMode(db, caseId, mode))) {
      return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
    }
    const updated = await db.query<Record<string, unknown>>(
      `UPDATE sourcing_sample_logs
       SET status = $1, quality_rating = COALESCE($2, quality_rating), updated_at = NOW()
       WHERE id = $3 AND case_id = $4
         AND EXISTS (
           SELECT 1 FROM product_cases pc
           WHERE pc.id = sourcing_sample_logs.case_id AND pc.is_demo = $5
         )
       RETURNING *`,
      [status, qualityRating, sampleId, caseId, isDemoMode(mode)],
    );
    if (!updated.rows[0]) {
      return NextResponse.json({ error: "未找到对应拿样记录" }, { status: 404 });
    }
    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "sourcing.sample_updated",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId, status, qualityRating: qualityRating ?? undefined, mode },
    }).catch(() => {});
    return NextResponse.json({ ok: true, sample: mapRow(updated.rows[0]) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "更新拿样状态失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const mode = await getAppMode();
    const { id: caseId } = await context.params;
    const { searchParams } = new URL(request.url);
    const sampleId = searchParams.get("sampleId")?.trim();
    if (!sampleId) {
      return NextResponse.json({ error: "缺少 sampleId" }, { status: 400 });
    }
    const db = await getDb();
    if (!(await caseExistsInMode(db, caseId, mode))) {
      return NextResponse.json({ error: "商品案卷不存在" }, { status: 404 });
    }
    const deleted = await db.query<{ id: string }>(
      `DELETE FROM sourcing_sample_logs
       WHERE id = $1 AND case_id = $2
         AND EXISTS (
           SELECT 1 FROM product_cases pc
           WHERE pc.id = sourcing_sample_logs.case_id AND pc.is_demo = $3
         )
       RETURNING id`,
      [sampleId, caseId, isDemoMode(mode)],
    );
    if (!deleted.rows[0]) {
      return NextResponse.json({ error: "未找到对应拿样记录" }, { status: 404 });
    }
    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "sourcing.sample_deleted",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId, mode },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除拿样记录失败" },
      { status: 500 },
    );
  }
}
