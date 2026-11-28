import { NextResponse } from "next/server";
import { getPlatformConfig } from "@/lib/auto-pipeline/repository";
import { listInboxPendingCsvFiles } from "@/lib/auto-pipeline/providers";


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const platformCode = (searchParams.get("platform") || "amazon").trim().toLowerCase();
    const marketCode = (searchParams.get("market") || "US").trim().toUpperCase();
    const config = await getPlatformConfig(platformCode, marketCode);
    const inboxDir =
      config.inboxDir || `.data/inbox-csv/${config.platformCode}-${config.marketCode}`;
    const status = await listInboxPendingCsvFiles(inboxDir);
    return NextResponse.json({
      ok: true,
      inboxDir: status.inboxDir,
      pendingCount: status.pendingFiles.length,
      pendingFiles: status.pendingFiles,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "检测收件箱状态失败" },
      { status: 400 },
    );
  }
}
