import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "aitrade_access_ok";

function isPublicPath(pathname: string): boolean {
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/unlock" ||
    pathname === "/api/auth/unlock" ||
    pathname === "/api/health"
  ) {
    return true;
  }
  return false;
}

export function proxy(request: NextRequest) {
  const configuredPin = process.env.APP_ACCESS_PIN?.trim();
  if (!configuredPin) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const cookieVal = request.cookies.get(AUTH_COOKIE)?.value;
  if (cookieVal === configuredPin) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "未授权访问，请先输入访问口令" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  const nextTarget = `${pathname}${search}`;
  if (nextTarget && nextTarget !== "/") {
    unlockUrl.searchParams.set("next", nextTarget);
  }
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|webp|ico|csv)$).*)"],
};
