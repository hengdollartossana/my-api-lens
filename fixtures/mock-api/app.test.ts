import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "./app";
import { mockBaseUrl } from "./base-url";

const server = createMockServer();
let base = "";
let auth: HeadersInit = {};

const j = (path: string, init?: RequestInit) => fetch(base + path, init);

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const login = await j("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: "demo", password: "demo" }),
  });
  auth = { authorization: `Bearer ${(await login.json()).token}` };
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("mock api", () => {
  it("rejects bad login and unauthenticated calls", async () => {
    const bad = await j("/api/v1/auth/login", { method: "POST", body: JSON.stringify({}) });
    expect(bad.status).toBe(401);
    expect((await j("/api/v1/t/users")).status).toBe(401);
  });

  it("serves the deliberate mismatches", async () => {
    const users = await (await j("/api/v1/t/users", { headers: auth })).json();
    expect(users[1].email).toBeUndefined();
    const user = await (await j("/api/v1/t/users/u1", { headers: auth })).json();
    expect(user.internalNote).toBeDefined();
    const orders = await (await j("/api/v1/t/orders", { headers: auth })).json();
    expect(typeof orders[0].total.amount).toBe("string");
    const order = await (await j("/api/v1/t/orders/o1", { headers: auth })).json();
    expect(order.shippingAddress).toBeNull();
    const dup = await j("/api/v1/t/users", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ email: "taken@example.com", name: "X" }),
    });
    expect(dup.status).toBe(409);
  });

  it("refreshes tokens and reads /me", async () => {
    const r = await j("/api/v1/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken: "mock-refresh-token" }),
    });
    expect(r.status).toBe(200);
    expect((await j("/api/v1/auth/me", { headers: auth })).status).toBe(200);
  });
});

describe("mockBaseUrl", () => {
  it("reads MOCK_API_PORT with a 4010 default", () => {
    expect(mockBaseUrl({ MOCK_API_PORT: "4123" })).toBe("http://localhost:4123");
    expect(mockBaseUrl({})).toBe("http://localhost:4010");
  });
});
