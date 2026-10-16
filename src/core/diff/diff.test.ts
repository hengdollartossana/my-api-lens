import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../fixtures/mock-api/app";
import { buildRequest, type ExecEndpoint, execute } from "../executor";
import { parseSpec } from "../parser";
import { diffResponse, toJsonPath, worstSeverity } from "./index";

const obj = (properties: Record<string, unknown>, required: string[] = [], extra = {}) => ({
  type: "object",
  properties,
  required,
  ...extra,
});
const summarize = (items: ReturnType<typeof diffResponse>) =>
  items.map((i) => `${i.kind} ${i.path}`);

describe("status handling", () => {
  it("flags an undocumented status as an error", () => {
    const items = diffResponse({ "200": obj({}) }, { status: 409, body: { message: "x" } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "undocumented_status",
      severity: "error",
      path: "$status",
      actual: 409,
    });
  });

  it("matches ranges and default", () => {
    expect(diffResponse({ "2XX": null }, { status: 201, body: "anything" })).toEqual([]);
    expect(
      diffResponse({ default: obj({ a: { type: "string" } }) }, { status: 500, body: { a: "x" } }),
    ).toEqual([]);
  });

  it("skips body checks when no body schema is documented", () => {
    expect(diffResponse({ "204": null }, { status: 204, body: null })).toEqual([]);
  });
});

describe("table: each kind, path and severity", () => {
  const schema = obj(
    {
      id: { type: "string" },
      email: { type: "string", format: "email" },
      role: { type: "string", enum: ["admin", "user"] },
      age: { type: "integer", minimum: 0 },
      tags: { type: "array", items: { type: "string" } },
      address: obj({ city: { type: "string" } }, ["city"]),
      meta: { type: "string", nullable: true },
    },
    ["id", "email"],
  );
  const cases: [string, unknown, string[], string][] = [
    [
      "valid",
      {
        id: "1",
        email: "a@b.co",
        role: "user",
        age: 3,
        tags: ["x"],
        address: { city: "c" },
        meta: null,
      },
      [],
      "ok",
    ],
    ["missing required", { id: "1" }, ["missing_required $.email"], "error"],
    ["wrong type", { id: 1, email: "a@b.co" }, ["type_mismatch $.id"], "error"],
    ["integer got float", { id: "1", email: "a@b.co", age: 1.5 }, ["type_mismatch $.age"], "error"],
    [
      "unexpected null",
      { id: "1", email: "a@b.co", address: null },
      ["unexpected_null $.address"],
      "warn",
    ],
    ["nullable null is fine", { id: "1", email: "a@b.co", meta: null }, [], "ok"],
    ["enum", { id: "1", email: "a@b.co", role: "root" }, ["enum_violation $.role"], "warn"],
    ["format", { id: "1", email: "nope" }, ["format_violation $.email"], "warn"],
    ["constraint", { id: "1", email: "a@b.co", age: -1 }, ["format_violation $.age"], "warn"],
    ["extra field", { id: "1", email: "a@b.co", secret: 1 }, ["extra_field $.secret"], "info"],
    [
      "nested path",
      { id: "1", email: "a@b.co", address: {} },
      ["missing_required $.address.city"],
      "error",
    ],
    [
      "array index path",
      { id: "1", email: "a@b.co", tags: ["a", 2] },
      ["type_mismatch $.tags[1]"],
      "error",
    ],
    [
      "several at once, errors first",
      { id: 1, email: "a@b.co", role: "root", extra: true },
      ["type_mismatch $.id", "enum_violation $.role", "extra_field $.extra"],
      "error",
    ],
  ];
  it.each(cases)("%s", (_name, body, expected, severity) => {
    const items = diffResponse({ "200": schema }, { status: 200, body });
    expect(summarize(items)).toEqual(expected);
    expect(worstSeverity(items)).toBe(severity);
  });
});

describe("extra fields", () => {
  const base = { type: "object", properties: { a: { type: "string" } } };
  it("respects additionalProperties", () => {
    const body = { a: "x", b: 1 };
    expect(summarize(diffResponse({ "200": base }, { status: 200, body }))).toEqual([
      "extra_field $.b",
    ]);
    expect(
      diffResponse({ "200": { ...base, additionalProperties: true } }, { status: 200, body }),
    ).toEqual([]);
    expect(
      diffResponse(
        { "200": { ...base, additionalProperties: { type: "number" } } },
        { status: 200, body },
      ),
    ).toEqual([]);
    expect(
      summarize(
        diffResponse({ "200": { ...base, additionalProperties: false } }, { status: 200, body }),
      ),
    ).toEqual(["extra_field $.b"]);
  });

  it("walks arrays and allOf, and ignores free-form objects", () => {
    const list = {
      type: "array",
      items: { allOf: [base, { type: "object", properties: { c: { type: "string" } } }] },
    };
    expect(
      summarize(diffResponse({ "200": list }, { status: 200, body: [{ a: "x", c: "y", z: 1 }] })),
    ).toEqual(["extra_field $[0].z"]);
    expect(
      diffResponse({ "200": { type: "object" } }, { status: 200, body: { anything: 1 } }),
    ).toEqual([]);
  });
});

