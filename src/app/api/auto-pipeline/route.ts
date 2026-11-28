import { NextResponse } from "next/server";
import {
  getPlatformConfig,
  listAutoCandidates,
  listAutoPipelineRuns,
  listPlatformConfigs,
} from "@/lib/auto-pipeline/repository";
import {
  seedsFromCsv,
  seedsFromExtensionItems,
  seedsFromInboxDirectory,
  type RawExtensionSeed,
} from "@/lib/auto-pipeline/providers";
import { runAutoSourcingPipeline } from "@/lib/auto-pipeline/orchestrator";
import type { AutoGrade, AutoSourceType } from "@/lib/auto-pipeline/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    const { searchParams } = new URL(request.url);
    const platformCode = searchParams.get("platform") || "ALL";
    const marketCode = searchParams.get("market") || "ALL";
    const grade = (searchParams.get("grade") || "ALL") as AutoGrade | "ALL";
    const runId = searchParams.get("runId") || undefined;

    const [configs, runs, candidates] = await Promise.all([
      listPlatformConfigs(),
      listAutoPipelineRuns({ limit: 50 }),
      listAutoCandidates({ platformCode, marketCode, grade, runId, limit: runId && runId !== "ALL" ? 500 : 300 }),
    ]);

    return NextResponse.json({ configs, runs, candidates }, { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取自动选品失败" },
      { status: 500, headers },
    );
  }
}

export async function POST(request: Request) {
  const headers = corsHeaders(request);
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const platformCode = String(body.platformCode || "amazon").trim().toLowerCase();
    const marketCode = String(body.marketCode || "US").trim().toUpperCase();
    const sourceType = String(body.sourceType || "csv").trim() as AutoSourceType;
    const sourceLabel = typeof body.sourceLabel === "string" ? body.sourceLabel : undefined;
    const actor = typeof body.actor === "string" && body.actor.trim() ? body.actor.trim() : "运营人员";

    const config = await getPlatformConfig(platformCode, marketCode);

    let seeds;
    let extraMeta: Record<string, unknown> = {};

    if (sourceType === "csv") {
      const csv = String(body.csv || "");
      if (!csv.trim()) {
        return NextResponse.json({ error: "请提供有效的 CSV 内容" }, { status: 400, headers });
      }
      seeds = seedsFromCsv({
        csv,
        platformCode: config.platformCode,
        marketCode: config.marketCode,
        defaultCurrency: config.currency,
      });
    } else if (sourceType === "extension") {
      const items = Array.isArray(body.items) ? (body.items as RawExtensionSeed[]) : [];
      if (items.length === 0) {
        return NextResponse.json({ error: "扩展推送的商品列表为空" }, { status: 400, headers });
      }
      seeds = seedsFromExtensionItems({
        items,
        platformCode: config.platformCode,
        marketCode: config.marketCode,
        defaultCurrency: config.currency,
      });
    } else if (sourceType === "inbox") {
      const inboxDir =
        (typeof body.inboxDir === "string" && body.inboxDir.trim()) ||
        config.inboxDir ||
        `.data/inbox-csv/${config.platformCode}-${config.marketCode}`;
      const scanned = await seedsFromInboxDirectory({
        inboxDir,
        platformCode: config.platformCode,
        marketCode: config.marketCode,
        defaultCurrency: config.currency,
      });
      seeds = scanned.seeds;
      extraMeta = { inboxDir, filesRead: scanned.filesRead };
      if (seeds.length === 0) {
        return NextResponse.json(
          {
            error: `收件箱目录 ${inboxDir} 下未发现可解析的 CSV 文件`,
            inboxDir,
            filesRead: scanned.filesRead,
          },
          { status: 400, headers },
        );
      }
    } else {
      return NextResponse.json({ error: `暂不支持的触发源：${sourceType}` }, { status: 400, headers });
    }

    if (seeds.length === 0) {
      return NextResponse.json({ error: "未解析出有效的候选商品（请检查 ASIN/ID 与售价列）" }, { status: 400, headers });
    }

    const result = await runAutoSourcingPipeline({
      platformCode: config.platformCode,
      marketCode: config.marketCode,
      sourceType,
      sourceLabel,
      seeds,
      actor,
    });

    return NextResponse.json(
      {
        ok: true,
        ...result,
        ...extraMeta,
        redirectUrl: `/auto-pipeline?platform=${encodeURIComponent(config.platformCode)}&market=${encodeURIComponent(config.marketCode)}`,
      },
      { headers },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "自动选品流水线执行失败" },
      { status: 500, headers },
    );
  }
}
