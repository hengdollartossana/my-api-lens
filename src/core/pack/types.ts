export interface PackParameter {
  name: string;
  in: string;
  required: boolean;
  schema?: unknown;
}

/** A known mismatch between spec and reality (shape of a diff item). */
export interface PackDiffNote {
  kind: string;
  path: string;
  message: string;
}

export interface PackEndpoint {
  method: string;
  path: string;
  summary?: string | null;
  operationId?: string | null;
  parameters: PackParameter[];
  requestBodySchema: unknown | null;
  /** Keyed by HTTP status (or "2XX" / "default"). */
  responseSchemas: Record<string, unknown | null>;
  /** Known diffs for this endpoint; listed under "Known diffs". */
  diffNotes?: PackDiffNote[];
  /** A real response seen in a run; used instead of the spec when `preferObserved` is set. */
  observed?: { status: number; body: unknown };
}

export interface PackModule {
  name: string;
  endpoints: PackEndpoint[];
}

export type AuthSummary =
  | { type: "none" }
  | { type: "static_bearer"; headerName?: string }
  | { type: "api_key"; in: "header" | "query"; name: string }
  | {
      type: "login_flow";
      loginPath: string;
      method?: string;
      tokenPath: string;
      headerName?: string;
    };

export interface PackOptions {
  /** Shown instead of a real host. Default `{{BASE_URL}}`. */
  baseUrlPlaceholder?: string;
  /** Auth recipe summary (never secrets). Omit to infer from `securitySchemes`. */
  auth?: AuthSummary;
  securitySchemes?: Record<string, Record<string, unknown>>;
  /** Use observed responses (when present) instead of the documented schema. */
  preferObserved?: boolean;
  title?: string;
}
