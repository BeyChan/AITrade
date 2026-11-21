import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

type Captured1688Item = {
  title?: string;
  supplierName?: string;
  offerUrl?: string;
  supplierUrl?: string;
  price?: string;
  priceText?: string;
  priceCny?: number;
  moqText?: string;
  moq?: number | string;
  location?: string;
};

function parseCny(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const m = raw.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (m) {
      const v = Number(m[0]);
      if (Number.isFinite(v) && v > 0) return v;
    }
  }
  return 0;
}

function parseMoq(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw === "string") {
    const m = raw.replace(/,/g, "").match(/\d+/);
    if (m) {
      const v = Number(m[0]);
      if (Number.isFinite(v) && v > 0) return Math.round(v);
    }
  }
  return 100;
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    const body = (await request.json()) as {
      caseId?: string;
      fxRate?: number;
      candidates?: Captured1688Item[];
    };
    const caseId = (body.caseId || "").trim() || null;
    const fxRate = Number(body.fxRate) > 0 ? Number(body.fxRate) : 7.25;
    const rawList = Array.isArray(body.candidates) ? body.candidates.slice(0, 30) : [];

    if (rawList.length === 0) {
      return NextResponse.json({ error: "未收到有效的 1688 工厂候选" }, { status: 400, headers });
    }

    const db = await getDb();
    let importedSuppliers = 0;
    let importedQuotes = 0;

    for (const item of rawList) {
      const supplierName = (item.supplierName || item.title || "").trim().slice(0, 80);
      if (!supplierName) continue;
      const supplierUrl = (item.supplierUrl || item.offerUrl || "").trim().slice(0, 500);
      const location = (item.location || "CN").trim().slice(0, 40);
      const cny = parseCny(item.priceCny ?? item.priceText ?? item.price);
      const moq = parseMoq(item.moq ?? item.moqText);

      // 1. 按名称查重或写入全局 1688 工厂库
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM suppliers WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [supplierName],
      );
      let supplierId = existing.rows[0]?.id;
      if (!supplierId) {
        supplierId = `sup-${randomUUID().slice(0, 12)}`;
        await db.query(
          `INSERT INTO suppliers (id, name, platform, url, country, rating, notes)
           VALUES ($1, $2, '1688', $3, $4, 4.6, $5)`,
          [
            supplierId,
            supplierName,
            supplierUrl || null,
            location || "CN",
            item.title ? `1688 采集商品：${item.title.slice(0, 120)}` : "Chrome 扩展采集",
          ],
        );
        importedSuppliers += 1;
      }

      // 2. 若指定了商品案卷且采到了价格，同步写入该案卷的 RFQ 与报价比价表
      if (caseId && cny > 0) {
        const unitUsdCents = Math.max(10, Math.round((cny / fxRate) * 100));
        const rfqId = `rfq-${randomUUID().slice(0, 12)}`;
        const quoteId = `quo-${randomUUID().slice(0, 12)}`;
        await db.query(
          `INSERT INTO rfqs (id, case_id, supplier_id, status, requirements)
           VALUES ($1, $2, $3, 'quoted', $4::jsonb)`,
          [
            rfqId,
            caseId,
            supplierId,
            JSON.stringify({ source: "1688_extension", offerTitle: item.title || "", offerUrl: item.offerUrl || "" }),
          ],
        );
        await db.query(
          `INSERT INTO quotes (id, rfq_id, unit_price_cents, moq, lead_time_days, currency, quality_score, raw_payload)
           VALUES ($1, $2, $3, $4, 15, 'USD', 75, $5::jsonb)`,
          [
            quoteId,
            rfqId,
            unitUsdCents,
            moq,
            JSON.stringify({ priceCny: cny, fxRate, offerUrl: item.offerUrl || "", title: item.title || "" }),
          ],
        );
        importedQuotes += 1;
      }
    }

    const redirectUrl = caseId ? `/cases/${encodeURIComponent(caseId)}/sourcing` : "/sourcing";
    return NextResponse.json(
      {
        ok: true,
        importedSuppliers,
        importedQuotes,
        totalReceived: rawList.length,
        redirectUrl,
      },
      { headers },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "写入 1688 工厂数据失败" },
      { status: 500, headers },
    );
  }
}
