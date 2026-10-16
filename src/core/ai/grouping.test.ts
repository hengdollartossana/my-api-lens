import { describe, expect, it } from "vitest";
import { buildGroupingRequest, parseGroupingResponse } from "./index";

const eps = [
  { stableKey: "GET /invoices", method: "get", path: "/invoices", summary: "List invoices" },
  { stableKey: "POST /invoices", method: "post", path: "/invoices", summary: null },
  { stableKey: "GET /ping", method: "get", path: "/ping" },
];

describe("buildGroupingRequest", () => {
  it("sends one-liners and existing module names only", () => {
    const req = buildGroupingRequest(eps, ["User", "Order"]);
    expect(req.prompt).toContain("Existing modules: User, Order");
    expect(req.prompt).toContain("1. GET /invoices - List invoices");
    expect(req.prompt).toContain("2. POST /invoices");
    expect(req.prompt).not.toMatch(/schema|example|token|password/i);
  });
});

describe("parseGroupingResponse", () => {
  it("maps ids back to stable keys and normalises names", () => {
    const text =
      '```json\n{"assignments":[{"id":1,"module":"Invoices"},{"id":2,"module":"invoice"}]}\n```';
    expect(parseGroupingResponse(text, eps)).toEqual([
      { stableKey: "GET /invoices", module: "Invoice" },
      { stableKey: "POST /invoices", module: "Invoice" },
    ]);
  });

  it("drops unknown ids, empty or reserved names and repeats", () => {
    const text = JSON.stringify({
      assignments: [
        { id: 9, module: "Ghost" },
        { id: 3, module: "   " },
        { id: 3, module: "Ungrouped" },
        { id: 1, module: "Billing" },
        { id: 1, module: "Other" },
      ],
    });
    expect(parseGroupingResponse(text, eps)).toEqual([
      { stableKey: "GET /invoices", module: "Billing" },
    ]);
  });

  it("returns nothing for unusable replies", () => {
    for (const t of ["", "sorry, no", "{not json}", '{"assignments":"x"}']) {
      expect(parseGroupingResponse(t, eps)).toEqual([]);
    }
  });
});
