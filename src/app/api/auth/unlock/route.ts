import { NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  checkUnlockRateLimit,
  clearUnlockFailures,
  deriveAccessToken,
  extractClientKey,
  recordUnlockFailure,
  verifyAccessPin,
} from "@/lib/access-pin";
import { recordAuditLog } from "@/lib/audit-logs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const configuredPin = process.env.APP_ACCESS_PIN?.trim();
  if (!configuredPin) {
    return NextResponse.json({ ok: true });
  }

  const clientKey = extractClientKey(request);
  const limit = checkUnlockRateLimit(clientKey);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `尝试次数过多，请 ${limit.retryAfterSeconds} 秒后再试` },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { pin?: string };
  const pin = String(body.pin ?? "").trim();
  if (!verifyAccessPin(pin, configuredPin)) {
    const failure = recordUnlockFailure(clientKey);
    await recordAuditLog({
      actor: "访客",
      action: "auth.pin_failed",
      entityType: "auth_access",
      entityId: "pin",
      details: { reason: "口令不匹配", blocked: failure.blocked },
    }).catch(() => {});
    if (failure.blocked) {
      return NextResponse.json(
        { error: `口令连续错误过多，请 ${failure.retryAfterSeconds} 秒后再试` },
        {
          status: 429,
          headers: { "Retry-After": String(failure.retryAfterSeconds) },
        },
      );
    }
    return NextResponse.json({ error: "访问口令不正确，请重试" }, { status: 401 });
  }

  clearUnlockFailures(clientKey);
  await recordAuditLog({
    actor: "本机用户",
    action: "auth.pin_unlocked",
    entityType: "auth_access",
    entityId: "pin",
    details: { sessionDays: 30 },
  }).catch(() => {});

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, deriveAccessToken(configuredPin), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
