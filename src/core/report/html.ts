import { groupByModule, kindLabel } from "./markdown";
import { safeText, safeValue } from "./redact";
import type { ReportInput, ReportSummary } from "./types";

/** Escape text for HTML. Everything user-controlled goes through this. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root{--bg:#fff;--fg:#171717;--muted:#6b7280;--line:#e5e7eb;--error:#dc2626;--warn:#d97706;--info:#0284c7;--ok:#16a34a}
@media (prefers-color-scheme:dark){:root{--bg:#0a0a0a;--fg:#ededed;--muted:#9ca3af;--line:#27272a;--error:#f87171;--warn:#fbbf24;--info:#38bdf8;--ok:#22c55e}}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:960px;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px}h3{font-size:14px;margin:16px 0 4px}
.muted{color:var(--muted);font-size:12px}
.summary{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.card{border:1px solid var(--line);border-radius:8px;padding:8px 14px;min-width:110px}
.card b{display:block;font-size:20px}
table{width:100%;border-collapse:collapse;font-size:13px;margin:4px 0 8px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
th{color:var(--muted);font-weight:500}
code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.sev{font-weight:600}.error{color:var(--error)}.warn{color:var(--warn)}.info{color:var(--info)}
.prod{color:var(--error);font-weight:700}
.wrap{overflow-x:auto}
`;

const SEVERITY_LABEL = { error: "Error", warn: "Warning", info: "Info" } as const;

/** One self-contained HTML page: inline CSS, no scripts, no external requests. */
export function toHtml(input: ReportInput, summary: ReportSummary): string {
  const withDiffs = input.endpoints.filter((e) => e.items.length > 0);
  const body: string[] = [
    `<h1>API diff report: ${esc(input.project)}</h1>`,
    `<p class="muted">Generated ${esc(input.generatedAt)}. Spec vs reality, from each endpoint's latest run.</p>`,
    `<div class="summary">`,
    `<div class="card"><b class="error">${summary.errors}</b>Errors</div>`,
    `<div class="card"><b class="warn">${summary.warnings}</b>Warnings</div>`,
    `<div class="card"><b class="info">${summary.info}</b>Info</div>`,
    `<div class="card"><b>${summary.endpointsCompared}</b>Endpoints compared</div>`,
    `<div class="card"><b>${summary.endpointsMatching}</b>Matching the spec</div>`,
    `</div>`,
  ];

  if (withDiffs.length === 0) {
    body.push("<p>No mismatches: every compared response matches the spec.</p>");
  }
  for (const [module, list] of groupByModule(withDiffs)) {
    body.push(`<h2>${esc(module)}</h2>`);
    for (const e of list) {
      body.push(
        `<h3>${esc(e.method)} <code>${esc(e.path)}</code></h3>`,
        `<p class="muted">Environment: ${esc(e.environment)}${e.isProd ? ' <span class="prod">PROD</span>' : ""} · run ${esc(e.ranAt)}${
          e.statusCode !== null ? ` · HTTP ${e.statusCode}` : ""
        }</p>`,
        `<div class="wrap"><table><thead><tr><th>Severity</th><th>Kind</th><th>Path</th><th>Expected</th><th>Actual</th><th>Note</th></tr></thead><tbody>`,
      );
      for (const i of e.items) {
        body.push(
          `<tr><td class="sev ${i.severity}">${SEVERITY_LABEL[i.severity]}</td><td>${esc(kindLabel(i.kind))}</td><td><code>${esc(i.path)}</code></td><td>${
            i.expected !== undefined ? `<code>${esc(safeValue(i.path, i.expected))}</code>` : ""
          }</td><td>${i.actual !== undefined ? `<code>${esc(safeValue(i.path, i.actual))}</code>` : ""}</td><td>${esc(safeText(i.message))}</td></tr>`,
        );
      }
      body.push("</tbody></table></div>");
    }
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`API diff report: ${input.project}`)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body.join("\n")}
</main>
</body>
</html>
`;
}
