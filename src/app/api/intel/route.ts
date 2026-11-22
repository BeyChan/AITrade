import { NextResponse } from "next/server";
import { getMarketIntelSnapshot, refreshMarketIntel } from "@/lib/market-intel";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const auto = url.searchParams.get("auto") === "1";

    if (force) {
      const result = await refreshMarketIntel("手动刷新", true);
      return NextResponse.json(result);
    }

    const current = await getMarketIntelSnapshot();
    if (auto && (current.isStale || current.items.length === 0)) {
      const result = await refreshMarketIntel("自动同步", false);
      return NextResponse.json(result);
    }

    return NextResponse.json({ snapshot: current, refreshed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取跨境情报失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await refreshMarketIntel("本机管理员", true);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "刷新跨境情报失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
