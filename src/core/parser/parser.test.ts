import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { discoverSpecUrl, looksLikeHtml } from "./html";
import { isDestructive, ParseSpecError, parseSpec, stableKey } from "./index";

const spec = (name: string) => readFileSync(`fixtures/specs/${name}`, "utf8");

describe("stableKey / isDestructive", () => {
  it("uppercases the method and normalizes params to {}", () => {
    expect(stableKey("get", "/api/v1/{tenant}/users/{userId}")).toBe("GET /api/v1/{}/users/{}");
  });
  it("treats only GET/HEAD/OPTIONS as safe", () => {
    for (const m of ["GET", "head", "Options"]) expect(isDestructive(m)).toBe(false);
    for (const m of ["POST", "PUT", "patch", "DELETE"]) expect(isDestructive(m)).toBe(true);
  });
});

describe("parseSpec fixtures", () => {
  it.each([
    ["petstore-v2.json", "2.0", 4],
    ["petstore-v3.yaml", "3.0.3", 4],
    ["messy-v3.json", "3.0.3", 9],
  ])("%s parses with the expected endpoint count", async (file, openapi, count) => {
    const parsed = await parseSpec({ text: spec(file), filename: file });
    expect(parsed.openapi).toBe(openapi);
    expect(parsed.endpoints).toHaveLength(count);
    expect(parsed.specHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes v2 and v3 petstore equivalently", async () => {
    const v2 = await parseSpec({ text: spec("petstore-v2.json"), filename: "petstore-v2.json" });
    const v3 = await parseSpec({ text: spec("petstore-v3.yaml"), filename: "petstore-v3.yaml" });
    expect(v2.endpoints).toEqual(v3.endpoints);
    expect(v2.servers).toEqual(["https://petstore.example.test/v2"]);
    expect(v3.servers).toEqual(["https://petstore.example.test/v3"]);
  });

  it("derefs messy-v3 and normalizes its keys", async () => {
    const p = await parseSpec({ text: spec("messy-v3.json") });
    const keys = p.endpoints.map((e) => e.stableKey);
    expect(keys).toContain("GET /api/v1/{}/users/{}");
    expect(keys).toContain("DELETE /api/v1/{}/orders/{}");
    const user = p.endpoints.find((e) => e.operationId === "UsersController_findOne");
    expect(user?.parameters.map((x) => x.name)).toEqual(["tenant", "userId"]);
    expect((user?.responseSchemas["200"] as { required: string[] }).required).toContain("email");
    const login = p.endpoints.find((e) => e.operationId === "AuthController_login");
    expect(login?.security).toEqual([]);
    expect(login?.isDestructive).toBe(true);
    expect(p.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("hash ignores formatting but changes with content", async () => {
    const a = await parseSpec({ text: spec("petstore-v2.json") });
    const reformatted = JSON.stringify(JSON.parse(spec("petstore-v2.json")), null, 4);
    expect((await parseSpec({ text: reformatted })).specHash).toBe(a.specHash);
    const changed = spec("petstore-v2.json").replace("Add a new pet", "Add a pet");
    expect((await parseSpec({ text: changed })).specHash).not.toBe(a.specHash);
  });
});

describe("parseSpec errors", () => {
  it("returns a typed INVALID_SPEC error for bad input", async () => {
    for (const text of ["not a spec: [", '{"openapi":"3.0.3"}', "{}"]) {
      const err = await parseSpec({ text }).catch((e) => e);
      expect(err).toBeInstanceOf(ParseSpecError);
      expect(err.code).toBe("INVALID_SPEC");
    }
  });

  it("rejects duplicate endpoints after normalization", async () => {
    const dup = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "d", version: "1" },
      paths: {
        "/a/{x}": { get: { responses: { "200": { description: "ok" } } } },
        "/a/{y}": { get: { responses: { "200": { description: "ok" } } } },
      },
    });
    await expect(parseSpec({ text: dup })).rejects.toMatchObject({ code: "INVALID_SPEC" });
  });
});

describe("parseSpec url", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok.yaml") return void res.end(spec("petstore-v3.yaml"));
      if (req.url === "/docs")
        return void res.end(
          "<!doctype html><html><body><div id=ui></div><script>SwaggerUIBundle({ url: '/ok.yaml', dom_id: '#ui' })</script></body></html>",
        );
      if (req.url === "/redoc")
        return void res.end(
          '<!doctype html><html><body><redoc spec-url="/ok.yaml"></redoc></body></html>',
        );
      if (req.url === "/page")
        return void res.end("<!doctype html><html><body>hello</body></html>");
      if (req.url === "/big") return void res.end("x".repeat(2048));
      if (req.url === "/slow") return; // never responds
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  it("fetches and parses a YAML spec", async () => {
    const p = await parseSpec({ url: `${base}/ok.yaml` });
    expect(p.endpoints).toHaveLength(4);
  });

  it("follows the spec URL of a Swagger UI or Redoc docs page", async () => {
    expect((await parseSpec({ url: `${base}/docs` })).endpoints).toHaveLength(4);
    expect((await parseSpec({ url: `${base}/redoc` })).endpoints).toHaveLength(4);
  });

  it("explains when a web page has no spec in it", async () => {
    await expect(parseSpec({ url: `${base}/page` })).rejects.toMatchObject({
      code: "INVALID_SPEC",
      message: expect.stringContaining("web page, not an OpenAPI spec"),
    });
    await expect(
      parseSpec({ text: "<!DOCTYPE html><html></html>", filename: "x.html" }),
    ).rejects.toMatchObject({ code: "INVALID_SPEC" });
  });

  it("maps HTTP errors, size limit and timeout to typed errors", async () => {
    await expect(parseSpec({ url: `${base}/nope` })).rejects.toMatchObject({
      code: "FETCH_FAILED",
    });
    const { fetchSpecText } = await import("./index");
    await expect(fetchSpecText(`${base}/big`, { maxBytes: 100 })).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    await expect(fetchSpecText(`${base}/slow`, { timeoutMs: 200 })).rejects.toMatchObject({
      code: "FETCH_TIMEOUT",
    });
  });
});

describe("docs page detection", () => {
  it("recognises HTML but not JSON or YAML", () => {
    expect(looksLikeHtml("  <!DOCTYPE html><html>")).toBe(true);
    expect(looksLikeHtml('{"openapi":"3.0.0"}')).toBe(false);
    expect(looksLikeHtml("openapi: 3.0.0")).toBe(false);
  });

  it("finds the spec URL and only follows the same origin", () => {
    const page = "http://localhost:3100/docs";
    expect(
      discoverSpecUrl(
        "SwaggerUIBundle({ url: '/openapi.json', persistAuthorization: true })",
        page,
      ),
    ).toBe("http://localhost:3100/openapi.json");
    expect(discoverSpecUrl('<redoc spec-url="v3/api-docs"></redoc>', page)).toBe(
      "http://localhost:3100/v3/api-docs",
    );
    expect(discoverSpecUrl("SwaggerUIBundle({ url: 'http://evil.test/x.json' })", page)).toBeNull();
    expect(discoverSpecUrl("<p>nothing</p>", page)).toBeNull();
  });
});
