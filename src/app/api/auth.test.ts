import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as loginHandler } from "@/app/api/auth/login/route";
import { POST as logoutHandler } from "@/app/api/auth/logout/route";
import { GET as healthHandler } from "@/app/api/health/route";
import { clearRateLimits, createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { middleware } from "@/middleware";

describe("auth integration and middleware", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.APP_PASSWORD = "super-secret-password";
    process.env.SESSION_SECRET = "session-secret-must-be-at-least-32-chars-long";
    clearRateLimits();
  });

  describe("GET /api/health", () => {
    it("returns 200 with { ok: true }", async () => {
      const response = await healthHandler();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ ok: true });
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns 200 and sets cookie when password is correct", async () => {
      const req = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "super-secret-password" }),
      });

      const response = await loginHandler(req);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ ok: true });

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain(SESSION_COOKIE_NAME);
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=lax/i);
    });

    it("returns 401 when password is wrong", async () => {
      const req = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "incorrect-password" }),
      });

      const response = await loginHandler(req);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({
        error: { code: "UNAUTHORIZED", message: "Invalid password" },
      });
    });

    it("returns 400 when password is missing or empty", async () => {
      const req = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "" }),
      });

      const response = await loginHandler(req);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe("BAD_REQUEST");
    });

    it("enforces rate limit after 5 failed attempts", async () => {
      for (let i = 0; i < 5; i++) {
        const req = new Request("http://localhost:3000/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "10.10.10.10",
          },
          body: JSON.stringify({ password: "wrong" }),
        });
        const res = await loginHandler(req);
        expect(res.status).toBe(401);
      }

      // 6th attempt should be blocked by rate limiter
      const req = new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": "10.10.10.10",
        },
        body: JSON.stringify({ password: "super-secret-password" }),
      });
      const response = await loginHandler(req);
      expect(response.status).toBe(429);
      const data = await response.json();
      expect(data.error.code).toBe("TOO_MANY_REQUESTS");
      expect(response.headers.get("Retry-After")).toBeTruthy();
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns 200 and clears session cookie", async () => {
      const response = await logoutHandler();
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ ok: true });

      const setCookie = response.headers.get("set-cookie");
      expect(setCookie).toBeTruthy();
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(setCookie).toContain("Max-Age=0");
    });
  });

  describe("middleware protection", () => {
    it("allows public access to /api/health without session", async () => {
      const req = new NextRequest("http://localhost:3000/api/health");
      const res = await middleware(req);
      // NextResponse.next() returns a response that continues
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows public access to /login without session", async () => {
      const req = new NextRequest("http://localhost:3000/login");
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows public access to /api/auth/login without session", async () => {
      const req = new NextRequest("http://localhost:3000/api/auth/login", {
        method: "POST",
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("redirects unauthenticated page requests to /login", async () => {
      const req = new NextRequest("http://localhost:3000/dashboard");
      const res = await middleware(req);
      expect(res.status).toBe(307);
      const location = res.headers.get("location");
      expect(location).toContain("/login");
      expect(location).toContain("from=%2Fdashboard");
    });

    it("returns 401 JSON for unauthenticated protected API requests", async () => {
      const req = new NextRequest("http://localhost:3000/api/projects");
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toEqual({
        error: { code: "UNAUTHORIZED", message: "Authentication required" },
      });
    });

    it("allows authenticated requests to protected pages", async () => {
      const token = await createSessionToken({ authenticated: true });
      const req = new NextRequest("http://localhost:3000/dashboard", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    });

    it("allows authenticated requests to protected APIs", async () => {
      const token = await createSessionToken({ authenticated: true });
      const req = new NextRequest("http://localhost:3000/api/projects", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(200);
    });

    it("redirects authenticated users visiting /login to /", async () => {
      const token = await createSessionToken({ authenticated: true });
      const req = new NextRequest("http://localhost:3000/login", {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${token}`,
        },
      });
      const res = await middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe("http://localhost:3000/");
    });
  });
});
