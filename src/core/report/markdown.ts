import { safeText, safeValue } from "./redact";
import type { ReportEndpoint, ReportInput, ReportSummary } from "./types";

const SEVERITY_LABEL = { error: "Error", warn: "Warning", info: "Info" } as const;
const KIND_LABEL: Record<string, string> = {
  undocumented_status: "Undocumented status",
  missing_required: "Missing required field",
  extra_field: "Extra field",
  type_mismatch: "Type mismatch",
  unexpected_null: "Unexpected null",
  enum_violation: "Enum violation",
  format_violation: "Format violation",
};

export const kindLabel = (k: string) => KIND_LABEL[k] ?? k;

/** Text for headings and table cells: escape pipes, flatten newlines and neutralize raw HTML. */
const cell = (s: string) =>
  s
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, " ");
/** Inside a code span HTML is shown literally, so only table syntax needs escaping. */
const raw = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const code = (s: string) => (s ? `\`${s.replace(/`/g, "'")}\`` : "");

export function groupByModule(endpoints: ReportEndpoint[]): [string, ReportEndpoint[]][] {
  const map = new Map<string, ReportEndpoint[]>();
  for (const e of endpoints) map.set(e.module, [...(map.get(e.module) ?? []), e]);
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function summarize(endpoints: ReportEndpoint[]): ReportSummary {
  const count = (sev: string) =>
    endpoints.reduce((n, e) => n + e.items.filter((i) => i.severity === sev).length, 0);
  return {
    errors: count("error"),
    warnings: count("warn"),
    info: count("info"),
    endpointsCompared: endpoints.length,
    endpointsMatching: endpoints.filter((e) => e.items.length === 0).length,
  };
}

export function toMarkdown(input: ReportInput, summary: ReportSummary): string {
  const out: string[] = [
    `# API diff report: ${cell(input.project)}`,
    "",
    `Generated ${input.generatedAt}. Spec vs reality, from each endpoint's latest run.`,
    "",
    "## Summary",
    "",
    "| Errors | Warnings | Info | Endpoints compared | Matching the spec |",
    "|---:|---:|---:|---:|---:|",
    `| ${summary.errors} | ${summary.warnings} | ${summary.info} | ${summary.endpointsCompared} | ${summary.endpointsMatching} |`,
    "",
  ];

  const withDiffs = input.endpoints.filter((e) => e.items.length > 0);
  if (withDiffs.length === 0) {
    out.push("No mismatches: every compared response matches the spec.", "");
    return `${out.join("\n")}`;
  }

  for (const [module, list] of groupByModule(withDiffs)) {
    out.push(`## ${cell(module)}`, "");
    for (const e of list) {
      out.push(
        `### ${e.method} ${code(e.path)}`,
        "",
        `Environment: ${cell(e.environment)}${e.isProd ? " (PROD)" : ""} · run ${e.ranAt}${e.statusCode !== null ? ` · HTTP ${e.statusCode}` : ""}`,
        "",
        "| Severity | Kind | Path | Expected | Actual | Note |",
        "|---|---|---|---|---|---|",
      );
      for (const i of e.items) {
        out.push(
          `| ${SEVERITY_LABEL[i.severity]} | ${kindLabel(i.kind)} | ${code(raw(i.path))} | ${
            i.expected !== undefined ? code(raw(safeValue(i.path, i.expected))) : ""
          } | ${i.actual !== undefined ? code(raw(safeValue(i.path, i.actual))) : ""} | ${cell(safeText(i.message))} |`,
        );
      }
      out.push("");
    }
  }
  return out.join("\n");
}
