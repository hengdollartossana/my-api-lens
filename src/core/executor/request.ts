import { sampleFromSchema } from "./sample";
import {
  type BuiltRequest,
  type ExecAuth,
  type ExecEndpoint,
  type ExecEnv,
  type ExecInput,
  ExecutorError,
  type RedactedRequest,
} from "./types";

const REDACTED_HEADERS = new Set(["authorization", "cookie", "x-api-key"]);
const REDACTED = "[REDACTED]";

function joinUrl(baseUrl: string, path: string): URL {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new ExecutorError("INVALID_BASE_URL", `Invalid environment base URL: ${baseUrl}`);
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  return base;
}

function sampleScalar(schema: unknown): string {
  const v = sampleFromSchema(schema);
  return v === null || v === undefined ? "1" : String(v);
}

export function buildRequest(
  endpoint: ExecEndpoint,
  env: ExecEnv,
  input: ExecInput = {},
  auth: ExecAuth = {},
): BuiltRequest {
  // Path params: given value, else a sample from the schema.
  const pathParams = new Map<string, string>();
  for (const p of endpoint.parameters.filter((x) => x.in === "path")) {
    const given = input.pathParams?.[p.name];
    pathParams.set(p.name, given !== undefined ? String(given) : sampleScalar(p.schema));
  }
  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    const value = pathParams.get(name) ?? input.pathParams?.[name];
    if (value === undefined) {
      throw new ExecutorError("MISSING_PATH_PARAM", `Missing path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });

  const url = joinUrl(env.baseUrl, path);

  // Query: required params get a sample when not provided; explicit input always wins.
  for (const p of endpoint.parameters.filter((x) => x.in === "query" && x.required)) {
    if (input.query?.[p.name] === undefined) url.searchParams.set(p.name, sampleScalar(p.schema));
  }
  for (const [k, v] of Object.entries(input.query ?? {})) url.searchParams.set(k, String(v));
  for (const [k, v] of Object.entries(auth.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = { accept: "application/json" };
  const lower = (h: Record<string, string>) =>
    Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  Object.assign(headers, lower(env.defaultHeaders ?? {}));

  let body: string | undefined;
  let bodyWasGenerated = false;
  const hasBody = endpoint.requestBodySchema !== null && endpoint.requestBodySchema !== undefined;
  if (input.body !== undefined) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body);
    headers["content-type"] ??= "application/json";
  } else if (hasBody && !["GET", "HEAD"].includes(endpoint.method.toUpperCase())) {
    body = JSON.stringify(sampleFromSchema(endpoint.requestBodySchema));
    bodyWasGenerated = true;
    headers["content-type"] ??= "application/json";
  }

  Object.assign(headers, lower(input.headers ?? {}), lower(auth.headers ?? {}));

  return {
    method: endpoint.method.toUpperCase(),
    url: url.toString(),
    headers,
    body,
    bodyWasGenerated,
    secretQueryKeys: Object.keys(auth.query ?? {}),
  };
}

/** Copy of the request that is safe to store or log: auth headers and credential query values masked. */
export function redactRequest(req: BuiltRequest): RedactedRequest {
  const url = new URL(req.url);
  for (const key of req.secretQueryKeys) {
    if (url.searchParams.has(key)) url.searchParams.set(key, REDACTED);
  }
  return {
    method: req.method,
    url: url.toString().replace(/%5BREDACTED%5D/g, REDACTED),
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        REDACTED_HEADERS.has(k.toLowerCase()) ? REDACTED : v,
      ]),
    ),
    body: req.body,
  };
}
