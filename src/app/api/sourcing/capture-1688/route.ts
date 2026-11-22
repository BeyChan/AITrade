import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getDb } from "@/lib/db";
import { getEffectiveFxRate } from "@/lib/fx-rates";
import { getComparisonReportById, saveComparisonReport } from "@/lib/competitor-compare/storage";

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
      reportId?: string;
      competitorAsin?: string;
      fxRate?: number;
      candidates?: Captured1688Item[];
    };
    const rawTarget = (body.caseId || "").trim();
    let caseId: string | null = rawTarget || null;
    let reportId: string | null = (body.reportId || "").trim() || null;
    let competitorAsin: string | null = (body.competitorAsin || "").trim().toUpperCase() || null;
    // 兼容扩展下拉框统一 value 格式："report:<reportId>:<asin>"
    if (rawTarget.startsWith("report:")) {
      const parts = rawTarget.split(":");
      if (parts.length >= 3) {
        reportId = parts[1] || null;
        competitorAsin = (parts[2] || "").toUpperCase() || null;
        caseId = null;
      }
    }
    const defaultUsdFx = await getEffectiveFxRate("USD");
    const fxRate = Number(body.fxRate) > 0 ? Number(body.fxRate) : defaultUsdFx;
    const rawList = Array.isArray(body.candidates) ? body.candidates.slice(0, 30) : [];

    if (rawList.length === 0) {
      return NextResponse.json({ error: "未收到有效的 1688 工厂候选" }, { status: 400, headers });
    }

    const db = await getDb();
    let importedSuppliers = 0;
    let importedQuotes = 0;
    const collectedOffers: Array<{ cny: number; supplierName: string; offerUrl: string }> = [];

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
      const noteText = item.title
        ? `1688 采集商品：${item.title.slice(0, 120)}${cny > 0 ? `（参考价 ¥${cny} / MOQ ${moq}）` : ""}`
        : cny > 0
          ? `Chrome 扩展采集（参考价 ¥${cny} / MOQ ${moq}）`
          : "Chrome 扩展采集";
      const profileJson = JSON.stringify({
        ...(cny > 0 ? { priceCny: cny } : {}),
        ...(moq > 0 ? { moq } : {}),
        ...(item.title ? { offerTitle: item.title.slice(0, 120) } : {}),
      });
      if (!supplierId) {
        supplierId = `sup-${randomUUID().slice(0, 12)}`;
        await db.exec(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;`).catch(() => {});
        await db.query(
          `INSERT INTO suppliers (id, name, platform, url, country, rating, notes, profile)
           VALUES ($1, $2, '1688', $3, $4, 4.6, $5, $6::jsonb)`,
          [
            supplierId,
            supplierName,
            supplierUrl || null,
            location || "CN",
            noteText,
            profileJson,
          ],
        );
        importedSuppliers += 1;
      } else if (cny > 0) {
        await db.exec(`ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;`).catch(() => {});
        await db.query(
          `UPDATE suppliers SET profile = COALESCE(profile, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
          [supplierId, profileJson],
        ).catch(() => {});
      }

      if (cny > 0) {
        collectedOffers.push({
          cny,
          supplierName,
          offerUrl: (item.offerUrl || supplierUrl || "").trim(),
        });
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

    // 3. 若选择了「回补竞品研报进价」，把本次采到的真实人民币中位价/最低价直接写回对应竞品 ASIN
    let backfilledCompetitor = false;
    let backfilledActualCny: number | null = null;
    let backfilledMarket = "";
    let backfilledPlatform = "";
    if (reportId && competitorAsin && collectedOffers.length > 0) {
      const report = await getComparisonReportById(reportId, { mode: "sandbox" });
      if (report) {
        const sorted = [...collectedOffers].sort((a, b) => a.cny - b.cny);
        const median = sorted[Math.floor(sorted.length / 2)]!;
        const best = sorted[0]!;
        const maxOffer = sorted[sorted.length - 1]!;
        const updatedCompetitors = report.competitors.map((c) => {
          if ((c.asin || "").toUpperCase() !== competitorAsin) return c;
          backfilledCompetitor = true;
          backfilledActualCny = Number(median.cny.toFixed(2));
          backfilledMarket = report.marketCode || "US";
          backfilledPlatform = report.platformCode || "amazon";
          return {
            ...c,
            sourcingCost: {
              actualCny: Number(median.cny.toFixed(2)),
              minCny: Number(best.cny.toFixed(2)),
              maxCny: Number(maxOffer.cny.toFixed(2)),
              sampleCount: sorted.length,
              bestSupplierName: best.supplierName,
              bestOfferUrl: best.offerUrl || undefined,
              updatedAt: new Date().toISOString(),
            },
          };
        });
        if (backfilledCompetitor) {
          await saveComparisonReport({ ...report, competitors: updatedCompetitors });
          // 回补完成后自动移出待回补列表，不再重复出现在 Chrome 扩展下拉框
          await db.query(
            `DELETE FROM competitor_sourcing_targets WHERE id = $1`,
            [`${reportId}:${competitorAsin}`],
          ).catch(() => {});
        }
      }
    }

    await recordAuditLog({
      actor: "Chrome 采集扩展",
      action: "sourcing.1688_captured",
      entityType: caseId ? "product_case" : "supplier",
      entityId: caseId || reportId || "1688-batch",
      details: {
        importedSuppliers,
        importedQuotes,
        totalReceived: rawList.length,
        backfilledCompetitor,
        backfilledActualCny: backfilledActualCny ?? undefined,
        competitorAsin: competitorAsin ?? undefined,
      },
    }).catch(() => {});

    const redirectUrl = backfilledCompetitor && reportId
      ? `/competitors?id=${encodeURIComponent(reportId)}&market=${encodeURIComponent(backfilledMarket || "US")}&platform=${encodeURIComponent(backfilledPlatform || "amazon")}`
      : caseId
        ? `/cases/${encodeURIComponent(caseId)}/sourcing`
        : "/sourcing";
    return NextResponse.json(
      {
        ok: true,
        importedSuppliers,
        importedQuotes,
        backfilledCompetitor,
        backfilledActualCny,
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
