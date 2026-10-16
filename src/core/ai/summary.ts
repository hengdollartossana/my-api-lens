import type { AiRequest } from "./types";

/** One difference between the spec and a real response. Values are never sent, only the finding. */
export interface SummaryDiffItem {
  /** `GET /users/{id}` */
  endpoint: string;
  kind: string;
  severity: "error" | "warn" | "info";
  /** Field path inside the response, e.g. `$.items[0].email`. */
  path: string;
  message: string;
}

export interface SummaryContext {
  moduleName: string | null;
  environmentName: string;
  /** Endpoints compared in the run (with or without findings). */
  comparedCount: number;
}

/** Most findings sent per call; errors first so the cut never drops the important ones. */
export const MAX_SUMMARY_ITEMS = 200;
const MAX_MESSAGE_CHARS = 200;
const RANK = { error: 0, warn: 1, info: 2 } as const;

const clip = (s: string) =>
  s.length > MAX_MESSAGE_CHARS ? `${s.slice(0, MAX_MESSAGE_CHARS)}…` : s;

/** The prompt for a plain-English summary of a run's differences. Diff items only, no bodies. */
export function buildSummaryRequest(ctx: SummaryContext, items: SummaryDiffItem[]): AiRequest {
  const ordered = [...items].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.endpoint.localeCompare(b.endpoint),
  );
  const shown = ordered.slice(0, MAX_SUMMARY_ITEMS);
  const lines = shown.map(
    (i) => `[${i.severity}] ${i.endpoint} ${i.path}: ${i.kind} - ${clip(i.message)}`,
  );
  const omitted = ordered.length - shown.length;
  return {
    system:
      "You explain differences between an API's OpenAPI spec and what it really returned, for a " +
      "developer who will build a client against it. Be concrete and brief. Group related " +
      "findings, lead with what would break a client, and end with what to do first. " +
      "Plain sentences or a short bullet list; no headings.",
    prompt:
      `Module: ${ctx.moduleName ?? "all modules"}\n` +
      `Environment: ${ctx.environmentName}\n` +
      `Endpoints compared: ${ctx.comparedCount}; findings: ${items.length}\n\n` +
      `${lines.join("\n")}${omitted > 0 ? `\n(${omitted} lower-severity findings not shown)` : ""}\n\n` +
      "Summarise in under 150 words.",
    maxTokens: 4000,
  };
}
