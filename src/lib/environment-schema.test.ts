import { describe, expect, it } from "vitest";
import { baseUrlSchema, environmentInput, fieldErrors } from "./environment-schema";

describe("baseUrlSchema", () => {
  it("accepts http(s) URLs and trims trailing slashes", () => {
    expect(baseUrlSchema.parse(" https://api.example.com/ ")).toBe("https://api.example.com");
    expect(baseUrlSchema.parse("http://localhost:4010")).toBe("http://localhost:4010");
    expect(baseUrlSchema.parse("https://api.example.com/v1//")).toBe("https://api.example.com/v1");
  });

  it.each([
    "",
    "not a url",
    "ftp://example.com",
    "javascript:alert(1)",
    "https://",
    "/relative",
    "https://user:pw@example.com",
  ])("rejects %j", (bad) => {
    expect(baseUrlSchema.safeParse(bad).success).toBe(false);
  });
});

describe("environmentInput", () => {
  it("applies defaults", () => {
    expect(environmentInput.parse({ name: " dev ", baseUrl: "http://x.test" })).toEqual({
      name: "dev",
      baseUrl: "http://x.test",
      isProd: false,
      defaultHeaders: {},
    });
  });

  it("validates header names and values", () => {
    const ok = environmentInput.safeParse({
      name: "a",
      baseUrl: "http://x.test",
      defaultHeaders: { "X-Tenant": "acme" },
    });
    expect(ok.success).toBe(true);
    const badName = environmentInput.safeParse({
      name: "a",
      baseUrl: "http://x.test",
      defaultHeaders: { "bad name": "v" },
    });
    expect(badName.success).toBe(false);
    const badValue = environmentInput.safeParse({
      name: "a",
      baseUrl: "http://x.test",
      defaultHeaders: { A: "line\nbreak" },
    });
    expect(badValue.success).toBe(false);
  });

  it("reports the first problem per field", () => {
    const r = environmentInput.safeParse({ name: "", baseUrl: "nope" });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(["baseUrl", "name"]);
  });
});
