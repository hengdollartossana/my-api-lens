export type JsonObject = Record<string, unknown>;

export interface NormalizedParameter {
  name: string;
  in: string;
  required: boolean;
  schema: unknown;
}

export interface NormalizedEndpoint {
  /** `METHOD /path/{}` — see stableKey(). */
  stableKey: string;
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  tags: string[];
  parameters: NormalizedParameter[];
  requestBodySchema: unknown | null;
  /** Keyed by HTTP status (or "default"); null when the response has no schema. */
  responseSchemas: Record<string, unknown | null>;
  security: unknown[];
  isDestructive: boolean;
}

export interface ParsedSpec {
  title: string;
  version: string;
  /** "2.0" for Swagger 2, otherwise the OpenAPI 3.x version string. */
  openapi: string;
  servers: string[];
  securitySchemes: Record<string, JsonObject>;
  endpoints: NormalizedEndpoint[];
  specHash: string;
  /** The spec as written (JSON-compatible, $refs intact); stored so re-imports can be compared. */
  raw: JsonObject;
}

export type ParseInput = { url: string } | { text: string; filename?: string };
