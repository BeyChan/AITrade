import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supplierId = (id || "").trim();
    const body = (await request.json().catch(() => ({}))) as {
      caseId?: string;
      priceCny?: number;
      moq?: number;
      fxRate?: number;
    };
    const caseId = (body.caseId || "").trim();
    if (!supplierId || !caseId) {
      return NextResponse.json({ error: "请选择要参与的商品" }, { status: 400 });
    }
    const priceCny = Math.max(0.1, Number(body.priceCny) || 25);
    const fxRate = Math.max(0.1, Number(body.fxRate) || 7.25);
    const moq = Math.max(1, Math.round(Number(body.moq) || 100));
    const unitUsdCents = Math.max(10, Math.round((priceCny / fxRate) * 100));

    const db = await getDb();
    const rfqId = `rfq-${randomUUID().slice(0, 12)}`;
    const quoteId = `quo-${randomUUID().slice(0, 12)}`;
    await db.query(
      `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements)
       VALUES ($1, $2, $3, 'quoted', $4::jsonb)`,
      [rfqId, caseId, supplierId, JSON.stringify({ source: "supplier_directory_link" })],
    );
    await db.query(
      `INSERT INTO quotes (id, rfq_id, unit_price_cents, moq, lead_time_days, currency, quality_score, raw_payload)
       VALUES ($1, $2, $3, $4, 15, 'USD', 75, $5::jsonb)`,
      [quoteId, rfqId, unitUsdCents, moq, JSON.stringify({ priceCny, fxRate })],
    );

    return NextResponse.json({
      ok: true,
      caseId,
      redirectUrl: `/cases/${encodeURIComponent(caseId)}/sourcing`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "关联商品失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supplierId = (id || "").trim();
    if (!supplierId) {
      return NextResponse.json({ error: "缺少工厂 ID" }, { status: 400 });
    }

    const db = await getDb();
    const selectedRes = await db.query<{ id: string }>(
      `SELECT id FROM supplier_selections WHERE supplier_id = $1 LIMIT 1`,
      [supplierId],
    );
    if (selectedRes.rows.length > 0) {
      return NextResponse.json(
        { error: "该工厂已被正式定标到商品案卷，无法直接移除；请先在对应案卷更换中标工厂。" },
        { status: 409 },
      );
    }

    // 清理未定标的关联询价单与外部 ID 映射，再删除工厂主记录
    await db.query(`DELETE FROM rfqs WHERE supplier_id = $1`, [supplierId]);
    await db.query(`DELETE FROM supplier_external_ids WHERE supplier_id = $1`, [supplierId]);
    const deleted = await db.query<{ id: string }>(
      `DELETE FROM suppliers WHERE id = $1 RETURNING id`,
      [supplierId],
    );

    if (deleted.rows.length === 0) {
      return NextResponse.json({ error: "未找到该工厂记录" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: supplierId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "移除工厂失败" },
      { status: 500 },
    );
  }
}
