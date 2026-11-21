import { NextResponse } from "next/server";

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
    return NextResponse.json({ error: "访问口令不正确，请重试" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, configuredPin, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
