export type Json = unknown;

export interface ExecParameter {
  name: string;
  in: string;
  required: boolean;
  schema?: unknown;
}

/** The slice of a parsed endpoint the executor needs. */
export interface ExecEndpoint {
  method: string;
  path: string;
  parameters: ExecParameter[];
  requestBodySchema: unknown | null;
}

export interface ExecEnv {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
}

export interface ExecInput {
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  /** JSON body; when undefined and the endpoint has a body schema, a sample is generated. */
  body?: unknown;
}

/** Credentials resolved by an auth recipe (T-16). */
export interface ExecAuth {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface BuiltRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  bodyWasGenerated: boolean;
  /** Query keys that carry credentials; redacted when the request is stored. */
  secretQueryKeys: string[];
}

export interface RedactedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export type ExecErrorCode = "TIMEOUT" | "NETWORK" | "BLOCKED";

export interface ExecResult {
  /** HTTP status, or null when no response arrived (see error). */
  status: number | null;
  headers: Record<string, string>;
  durationMs: number;
  /** Parsed JSON when the body is JSON and complete, otherwise the text (or null if empty). */
  body: Json | null;
  bodyText: string;
  /** True when the body hit the size cap and was cut. */
  truncated: boolean;
  error?: { code: ExecErrorCode; message: string };
  request: RedactedRequest;
}

export interface ExecuteOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Called with the final URL before sending; throw to block (wire SSRF guard here). */
  guard?: (url: string) => Promise<void> | void;
}

export class ExecutorError extends Error {
  constructor(
    readonly code: "MISSING_PATH_PARAM" | "INVALID_BASE_URL",
    message: string,
  ) {
    super(message);
    this.name = "ExecutorError";
  }
}
