"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { MethodBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChangeSummary } from "@/db/projects";

type Mode = "url" | "file";

const method = (key: string) => key.split(" ")[0] ?? "";
const path = (key: string) => key.split(" ").slice(1).join(" ");

function Group({ title, items }: { title: string; items: { key: string; note?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <details
      open={items.length <= 8}
      className="rounded-md border border-zinc-200 dark:border-zinc-800"
    >
      <summary className="cursor-pointer p-2 text-sm font-medium">
        {title} <span className="text-zinc-500">({items.length})</span>
      </summary>
      <ul className="flex flex-col gap-1 border-t border-zinc-200 p-2 dark:border-zinc-800">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-2 text-xs">
            <MethodBadge method={method(i.key)} />
            <span className="font-mono">{path(i.key)}</span>
            {i.note ? <span className="text-zinc-500">{i.note}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Re-import the spec (fetch the URL again, or upload a new file) and show what changed. */
export function ReimportDialog({
  projectId,
  specSource,
  specUrl,
}: {
  projectId: string;
  specSource: "url" | "file";
  specUrl: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>(specSource === "url" && specUrl ? "url" : "file");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<ChangeSummary | null>(null);

  const canFetch = specSource === "url" && !!specUrl;

  function open() {
    setError(null);
    setChanges(null);
    dialog.current?.showModal();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "url") {
        res = await fetch(`/api/projects/${projectId}/reimport`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      } else {
        if (!file) {
          setError("Choose a spec file first.");
          return;
        }
        const form = new FormData();
        form.set("file", file);
        res = await fetch(`/api/projects/${projectId}/reimport`, { method: "POST", body: form });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Re-import failed (HTTP ${res.status})`);
        return;
      }
      setChanges(data.changes);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const total = changes
    ? changes.added.length + changes.removed.length + changes.changed.length + changes.moved.length
    : 0;

  return (
    <>
      <Button variant="outline" size="sm" onClick={open}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Re-import
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="reimport-title"
        className="m-auto max-h-[85vh] w-[min(36rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        {changes ? (
          <div className="flex flex-col gap-3 p-4">
            <h2 id="reimport-title" className="text-base font-semibold">
              {changes.identical ? "No changes" : "Re-import finished"}
            </h2>
            {changes.identical ? (
              <p className="text-sm text-zinc-500">
                The spec is identical to the stored one. Nothing was changed.
              </p>
            ) : (
              <>
                <p className="text-sm" aria-live="polite">
                  {changes.added.length} new · {changes.removed.length} removed ·{" "}
                  {changes.changed.length} changed · {changes.moved.length} moved ·{" "}
                  {changes.unchangedCount} unchanged
                  {total === 0 ? " (only descriptions changed)" : ""}
                </p>
                {changes.needsReview.length ? (
                  <p
                    role="status"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-300"
                  >
                    Needs review again: <strong>{changes.needsReview.join(", ")}</strong>. They were
                    approved and something in them changed.
                  </p>
                ) : null}
                <Group
                  title="New"
                  items={changes.added.map((a) => ({ key: a.stableKey, note: a.module }))}
                />
                <Group
                  title="Removed"
                  items={changes.removed.map((r) => ({
                    key: r.stableKey,
                    note: r.module ?? undefined,
                  }))}
                />
                <Group
                  title="Changed"
                  items={changes.changed.map((c) => ({
                    key: c.stableKey,
                    note: c.parts.join(", "),
                  }))}
                />
                <Group
                  title="Moved"
                  items={changes.moved.map((m) => ({
                    key: m.stableKey,
                    note: `${m.from ?? "none"} → ${m.to}`,
                  }))}
                />
              </>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => dialog.current?.close()}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4 p-4">
            <h2 id="reimport-title" className="text-base font-semibold">
              Re-import spec
            </h2>
            <p className="text-sm text-zinc-500">
              Compares by endpoint. Your manual module moves and renames are kept; approved modules
              that change go back to needs review.
            </p>
            {canFetch ? (
              <div className="flex flex-col gap-2 text-sm" role="radiogroup" aria-label="Source">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "url"}
                    onChange={() => setMode("url")}
                  />
                  <span>
                    Fetch again from <span className="break-all font-mono text-xs">{specUrl}</span>
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "file"}
                    onChange={() => setMode("file")}
                  />
                  Upload a file
                </label>
              </div>
            ) : null}
            {mode === "file" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reimport-file">Spec file (JSON or YAML, up to 10 MB)</Label>
                <Input
                  id="reimport-file"
                  type="file"
                  accept=".json,.yaml,.yml,application/json"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="whitespace-pre-wrap break-words rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
              >
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => dialog.current?.close()}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Re-import
              </Button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}
