import { NextResponse } from "next/server";
import { recordAuditLog } from "@/lib/audit-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AUTH_COOKIE = "aitrade_access_ok";

export async function POST(request: Request) {
  const configuredPin = process.env.APP_ACCESS_PIN?.trim();
  if (!configuredPin) {
    return NextResponse.json({ ok: true });
  }

  const body = (await request.json().catch(() => ({}))) as { pin?: string };
  const pin = String(body.pin ?? "").trim();
  if (!pin || pin !== configuredPin) {
    await recordAuditLog({
      actor: "访客",
      action: "auth.pin_failed",
      entityType: "auth_access",
      entityId: "pin",
      details: { reason: "口令不匹配" },
    }).catch(() => {});
    return NextResponse.json({ error: "访问口令不正确，请重试" }, { status: 401 });
  }

  await recordAuditLog({
    actor: "本机用户",
    action: "auth.pin_unlocked",
    entityType: "auth_access",
    entityId: "pin",
    details: { sessionDays: 30 },
  }).catch(() => {});

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, configuredPin, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
