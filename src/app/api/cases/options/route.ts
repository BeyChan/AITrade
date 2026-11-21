import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const headers = corsHeaders(request);
  try {
    const db = await getDb();
    const res = await db.query<{ id: string; asin: string; title: string; marketplace: string }>(
      `SELECT id, asin, title, marketplace
       FROM product_cases
       WHERE status NOT IN ('archived', 'rejected')
       ORDER BY updated_at DESC
       LIMIT 50`,
    );
    return NextResponse.json({ cases: res.rows }, { headers });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "读取商品列表失败", cases: [] },
      { status: 500, headers },
    );
  }
}
