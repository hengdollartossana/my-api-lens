"use client";

import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { ModuleSummary } from "@/db/modules";

interface PackResponse {
  markdown: string;
  tokens: number;
  unapproved: string[];
}

/** Pick modules, preview the pack, then copy it or download it as `.md` (both use the same text). */
export function PackBuilder({
  projectId,
  modules,
}: {
  projectId: string;
  modules: ModuleSummary[];
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(modules.filter((m) => m.status === "approved").map((m) => m.id)),
  );
  const [allowUnapproved, setAllowUnapproved] = useState(false);
  const [preferObserved, setPreferObserved] = useState(false);
  const [pack, setPack] = useState<PackResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const ids = useMemo(() => [...selected].sort(), [selected]);

  useEffect(() => {
    if (ids.length === 0) {
      setPack(null);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/projects/${projectId}/pack`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleIds: ids, preferObserved }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Could not build the pack");
        setPack(data as PackResponse);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      });
    return () => ctrl.abort();
  }, [projectId, ids, preferObserved]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setUnapprovedAllowed = (on: boolean) => {
    setAllowUnapproved(on);
    if (!on) {
      setSelected(
        (prev) =>
          new Set(
            [...prev].filter((id) => modules.find((m) => m.id === id)?.status === "approved"),
          ),
      );
    }
  };

  const copy = async () => {
    if (!pack) return;
    await navigator.clipboard.writeText(pack.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    if (!pack) return;
    const url = URL.createObjectURL(new Blob([pack.markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "api-context.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (modules.length === 0) {
    return (
      <EmptyState title="No modules" description="Import a spec first; its modules appear here." />
    );
  }

  const hasUnapproved = modules.some((m) => m.status !== "approved");
  const unapprovedPicked = pack?.unapproved ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {modules.map((m) => {
            const approved = m.status === "approved";
            const locked = !approved && !allowUnapproved;
            return (
              <li key={m.id}>
                <label
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${locked ? "opacity-50" : "cursor-pointer"}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    disabled={locked}
                    onChange={() => toggle(m.id)}
                  />
                  <span className="flex-1 truncate">{m.name}</span>
                  <span className="text-xs tabular-nums text-zinc-500">{m.endpointCount}</span>
                  <StatusBadge status={m.status} />
                </label>
              </li>
            );
          })}
        </ul>
        {hasUnapproved ? (
          <label className="flex items-start gap-2 text-xs text-zinc-500">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={allowUnapproved}
              onChange={(e) => setUnapprovedAllowed(e.target.checked)}
            />
            Allow unapproved modules (their contract has not been verified)
          </label>
        ) : null}
        <label className="flex items-start gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={preferObserved}
            onChange={(e) => setPreferObserved(e.target.checked)}
          />
          Prefer observed responses over the spec
        </label>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {unapprovedPicked.length ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Not approved: {unapprovedPicked.join(", ")}. The pack may not match the real API.
            </span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={copy} disabled={!pack}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" variant="outline" onClick={download} disabled={!pack}>
            <Download className="size-4" />
            Download .md
          </Button>
          <p className="ml-auto text-xs tabular-nums text-zinc-500" aria-live="polite">
            {pack ? `~${pack.tokens.toLocaleString()} tokens` : "Select modules"}
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <pre className="max-h-[70vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950">
          {pack ? pack.markdown : "Pick at least one module to preview its context pack."}
        </pre>
      </div>
    </div>
  );
}
