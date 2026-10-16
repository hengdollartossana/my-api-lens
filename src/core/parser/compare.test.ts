import { describe, expect, it } from "vitest";
import { type ComparableEndpoint, canonicalJson, changedParts, compareEndpoints } from "./index";

const ep = (key: string, over: Partial<ComparableEndpoint> = {}): ComparableEndpoint => ({
  stableKey: key,
  parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
  requestBodySchema: null,
  responseSchemas: { "200": { type: "object", properties: { a: { type: "string" } } } },
  security: [],
  isDestructive: false,
  ...over,
});

describe("canonicalJson", () => {
  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(
      canonicalJson({ a: [{ c: 2, d: 1 }], b: 1 }),
    );
    expect(canonicalJson(undefined)).toBe("null");
  });
});

describe("changedParts", () => {
  it("reports each differing part", () => {
    const base = ep("GET /a");
    expect(changedParts(base, ep("GET /a"))).toEqual([]);
    expect(changedParts(base, ep("GET /a", { parameters: [] }))).toEqual(["parameters"]);
    expect(changedParts(base, ep("GET /a", { requestBodySchema: { type: "object" } }))).toEqual([
      "requestBody",
    ]);
    expect(changedParts(base, ep("GET /a", { responseSchemas: {} }))).toEqual(["responses"]);
    expect(changedParts(base, ep("GET /a", { security: [{ bearer: [] }] }))).toEqual(["security"]);
    expect(changedParts(base, ep("GET /a", { isDestructive: true }))).toEqual(["destructive"]);
  });

  it("treats key order and null/undefined body the same", () => {
    const a = ep("GET /a", {
      responseSchemas: { "200": { x: 1, y: 2 } },
      requestBodySchema: undefined,
    });
    const b = ep("GET /a", { responseSchemas: { "200": { y: 2, x: 1 } }, requestBodySchema: null });
    expect(changedParts(a, b)).toEqual([]);
  });
});

describe("compareEndpoints", () => {
  it("finds added, removed, changed and unchanged by stable key", () => {
    const current = [ep("GET /a"), ep("GET /b"), ep("GET /c")];
    const next = [ep("GET /a"), ep("GET /b", { security: [{ k: [] }] }), ep("GET /d")];
    expect(compareEndpoints(current, next)).toEqual({
      added: ["GET /d"],
      removed: ["GET /c"],
      changed: [{ stableKey: "GET /b", parts: ["security"] }],
      unchanged: ["GET /a"],
    });
  });

  it("reports nothing for identical lists", () => {
    const list = [ep("GET /a"), ep("POST /a")];
    expect(compareEndpoints(list, [...list])).toMatchObject({
      added: [],
      removed: [],
      changed: [],
    });
  });
});
