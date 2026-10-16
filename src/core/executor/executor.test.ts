import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../fixtures/mock-api/app";
import { parseSpec } from "../parser";
import {
  buildRequest,
  type ExecEndpoint,
  ExecutorError,
  execute,
  redactRequest,
  sampleFromSchema,
} from "./index";

let mock: Server;
let base = "";
let endpoints: Record<string, ExecEndpoint>;
let token = "";

const env = () => ({ baseUrl: base });

beforeAll(async () => {
  // Ephemeral port so tests never collide with a running `pnpm mock:api`.
  mock = createMockServer();
  await new Promise<void>((r) => mock.listen(0, r));
  base = `http://localhost:${(mock.address() as AddressInfo).port}`;
  const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
  endpoints = Object.fromEntries(parsed.endpoints.map((e) => [e.stableKey, e]));
  const login = await execute(
    buildRequest(endpoints["POST /api/v1/auth/login"] as ExecEndpoint, env(), {
      body: { username: "demo", password: "demo" },
    }),
  );
  token = (login.body as { token: string }).token;
});
afterAll(() => new Promise<void>((r) => mock.close(() => r())));

const ep = (key: string) => endpoints[key] as ExecEndpoint;
const auth = () => ({ headers: { Authorization: `Bearer ${token}` } });

describe("sampleFromSchema", () => {
  it("builds samples by type, format, enum and refs", () => {
    expect(
      sampleFromSchema({
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          status: { type: "string", enum: ["a", "b"] },
          n: { type: "integer", minimum: 5 },
          flag: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          fixed: { type: "string", example: "keep" },
        },
      }),
    ).toEqual({
      email: "user@example.com",
      status: "a",
      n: 5,
      flag: true,
      tags: ["string"],
      fixed: "keep",
    });
  });

  it("merges allOf and picks the first oneOf", () => {
    expect(
      sampleFromSchema({
        allOf: [
          { type: "object", properties: { a: { type: "string" } } },
          { type: "object", properties: { b: { type: "integer" } } },
        ],
      }),
    ).toEqual({ a: "string", b: 1 });
    expect(sampleFromSchema({ oneOf: [{ type: "boolean" }, { type: "string" }] })).toBe(true);
  });

  it("stops on deeply nested or recursive schemas", () => {
    const node: Record<string, unknown> = { type: "object", properties: {} };
    (node.properties as Record<string, unknown>).child = node;
    expect(() => JSON.stringify(sampleFromSchema(node))).not.toThrow();
  });
});

describe("buildRequest", () => {
  it("fills path params, encodes them and appends query params", () => {
    const req = buildRequest(ep("GET /api/v1/{}/orders/{}"), env(), {
      pathParams: { tenant: "acme corp", orderId: "o/1" },
      query: { expand: "lines", n: 2 },
    });
    expect(req.url).toBe(`${base}/api/v1/acme%20corp/orders/o%2F1?expand=lines&n=2`);
    expect(req.method).toBe("GET");
    expect(req.body).toBeUndefined();
  });

  it("samples missing path params and required query params", () => {
    const e: ExecEndpoint = {
      method: "get",
      path: "/items/{id}",
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "integer" } },
        { name: "q", in: "query", required: true, schema: { type: "string" } },
        { name: "opt", in: "query", required: false, schema: { type: "string" } },
      ],
      requestBodySchema: null,
    };
    expect(buildRequest(e, env()).url).toBe(`${base}/items/1?q=string`);
  });

  it("throws on a path param with no value or schema", () => {
    const e: ExecEndpoint = {
      method: "GET",
      path: "/x/{id}",
      parameters: [],
      requestBodySchema: null,
    };
    expect(() => buildRequest(e, env())).toThrow(ExecutorError);
  });

  it("keeps a base URL path prefix", () => {
    const e: ExecEndpoint = { method: "GET", path: "/a", parameters: [], requestBodySchema: null };
    expect(buildRequest(e, { baseUrl: "http://h.test/prefix/" }).url).toBe(
      "http://h.test/prefix/a",
    );
  });

  it("generates a body from the schema when none is given", () => {
    const req = buildRequest(ep("POST /api/v1/{}/users"), env(), { pathParams: { tenant: "t" } });
    expect(req.bodyWasGenerated).toBe(true);
    expect(JSON.parse(req.body as string)).toEqual({ email: "user@example.com", name: "string" });
    expect(req.headers["content-type"]).toBe("application/json");
  });

  it("uses a given body as is and layers headers: defaults < input < auth", () => {
    const req = buildRequest(
      ep("POST /api/v1/{}/users"),
      { baseUrl: base, defaultHeaders: { "X-Env": "dev", "X-Over": "env" } },
      {
        pathParams: { tenant: "t" },
        body: { email: "a@b.c", name: "N" },
        headers: { "x-over": "input" },
      },
      { headers: { Authorization: "Bearer t" } },
    );
    expect(req.bodyWasGenerated).toBe(false);
    expect(req.body).toBe('{"email":"a@b.c","name":"N"}');
    expect(req.headers).toMatchObject({
      "x-env": "dev",
      "x-over": "input",
      authorization: "Bearer t",
    });
  });
});

