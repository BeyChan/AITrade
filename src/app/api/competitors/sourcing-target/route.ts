import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";
import { getDb } from "@/lib/db";
import { getComparisonReportById } from "@/lib/competitor-compare/storage";
import { corsHeaders } from "@/lib/api-http";
import { getAppMode, isDemoMode } from "@/lib/app-mode";


export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, { methods: "GET, POST, OPTIONS" }),
  });
}

/** 供 Chrome 扩展在 1688 页面拉取「待回补进价的竞品列表」 */
export async function GET(request: Request) {
  const headers = corsHeaders(request, { methods: "GET, POST, OPTIONS" });
  try {
    const db = await getDb();
    const mode = await getAppMode();
    const demo = isDemoMode(mode);
    const res = await db.query<{
      report_id: string;
      asin: string;
      title: string;
      market_code: string;
      target_max_cny: string | number;
      competitor_count: number;
      updated_at: string;
    }>(
      `SELECT report_id, asin, title, market_code, target_max_cny, competitor_count, updated_at
       FROM competitor_sourcing_targets
       WHERE is_demo = $1
       ORDER BY updated_at DESC
       LIMIT 10`,
      [demo],
    );
    const pending: Array<{
      reportId: string;
      asin: string;
      title: string;
      marketCode: string;
      targetMaxCny: number;
      competitorCount: number;
      updatedAt: string;
    }> = [];
    for (const r of res.rows) {
      const report = await getComparisonReportById(r.report_id, { mode }).catch(() => null);
      const comp = report?.competitors.find((c) => (c.asin || "").toUpperCase() === r.asin.toUpperCase());
      // 研报已删或该单品已完成进价回补/手填 -> 自动清出待回补队列
      if (!report || !comp || (comp.sourcingCost?.actualCny && comp.sourcingCost.actualCny > 0)) {
        await db.query(
          `DELETE FROM competitor_sourcing_targets WHERE id = $1 AND is_demo = $2`,
          [`${r.report_id}:${r.asin}`, demo],
        ).catch(() => {});
        continue;
      }
      pending.push({
        reportId: r.report_id,
        asin: r.asin,
        title: r.title,
        marketCode: r.market_code,
        targetMaxCny: Number(r.target_max_cny) || 0,
        competitorCount: Number(r.competitor_count) || 1,
        updatedAt: r.updated_at,
      });
    }
    return NextResponse.json({ targets: pending }, { headers });
  } catch {
    return NextResponse.json({ targets: [] }, { headers });
  }
}

/** 用户在竞品研报点「搜 1688 同款」时，记录当前待回补竞品锚点 */
export async function POST(request: Request) {
  const headers = corsHeaders(request, { methods: "GET, POST, OPTIONS" });
  try {
    const body = (await request.json()) as {
      reportId?: string;
      asin?: string;
      title?: string;
      marketCode?: string;
      targetMaxCny?: number;
      competitorCount?: number;
    };
    const reportId = (body.reportId || "").trim();
    const asin = (body.asin || "").trim().toUpperCase();
    if (!reportId || !asin) {
      return NextResponse.json({ error: "缺少 reportId 或 asin" }, { status: 400, headers });
    }
    const db = await getDb();
    const mode = await getAppMode();
    const demo = isDemoMode(mode);
    const report = await getComparisonReportById(reportId, { mode });
    if (!report) {
      return NextResponse.json({ error: "未找到当前模式下的竞品研报" }, { status: 404, headers });
    }
    const id = `${reportId}:${asin}`;
    const targetMaxCny = Number.isFinite(Number(body.targetMaxCny)) ? Math.max(0, Number(body.targetMaxCny)) : 0;
    const competitorCount = Number.isFinite(Number(body.competitorCount)) && Number(body.competitorCount) > 0
      ? Math.round(Number(body.competitorCount))
      : 1;
    const saved = await db.query<{ id: string }>(
      `INSERT INTO competitor_sourcing_targets (id, report_id, asin, title, market_code, target_max_cny, competitor_count, updated_at, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         market_code = EXCLUDED.market_code,
         target_max_cny = EXCLUDED.target_max_cny,
         competitor_count = EXCLUDED.competitor_count,
         updated_at = NOW()
       WHERE competitor_sourcing_targets.is_demo = EXCLUDED.is_demo
       RETURNING id`,
      [id, reportId, asin, (body.title || "").slice(0, 120), (body.marketCode || "US").toUpperCase(), targetMaxCny, competitorCount, demo],
    );
    if (!saved.rows[0]) {
      return NextResponse.json({ error: "该回补目标已被另一模式占用" }, { status: 409, headers });
    }
    await recordAuditLog({
      mode,
      actor: "本机用户",
      action: "competitor.sourcing_target_saved",
      entityType: "competitor_report",
      entityId: reportId,
      details: {
        asin,
        marketCode: (body.marketCode || "US").toUpperCase(),
        targetMaxCny,
        competitorCount,
      },
    }).catch(() => {});
    return NextResponse.json({ ok: true, id }, { headers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存待回补目标失败" },
      { status: 500, headers },
    );
  }
}
