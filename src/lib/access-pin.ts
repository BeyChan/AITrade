import { createHmac, timingSafeEqual } from "node:crypto";

export const AUTH_COOKIE = "aitrade_access_ok";

const TOKEN_VERSION = "v1";
const TOKEN_DOMAIN = "aitrade.access-pin.session";

/**
 * 基于访问口令派生存放在 HttpOnly Cookie 中的签名令牌，避免明文口令落盘到浏览器 Cookie。
 */
export function deriveAccessToken(pin: string, salt = process.env.APP_SESSION_SECRET?.trim() || TOKEN_DOMAIN): string {
  const mac = createHmac("sha256", `${TOKEN_DOMAIN}:${salt}`).update(pin).digest("base64url");
  return `${TOKEN_VERSION}.${mac}`;
}

export function safeTextEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyAccessCookie(cookieValue: string | undefined, configuredPin: string): boolean {
  if (!cookieValue || !configuredPin) return false;
  const expected = deriveAccessToken(configuredPin);
  return safeTextEqual(cookieValue, expected);
}

export function verifyAccessPin(inputPin: string, configuredPin: string): boolean {
  if (!inputPin || !configuredPin) return false;
  return safeTextEqual(inputPin, configuredPin);
}

type RateBucket = {
  attempts: number[];
  blockedUntil: number;
};

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

declare global {
  // eslint-disable-next-line no-var
  var __aitradePinRateLimits: Map<string, RateBucket> | undefined;
}

function getRateMap(): Map<string, RateBucket> {
  if (!globalThis.__aitradePinRateLimits) {
    globalThis.__aitradePinRateLimits = new Map();
  }
  return globalThis.__aitradePinRateLimits;
}

export function checkUnlockRateLimit(clientKey: string, now = Date.now()): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const map = getRateMap();
  const bucket = map.get(clientKey);
  if (!bucket) return { allowed: true, retryAfterSeconds: 0 };

  if (bucket.blockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    };
  }

  bucket.attempts = bucket.attempts.filter((ts) => now - ts < WINDOW_MS);
  if (bucket.attempts.length === 0) {
    map.delete(clientKey);
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordUnlockFailure(clientKey: string, now = Date.now()): {
  blocked: boolean;
  retryAfterSeconds: number;
  remainingAttempts: number;
} {
  const map = getRateMap();
  const bucket = map.get(clientKey) ?? { attempts: [], blockedUntil: 0 };
  bucket.attempts = bucket.attempts.filter((ts) => now - ts < WINDOW_MS);
  bucket.attempts.push(now);

  if (bucket.attempts.length >= MAX_FAILURES) {
    bucket.blockedUntil = now + LOCKOUT_MS;
    map.set(clientKey, bucket);
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000),
      remainingAttempts: 0,
    };
  }

  map.set(clientKey, bucket);
  return {
    blocked: false,
    retryAfterSeconds: 0,
    remainingAttempts: Math.max(0, MAX_FAILURES - bucket.attempts.length),
  };
}

export function clearUnlockFailures(clientKey: string): void {
  getRateMap().delete(clientKey);
}

export function extractClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "local";
}
