"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EnvBadge, MethodBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Label } from "@/components/ui/label";
import type { DiffRow } from "@/db/diffs";
import { cn } from "@/lib/utils";
import { DiffList } from "./diff-list";

type Filter = "all" | "error" | "warn" | "info";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "warn", label: "Warnings" },
  { id: "info", label: "Info" },
];

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** Spec vs reality, grouped by module and endpoint, with a severity filter. */
export function DiffView({
  projectId,
  rows,
  environments,
}: {
  projectId: string;
  rows: DiffRow[];
  environments: { id: string; name: string; isProd: boolean }[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [envId, setEnvId] = useState("");

  const scoped = useMemo(
    () => rows.filter((r) => !envId || r.environmentId === envId),
    [rows, envId],
  );
  const counts = useMemo(() => {
    const c = { error: 0, warn: 0, info: 0 };
    for (const r of scoped) for (const i of r.items) c[i.severity]++;
    return c;
  }, [scoped]);

  const visible = useMemo(
    () =>
      scoped
        .map((r) => ({
          ...r,
          items: filter === "all" ? r.items : r.items.filter((i) => i.severity === filter),
        }))
        .filter((r) => r.items.length > 0),
    [scoped, filter],
  );
  const clean = scoped.filter((r) => r.items.length === 0).length;

  const byModule = useMemo(() => {
    const groups = new Map<string, typeof visible>();
    for (const r of visible) groups.set(r.moduleName, [...(groups.get(r.moduleName) ?? []), r]);
    return [...groups.entries()];
  }, [visible]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No comparisons yet"
        description="Run a module (or send an endpoint) and every response is compared with the spec. Mismatches appear here."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div
          className="flex gap-1 rounded-md bg-zinc-100 p-1 dark:bg-zinc-900"
          role="tablist"
          aria-label="Severity"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded px-3 py-1 text-sm",
                filter === f.id ? "bg-background font-medium shadow-sm" : "text-zinc-500",
              )}
            >
              {f.label}
              {f.id !== "all" ? (
                <span className="ml-1 tabular-nums text-zinc-500">{counts[f.id]}</span>
              ) : null}
            </button>
          ))}
        </div>
        {environments.length > 1 ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="diff-env" className="text-xs">
              Environment
            </Label>
            <select
              id="diff-env"
              value={envId}
              onChange={(e) => setEnvId(e.target.value)}
              className="h-8 rounded-md border border-zinc-300 bg-background px-2 text-xs dark:border-zinc-800"
            >
              <option value="">All</option>
              {environments.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.isProd ? " (prod)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className="ml-auto text-xs text-zinc-500" aria-live="polite">
          {counts.error} errors · {counts.warn} warnings · {counts.info} info · {clean} of{" "}
          {scoped.length} compared endpoints match
        </p>
      </div>

      {byModule.length === 0 ? (
        <EmptyState
          title={filter === "all" ? "No mismatches" : "Nothing at this severity"}
          description="Every compared response matches the spec."
        />
      ) : (
        byModule.map(([moduleName, list]) => (
          <section key={moduleName} aria-label={moduleName} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {moduleName} <span className="font-normal text-zinc-500">({list.length})</span>
            </h2>
            {list.map((r) => (
              <article
                key={r.endpointId}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                aria-label={`${r.method} ${r.path}`}
              >
                <header className="mb-1 flex flex-wrap items-center gap-2">
                  <MethodBadge method={r.method} />
                  <Link
                    href={`/projects/${projectId}/endpoints/${r.endpointId}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {r.path}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {r.environmentName} · {fmt.format(new Date(r.ranAt))}
                  </span>
                  <EnvBadge isProd={r.isProd} />
                  <Link
                    href={`/runs/${r.runId}?endpoint=${r.endpointId}`}
                    className="ml-auto text-xs text-primary hover:underline"
                  >
                    View response
                  </Link>
                </header>
                <DiffList items={r.items} />
              </article>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
