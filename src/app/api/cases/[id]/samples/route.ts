import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

let sampleTableReadyPromise: Promise<void> | null = null;

async function ensureSampleTable(): Promise<void> {
  if (!sampleTableReadyPromise) {
    sampleTableReadyPromise = (async () => {
      const db = await getDb();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sourcing_sample_logs (
          id TEXT PRIMARY KEY,
          case_id TEXT NOT NULL REFERENCES product_cases(id) ON DELETE CASCADE,
          supplier_name TEXT NOT NULL,
          sample_cost_cny NUMERIC(10, 2) NOT NULL DEFAULT 0,
          shipping_cost_cny NUMERIC(10, 2) NOT NULL DEFAULT 0,
          tracking_no TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'ordered'
            CHECK (status IN ('ordered', 'received', 'passed', 'failed', 'returned')),
          quality_rating INTEGER CHECK (quality_rating IS NULL OR quality_rating BETWEEN 1 AND 5),
          pros TEXT NOT NULL DEFAULT '',
          defects TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '管理员',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch((err) => {
      sampleTableReadyPromise = null;
      throw err;
    });
  }
  await sampleTableReadyPromise;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    await ensureSampleTable();
    const db = await getDb();
    const res = await db.query<Record<string, unknown>>(
      `SELECT * FROM sourcing_sample_logs WHERE case_id = $1 ORDER BY created_at DESC`,
      [id],
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
    await ensureSampleTable();
    const db = await getDb();
    const sampleId = `smp-${randomUUID().slice(0, 12)}`;
    const inserted = await db.query<Record<string, unknown>>(
      `INSERT INTO sourcing_sample_logs
        (id, case_id, supplier_name, sample_cost_cny, shipping_cost_cny, tracking_no, status, quality_rating, pros, defects, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [sampleId, caseId, supplierName, sampleCostCny, shippingCostCny, trackingNo, status, qualityRating, pros, defects, notes, operator],
    );
    await recordAuditLog({
      actor: operator,
      action: "sourcing.sample_created",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId, supplierName, status, sampleCostCny, shippingCostCny },
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
    const updated = await db.query<Record<string, unknown>>(
      `UPDATE sourcing_sample_logs
       SET status = $1, quality_rating = COALESCE($2, quality_rating), updated_at = NOW()
       WHERE id = $3 AND case_id = $4
       RETURNING *`,
      [status, qualityRating, sampleId, caseId],
    );
    if (!updated.rows[0]) {
      return NextResponse.json({ error: "未找到对应拿样记录" }, { status: 404 });
    }
    await recordAuditLog({
      actor: "本机用户",
      action: "sourcing.sample_updated",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId, status, qualityRating: qualityRating ?? undefined },
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
    const { id: caseId } = await context.params;
    const { searchParams } = new URL(request.url);
    const sampleId = searchParams.get("sampleId")?.trim();
    if (!sampleId) {
      return NextResponse.json({ error: "缺少 sampleId" }, { status: 400 });
    }
    const db = await getDb();
    await db.query(`DELETE FROM sourcing_sample_logs WHERE id = $1 AND case_id = $2`, [sampleId, caseId]);
    await recordAuditLog({
      actor: "本机用户",
      action: "sourcing.sample_deleted",
      entityType: "sourcing_sample",
      entityId: sampleId,
      details: { caseId },
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "删除拿样记录失败" },
      { status: 500 },
    );
  }
}
