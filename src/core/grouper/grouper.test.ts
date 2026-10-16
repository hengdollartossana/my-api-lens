import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSpec } from "../parser";
import {
  type GroupableEndpoint,
  groupEndpoints,
  type ModuleVia,
  normalizeModuleName,
} from "./index";

const secured = [{ bearerAuth: [] }];
const ep = (over: Partial<GroupableEndpoint> & { path: string }): GroupableEndpoint => ({
  stableKey: `GET ${over.path}`,
  operationId: null,
  tags: [],
  security: secured,
  ...over,
});

describe("normalizeModuleName", () => {
  it.each([
    ["users", "User"],
    ["UsersController", "User"],
    ["order-items", "Order Item"],
    ["PaymentApi", "Payment"],
    ["billing_service", "Billing"],
    ["categories", "Category"],
    ["status", "Status"],
    ["address", "Address"],
    ["boxes", "Box"],
    ["news", "News"],
    ["Controller", ""],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeModuleName(input)).toBe(expected);
  });
});

describe("grouping rules", () => {
  const cases: [string, GroupableEndpoint, string, ModuleVia, Record<string, string>?][] = [
    [
      "manual override",
      ep({ path: "/users", tags: ["x"] }),
      "Billing",
      "manual",
      { "GET /users": "Billing" },
    ],
    [
      "first meaningful tag",
      ep({ path: "/users", tags: ["default", "api", "pets"] }),
      "Pet",
      "tag",
    ],
    ["tag beats path", ep({ path: "/users", tags: ["Orders"] }), "Order", "tag"],
    [
      "only ignored tags fall through to path",
      ep({ path: "/users", tags: ["default", "API"] }),
      "User",
      "path",
    ],
    [
      "strips /api /v1 and {tenant}",
      ep({ path: "/api/v1/{tenant}/users/{userId}" }),
      "User",
      "path",
    ],
    ["nested stays with parent", ep({ path: "/api/v2/orders/{id}/items" }), "Order", "path"],
    [
      "path beats operationId",
      ep({ path: "/orders", operationId: "UsersController_list" }),
      "Order",
      "path",
    ],
    [
      "operationId prefix",
      ep({ path: "/api/v1/{tenant}", operationId: "BillingController_get" }),
      "Billing",
      "operation_id",
    ],
    [
      "camelCase operationId has no prefix",
      ep({ path: "/", operationId: "getUserById" }),
      "Ungrouped",
      "ungrouped",
    ],
    ["auth keyword in path", ep({ path: "/login" }), "Auth", "auth"],
    ["auth keyword in operationId", ep({ path: "/", operationId: "doRefresh" }), "Auth", "auth"],
    ["{tenant}/me is auth", ep({ path: "/{tenant}/me" }), "Auth", "auth"],
    ["no security is auth", ep({ path: "/", security: [] }), "Auth", "auth"],
    ["nothing matches", ep({ path: "/" }), "Ungrouped", "ungrouped"],
  ];

  it.each(cases)("%s", (_name, endpoint, moduleName, via, overrides) => {
    const { assignments } = groupEndpoints([endpoint], { overrides });
    expect(assignments).toEqual([{ stableKey: endpoint.stableKey, moduleName, via }]);
  });

  it("reports the highest-priority via per module", () => {
    const { modules } = groupEndpoints([
      ep({ path: "/", stableKey: "GET /a", operationId: "UsersController_a", tags: [] }),
      ep({ path: "/users", stableKey: "GET /b" }),
    ]);
    const user = modules.find((m) => m.name === "User");
    expect(user?.via).toBe("path");
    expect(user?.stableKeys).toEqual(["GET /a", "GET /b"]);
  });
});

describe("messy-v3 fixture", () => {
  it("assigns every endpoint a module", async () => {
    const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
    const { assignments, modules } = groupEndpoints(parsed.endpoints);
    expect(assignments).toHaveLength(parsed.endpoints.length);
    expect(assignments.every((a) => a.moduleName.length > 0)).toBe(true);
    const names = Object.fromEntries(modules.map((m) => [m.name, m.stableKeys.length]));
    expect(names).toEqual({ Auth: 3, User: 3, Order: 3 });
    expect(modules.every((m) => m.via === "path")).toBe(true);
  });

  it("lets a manual override move an endpoint", async () => {
    const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
    const key = "GET /api/v1/{}/orders";
    const { modules } = groupEndpoints(parsed.endpoints, { overrides: { [key]: "Sales" } });
    expect(modules.find((m) => m.name === "Sales")?.stableKeys).toEqual([key]);
    expect(modules.find((m) => m.name === "Order")?.stableKeys).toHaveLength(2);
  });
});
