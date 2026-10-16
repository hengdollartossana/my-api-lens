"use client";

import { Loader2, Play } from "lucide-react";
import { useState } from "react";
import { EnvBadge } from "@/components/badges";
import { useEnvironmentSelection } from "@/components/environments/use-environment-selection";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { EnvironmentOption } from "@/db/environments";
import { ConfirmDestructiveDialog } from "./confirm-destructive-dialog";
import { RunView } from "./run-view";

/**
 * "Run module": pick an environment and start a run. Read-only endpoints run by default;
 * destructive ones need the checkbox plus a confirmation (and the typed env name on prod).
 */
export function RunModulePanel({
  projectId,
  moduleId,
  environments,
  destructiveCount,
  endpointCount,
}: {
  projectId: string;
  moduleId: string;
  environments: EnvironmentOption[];
  destructiveCount: number;
  endpointCount: number;
}) {
  const [env, selectEnv] = useEnvironmentSelection(projectId, environments);
  const [includeDestructive, setIncludeDestructive] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(confirmed: boolean, typedName = "") {
    if (!env) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          environmentId: env.id,
          moduleId,
          ...(confirmed ? { confirmDestructive: true, confirmEnvName: typedName } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Could not start the run (HTTP ${res.status})`);
        return;
      }
      setConfirmOpen(false);
      setRunId(data.runId);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function onRun() {
    setError(null);
    if (includeDestructive && destructiveCount > 0) setConfirmOpen(true);
    else void start(false);
  }

  if (environments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-800">
        Add an environment (base URL) to run this module. Environment settings arrive with T-13.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="run-env">Environment</Label>
          <select
            id="run-env"
            value={env?.id ?? ""}
            onChange={(e) => selectEnv(e.target.value)}
            className="h-9 rounded-md border border-zinc-300 bg-background px-2 text-sm dark:border-zinc-800"
          >
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.isProd ? " (prod)" : ""}
              </option>
            ))}
          </select>
        </div>
        {destructiveCount > 0 ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeDestructive}
              onChange={(e) => setIncludeDestructive(e.target.checked)}
            />
            Include {destructiveCount} destructive endpoint{destructiveCount === 1 ? "" : "s"}
          </label>
        ) : null}
        <Button onClick={onRun} disabled={busy || endpointCount === 0}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          Run module
        </Button>
      </div>
      {env?.isProd ? (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          Production environment: be careful.
        </p>
      ) : null}
      {error && !confirmOpen ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <ConfirmDestructiveDialog
        open={confirmOpen}
        env={env}
        count={destructiveCount}
        busy={busy}
        error={error}
        onConfirm={(typed) => void start(true, typed)}
        onCancel={() => setConfirmOpen(false)}
      />

      {runId ? <RunView runId={runId} /> : null}
    </div>
  );
}
