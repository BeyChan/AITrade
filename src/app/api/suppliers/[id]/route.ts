import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getDb } from "@/lib/db";
import { getEffectiveFxRate } from "@/lib/fx-rates";
import type { SupplierProfileMeta, SupplierStatus } from "@/lib/types";
import { getAppMode, isDemoMode } from "@/lib/app-mode";


const VALID_STATUSES: SupplierStatus[] = ["new", "contacted", "sampled", "preferred", "blacklisted"];

export async function GET(
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
    const mode = await getAppMode();
    const demo = isDemoMode(mode);
    const supRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [supplierId, demo],
    );
    const supplier = supRes.rows[0];
    if (!supplier) {
      return NextResponse.json({ error: "未找到该工厂" }, { status: 404 });
    }

    // 1. 历史参与商品与报价记录
    const quotesRes = await db.query<{
      quote_id: string;
      case_id: string;
      asin: string;
      case_title: string;
      marketplace: string;
      unit_price_cents: number;
      moq: number;
      lead_time_days: number | null;
      currency: string;
      raw_payload: Record<string, unknown> | null;
      created_at: string;
      is_selected: boolean;
    }>(
      `SELECT q.id AS quote_id, r.case_id, pc.asin, pc.title AS case_title, pc.marketplace,
              q.unit_price_cents, q.moq, q.lead_time_days, q.currency, q.raw_payload, q.created_at,
              EXISTS(SELECT 1 FROM supplier_selections ss WHERE ss.quote_id = q.id) AS is_selected
       FROM quotes q
       JOIN rfqs r ON r.id = q.rfq_id
       JOIN product_cases pc ON pc.id = r.case_id
       WHERE r.supplier_id = $1 AND pc.is_demo = $2
       ORDER BY q.created_at DESC
       LIMIT 30`,
      [supplierId, demo],
    );

    // 2. 关联的拿样与验货日记（按工厂名模糊匹配）
    const samplesRes = await db
      .query<{
        id: string;
        case_id: string;
        supplier_name: string;
        sample_cost_cny: string | number;
        shipping_cost_cny: string | number;
        tracking_no: string;
        status: string;
        quality_rating: number | null;
        pros: string;
        defects: string;
        created_at: string;
      }>(
        `SELECT s.id, s.case_id, s.supplier_name, s.sample_cost_cny, s.shipping_cost_cny, s.tracking_no,
                s.status, s.quality_rating, s.pros, s.defects, s.created_at
         FROM sourcing_sample_logs s
         JOIN product_cases pc ON pc.id = s.case_id
         WHERE LOWER(s.supplier_name) = LOWER($1) AND pc.is_demo = $2
         ORDER BY s.created_at DESC
         LIMIT 20`,
        [String(supplier.name || ""), demo],
      )
      .catch(() => ({ rows: [] }));

    return NextResponse.json({
      supplier,
      quoteHistory: quotesRes.rows.map((r) => ({
        quoteId: r.quote_id,
        caseId: r.case_id,
        asin: r.asin,
        caseTitle: r.case_title,
        marketplace: r.marketplace,
        unitPriceCents: Number(r.unit_price_cents),
        priceCny: typeof r.raw_payload?.priceCny === "number" ? r.raw_payload.priceCny : null,
        moq: Number(r.moq),
        leadTimeDays: r.lead_time_days !== null ? Number(r.lead_time_days) : null,
        currency: r.currency || "USD",
        isSelected: Boolean(r.is_selected),
        createdAt: String(r.created_at),
      })),
      sampleHistory: samplesRes.rows.map((s) => ({
        id: s.id,
        caseId: s.case_id,
        supplierName: s.supplier_name,
        totalCostCny: Number(s.sample_cost_cny || 0) + Number(s.shipping_cost_cny || 0),
        trackingNo: s.tracking_no,
        status: s.status,
        qualityRating: s.quality_rating !== null ? Number(s.quality_rating) : null,
        pros: s.pros,
        defects: s.defects,
        createdAt: String(s.created_at),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取工厂档案失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const supplierId = (id || "").trim();
    if (!supplierId) {
      return NextResponse.json({ error: "缺少工厂 ID" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      url?: string;
      contact?: string;
      country?: string;
      rating?: number | string;
      notes?: string;
      profile?: SupplierProfileMeta;
    };

    const db = await getDb();
    const mode = await getAppMode();
    const demo = isDemoMode(mode);
    const existingRes = await db.query<Record<string, unknown>>(
      `SELECT * FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [supplierId, demo],
    );
    const current = existingRes.rows[0];
    if (!current) {
      return NextResponse.json({ error: "未找到该工厂" }, { status: 404 });
    }

    const nextName = typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : String(current.name);
    const nextUrl = typeof body.url === "string" ? body.url.trim().slice(0, 500) || null : (current.url as string | null);
    const nextContact = typeof body.contact === "string" ? body.contact.trim().slice(0, 120) || null : (current.contact as string | null);
    const nextCountry = typeof body.country === "string" && body.country.trim()
      ? body.country.trim().slice(0, 40)
      : (current.country as string | null);
    const rawRating = body.rating !== undefined ? Number(body.rating) : Number(current.rating ?? 4.5);
    const nextRating = Number.isFinite(rawRating) ? Math.min(5, Math.max(1, Math.round(rawRating * 10) / 10)) : 4.5;
    const nextNotes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : String(current.notes ?? "");

    const prevProfile = (current.profile && typeof current.profile === "object"
      ? current.profile
      : {}) as SupplierProfileMeta;
    const incomingProfile = body.profile ?? {};
    const statusCandidate = incomingProfile.status ?? prevProfile.status ?? "new";
    const safeStatus: SupplierStatus = VALID_STATUSES.includes(statusCandidate as SupplierStatus)
      ? (statusCandidate as SupplierStatus)
      : "new";

    const nextProfile: SupplierProfileMeta = {
      status: safeStatus,
      wechat: typeof incomingProfile.wechat === "string" ? incomingProfile.wechat.trim().slice(0, 60) : (prevProfile.wechat ?? ""),
      phone: typeof incomingProfile.phone === "string" ? incomingProfile.phone.trim().slice(0, 40) : (prevProfile.phone ?? ""),
      moq: incomingProfile.moq !== undefined
        ? (Number(incomingProfile.moq) > 0 ? Math.round(Number(incomingProfile.moq)) : null)
        : (prevProfile.moq ?? null),
      leadTimeDays: incomingProfile.leadTimeDays !== undefined
        ? (Number(incomingProfile.leadTimeDays) > 0 ? Math.round(Number(incomingProfile.leadTimeDays)) : null)
        : (prevProfile.leadTimeDays ?? null),
      paymentTerms: typeof incomingProfile.paymentTerms === "string"
        ? incomingProfile.paymentTerms.trim().slice(0, 80)
        : (prevProfile.paymentTerms ?? ""),
      supportsOem: incomingProfile.supportsOem !== undefined ? Boolean(incomingProfile.supportsOem) : Boolean(prevProfile.supportsOem),
      supportsCustomBox: incomingProfile.supportsCustomBox !== undefined ? Boolean(incomingProfile.supportsCustomBox) : Boolean(prevProfile.supportsCustomBox),
    };

    const updated = await db.query<Record<string, unknown>>(
      `UPDATE suppliers
       SET name = $1, url = $2, contact = $3, country = $4, rating = $5, notes = $6, profile = $7::jsonb, updated_at = NOW()
       WHERE id = $8 AND is_demo = $9
       RETURNING *`,
      [nextName, nextUrl, nextContact, nextCountry, nextRating, nextNotes, JSON.stringify(nextProfile), supplierId, demo],
    );

    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "supplier.updated",
      entityType: "supplier",
      entityId: supplierId,
      details: { name: nextName, status: nextProfile.status, rating: nextRating },
    }).catch(() => {});

    return NextResponse.json({ ok: true, supplier: updated.rows[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存工厂档案失败" },
      { status: 500 },
    );
  }
}

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
    const mode = await getAppMode();
    const defaultUsdFx = await getEffectiveFxRate("USD", { mode });
    const fxRate = Math.max(0.1, Number(body.fxRate) || defaultUsdFx);
    const moq = Math.max(1, Math.round(Number(body.moq) || 100));
    const unitUsdCents = Math.max(10, Math.round((priceCny / fxRate) * 100));

    const db = await getDb();
    const demo = isDemoMode(mode);
    const [supplierRes, caseRes] = await Promise.all([
      db.query<{ id: string }>(`SELECT id FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`, [supplierId, demo]),
      db.query<{ id: string }>(`SELECT id FROM product_cases WHERE id = $1 AND is_demo = $2 LIMIT 1`, [caseId, demo]),
    ]);
    if (!supplierRes.rows[0]) {
      return NextResponse.json({ error: "未找到当前模式下的工厂" }, { status: 404 });
    }
    if (!caseRes.rows[0]) {
      return NextResponse.json({ error: "未找到当前模式下的商品" }, { status: 404 });
    }
    const rfqId = `rfq-${randomUUID().slice(0, 12)}`;
    const quoteId = `quo-${randomUUID().slice(0, 12)}`;
    await db.transaction(async (tx) => {
      const supplierLock = await tx.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE id = $1 AND is_demo = $2 FOR UPDATE`,
        [supplierId, demo],
      );
      const caseLock = await tx.query<{ id: string }>(
        `SELECT id FROM product_cases WHERE id = $1 AND is_demo = $2 FOR UPDATE`,
        [caseId, demo],
      );
      if (!supplierLock.rows[0] || !caseLock.rows[0]) {
        throw new Error("工厂与商品必须属于同一模式");
      }
      await tx.query(
        `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements)
         VALUES ($1, $2, $3, 'quoted', $4::jsonb)`,
        [rfqId, caseId, supplierId, JSON.stringify({ source: "supplier_directory_link" })],
      );
      await tx.query(
        `INSERT INTO quotes (id, rfq_id, unit_price_cents, moq, lead_time_days, currency, quality_score, raw_payload)
         VALUES ($1, $2, $3, $4, 15, 'USD', 75, $5::jsonb)`,
        [quoteId, rfqId, unitUsdCents, moq, JSON.stringify({ priceCny, fxRate })],
      );
    });

    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "supplier.linked_to_case",
      entityType: "product_case",
      entityId: caseId,
      details: { supplierId, quoteId, priceCny, moq, fxRate },
    }).catch(() => {});

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
    const mode = await getAppMode();
    const demo = isDemoMode(mode);
    const supplierRes = await db.query<{ id: string }>(
      `SELECT id FROM suppliers WHERE id = $1 AND is_demo = $2 LIMIT 1`,
      [supplierId, demo],
    );
    if (!supplierRes.rows[0]) {
      return NextResponse.json({ error: "未找到该工厂记录" }, { status: 404 });
    }
    const selectedRes = await db.query<{ id: string }>(
      `SELECT ss.id
       FROM supplier_selections ss
       JOIN product_cases pc ON pc.id = ss.case_id
       WHERE ss.supplier_id = $1 AND pc.is_demo = $2
       LIMIT 1`,
      [supplierId, demo],
    );
    if (selectedRes.rows.length > 0) {
      return NextResponse.json(
        { error: "该工厂已被正式定标到商品案卷，无法直接移除；请先在对应案卷更换中标工厂。" },
        { status: 409 },
      );
    }

    const deleted = await db.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM rfqs
         WHERE supplier_id = $1
           AND case_id IN (SELECT id FROM product_cases WHERE is_demo = $2)`,
        [supplierId, demo],
      );
      await tx.query(
        `DELETE FROM supplier_external_ids WHERE supplier_id = $1 AND is_demo = $2`,
        [supplierId, demo],
      );
      return tx.query<{ id: string }>(
        `DELETE FROM suppliers WHERE id = $1 AND is_demo = $2 RETURNING id`,
        [supplierId, demo],
      );
    });

    if (deleted.rows.length === 0) {
      return NextResponse.json({ error: "未找到该工厂记录" }, { status: 404 });
    }

    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "supplier.deleted",
      entityType: "supplier",
      entityId: supplierId,
    }).catch(() => {});

    return NextResponse.json({ ok: true, id: supplierId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "移除工厂失败" },
      { status: 500 },
    );
  }
}
