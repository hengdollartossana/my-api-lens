"use client";

import { Loader2, Plus, Send, X } from "lucide-react";
import { useState } from "react";
import { EnvBadge, StatusBadge } from "@/components/badges";
import { DiffList } from "@/components/diff/diff-list";
import { useEnvironmentSelection } from "@/components/environments/use-environment-selection";
import { JsonEditor } from "@/components/json-editor";
import { JsonViewer } from "@/components/json-viewer";
import { ConfirmDestructiveDialog } from "@/components/runs/confirm-destructive-dialog";
import { useRun } from "@/components/runs/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnvironmentOption } from "@/db/environments";
import { documentedSchema, type InitialInput } from "@/lib/endpoint-input";
import { SKIP_LABELS } from "@/lib/run-types";
import { cn } from "@/lib/utils";

type Tab = "request" | "response";

export interface SenderEndpoint {
  id: string;
  method: string;
  path: string;
  isDestructive: boolean;
  responseSchemas: Record<string, unknown> | null;
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, message: `Body is not valid JSON: ${(e as Error).message}` };
  }
}

function asJson(text: string | null): unknown {
  if (text === null || text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function ResponsePane({ runId, endpoint }: { runId: string; endpoint: SenderEndpoint }) {
  const { data, error } = useRun(runId);
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {(error as Error).message}
      </p>
    );
  }
  const result = data?.results[0];
  const running = !data || data.run.status === "running";
  if (running && !result) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-500" aria-live="polite">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Sending…
      </p>
    );
  }
  if (!result) return <p className="text-sm text-zinc-500">No result was recorded.</p>;

  if (result.skipReason) {
    return (
      <p className="text-sm">
        <StatusBadge status="skipped" /> {SKIP_LABELS[result.skipReason] ?? result.skipReason}
      </p>
    );
  }

  const doc = documentedSchema(endpoint.responseSchemas, result.statusCode);
  const body = asJson(result.responseBody);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge status={result.severity} />
        <span className="font-mono">{result.statusCode ?? "no response"}</span>
        <span className="text-zinc-500">
          {result.durationMs !== null ? `${result.durationMs} ms` : ""}
        </span>
        {running ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading details" />
        ) : null}
      </div>
      {result.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {result.error}
        </p>
      ) : null}
      {result.diff ? (
        <div>
          <h3 className="mb-1 text-xs font-medium">Differences from the spec</h3>
          <DiffList items={result.diff} />
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <h3 className="mb-1 text-xs font-medium">Response headers</h3>
            <JsonViewer value={result.responseHeaders ?? {}} maxHeight="12rem" />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium">Response body</h3>
            {body === null ? (
              <p className="text-xs text-zinc-500">{running ? "Loading…" : "Empty."}</p>
            ) : (
              <JsonViewer value={body} maxHeight="24rem" />
            )}
          </div>
        </div>
        <div className="min-w-0">
          <h3 className="mb-1 text-xs font-medium">
            Documented schema{result.statusCode ? ` (${result.statusCode})` : ""}
          </h3>
          {!doc.found ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Status {result.statusCode} is not documented in the spec.
            </p>
          ) : doc.schema === null ? (
            <p className="text-xs text-zinc-500">The spec documents this status without a body.</p>
          ) : (
            <JsonViewer value={doc.schema} maxHeight="24rem" />
          )}
        </div>
      </div>
    </div>
  );
}

