import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupEndpoints } from "../grouper";
import { parseSpec } from "../parser";
import { buildContextPack, estimateTokens, type PackEndpoint, type PackModule } from "./index";

async function messyModules(): Promise<{
  modules: PackModule[];
  schemes: Record<string, Record<string, unknown>>;
}> {
  const p = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
  const g = groupEndpoints(p.endpoints);
  return {
    modules: g.modules.map((m) => ({
      name: m.name,
      endpoints: p.endpoints.filter((e) => m.stableKeys.includes(e.stableKey)),
    })),
    schemes: p.securitySchemes,
  };
}

const obj = (props: Record<string, unknown>, required: string[] = Object.keys(props)) => ({
  type: "object",
  properties: props,
  required,
});
const str = { type: "string" };

describe("estimateTokens", () => {
  it("is chars / 4, rounded up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("snapshots", () => {
  it("messy-v3, all modules", async () => {
    const { modules, schemes } = await messyModules();
    expect(buildContextPack(modules, { securitySchemes: schemes })).toMatchSnapshot();
  });

  it("messy-v3 with a login_flow auth summary, custom placeholder and diff notes", async () => {
    const { modules } = await messyModules();
    const orders = modules.find((m) => m.name === "Order") as PackModule;
    (orders.endpoints[0] as PackEndpoint).diffNotes = [
      {
        kind: "type_mismatch",
        path: "$[0].total.amount",
        message: "is a string, spec says number",
      },
    ];
    const md = buildContextPack([orders], {
      title: "Orders",
      baseUrlPlaceholder: "<BASE_URL>",
      auth: { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" },
    });
    expect(md).toMatchSnapshot();
  });
});

describe("content rules", () => {
  it("deduplicates identical shapes into one interface", async () => {
    const { modules } = await messyModules();
    const md = buildContextPack(modules);
    const decls = md.match(/^interface (\w+)/gm) ?? [];
    expect(new Set(decls).size).toBe(decls.length);
    // Address appears in /me, users and orders but is declared once.
    expect(md.match(/line1: string/g)).toHaveLength(1);
  });

  it("uses a placeholder, never a real host", async () => {
    const { modules } = await messyModules();
    const md = buildContextPack(modules);
    expect(md).toContain("Base URL: `{{BASE_URL}}`");
    expect(md).not.toMatch(/localhost|https?:\/\//);
  });

  it("prefers observed reality when asked", () => {
    const e: PackEndpoint = {
      method: "GET",
      path: "/users/{id}",
      parameters: [{ name: "id", in: "path", required: true, schema: str }],
      requestBodySchema: null,
      responseSchemas: { "200": obj({ id: str, name: str }) },
      observed: { status: 200, body: { id: "1", name: "Ann", internalNote: "vip", score: "9" } },
    };
    const spec = buildContextPack([{ name: "U", endpoints: [e] }]);
    const real = buildContextPack([{ name: "U", endpoints: [e] }], { preferObserved: true });
    expect(spec).not.toContain("internalNote");
    expect(real).toContain("internalNote: string");
    expect(real).toContain("score: string");
  });

  it("marks observed array fields missing in some items as optional", () => {
    const e: PackEndpoint = {
      method: "GET",
      path: "/users",
      parameters: [],
      requestBodySchema: null,
      responseSchemas: { "200": { type: "array", items: obj({ id: str, email: str }) } },
      observed: { status: 200, body: [{ id: "1", email: "a" }, { id: "2" }] },
    };
    const md = buildContextPack([{ name: "U", endpoints: [e] }], { preferObserved: true });
    expect(md).toContain("email?: string");
    expect(md).toContain("User[]");
  });

  it("renders enums, nullable, records, unions and quoted keys", () => {
    const e: PackEndpoint = {
      method: "GET",
      path: "/things",
      parameters: [],
      requestBodySchema: null,
      responseSchemas: {
        "200": obj({
          status: { type: "string", enum: ["a", "b"] },
          note: { type: "string", nullable: true },
          tags: { type: "object", additionalProperties: { type: "integer" } },
          "x-id": str,
          either: { oneOf: [str, { type: "integer" }] },
        }),
      },
    };
    const md = buildContextPack([{ name: "T", endpoints: [e] }]);
    expect(md).toContain('status: "a" | "b"');
    expect(md).toContain("note: string | null");
    expect(md).toContain("tags: Record<string, number>");
    expect(md).toContain('"x-id": string');
    expect(md).toContain("either: string | number");
  });

  it("summarizes api_key and no auth", () => {
    expect(buildContextPack([], { auth: { type: "api_key", in: "query", name: "key" } })).toContain(
      "API key in query `key`",
    );
    expect(buildContextPack([], { auth: { type: "none" } })).toContain("Auth: none");
  });
});

describe("token budget", () => {
  function resource(name: string, plural: string): PackEndpoint[] {
    const item = obj({
      id: { type: "string", format: "uuid" },
      name: str,
      status: { type: "string", enum: ["active", "archived"] },
      createdAt: { type: "string", format: "date-time" },
      owner: obj({ id: str, email: str }),
      tags: { type: "array", items: str },
    });
    const create = obj({ name: str, status: { type: "string", enum: ["active", "archived"] } }, [
      "name",
    ]);
    const id = { name: "id", in: "path", required: true, schema: str };
    return [
      {
        method: "GET",
        path: `/api/v1/${plural}`,
        summary: `List ${plural}`,
        parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer" } }],
        requestBodySchema: null,
        responseSchemas: { "200": { type: "array", items: item }, "401": null },
      },
      {
        method: "GET",
        path: `/api/v1/${plural}/{id}`,
        summary: `Get one ${name}`,
        parameters: [id],
        requestBodySchema: null,
        responseSchemas: { "200": item, "404": null },
      },
      {
        method: "POST",
        path: `/api/v1/${plural}`,
        summary: `Create ${name}`,
        parameters: [],
        requestBodySchema: create,
        responseSchemas: { "201": item, "400": null },
      },
      {
        method: "PUT",
        path: `/api/v1/${plural}/{id}`,
        summary: `Update ${name}`,
        parameters: [id],
        requestBodySchema: create,
        responseSchemas: { "200": item, "404": null },
      },
    ];
  }

  it("keeps a 20-endpoint module under ~2,000 tokens", () => {
    const endpoints = [
      resource("project", "projects"),
      resource("task", "tasks"),
      resource("label", "labels"),
      resource("comment", "comments"),
      resource("member", "members"),
    ].flat();
    expect(endpoints).toHaveLength(20);
    const md = buildContextPack([{ name: "Planner", endpoints }]);
    expect(estimateTokens(md)).toBeLessThan(2000);
  });
});