describe("robustness", () => {
  it("handles anyOf without branch noise", () => {
    const schema = {
      anyOf: [obj({ a: { type: "string" } }, ["a"]), obj({ b: { type: "integer" } }, ["b"])],
    };
    expect(diffResponse({ "200": schema }, { status: 200, body: { a: "x" } })).toEqual([]);
    const items = diffResponse({ "200": schema }, { status: 200, body: { c: 1 } });
    expect(items.map((i) => i.kind)).toEqual(["type_mismatch"]);
  });

  it("ignores unresolved $ref and uncompilable schemas instead of throwing", () => {
    expect(
      diffResponse(
        { "200": obj({ child: { $ref: "#/components/schemas/Node" } }) },
        { status: 200, body: { child: { x: 1 } } },
      ),
    ).toEqual([]);
    expect(() =>
      diffResponse({ "200": { type: "nonsense" } }, { status: 200, body: 1 }),
    ).not.toThrow();
  });

  it("reports a non-JSON body against an object schema", () => {
    expect(summarize(diffResponse({ "200": obj({}) }, { status: 200, body: "<html>" }))).toEqual([
      "type_mismatch $",
    ]);
  });

  it("truncates long actual values", () => {
    const [item] = diffResponse(
      { "200": obj({ a: { type: "integer" } }) },
      { status: 200, body: { a: "x".repeat(500) } },
    );
    expect(String(item?.actual).length).toBeLessThan(200);
  });

  it("converts JSON pointers to paths", () => {
    expect(toJsonPath("")).toBe("$");
    expect(toJsonPath("/items/0/a~1b")).toBe("$.items[0].a/b");
  });
});

describe("messy-v3 mock fixture", () => {
  let mock: Server;
  let base = "";
  const endpoints = new Map<string, ExecEndpoint & { responseSchemas: Record<string, unknown> }>();
  let headers: Record<string, string> = {};

  beforeAll(async () => {
    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    base = `http://localhost:${(mock.address() as AddressInfo).port}`;
    const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
    for (const e of parsed.endpoints) endpoints.set(e.stableKey, e);
    const login = await execute(
      buildRequest(
        endpoints.get("POST /api/v1/auth/login") as ExecEndpoint,
        { baseUrl: base },
        { body: { username: "demo", password: "demo" } },
      ),
    );
    headers = { Authorization: `Bearer ${(login.body as { token: string }).token}` };
  });
  afterAll(() => new Promise<void>((r) => mock.close(() => r())));

  async function diffFor(key: string, input: Parameters<typeof buildRequest>[2] = {}) {
    const ep = endpoints.get(key) as ExecEndpoint & { responseSchemas: Record<string, unknown> };
    const res = await execute(
      buildRequest(ep, { baseUrl: base }, { pathParams: { tenant: "t" }, ...input }, { headers }),
    );
    return diffResponse(ep.responseSchemas, { status: res.status as number, body: res.body });
  }

  it("detects every documented mismatch with the right kind and path", async () => {
    expect(summarize(await diffFor("GET /api/v1/{}/users"))).toEqual([
      "missing_required $[1].email",
    ]);
    expect(
      summarize(
        await diffFor("GET /api/v1/{}/users/{}", { pathParams: { tenant: "t", userId: "u1" } }),
      ),
    ).toEqual(["extra_field $.internalNote"]);
    expect(summarize(await diffFor("GET /api/v1/{}/orders"))).toEqual([
      "type_mismatch $[0].total.amount",
    ]);
    expect(
      summarize(
        await diffFor("GET /api/v1/{}/orders/{}", { pathParams: { tenant: "t", orderId: "o1" } }),
      ),
    ).toEqual(["unexpected_null $.shippingAddress"]);
    expect(
      summarize(
        await diffFor("POST /api/v1/{}/users", { body: { email: "taken@example.com", name: "x" } }),
      ),
    ).toEqual(["undocumented_status $status"]);
  });

  it("gives zero items for matching responses", async () => {
    expect(await diffFor("GET /api/v1/auth/me")).toEqual([]);
    expect(await diffFor("POST /api/v1/{}/users")).toEqual([]);
    expect(
      await diffFor("DELETE /api/v1/{}/orders/{}", { pathParams: { tenant: "t", orderId: "o1" } }),
    ).toEqual([]);
  });
});
