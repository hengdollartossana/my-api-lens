import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { groupEndpoints } from "../grouper";
import { parseSpec } from "../parser";
import {
  type CodegenEndpoint,
  type CodegenModule,
  type GeneratedFile,
  generateFlutter,
} from "./index";
import { camelCase, operationName, pascalCase, snakeCase } from "./names";

async function messyModules(): Promise<CodegenModule[]> {
  const p = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
  const g = groupEndpoints(p.endpoints);
  return g.modules.map((m) => ({
    name: m.name,
    endpoints: p.endpoints.filter((e) => m.stableKeys.includes(e.stableKey)),
  }));
}

const str = { type: "string" };
const obj = (
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) => ({
  type: "object",
  properties,
  required,
});

/** Long names, every parameter kind, odd methods: the cases most likely to trip dart format. */
function stressModules(): CodegenModule[] {
  const address = obj({ line_1: str, postal_code: { type: "string", nullable: true } }, ["line_1"]);
  const document = obj(
    {
      id: { type: "string", format: "uuid" },
      class: str,
      created_at: { type: "string", format: "date-time" },
      page_count: { type: "integer" },
      score: { type: "number" },
      status: { type: "string", enum: ["draft", "final"] },
      tags: { type: "array", items: str },
      counts: { type: "object", additionalProperties: { type: "integer" } },
      billing_address: address,
      shipping_address: address,
      "x-trace-id": str,
      mixed: { oneOf: [str, { type: "integer" }] },
      note: { type: "string", nullable: true },
    },
    ["id", "class", "created_at"],
  );
  const base = (
    over: Partial<CodegenEndpoint> & { method: string; path: string },
  ): CodegenEndpoint => ({
    parameters: [],
    requestBodySchema: null,
    responseSchemas: {},
    ...over,
  });
  const tenant = { name: "tenantIdentifier", in: "path", required: true, schema: str };
  const org = {
    name: "organizationIdentifier",
    in: "path",
    required: true,
    schema: { type: "integer" },
  };
  return [
    {
      name: "Documents Management Service",
      endpoints: [
        base({
          method: "GET",
          path: "/api/v1/{tenantIdentifier}/organizations/{organizationIdentifier}/documents",
          operationId: "DocumentsController_findAllDocumentsForOrganization",
          summary: "List every document of an organization",
          parameters: [
            tenant,
            org,
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: true, schema: { type: "integer" } },
            { name: "search_text", in: "query", required: false, schema: str },
            { name: "X-Trace", in: "header", required: false, schema: str },
          ],
          responseSchemas: { "200": { type: "array", items: document }, "401": null },
        }),
        base({
          method: "GET",
          path: "/documents/{id}",
          parameters: [{ name: "id", in: "path", required: true, schema: str }],
          responseSchemas: { "200": document },
        }),
        base({
          method: "PATCH",
          path: "/documents/{id}",
          parameters: [{ name: "id", in: "path", required: true, schema: str }],
          requestBodySchema: obj({ title: str, page_count: { type: "integer" } }, []),
          responseSchemas: { "200": document },
        }),
        base({
          method: "DELETE",
          path: "/documents/{id}",
          parameters: [{ name: "id", in: "path", required: true, schema: str }],
          responseSchemas: { "204": null },
        }),
        base({ method: "OPTIONS", path: "/documents", responseSchemas: { "204": null } }),
        base({
          method: "GET",
          path: "/documents/count",
          responseSchemas: { "200": { type: "integer" } },
        }),
        base({
          method: "GET",
          path: "/documents/names",
          responseSchemas: { "200": { type: "array", items: str } },
        }),
        base({ method: "GET", path: "/documents/it's$odd", responseSchemas: { "200": str } }),
        base({
          method: "POST",
          path: "/documents/bulk",
          requestBodySchema: { type: "array", items: str },
          responseSchemas: { "202": null },
        }),
      ],
    },
  ];
}

const dartAvailable = spawnSync("dart", ["--version"]).status === 0;

function writeAll(files: GeneratedFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "apilens-dart-"));
  for (const f of files) {
    mkdirSync(dirname(join(dir, f.path)), { recursive: true });
    writeFileSync(join(dir, f.path), f.content);
  }
  return dir;
}

describe("names", () => {
  it("converts between cases", () => {
    expect(snakeCase("UsersController")).toBe("users_controller");
    expect(pascalCase("order-items")).toBe("OrderItems");
    expect(camelCase("created_at")).toBe("createdAt");
    expect(camelCase("123abc")).toBe("n123abc");
  });

  it("names operations from the operationId tail, else method and path", () => {
    expect(
      operationName({ method: "GET", path: "/x", operationId: "UsersController_findAll" }),
    ).toBe("findAll");
    expect(operationName({ method: "GET", path: "/api/v1/users/{id}" })).toBe("getUsersById");
    expect(operationName({ method: "GET", path: "/x", operationId: "default" })).toBe(
      "defaultValue",
    );
  });
});

