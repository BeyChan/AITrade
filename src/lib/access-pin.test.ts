import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkUnlockRateLimit,
  clearUnlockFailures,
  deriveAccessToken,
  recordUnlockFailure,
  verifyAccessCookie,
  verifyAccessPin,
} from "./access-pin.ts";

describe("access-pin token & rate limiting", () => {
  it("derives non-plaintext signed token and verifies cookie safely", () => {
    const pin = "super-secret-2026";
    const token = deriveAccessToken(pin);
    assert.ok(token.startsWith("v1."));
    assert.ok(!token.includes(pin));
    assert.equal(verifyAccessCookie(token, pin), true);
    assert.equal(verifyAccessCookie(pin, pin), false);
    assert.equal(verifyAccessCookie(token, "wrong-pin"), false);
    assert.equal(verifyAccessPin(pin, pin), true);
    assert.equal(verifyAccessPin("wrong", pin), false);
  });

  it("blocks after 5 consecutive failures and recovers after clear or lockout", () => {
    const key = `test-client-${Date.now()}`;
    const base = 1_700_000_000_000;
    clearUnlockFailures(key);

    for (let i = 0; i < 4; i += 1) {
      const res = recordUnlockFailure(key, base + i * 1000);
      assert.equal(res.blocked, false);
      assert.equal(checkUnlockRateLimit(key, base + i * 1000).allowed, true);
    }

    const fifth = recordUnlockFailure(key, base + 4000);
    assert.equal(fifth.blocked, true);
    const limited = checkUnlockRateLimit(key, base + 5000);
    assert.equal(limited.allowed, false);
    assert.ok(limited.retryAfterSeconds > 0);

    // After lockout expires
    assert.equal(checkUnlockRateLimit(key, base + 6 * 60 * 1000).allowed, true);
    clearUnlockFailures(key);
  });
});
