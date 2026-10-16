import { toHtml } from "./html";
import { summarize, toMarkdown } from "./markdown";
import type { Report, ReportInput } from "./types";

export { REDACTED, safeText, safeValue } from "./redact";
export * from "./types";

/**
 * Build a shareable diff report as Markdown and as one self-contained HTML page.
 * Values are truncated and credentials redacted, so the files are safe to hand to others.
 */
export function buildDiffReport(input: ReportInput): Report {
  const summary = summarize(input.endpoints);
  return { markdown: toMarkdown(input, summary), html: toHtml(input, summary), summary };
}