describe("flutter golden files", () => {
  it("generates messy-v3", async () => {
    const files = generateFlutter(await messyModules());
    expect(files.map((f) => f.path)).toMatchSnapshot();
    for (const f of files) {
      await expect(f.content).toMatchFileSnapshot(`./__golden__/messy/${f.path}`);
    }
  });

  it("prefers observed reality for nullability and extra fields", async () => {
    const modules = await messyModules();
    const observed: Record<string, { status: number; body: unknown }> = {
      "GET /api/v1/{tenant}/users": {
        status: 200,
        body: [
          { id: "u1", email: "a@b.c", name: "A" },
          { id: "u2", name: "B" },
        ],
      },
      "GET /api/v1/{tenant}/users/{userId}": {
        status: 200,
        body: { id: "u1", email: "a@b.c", name: "A", internalNote: "vip" },
      },
      "GET /api/v1/{tenant}/orders": {
        status: 200,
        body: [
          {
            id: "o1",
            total: { amount: "42.50", currency: "USD" },
            shippingAddress: { line1: "1", city: "c" },
            lines: [],
          },
        ],
      },
      "GET /api/v1/{tenant}/orders/{orderId}": {
        status: 200,
        body: {
          id: "o1",
          total: { amount: 20, currency: "USD" },
          shippingAddress: null,
          lines: [],
        },
      },
    };
    const withObserved = modules.map((m) => ({
      ...m,
      endpoints: m.endpoints.map((e) => ({ ...e, observed: observed[`${e.method} ${e.path}`] })),
    })) as CodegenModule[];
    const files = generateFlutter(withObserved, { preferObserved: true }).filter((f) =>
      f.path.startsWith("lib/api/models/"),
    );
    for (const f of files) {
      await expect(f.content).toMatchFileSnapshot(`./__golden__/messy-observed/${f.path}`);
    }
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    expect(byPath.get("lib/api/models/user.dart")).toContain("String? email");
    expect([...byPath.values()].some((c) => c.includes("String? internalNote"))).toBe(true);
    expect([...byPath.values()].some((c) => c.includes("Address? shippingAddress"))).toBe(true);
    expect([...byPath.values()].some((c) => c.includes("required String amount"))).toBe(true);
  });

  it("generates a stress module", () => {
    const files = generateFlutter(stressModules());
    for (const f of files) {
      expect(f.path).toMatch(/^lib\/api\/[a-z0-9_/]+\.dart$/);
    }
  });
});

describe("flutter output rules", () => {
  const files = generateFlutter(stressModules());
  const get = (path: string) => (files.find((f) => f.path === path) as GeneratedFile).content;
  const models = files.filter(
    (f) => f.path.startsWith("lib/api/models/") && !f.path.endsWith("models.dart"),
  );

  it("uses snake_case files, PascalCase classes and camelCase fields with JsonKey", () => {
    const doc = get("lib/api/models/document.dart");
    expect(doc).toContain("class Document with _$Document");
    expect(doc).toContain("@JsonKey(name: 'created_at') required DateTime createdAt");
    expect(doc).toContain("@JsonKey(name: 'page_count') int? pageCount");
    expect(doc).toContain("@JsonKey(name: 'x-trace-id') String? xTraceId");
    expect(doc).toContain("part 'document.freezed.dart';");
    expect(doc).toContain("part 'document.g.dart';");
  });

  it("maps types: int vs double, enums as String, lists, maps, nullable and reserved words", () => {
    const doc = get("lib/api/models/document.dart");
    expect(doc).toContain("double? score");
    expect(doc).toContain("String? status");
    expect(doc).toContain("List<String>? tags");
    expect(doc).toContain("Map<String, int>? counts");
    expect(doc).toContain("String? note");
    expect(doc).toContain("classValue");
    expect(doc).toContain("dynamic mixed");
  });

  it("shares one model for identical shapes", () => {
    const doc = get("lib/api/models/document.dart");
    expect(doc).toContain("Address? billingAddress");
    expect(doc).toContain("Address? shippingAddress");
    expect(models.filter((m) => /class \w*Address\b/.test(m.content))).toHaveLength(1);
  });

  it("builds the client with path interpolation, query params and bodies", () => {
    const client = get(
      "lib/api/documents_management_service/documents_management_service_client.dart",
    );
    expect(client).toContain("class DocumentsManagementServiceClient");
    expect(client).toContain("$tenantIdentifier");
    expect(client).toContain("$organizationIdentifier/documents");
    expect(client).toContain("'offset': offset");
    expect(client).toContain("if (limit != null) 'limit': limit");
    expect(client).toContain("if (searchText != null) 'search_text': searchText");
    expect(client).toContain("data: body.toJson()");
    expect(client).toContain("_dio.patch<dynamic>");
    expect(client).toContain("_dio.request<dynamic>");
    expect(client).toContain("Options(method: 'OPTIONS')");
    expect(client).toContain("Future<void> deleteDocumentsById");
  });

  it("escapes quotes and dollars in paths", () => {
    const client = get(
      "lib/api/documents_management_service/documents_management_service_client.dart",
    );
    expect(client).toContain("'/documents/it\\'s\\$odd'");
  });

  it("wraps repositories in ApiException and exports barrels", () => {
    const repo = get(
      "lib/api/documents_management_service/documents_management_service_repository.dart",
    );
    expect(repo).toContain("on DioException catch (e)");
    expect(repo).toContain("throw ApiException.fromDio(e)");
    expect(get("lib/api/api.dart")).toContain("export 'api_exception.dart';");
    expect(get("lib/api/api_exception.dart")).toContain("class ApiException implements Exception");
  });

  it("contains no secrets or real hosts", () => {
    for (const f of files) expect(f.content).not.toMatch(/https?:\/\/|Bearer|password/i);
  });

  it("is deterministic", async () => {
    const a = generateFlutter(await messyModules());
    const b = generateFlutter(await messyModules());
    expect(a).toEqual(b);
  });
});

describe("dart format", () => {
  if (!dartAvailable)
    console.warn("dart is not installed: skipping the `dart format` check on generated code");
  it.skipIf(!dartAvailable)("generated code is already formatted", async () => {
    for (const files of [generateFlutter(await messyModules()), generateFlutter(stressModules())]) {
      const dir = writeAll(files);
      const res = spawnSync("dart", ["format", "--output=none", "--set-exit-if-changed", "."], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(res.stdout + res.stderr, `${res.stdout}${res.stderr}`).not.toMatch(/^Changed /m);
      expect(res.status).toBe(0);
    }
  });
});
