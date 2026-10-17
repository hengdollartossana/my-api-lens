import { describe, expect, it } from "vitest";
import { buildTestDataRequest, parseTestDataResponse, type TestDataEndpoint } from "./index";

const eps: TestDataEndpoint[] = [
  {
    stableKey: "POST /users",
    method: "post",
    path: "/users",
    summary: "Create user",
    parameters: [{ name: "dryRun", in: "query", required: false, schema: { type: "boolean" } }],
    requestBodySchema: { type: "object", properties: { email: { type: "string" } } },
  },
  {
    stableKey: "GET /users/{}",
    method: "get",
    path: "/users/{id}",
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "integer" } },
      { name: "X-Trace", in: "header", required: false },
    ],
  },
];

describe("buildTestDataRequest", () => {
  it("sends parameter and body schemas, not headers", () => {
    const req = buildTestDataRequest(eps);
    expect(req.prompt).toContain("1. POST /users - Create user");
    expect(req.prompt).toContain('body: {"type":"object"');
    expect(req.prompt).toContain("path id (required)");
    expect(req.prompt).not.toContain("X-Trace");
  });
});

describe("parseTestDataResponse", () => {
  it("maps ids to stable keys and tolerates code fences", () => {
    const text =
      '```json\n{"endpoints":[{"id":1,"query":{"dryRun":true},"body":{"email":"ana@acme.io"}},{"id":2,"pathParams":{"id":42}}]}\n```';
    const out = parseTestDataResponse(text, eps);
    expect(out.get("POST /users")).toEqual({
      query: { dryRun: true },
      body: { email: "ana@acme.io" },
    });
    expect(out.get("GET /users/{}")).toEqual({ pathParams: { id: 42 } });
  });

  it("drops unknown ids and params, non-scalar values, and a body for endpoints without one", () => {
    const text = JSON.stringify({
      endpoints: [
        { id: 9, body: {} },
        { id: 2, pathParams: { id: { x: 1 }, nope: 1 }, body: { a: 1 } },
        { id: 1, query: { other: "x" } },
      ],
    });
    expect(parseTestDataResponse(text, eps).size).toBe(0);
  });

  it("returns nothing for garbage", () => {
    expect(parseTestDataResponse("sorry, no", eps).size).toBe(0);
    expect(parseTestDataResponse('{"endpoints":"x"}', eps).size).toBe(0);
  });
});
