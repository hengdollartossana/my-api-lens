import type { AiRequest } from "./types";

/** One endpoint as the model sees it: its inputs only, never responses or real data. */
export interface TestDataEndpoint {
  stableKey: string;
  method: string;
  path: string;
  summary?: string | null;
  parameters: { name: string; in: string; required: boolean; schema?: unknown }[];
  requestBodySchema?: unknown | null;
}

/** Request values for one endpoint, in the shape the executor accepts. */
export interface TestDataInput {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
}

/** Most endpoints per call; the rest keep schema-sampled values. */
export const MAX_TESTDATA_ENDPOINTS = 40;
const MAX_SCHEMA_CHARS = 1500;

const clipSchema = (schema: unknown) => {
  const text = JSON.stringify(schema ?? null);
  return text.length > MAX_SCHEMA_CHARS ? `${text.slice(0, MAX_SCHEMA_CHARS)}…` : text;
};

const describeEndpoint = (e: TestDataEndpoint, n: number) => {
  const lines = [`${n}. ${e.method.toUpperCase()} ${e.path}${e.summary ? ` - ${e.summary}` : ""}`];
  for (const p of e.parameters.filter((x) => x.in === "path" || x.in === "query"))
    lines.push(`   ${p.in} ${p.name}${p.required ? " (required)" : ""}: ${clipSchema(p.schema)}`);
  if (e.requestBodySchema) lines.push(`   body: ${clipSchema(e.requestBodySchema)}`);
  return lines.join("\n");
};

/** Ask for realistic request values per endpoint, referring to endpoints by short ids. */
export function buildTestDataRequest(endpoints: TestDataEndpoint[]): AiRequest {
  const shown = endpoints.slice(0, MAX_TESTDATA_ENDPOINTS);
  return {
    system:
      "You write realistic request data for calling REST API endpoints during development " +
      "testing. Values must satisfy the given JSON schemas (types, enums, formats, required " +
      "fields) and look like real data a frontend would send: real-looking names, emails, " +
      'dates, not placeholders like "string". Never use real people\'s data or secrets. ' +
      "Answer with JSON only.",
    prompt:
      `Endpoints:\n${shown.map((e, i) => describeEndpoint(e, i + 1)).join("\n")}\n\n` +
      'Reply with {"endpoints":[{"id":1,"pathParams":{},"query":{},"body":{}}]}. Include only ' +
      "the parts the endpoint has. Skip endpoints you cannot fill.",
    maxTokens: 8000,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const scalars = <T extends string | number | boolean>(
  raw: unknown,
  allowed: readonly string[],
  ok: (v: unknown) => v is T,
): Record<string, T> | undefined => {
  if (!isObj(raw)) return undefined;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(raw)) if (allowed.includes(k) && ok(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
};

/**
 * Turn the model's reply into inputs keyed by stable key. Tolerates prose or fences around the
 * JSON, and drops unknown ids, unknown parameter names and non-scalar parameter values, so a bad
 * answer degrades to the sampled defaults for that part.
 */
export function parseTestDataResponse(
  text: string,
  endpoints: TestDataEndpoint[],
): Map<string, TestDataInput> {
  const out = new Map<string, TestDataInput>();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return out;
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return out;
  }
  if (!isObj(json) || !Array.isArray(json.endpoints)) return out;

  for (const item of json.endpoints) {
    if (!isObj(item) || typeof item.id !== "number") continue;
    const endpoint = endpoints.slice(0, MAX_TESTDATA_ENDPOINTS)[item.id - 1];
    if (!endpoint || out.has(endpoint.stableKey)) continue;
    const names = (where: string) =>
      endpoint.parameters.filter((p) => p.in === where).map((p) => p.name);
    const pathParams = scalars(
      item.pathParams,
      names("path"),
      (v): v is string | number => typeof v === "string" || typeof v === "number",
    );
    const query = scalars(
      item.query,
      names("query"),
      (v): v is string | number | boolean =>
        typeof v === "string" || typeof v === "number" || typeof v === "boolean",
    );
    const body = endpoint.requestBodySchema && item.body !== undefined ? item.body : undefined;
    if (pathParams || query || body !== undefined) {
      out.set(endpoint.stableKey, {
        ...(pathParams && { pathParams }),
        ...(query && { query }),
        ...(body !== undefined && { body }),
      });
    }
  }
  return out;
}
