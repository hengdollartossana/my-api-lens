/** Shapes returned by the runs API; plain JSON so client components can import them. */

export type RunStatus = "running" | "done" | "failed" | "cancelled";
export type Severity = "ok" | "info" | "warn" | "error";

/** Mirror of core/diff DiffItem as plain JSON. */
export interface DiffItemJson {
  kind: string;
  severity: "error" | "warn" | "info";
  path: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export interface RunListItem {
  id: string;
  projectId: string;
  projectName: string;
  moduleId: string | null;
  moduleName: string | null;
  environmentId: string;
  environmentName: string;
  isProd: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  resultCount: number;
  errorCount: number;
  warnCount: number;
  skippedCount: number;
}

export interface RunResultItem {
  id: string;
  endpointId: string;
  stableKey: string;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number | null;
  severity: Severity;
  skipReason: string | null;
  error: string | null;
  /** Redacted request as sent (no auth headers). */
  request: unknown;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  /** Differences from the spec (null when not compared: skipped, error or truncated body). */
  diff: DiffItemJson[] | null;
}

export interface RunDetail {
  run: RunListItem;
  results: RunResultItem[];
}

/** A result as pushed over SSE (lighter than RunResultItem: no bodies or headers). */
export interface RunResultEvent {
  endpointId: string;
  stableKey: string;
  statusCode: number | null;
  durationMs: number | null;
  severity: Severity;
  diffCount: number;
  skipped: boolean;
  skipReason: string | null;
  error: string | null;
}

export const SKIP_LABELS: Record<string, string> = {
  destructive_unconfirmed: "Destructive: not confirmed",
};
