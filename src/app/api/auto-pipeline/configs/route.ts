import { NextResponse } from "next/server";
import { listPlatformConfigs, upsertPlatformConfig } from "@/lib/auto-pipeline/repository";
import type {
  AutoGradingThresholds,
  DeliveryMethodCode,
  PlatformEconomicsDefaults,
} from "@/lib/auto-pipeline/types";


export async function GET() {
  try {
    const configs = await listPlatformConfigs();
    return NextResponse.json({ configs });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取平台配置失败" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const platformCode = String(body.platformCode || "").trim().toLowerCase();
    const marketCode = String(body.marketCode || "").trim().toUpperCase();
    if (!platformCode || !marketCode) {
      return NextResponse.json({ error: "必须提供 platformCode 和 marketCode" }, { status: 400 });
    }

    const updated = await upsertPlatformConfig({
      platformCode,
      marketCode,
      currency: typeof body.currency === "string" ? body.currency : undefined,
      enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
      label: typeof body.label === "string" ? body.label : undefined,
      economicsDefaults: (body.economicsDefaults as Partial<PlatformEconomicsDefaults> | undefined) ?? undefined,
      thresholds: (body.thresholds as Partial<AutoGradingThresholds> | undefined) ?? undefined,
      deliveryMethods: Array.isArray(body.deliveryMethods)
        ? (body.deliveryMethods as DeliveryMethodCode[])
        : undefined,
      inboxDir: body.inboxDir === null || typeof body.inboxDir === "string" ? body.inboxDir : undefined,
      actor: typeof body.actor === "string" ? body.actor : "运营人员",
    });

    return NextResponse.json({ ok: true, config: updated });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存平台配置失败" },
      { status: 500 },
    );
  }
}
