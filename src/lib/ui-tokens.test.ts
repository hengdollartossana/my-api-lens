import { describe, expect, it } from "vitest";
import {
  isActive,
  methodClass,
  PROJECT_TABS,
  projectIdFromPath,
  STATUS_STYLES,
  statusStyle,
  VIA_LABELS,
  viaLabel,
} from "./ui-tokens";

describe("badges", () => {
  it("colors methods case-insensitively and falls back to neutral", () => {
    expect(methodClass("get")).toContain("sky");
    expect(methodClass("DELETE")).toContain("red");
    expect(methodClass("TRACE")).toContain("zinc");
  });

  it("has a label and a class for every status", () => {
    for (const key of Object.keys(STATUS_STYLES)) {
      const s = statusStyle(key);
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.className).toContain("border");
    }
    expect(statusStyle("mystery").label).toBe("mystery");
  });

  it("labels every grouping source", () => {
    expect(Object.keys(VIA_LABELS)).toEqual([
      "tag",
      "path",
      "operation_id",
      "auth",
      "ai",
      "manual",
      "ungrouped",
    ]);
    expect(viaLabel("operation_id")).toBe("operationId");
    expect(viaLabel("other")).toBe("other");
  });
});

describe("navigation helpers", () => {
  it("matches sections by prefix, not substring", () => {
    expect(isActive("/projects", "/projects")).toBe(true);
    expect(isActive("/projects/demo/diff", "/projects")).toBe(true);
    expect(isActive("/projectsX", "/projects")).toBe(false);
    expect(isActive("/runs", "/projects")).toBe(false);
  });

  it("reads the project id from the path", () => {
    expect(projectIdFromPath("/projects/abc/modules/m1")).toBe("abc");
    expect(projectIdFromPath("/projects")).toBeNull();
    expect(projectIdFromPath("/runs")).toBeNull();
  });

  it("lists the project tabs", () => {
    expect(PROJECT_TABS.map((t) => t.suffix)).toEqual(["", "/diff", "/pack", "/codegen"]);
  });
});
