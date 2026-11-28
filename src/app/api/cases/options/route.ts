import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { corsHeaders } from "@/lib/api-http";
import { getAppMode, isDemoMode } from "@/lib/app-mode";


export async function OPTIONS(request: Request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request, { methods: "GET, OPTIONS" }),
  });
}

export async function GET(request: Request) {
  const headers = corsHeaders(request, { methods: "GET, OPTIONS" });
  try {
    const db = await getDb();
    const mode = await getAppMode();
    const res = await db.query<{ id: string; asin: string; title: string; marketplace: string }>(
      `SELECT id, asin, title, marketplace
       FROM product_cases
       WHERE is_demo = $1 AND status NOT IN ('archived', 'rejected')
       ORDER BY updated_at DESC
       LIMIT 50`,
      [isDemoMode(mode)],
    );
    return NextResponse.json({ cases: res.rows }, { headers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取商品列表失败", cases: [] },
      { status: 500, headers },
    );
  }
}
