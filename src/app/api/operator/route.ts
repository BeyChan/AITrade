import { NextResponse } from "next/server";
import {
  OPERATOR_COOKIE_NAME,
  ROLE_COOKIE_NAME,
  sanitizeOperatorName,
  sanitizeWorkspaceRole,
} from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: string; role?: string };
    const name = sanitizeOperatorName(body.name);
    const role = sanitizeWorkspaceRole(body.role);
    const response = NextResponse.json({ ok: true, operator: name, role });
    const cookieOpts = {
      httpOnly: false,
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 60 * 24 * 180,
    };
    response.cookies.set(OPERATOR_COOKIE_NAME, name, cookieOpts);
    response.cookies.set(ROLE_COOKIE_NAME, role, cookieOpts);
    return response;
  } catch {
    return NextResponse.json({ error: "无法更新成员身份" }, { status: 400 });
  }
}
