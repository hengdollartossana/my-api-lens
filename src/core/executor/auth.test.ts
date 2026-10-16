import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMockServer } from "../../../fixtures/mock-api/app";
import { parseSpec } from "../parser";
import {
  type AuthContext,
  AuthError,
  authRecipeSchema,
  buildRequest,
  type ExecEndpoint,
  executeWithAuth,
  readJsonPath,
  resolveAuth,
  TokenCache,
  testAuth,
} from "./index";

let mock: Server;
let base = "";
let me: ExecEndpoint;
const cache = new TokenCache();
let calls: string[] = [];
const opts = { guard: (url: string) => void calls.push(new URL(url).pathname) };
const logins = () => calls.filter((p) => p.endsWith("/auth/login")).length;
const refreshes = () => calls.filter((p) => p.endsWith("/auth/refresh")).length;

const loginRecipe = authRecipeSchema.parse({
  type: "login_flow",
  loginPath: "/api/v1/auth/login",
  tokenPath: "token",
});
const secret = JSON.stringify({ username: "demo", password: "demo" });
const ctx = (over: Partial<AuthContext> = {}): AuthContext => ({
  recipe: loginRecipe,
  env: { baseUrl: base },
  secret,
  cacheKey: "p1:e1",
  ...over,
});
const buildMe = (auth: Parameters<typeof buildRequest>[3]) =>
  buildRequest(me, { baseUrl: base }, {}, auth);

beforeAll(async () => {
  mock = createMockServer();
  await new Promise<void>((r) => mock.listen(0, r));
  base = `http://localhost:${(mock.address() as AddressInfo).port}`;
  const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
  me = parsed.endpoints.find((e) => e.stableKey === "GET /api/v1/auth/me") as ExecEndpoint;
});
afterAll(() => new Promise<void>((r) => mock.close(() => r())));
beforeEach(() => {
  cache.clear();
  calls = [];
});

describe("recipe schema", () => {
  it("applies defaults and rejects unknown types", () => {
    expect(loginRecipe).toMatchObject({
      method: "POST",
      headerName: "Authorization",
      headerTemplate: "Bearer {{token}}",
    });
    expect(authRecipeSchema.safeParse({ type: "magic" }).success).toBe(false);
    expect(authRecipeSchema.safeParse({ type: "api_key" }).success).toBe(false);
  });
});

describe("readJsonPath", () => {
  it("reads nested keys and array indexes", () => {
    const data = { data: { items: [{ t: "x" }] } };
    expect(readJsonPath(data, "data.items[0].t")).toBe("x");
    expect(readJsonPath(data, "data.nope.t")).toBeUndefined();
  });
});

describe("static recipes", () => {
  it("none, static_bearer and api_key produce the right credentials", async () => {
    const none = authRecipeSchema.parse({ type: "none" });
    expect(await resolveAuth(ctx({ recipe: none, secret: null }), cache)).toEqual({});
    const bearer = authRecipeSchema.parse({ type: "static_bearer" });
    expect(await resolveAuth(ctx({ recipe: bearer, secret: "tok" }), cache)).toEqual({
      headers: { Authorization: "Bearer tok" },
    });
    const hdr = authRecipeSchema.parse({ type: "api_key", name: "X-Api-Key" });
    expect(await resolveAuth(ctx({ recipe: hdr, secret: "k" }), cache)).toEqual({
      headers: { "X-Api-Key": "k" },
    });
    const q = authRecipeSchema.parse({ type: "api_key", in: "query", name: "key" });
    expect(await resolveAuth(ctx({ recipe: q, secret: "k" }), cache)).toEqual({
      query: { key: "k" },
    });
  });

  it("errors without a stored secret", async () => {
    const bearer = authRecipeSchema.parse({ type: "static_bearer" });
    await expect(resolveAuth(ctx({ recipe: bearer, secret: null }), cache)).rejects.toMatchObject({
      code: "MISSING_SECRET",
    });
  });
});