describe("redactRequest", () => {
  it("masks Authorization, Cookie, X-Api-Key and credential query values", () => {
    const req = buildRequest(
      ep("GET /api/v1/auth/me"),
      env(),
      { headers: { Cookie: "s=1", "X-Api-Key": "k", "X-Trace": "ok" } },
      { headers: { Authorization: "Bearer secret" }, query: { api_key: "supersecret" } },
    );
    const red = redactRequest(req);
    expect(red.headers).toEqual({
      accept: "application/json",
      cookie: "[REDACTED]",
      "x-api-key": "[REDACTED]",
      "x-trace": "ok",
      authorization: "[REDACTED]",
    });
    expect(red.url).toContain("api_key=[REDACTED]");
    expect(JSON.stringify(red)).not.toContain("secret");
  });
});

describe("execute against the mock API", () => {
  it("runs a GET with path params and parses JSON", async () => {
    const res = await execute(
      buildRequest(
        ep("GET /api/v1/{}/users/{}"),
        env(),
        { pathParams: { tenant: "acme", userId: "u9" } },
        auth(),
      ),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: "u9", name: "Ann" });
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
    expect(res.truncated).toBe(false);
    expect(res.request.headers.authorization).toBe("[REDACTED]");
  });

  it("runs a POST with a generated body", async () => {
    const res = await execute(
      buildRequest(ep("POST /api/v1/{}/users"), env(), { pathParams: { tenant: "acme" } }, auth()),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "user@example.com", name: "string" });
    expect(res.request.body).toBe('{"email":"user@example.com","name":"string"}');
  });

  it("returns non-2xx responses as results, not errors", async () => {
    const res = await execute(
      buildRequest(ep("GET /api/v1/{}/orders"), env(), { pathParams: { tenant: "t" } }),
    );
    expect(res.status).toBe(401);
    expect(res.error).toBeUndefined();
  });

  it("reports a network error", async () => {
    const res = await execute(
      buildRequest(ep("GET /api/v1/auth/me"), { baseUrl: "http://localhost:1" }),
      { timeoutMs: 2000 },
    );
    expect(res.status).toBeNull();
    expect(res.error?.code).toBe("NETWORK");
  });

  it("blocks when the guard throws", async () => {
    const res = await execute(buildRequest(ep("GET /api/v1/auth/me"), env()), {
      guard: () => {
        throw new Error("nope");
      },
    });
    expect(res).toMatchObject({ status: null, error: { code: "BLOCKED", message: "nope" } });
  });
});

describe("timeout and truncation", () => {
  let slow: Server;
  let slowBase = "";
  beforeAll(async () => {
    slow = createServer((req, res) => {
      if (req.url === "/hang") return; // never answers
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "application/json" });
        return void res.end(JSON.stringify({ data: "x".repeat(5000) }));
      }
      res.writeHead(200, { "content-type": "text/plain" }).end("plain text");
    });
    await new Promise<void>((r) => slow.listen(0, r));
    slowBase = `http://localhost:${(slow.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    slow.closeAllConnections();
    slow.close();
  });

  const get = (path: string): ExecEndpoint => ({
    method: "GET",
    path,
    parameters: [],
    requestBodySchema: null,
  });

  it("times out", async () => {
    const res = await execute(buildRequest(get("/hang"), { baseUrl: slowBase }), {
      timeoutMs: 200,
    });
    expect(res.status).toBeNull();
    expect(res.error?.code).toBe("TIMEOUT");
    expect(res.durationMs).toBeLessThan(2000);
  });

  it("truncates bodies over the cap and skips JSON parsing", async () => {
    const res = await execute(buildRequest(get("/big"), { baseUrl: slowBase }), { maxBytes: 1000 });
    expect(res.status).toBe(200);
    expect(res.truncated).toBe(true);
    expect(res.bodyText).toHaveLength(1000);
    expect(typeof res.body).toBe("string");
  });

  it("returns plain text bodies as text", async () => {
    const res = await execute(buildRequest(get("/text"), { baseUrl: slowBase }));
    expect(res.body).toBe("plain text");
    expect(res.truncated).toBe(false);
  });
});
