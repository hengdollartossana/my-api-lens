import { describe, expect, it } from "vitest";
import { documentedSchema, initialInput } from "./endpoint-input";

describe("initialInput", () => {
  it("prefills path params, required query params and the body", () => {
    const out = initialInput(
      [
        { name: "id", in: "path", required: true, schema: { type: "integer" } },
        { name: "q", in: "query", required: true, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        { name: "X-Trace", in: "header", required: false },
      ],
      { type: "object", properties: { email: { type: "string", format: "email" } } },
    );
    expect(out.pathParams).toEqual({ id: "1" });
    expect(out.query).toEqual([
      { name: "q", value: "string", required: true },
      { name: "limit", value: "", required: false },
    ]);
    expect(JSON.parse(out.body)).toEqual({ email: "user@example.com" });
    expect(out.hasBody).toBe(true);
  });

  it("has no body for endpoints without a body schema", () => {
    expect(initialInput([], null)).toMatchObject({ body: "", hasBody: false, query: [] });
    expect(initialInput(null, null).pathParams).toEqual({});
  });
});

describe("documentedSchema", () => {
  const schemas = { "200": { type: "object" }, "4XX": null, default: { type: "string" } };
  it("matches exact, range and default, and reports undocumented", () => {
    expect(documentedSchema(schemas, 200)).toEqual({ found: true, schema: { type: "object" } });
    expect(documentedSchema(schemas, 404)).toEqual({ found: true, schema: null });
    expect(documentedSchema(schemas, 500)).toEqual({ found: true, schema: { type: "string" } });
    expect(documentedSchema({ "200": {} }, 409).found).toBe(false);
    expect(documentedSchema(schemas, null).found).toBe(false);
  });
});
