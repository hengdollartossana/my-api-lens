export type DiffKind =
  | "undocumented_status"
  | "missing_required"
  | "extra_field"
  | "type_mismatch"
  | "unexpected_null"
  | "enum_violation"
  | "format_violation";

export type DiffSeverity = "error" | "warn" | "info";

export interface DiffItem {
  kind: DiffKind;
  severity: DiffSeverity;
  /** JSON path into the response body, e.g. `$[1].email`; `$status` for the status code. */
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface ActualResponse {
  status: number;
  /** Parsed JSON, or text/null when the body was not JSON. */
  body: unknown;
}

/** Response schemas keyed by HTTP status (or "2XX" / "default"); null = no documented body. */
export type ResponseSchemas = Record<string, unknown | null>;

export const SEVERITY_BY_KIND: Record<DiffKind, DiffSeverity> = {
  missing_required: "error",
  type_mismatch: "error",
  undocumented_status: "error",
  unexpected_null: "warn",
  enum_violation: "warn",
  format_violation: "warn",
  extra_field: "info",
};
