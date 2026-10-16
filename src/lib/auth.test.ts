import { SignJWT } from "jose";
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clearRateLimits,
  createSessionToken,
  getSessionCookieOptions,
  recordRateLimitAttempt,
  resetRateLimit,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  verifyPassword,
  verifySessionToken,
} from "./auth";

describe("auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.APP_PASSWORD = "test-secret-password-123";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars-long";
    clearRateLimits();
  });

  describe("password comparison", () => {
    it("returns true when password matches APP_PASSWORD", () => {
      expect(verifyPassword("test-secret-password-123")).toBe(true);
    });

    it("returns false when password does not match", () => {
      expect(verifyPassword("wrong-password")).toBe(false);
      expect(verifyPassword("test-secret-password-124")).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(verifyPassword("")).toBe(false);
    });

    it("returns false if APP_PASSWORD is not set", () => {
      delete process.env.APP_PASSWORD;
      expect(verifyPassword("test-secret-password-123")).toBe(false);
    });

    it("handles passwords of differing lengths without errors (timing safe)", () => {
      expect(verifyPassword("a")).toBe(false);
      expect(verifyPassword("a".repeat(1000))).toBe(false);
    });
  });

  describe("session token", () => {
    it("signs and verifies a valid JWT session token", async () => {
      const token = await createSessionToken({ authenticated: true });
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);

      const payload = await verifySessionToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.authenticated).toBe(true);

      // Verify expiration is roughly 7 days out
      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + SESSION_MAX_AGE_SECONDS;
      expect(payload?.exp).toBeGreaterThan(now);
      expect(Math.abs((payload?.exp ?? 0) - expectedExp)).toBeLessThan(10);
    });

    it("returns null for malformed or empty tokens", async () => {
      expect(await verifySessionToken("")).toBeNull();
      expect(await verifySessionToken("invalid-token-string")).toBeNull();
      expect(await verifySessionToken("header.payload.signature")).toBeNull();
    });

    it("returns null when token is signed with a different secret", async () => {
      const token = await createSessionToken({ authenticated: true });

      // Change session secret
      process.env.SESSION_SECRET = "completely-different-secret-key-32-chars";
      expect(await verifySessionToken(token)).toBeNull();
    });

    it("returns null for expired tokens", async () => {
      const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
      const expiredToken = await new SignJWT({ authenticated: true })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
        .sign(secret);

      expect(await verifySessionToken(expiredToken)).toBeNull();
    });

    it("provides correct cookie options", () => {
      const options = getSessionCookieOptions();
      expect(options.name).toBe(SESSION_COOKIE_NAME);
      expect(options.httpOnly).toBe(true);
      expect(options.sameSite).toBe("lax");
      expect(options.maxAge).toBe(7 * 24 * 60 * 60);
      expect(options.path).toBe("/");
    });
  });

  describe("rate limiting", () => {
    const ip = "192.168.1.10";

    it("allows up to 5 attempts within 5 minutes", () => {
      for (let i = 0; i < 5; i++) {
        const check = checkRateLimit(ip);
        expect(check.allowed).toBe(true);
        expect(check.remaining).toBe(5 - i);
        recordRateLimitAttempt(ip);
      }

      // 6th attempt should be blocked
      const check = checkRateLimit(ip);
      expect(check.allowed).toBe(false);
      expect(check.remaining).toBe(0);
      expect(check.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("clears attempts when resetRateLimit is called", () => {
      for (let i = 0; i < 5; i++) {
        recordRateLimitAttempt(ip);
      }
      expect(checkRateLimit(ip).allowed).toBe(false);

      resetRateLimit(ip);
      expect(checkRateLimit(ip).allowed).toBe(true);
      expect(checkRateLimit(ip).remaining).toBe(5);
    });

    it("resets after the 5 minute window expires", () => {
      const now = 1_000_000_000;
      for (let i = 0; i < 5; i++) {
        recordRateLimitAttempt(ip, now);
      }
      expect(checkRateLimit(ip, now).allowed).toBe(false);

      // 5 minutes + 1 ms later
      const later = now + 5 * 60 * 1000 + 1;
      expect(checkRateLimit(ip, later).allowed).toBe(true);
      expect(checkRateLimit(ip, later).remaining).toBe(5);
    });

    it("tracks rate limits separately for different IPs", () => {
      const ip1 = "10.0.0.1";
      const ip2 = "10.0.0.2";

      for (let i = 0; i < 5; i++) {
        recordRateLimitAttempt(ip1);
      }
      expect(checkRateLimit(ip1).allowed).toBe(false);
      expect(checkRateLimit(ip2).allowed).toBe(true);
    });
  });
});
