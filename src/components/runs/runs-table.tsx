"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatusBadge } from "@/components/badges";
import type { RunListItem } from "@/lib/run-types";

const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function duration(r: RunListItem): string {
  if (!r.finishedAt) return "…";
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Run history; refreshes by itself while any run is still going. */
export function RunsTable({ projectId, empty }: { projectId?: string; empty: React.ReactNode }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ["runs", projectId ?? "all"],
    queryFn: async (): Promise<RunListItem[]> => {
      const res = await fetch(`/api/runs${projectId ? `?projectId=${projectId}` : ""}`);
      if (!res.ok) throw new Error(`Could not load runs (HTTP ${res.status})`);
      return (await res.json()).runs;
    },
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 2_000 : false),
  });

  if (isLoading) return <p className="text-sm text-zinc-500">Loading runs…</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {(error as Error).message}
      </p>
    );
  }
  if (!data?.length) return <>{empty}</>;

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
          <tr>
            <th className="p-2 font-medium">Started</th>
            <th className="p-2 font-medium">Project / module</th>
            <th className="p-2 font-medium">Environment</th>
            <th className="p-2 font-medium">Status</th>
            <th className="p-2 text-right font-medium">Endpoints</th>
            <th className="p-2 text-right font-medium">Errors</th>
            <th className="p-2 text-right font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.id} className="border-b border-zinc-200 last:border-0 dark:border-zinc-800">
              <td className="p-2 text-xs">
                <Link href={`/runs/${r.id}`} className="hover:underline">
                  {fmt.format(new Date(r.startedAt))}
                </Link>
              </td>
              <td className="p-2">
                <div className="font-medium">{r.moduleName ?? "All endpoints"}</div>
                <div className="text-xs text-zinc-500">{r.projectName}</div>
              </td>
              <td className="p-2 text-xs">
                {r.environmentName}
                {r.isProd ? (
                  <span className="ml-1 font-semibold uppercase text-red-600 dark:text-red-400">
                    prod
                  </span>
                ) : null}
              </td>
              <td className="p-2">
                <StatusBadge status={r.status} />
              </td>
              <td className="p-2 text-right tabular-nums">{r.resultCount}</td>
              <td className="p-2 text-right tabular-nums">{r.errorCount}</td>
              <td className="p-2 text-right text-xs tabular-nums">{duration(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
