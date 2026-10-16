"use client";

import { Ban, Loader2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { EnvBadge, MethodBadge, StatusBadge } from "@/components/badges";
import { DiffList } from "@/components/diff/diff-list";
import { JsonViewer } from "@/components/json-viewer";
import { Button } from "@/components/ui/button";
import { type RunResultItem, SKIP_LABELS } from "@/lib/run-types";
import type { StatusKey } from "@/lib/ui-tokens";
import { useRun } from "./use-run";

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "medium" });

/** Parse a stored body as JSON for pretty display; fall back to the raw text. */
function bodyValue(text: string | null): unknown {
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function rowStatus(r: RunResultItem): StatusKey {
  return r.skipReason ? "skipped" : r.severity;
}

function ResultDetails({ r, finished }: { r: RunResultItem; finished: boolean }) {
  if (r.skipReason) {
    return (
      <p className="text-xs">
        {SKIP_LABELS[r.skipReason] ?? r.skipReason}. Run again with destructive endpoints confirmed
        to call it.
      </p>
    );
  }
  if (!finished && r.request === null) {
    return (
      <p className="text-xs text-zinc-500">
        Request and response details appear when the run finishes.
      </p>
    );
  }
  const body = bodyValue(r.responseBody);
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {r.error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400 lg:col-span-2">
          {r.error}
        </p>
      ) : null}
      {r.diff && r.diff.length > 0 ? (
        <div className="lg:col-span-2">
          <h4 className="mb-1 text-xs font-medium">Differences from the spec</h4>
          <DiffList items={r.diff} />
        </div>
      ) : null}
      <div>
        <h4 className="mb-1 text-xs font-medium">Request (redacted)</h4>
        <JsonViewer value={r.request ?? {}} maxHeight="14rem" />
      </div>
      <div>
        <h4 className="mb-1 text-xs font-medium">Response headers</h4>
        <JsonViewer value={r.responseHeaders ?? {}} maxHeight="14rem" />
      </div>
      <div className="lg:col-span-2">
        <h4 className="mb-1 text-xs font-medium">Response body</h4>
        {body === null ? (
          <p className="text-xs text-zinc-500">Empty.</p>
        ) : (
          <JsonViewer value={body} maxHeight="20rem" />
        )}
      </div>
    </div>
  );
}

/** Live view of one run: progress, cancel, and a row per endpoint with its status and severity. */
export function RunView({ runId, initialOpen }: { runId: string; initialOpen?: string }) {
  const { data, error, isLoading } = useRun(runId);
  const [open, setOpen] = useState<Set<string>>(new Set(initialOpen ? [initialOpen] : []));
  const [cancelling, setCancelling] = useState(false);

  if (isLoading) return <p className="text-sm text-zinc-500">Loading run…</p>;
  if (error || !data) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {(error as Error | null)?.message ?? "Run not found"}
      </p>
    );
  }

  const { run, results, progress } = data;
  const running = run.status === "running";
  const completed = progress?.completed ?? results.length;
  const total = progress?.total ?? Math.max(results.length, 1);
  const pct = running ? Math.round((completed / total) * 100) : 100;
  const count = (sev: string) => results.filter((r) => !r.skipReason && r.severity === sev).length;
  const skipped = results.filter((r) => r.skipReason).length;

  async function cancel() {
    setCancelling(true);
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <section aria-label="Run" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-sm font-medium">{run.moduleName ?? "All endpoints"}</span>
        <span className="text-xs text-zinc-500">
          {run.projectName} · {run.environmentName}
        </span>
        <EnvBadge isProd={run.isProd} />
        <span className="text-xs text-zinc-500">{fmt.format(new Date(run.startedAt))}</span>
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/runs/${run.id}`} className="text-xs text-primary hover:underline">
            Open
          </Link>
          {running ? (
            <Button variant="outline" size="sm" onClick={cancel} disabled={cancelling}>
              {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Ban className="h-3.5 w-3.5" aria-hidden />
              )}
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-zinc-500" aria-live="polite">
          {running ? `${completed} of ${total} endpoints` : `${results.length} endpoints`} ·{" "}
          {count("ok")} ok · {count("warn")} warnings · {count("error")} errors · {skipped} skipped
        </p>
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-zinc-500">
          {running ? "Waiting for the first result…" : "No results."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="w-20 p-2 font-medium">Method</th>
                <th className="p-2 font-medium">Path</th>
                <th className="p-2 text-right font-medium">HTTP</th>
                <th className="p-2 text-right font-medium">Time</th>
                <th className="p-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <Fragment key={r.endpointId}>
                  <tr
                    className="cursor-pointer border-b border-zinc-200 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900/50"
                    onClick={() => toggle(r.endpointId)}
                    aria-expanded={open.has(r.endpointId)}
                  >
                    <td className="p-2">
                      <MethodBadge method={r.method} />
                    </td>
                    <td className="p-2 font-mono text-xs">
                      {r.path || r.stableKey}
                      {r.diff && r.diff.length > 0 ? (
                        <span className="ml-2 rounded bg-zinc-500/10 px-1.5 py-0.5 font-sans text-[11px] text-zinc-600 dark:text-zinc-300">
                          {r.diff.length} diff{r.diff.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-2 text-right tabular-nums">{r.statusCode ?? "—"}</td>
                    <td className="p-2 text-right tabular-nums">
                      {r.durationMs !== null ? `${r.durationMs} ms` : "—"}
                    </td>
                    <td className="p-2 text-right">
                      <StatusBadge status={rowStatus(r)} />
                    </td>
                  </tr>
                  {open.has(r.endpointId) ? (
                    <tr className="border-b border-zinc-200 bg-zinc-50/50 last:border-0 dark:border-zinc-800 dark:bg-zinc-900/30">
                      <td colSpan={5} className="p-3">
                        <ResultDetails r={r} finished={!running} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
