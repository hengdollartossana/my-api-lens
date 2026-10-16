import { ParseSpecError } from "./errors";
import type { JsonObject, NormalizedEndpoint, NormalizedParameter } from "./types";

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** `METHOD /path/{}` — method uppercased, every path param normalized to `{}`. */
export function stableKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path.replace(/\{[^}]*\}/g, "{}")}`;
}

export function isDestructive(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

const obj = (v: unknown): JsonObject => (v && typeof v === "object" ? (v as JsonObject) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function pickContentSchema(content: unknown): unknown | null {
  const c = obj(content);
  const media = obj(c["application/json"] ?? c[Object.keys(c)[0] ?? ""]);
  return media.schema ?? null;
}

function normalizeParameters(pathLevel: unknown, opLevel: unknown, v2: boolean) {
  const byKey = new Map<string, NormalizedParameter>();
  for (const raw of [...arr(pathLevel), ...arr(opLevel)]) {
    const p = obj(raw);
    if (typeof p.name !== "string" || typeof p.in !== "string") continue;
    if (v2 && p.in === "body") continue;
    let schema = p.schema;
    if (schema === undefined) {
      // Swagger 2 inlines the schema keywords on the parameter itself.
      const { name, in: _in, required, description, collectionFormat, ...rest } = p;
      void name;
      void _in;
      void required;
      void description;
      void collectionFormat;
      schema = rest;
    }
    byKey.set(`${p.in}:${p.name}`, {
      name: p.name,
      in: p.in,
      required: p.in === "path" ? true : p.required === true,
      schema,
    });
  }
  return [...byKey.values()];
}

export function normalizeEndpoints(api: JsonObject, v2: boolean): NormalizedEndpoint[] {
  const rootSecurity = arr(api.security);
  const out: NormalizedEndpoint[] = [];
  const seen = new Set<string>();

  for (const [path, rawItem] of Object.entries(obj(api.paths))) {
    const item = obj(rawItem);
    for (const method of METHODS) {
      if (!item[method]) continue;
      const op = obj(item[method]);
      const key = stableKey(method, path);
      if (seen.has(key)) {
        throw new ParseSpecError("INVALID_SPEC", `Duplicate endpoint after normalization: ${key}`);
      }
      seen.add(key);

      let requestBodySchema: unknown | null = null;
      if (v2) {
        const body = arr(op.parameters)
          .concat(arr(item.parameters))
          .map(obj)
          .find((p) => p.in === "body");
        requestBodySchema = body?.schema ?? null;
      } else {
        requestBodySchema = pickContentSchema(obj(op.requestBody).content);
      }

      const responseSchemas: Record<string, unknown | null> = {};
      for (const [status, rawRes] of Object.entries(obj(op.responses))) {
        const res = obj(rawRes);
        responseSchemas[status] = v2 ? (res.schema ?? null) : pickContentSchema(res.content);
      }

      out.push({
        stableKey: key,
        method: method.toUpperCase(),
        path,
        operationId: typeof op.operationId === "string" ? op.operationId : null,
        summary: typeof op.summary === "string" ? op.summary : null,
        tags: arr(op.tags).filter((t): t is string => typeof t === "string"),
        parameters: normalizeParameters(item.parameters, op.parameters, v2),
        requestBodySchema,
        responseSchemas,
        security: op.security === undefined ? rootSecurity : arr(op.security),
        isDestructive: isDestructive(method),
      });
    }
  }
  return out;
}

export function normalizeServers(api: JsonObject, v2: boolean): string[] {
  if (!v2) {
    return arr(api.servers)
      .map((s) => obj(s).url)
      .filter((u): u is string => typeof u === "string");
  }
  const host = typeof api.host === "string" ? api.host : null;
  if (!host) return [];
  const basePath = typeof api.basePath === "string" ? api.basePath : "";
  const schemes = arr(api.schemes).filter((s): s is string => typeof s === "string");
  return (schemes.length ? schemes : ["https"]).map((s) => `${s}://${host}${basePath}`);
}

export function normalizeSecuritySchemes(api: JsonObject, v2: boolean): Record<string, JsonObject> {
  if (!v2)
    return Object.fromEntries(
      Object.entries(obj(obj(api.components).securitySchemes)).map(([k, v]) => [k, obj(v)]),
    );
  const out: Record<string, JsonObject> = {};
  for (const [name, raw] of Object.entries(obj(api.securityDefinitions))) {
    const s = obj(raw);
    out[name] = s.type === "basic" ? { type: "http", scheme: "basic" } : s;
  }
  return out;
}
