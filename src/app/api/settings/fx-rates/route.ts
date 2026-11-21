import { NextResponse } from "next/server";
import {
  clearManualFxRate,
  getFxRatesSnapshot,
  refreshLiveFxRates,
  setManualFxRate,
} from "@/lib/fx-rates";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1";
    const autoRefresh = url.searchParams.get("auto") === "1";

    if (forceRefresh) {
      const result = await refreshLiveFxRates("手动刷新");
      return NextResponse.json(result);
    }

    const current = await getFxRatesSnapshot();
    if (autoRefresh && current.isLiveStale) {
      const result = await refreshLiveFxRates("自动同步");
      return NextResponse.json(result);
    }

    return NextResponse.json({ snapshot: current, refreshed: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取汇率失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: "refresh" | "set_manual" | "clear_manual";
      currency?: string;
      rateToRmb?: number;
      actor?: string;
    };

    const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "本机管理员";

    if (body.action === "refresh") {
      const result = await refreshLiveFxRates(actor);
      return NextResponse.json(result);
    }

    if (body.action === "set_manual") {
      if (!body.currency) {
        return NextResponse.json({ error: "缺少币种参数" }, { status: 400 });
      }
      const snapshot = await setManualFxRate({
        currency: body.currency,
        rateToRmb: Number(body.rateToRmb),
        actor,
      });
      return NextResponse.json({ snapshot, refreshed: false });
    }

    if (body.action === "clear_manual") {
      if (!body.currency) {
        return NextResponse.json({ error: "缺少币种参数" }, { status: 400 });
      }
      const snapshot = await clearManualFxRate({
        currency: body.currency,
        actor,
      });
      return NextResponse.json({ snapshot, refreshed: false });
    }

    return NextResponse.json({ error: "不支持的操作类型" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存汇率失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
