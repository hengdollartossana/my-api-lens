import { describe, expect, it } from "vitest";
import { buildDiffReport, REDACTED, type ReportEndpoint, safeValue } from "./index";

const ep = (over: Partial<ReportEndpoint> = {}): ReportEndpoint => ({
  module: "User",
  method: "GET",
  path: "/api/v1/{tenant}/users",
  environment: "staging",
  isProd: false,
  ranAt: "2026-10-16T10:00:00.000Z",
  statusCode: 200,
  items: [
    {
      kind: "missing_required",
      severity: "error",
      path: "$[1].email",
      message: 'Required field "email" is missing',
      expected: "present",
    },
    {
      kind: "extra_field",
      severity: "info",
      path: "$.internalNote",
      message: 'Field "internalNote" is not in the spec',
      actual: "vip",
    },
  ],
  ...over,
});

const input = (endpoints: ReportEndpoint[]) => ({
  project: "Messy API",
  generatedAt: "2026-10-16T12:00:00.000Z",
  endpoints,
});

describe("buildDiffReport", () => {
  it("summarizes counts", () => {
    const { summary } = buildDiffReport(
      input([
        ep(),
        ep({ path: "/ok", items: [] }),
        ep({
          path: "/warn",
          items: [{ kind: "unexpected_null", severity: "warn", path: "$.a", message: "null" }],
        }),
      ]),
    );
    expect(summary).toEqual({
      errors: 1,
      warnings: 1,
      info: 1,
      endpointsCompared: 3,
      endpointsMatching: 1,
    });
  });

  it("matches the Markdown snapshot", () => {
    expect(
      buildDiffReport(
        input([
          ep(),
          ep({
            module: "Order",
            method: "POST",
            isProd: true,
            statusCode: 409,
            path: "/api/v1/{tenant}/orders",
            items: [
              {
                kind: "undocumented_status",
                severity: "error",
                path: "$status",
                message: "Status 409 is not documented",
                expected: ["200", "401"],
                actual: 409,
              },
            ],
          }),
        ]),
      ).markdown,
    ).toMatchSnapshot();
  });

  it("says so when nothing differs", () => {
    const { markdown, html } = buildDiffReport(input([ep({ items: [] })]));
    expect(markdown).toContain("No mismatches");
    expect(html).toContain("No mismatches");
  });

  it("html is one self-contained page: no scripts, no external requests", () => {
    const { html } = buildDiffReport(input([ep()]));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).not.toMatch(/<script|<link|<img|src=|href=|@import|url\(/i);
    expect(html).toContain("prefers-color-scheme");
  });

  it("escapes HTML in every value", () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const { html, markdown } = buildDiffReport({
      project: evil,
      generatedAt: "now",
      endpoints: [
        ep({
          module: evil,
          path: evil,
          environment: evil,
          items: [
            {
              kind: "type_mismatch",
              severity: "error",
              path: `$.${evil}`,
              message: evil,
              expected: evil,
              actual: evil,
            },
          ],
        }),
      ],
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // raw HTML only ever appears inside code spans, where Markdown shows it literally
    expect(markdown.replace(/`[^`]*`/g, "")).not.toContain("<img");
    expect(markdown).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes table syntax in Markdown", () => {
    const { markdown } = buildDiffReport(
      input([
        ep({
          items: [
            {
              kind: "enum_violation",
              severity: "warn",
              path: "$.a",
              message: "a | b\nc",
              actual: "x|y",
            },
          ],
        }),
      ]),
    );
    expect(markdown).toContain("a \\| b c");
    expect(markdown).toContain("x\\|y");
  });
});

describe("redaction", () => {
  it("hides values under sensitive field names", () => {
    for (const key of [
      "token",
      "accessToken",
      "refresh_token",
      "password",
      "apiKey",
      "api-key",
      "Authorization",
      "sessionId",
      "secret",
      "cookie",
    ]) {
      expect(safeValue(`$.data.${key}`, "plain-looking-value"), key).toBe(REDACTED);
    }
    expect(safeValue("$.name", "Ann")).toBe("Ann");
  });

  it("hides JWTs, Bearer tokens and long opaque secrets wherever they appear", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature";
    expect(safeValue("$.note", jwt)).toBe(REDACTED);
    expect(safeValue("$.note", "Bearer abcdef0123456789")).toBe(REDACTED);
    expect(safeValue("$.note", "a".repeat(40))).toBe(REDACTED);
    expect(safeValue("$.obj", { id: 1, nested: { password: "hunter2", ok: "fine" } })).toBe(
      '{"id":1,"nested":{"password":"[REDACTED]","ok":"fine"}}',
    );
  });

  it("truncates long values", () => {
    const out = safeValue("$.text", `${"word ".repeat(100)}`);
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("…")).toBe(true);
  });

  it("a finished report contains no tokens or auth headers", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature";
    const { markdown, html } = buildDiffReport(
      input([
        ep({
          items: [
            {
              kind: "extra_field",
              severity: "info",
              path: "$.token",
              message: "extra",
              actual: "mock-access-token-123",
            },
            {
              kind: "type_mismatch",
              severity: "error",
              path: "$.note",
              message: `got ${jwt}`,
              actual: jwt,
            },
            {
              kind: "extra_field",
              severity: "info",
              path: "$.headers",
              message: "extra",
              actual: { Authorization: "Bearer abcdef0123456789", ok: 1 },
            },
          ],
        }),
      ]),
    );
    for (const text of [markdown, html]) {
      expect(text).not.toContain("mock-access-token-123");
      expect(text).not.toContain(jwt);
      expect(text).not.toContain("abcdef0123456789");
    }
    expect(markdown).toContain(REDACTED);
  });
});
