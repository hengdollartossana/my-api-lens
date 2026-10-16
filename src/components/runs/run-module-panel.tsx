"use client";

import { Loader2, Play } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnvironmentOption } from "@/db/environments";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [envId, setEnvId] = useState(
    environments.find((e) => !e.isProd)?.id ?? environments[0]?.id ?? "",
  );
  const [includeDestructive, setIncludeDestructive] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const env = environments.find((e) => e.id === envId);

  async function start(confirmed: boolean) {
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
      dialog.current?.close();
      setRunId(data.runId);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function onRun() {
    setError(null);
    setTypedName("");
    if (includeDestructive && destructiveCount > 0) dialog.current?.showModal();
    else void start(false);
  }

  if (environments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-800">
        Add an environment (base URL) to run this module. Environment settings arrive with T-13.
      </p>
    );
  }

  const needsName = !!env?.isProd;
  const nameOk = !needsName || typedName === env?.name;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="run-env">Environment</Label>
          <select
            id="run-env"
            value={envId}
            onChange={(e) => setEnvId(e.target.value)}
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
      {error && !dialog.current?.open ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <dialog
        ref={dialog}
        aria-labelledby="confirm-destructive-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            void start(true);
          }}
          className="flex flex-col gap-3 p-4"
        >
          <h2 id="confirm-destructive-title" className="text-base font-semibold">
            Run destructive endpoints?
          </h2>
          <p className="text-sm">
            This will call {destructiveCount} POST/PUT/PATCH/DELETE endpoint
            {destructiveCount === 1 ? "" : "s"} on <strong>{env?.name}</strong>. They can create,
            change or delete data.
          </p>
          {needsName ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-env-name">
                Type <code className="font-mono">{env?.name}</code> to confirm
              </Label>
              <Input
                id="confirm-env-name"
                autoComplete="off"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => dialog.current?.close()}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" size="sm" disabled={busy || !nameOk}>
              Run including destructive
            </Button>
          </div>
        </form>
      </dialog>

      {runId ? <RunView runId={runId} /> : null}
    </div>
  );
}