/** Request and Response tabs for one endpoint; sending goes through POST /api/runs. */
export function EndpointSender({
  projectId,
  endpoint,
  environments,
  initial,
}: {
  projectId: string;
  endpoint: SenderEndpoint;
  environments: EnvironmentOption[];
  initial: InitialInput;
}) {
  const [tab, setTab] = useState<Tab>("request");
  const [env, selectEnv] = useEnvironmentSelection(projectId, environments);
  const [pathParams, setPathParams] = useState(initial.pathParams);
  const [query, setQuery] = useState(initial.query);
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([]);
  const [body, setBody] = useState(initial.body);
  const [runId, setRunId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function post(confirmed: boolean, typedName = "") {
    if (!env) return;
    const parsed = parseBody(body);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          environmentId: env.id,
          endpointIds: [endpoint.id],
          ...(confirmed ? { confirmDestructive: true, confirmEnvName: typedName } : {}),
          input: {
            pathParams,
            query: Object.fromEntries(
              query.filter((q) => q.value !== "").map((q) => [q.name, q.value]),
            ),
            headers: Object.fromEntries(
              headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value]),
            ),
            ...(parsed.value !== undefined ? { body: parsed.value } : {}),
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Could not send (HTTP ${res.status})`);
        return;
      }
      setConfirmOpen(false);
      setRunId(data.runId);
      setTab("response");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSending(false);
    }
  }

  function onSend() {
    setError(null);
    if (!parseBody(body).ok) return setError((parseBody(body) as { message: string }).message);
    if (endpoint.isDestructive) setConfirmOpen(true);
    else void post(false);
  }

  if (environments.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-3 text-sm text-zinc-500 dark:border-zinc-800">
        Add an environment (base URL) to send requests. Environment settings arrive with T-13.
      </p>
    );
  }

  const pathNames = Object.keys(pathParams);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="send-env">Environment</Label>
          <select
            id="send-env"
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
        <Button onClick={onSend} disabled={sending}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Send className="h-4 w-4" aria-hidden />
          )}
          Send
        </Button>
        {env?.isProd ? (
          <span className="pb-2 text-xs font-medium text-red-600 dark:text-red-400">
            Production environment
          </span>
        ) : null}
      </div>
      {error && !confirmOpen ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {(["request", "response"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 border-transparent px-3 py-2 text-sm capitalize text-zinc-500 hover:text-foreground",
              tab === t && "border-primary text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "request" ? (
        <div className="flex flex-col gap-5">
          {pathNames.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium">Path parameters</legend>
              {pathNames.map((name) => (
                <div key={name} className="grid grid-cols-[10rem_1fr] items-center gap-2">
                  <Label htmlFor={`path-${name}`} className="font-mono text-xs">
                    {name}
                  </Label>
                  <Input
                    id={`path-${name}`}
                    value={pathParams[name] ?? ""}
                    onChange={(e) => setPathParams({ ...pathParams, [name]: e.target.value })}
                  />
                </div>
              ))}
            </fieldset>
          ) : null}

          {query.length > 0 ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-xs font-medium">Query parameters</legend>
              {query.map((q, i) => (
                <div key={q.name} className="grid grid-cols-[10rem_1fr] items-center gap-2">
                  <Label htmlFor={`query-${q.name}`} className="font-mono text-xs">
                    {q.name}
                    {q.required ? " *" : ""}
                  </Label>
                  <Input
                    id={`query-${q.name}`}
                    placeholder={q.required ? "required" : "optional"}
                    value={q.value}
                    onChange={(e) =>
                      setQuery(query.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : null}

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium">Headers</legend>
            <p className="text-xs text-zinc-500">
              Auth and the environment's default headers are added automatically. Extra headers you
              add win over defaults.
            </p>
            {headers.map((h, i) => (
              <div key={i} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2">
                <Input
                  aria-label={`Header name ${i + 1}`}
                  placeholder="Name"
                  value={h.key}
                  onChange={(e) =>
                    setHeaders(headers.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))
                  }
                />
                <Input
                  aria-label={`Header value ${i + 1}`}
                  placeholder="Value"
                  value={h.value}
                  onChange={(e) =>
                    setHeaders(
                      headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove header ${i + 1}`}
                  onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setHeaders([...headers, { key: "", value: "" }])}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add header
              </Button>
            </div>
          </fieldset>

          {initial.hasBody ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium">Body (JSON)</h3>
              <JsonEditor label="Request body" value={body} onChange={setBody} />
            </div>
          ) : null}
        </div>
      ) : runId ? (
        <ResponsePane runId={runId} endpoint={endpoint} />
      ) : (
        <p className="text-sm text-zinc-500">Send the request to see the response.</p>
      )}

      <ConfirmDestructiveDialog
        open={confirmOpen}
        env={env}
        count={1}
        busy={sending}
        error={error}
        onConfirm={(typed) => void post(true, typed)}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
