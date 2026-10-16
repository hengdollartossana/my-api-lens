"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { RunDetail, RunResultEvent, RunResultItem } from "@/lib/run-types";

export interface RunView extends RunDetail {
  progress?: { completed: number; total: number };
}

async function fetchRun(id: string): Promise<RunView> {
  const res = await fetch(`/api/runs/${id}`);
  if (!res.ok)
    throw new Error(
      res.status === 404 ? "Run not found" : `Could not load the run (HTTP ${res.status})`,
    );
  return res.json();
}

/** Result as pushed over SSE, widened to a table row (details arrive when the run finishes). */
function fromEvent(e: RunResultEvent, previous?: RunResultItem): RunResultItem {
  const [method = "", ...rest] = e.stableKey.split(" ");
  return {
    id: previous?.id ?? e.endpointId,
    endpointId: e.endpointId,
    stableKey: e.stableKey,
    method,
    path: previous?.path ?? rest.join(" "),
    statusCode: e.statusCode,
    durationMs: e.durationMs,
    severity: e.severity,
    skipReason: e.skipReason,
    error: e.error,
    request: previous?.request ?? null,
    responseHeaders: previous?.responseHeaders ?? null,
    responseBody: previous?.responseBody ?? null,
    diff: previous?.diff ?? null,
  };
}

/**
 * A run's state: loaded once, then kept live from the SSE stream while it is running.
 * The stream replays earlier events on connect, so updates are idempotent.
 */
export function useRun(runId: string) {
  const qc = useQueryClient();
  const key = ["run", runId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchRun(runId),
    refetchOnWindowFocus: false,
  });
  const running = query.data?.run.status === "running";

  useEffect(() => {
    if (!running) return;
    const source = new EventSource(`/api/runs/${runId}/stream`);
    const update = (fn: (prev: RunView) => RunView) =>
      qc.setQueryData<RunView>(key, (prev) => (prev ? fn(prev) : prev));

    source.addEventListener("result", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as RunResultEvent;
      update((prev) => {
        const i = prev.results.findIndex((r) => r.endpointId === data.endpointId);
        const results = [...prev.results];
        if (i >= 0) results[i] = fromEvent(data, results[i]);
        else results.push(fromEvent(data));
        return { ...prev, results };
      });
    });
    source.addEventListener("progress", (ev) => {
      const progress = JSON.parse((ev as MessageEvent).data);
      update((prev) => ({ ...prev, progress }));
    });
    source.addEventListener("done", () => {
      source.close();
      // Reload for the full stored results (headers, bodies) and the final status.
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["runs"] });
    });
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, running]);

  return query;
}