describe("login_flow", () => {
  it("logs in, then a protected GET succeeds", async () => {
    const res = await executeWithAuth(buildMe, ctx(), cache, opts);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "u1" });
    expect(logins()).toBe(1);
  });

  it("reuses the cached token across calls", async () => {
    await executeWithAuth(buildMe, ctx(), cache, opts);
    await executeWithAuth(buildMe, ctx(), cache, opts);
    expect(logins()).toBe(1);
  });

  it("caches per project+env key", async () => {
    await executeWithAuth(buildMe, ctx({ cacheKey: "p1:e1" }), cache, opts);
    await executeWithAuth(buildMe, ctx({ cacheKey: "p1:e2" }), cache, opts);
    expect(logins()).toBe(2);
  });

  it("an expired token triggers exactly one re-login and one retry", async () => {
    cache.set("p1:e1", { token: "expired" });
    const res = await executeWithAuth(buildMe, ctx(), cache, opts);
    expect(res.status).toBe(200);
    expect(logins()).toBe(1);
    expect(calls.filter((p) => p.endsWith("/auth/me"))).toHaveLength(2);
  });

  it("does not loop when the retry is also 401", async () => {
    const bad = authRecipeSchema.parse({
      type: "login_flow",
      loginPath: "/api/v1/auth/login",
      tokenPath: "token",
      headerTemplate: "Bearer nope-{{token}}",
    });
    const res = await executeWithAuth(buildMe, ctx({ recipe: bad }), cache, opts);
    expect(res.status).toBe(401);
    expect(logins()).toBe(2); // initial login + one re-login
    expect(calls.filter((p) => p.endsWith("/auth/me"))).toHaveLength(2);
  });

  it("prefers refresh over a full login when configured", async () => {
    const withRefresh = authRecipeSchema.parse({
      type: "login_flow",
      loginPath: "/api/v1/auth/login",
      tokenPath: "token",
      refresh: {
        path: "/api/v1/auth/refresh",
        tokenPath: "token",
        refreshTokenPath: "refreshToken",
      },
    });
    const c = ctx({ recipe: withRefresh });
    await resolveAuth(c, cache, opts); // login, stores the refresh token
    cache.set("p1:e1", { token: "expired", refreshToken: "mock-refresh-token" });
    const res = await executeWithAuth(buildMe, c, cache, opts);
    expect(res.status).toBe(200);
    expect(refreshes()).toBe(1);
    expect(logins()).toBe(1);
  });

  it("reports bad credentials and bad secrets without leaking", async () => {
    const wrong = JSON.stringify({ username: "demo", password: "wrong-password" });
    const err = await resolveAuth(ctx({ secret: wrong }), cache, opts).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe("LOGIN_FAILED");
    expect(err.message).not.toContain("wrong-password");
    await expect(resolveAuth(ctx({ secret: "plain" }), cache)).rejects.toMatchObject({
      code: "BAD_SECRET",
    });
  });

  it("escapes credentials inside the JSON body template", async () => {
    const tricky = JSON.stringify({ username: 'a"b', password: "p\\q" });
    const err = await resolveAuth(ctx({ secret: tricky }), cache, opts).catch((e) => e);
    expect(err.code).toBe("LOGIN_FAILED"); // reached the server with valid JSON, wrong creds
    expect(err.message).toContain("HTTP 401");
  });
});

describe("testAuth", () => {
  it("never returns the token", async () => {
    const ok = await testAuth(ctx(), cache, opts);
    expect(ok).toEqual({ ok: true, message: "Auth works" });
    const entry = cache.get("p1:e1");
    expect(JSON.stringify(ok)).not.toContain(entry?.token ?? "no-token");
    const bad = await testAuth(
      ctx({ secret: JSON.stringify({ username: "x", password: "y" }) }),
      cache,
      opts,
    );
    expect(bad.ok).toBe(false);
  });
});
