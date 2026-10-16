import { describe, expect, it } from "vitest";
import { checkApproval, moduleContractHash } from "./index";

const ep = (stableKey: string, extra: Record<string, unknown> = {}) => ({
  stableKey,
  parameters: [],
  requestBodySchema: null,
  responseSchemas: { "200": { type: "object" } },
  security: null,
  isDestructive: false,
  ...extra,
});

describe("moduleContractHash", () => {
  it("ignores endpoint order", () => {
    const a = [ep("GET /a"), ep("GET /b")];
    expect(moduleContractHash(a)).toBe(moduleContractHash([...a].reverse()));
  });
  it("changes on a contract change, an added endpoint or a removed one", () => {
    const base = moduleContractHash([ep("GET /a")]);
    expect(
      moduleContractHash([ep("GET /a", { responseSchemas: { "200": { type: "array" } } })]),
    ).not.toBe(base);
    expect(moduleContractHash([ep("GET /a"), ep("GET /b")])).not.toBe(base);
    expect(moduleContractHash([])).not.toBe(base);
  });
});

describe("checkApproval", () => {
  it("blocks on error severity only", () => {
    expect(checkApproval([{ severity: "warn" }, { severity: "info" }]).allowed).toBe(true);
    expect(checkApproval([{ severity: "warn" }, { severity: "error" }])).toEqual({
      allowed: false,
      errorCount: 1,
    });
  });
});
