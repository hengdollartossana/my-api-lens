"use client";

import { Loader2, MoveRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { MethodBadge, ViaBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModuleEndpoint } from "@/db/modules";

const NEW = "__new__";

/** Endpoints of a module with a method filter, path search and "Move to module…". */
export function ModuleEndpoints({
  projectId,
  moduleId,
  endpoints,
  modules,
}: {
  projectId: string;
  moduleId: string;
  endpoints: ModuleEndpoint[];
  modules: { id: string; name: string }[];
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [moving, setMoving] = useState<ModuleEndpoint | null>(null);
  const [target, setTarget] = useState("");
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = useMemo(() => [...new Set(endpoints.map((e) => e.method))].sort(), [endpoints]);
  const shown = useMemo(
    () =>
      endpoints.filter(
        (e) =>
          (!method || e.method === method) &&
          e.path.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    [endpoints, method, search],
  );
  const others = modules.filter((m) => m.id !== moduleId);

  function openMove(e: ModuleEndpoint) {
    setMoving(e);
    setTarget(others[0]?.id ?? NEW);
    setNewName("");
    setError(null);
    dialog.current?.showModal();
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!moving) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/endpoints/${moving.id}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(target === NEW ? { newModuleName: newName } : { moduleId: target }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Could not move (HTTP ${res.status})`);
        return;
      }
      dialog.current?.close();
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Endpoints" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-sm font-medium">
          Endpoints{" "}
          <span className="font-normal text-zinc-500">
            (
            {shown.length === endpoints.length
              ? endpoints.length
              : `${shown.length} of ${endpoints.length}`}
            )
          </span>
        </h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-method" className="text-xs">
            Method
          </Label>
          <select
            id="filter-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="h-8 rounded-md border border-zinc-300 bg-background px-2 text-xs dark:border-zinc-800"
          >
            <option value="">All</option>
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="filter-path" className="text-xs">
            Search path
          </Label>
          <Input
            id="filter-path"
            type="search"
            placeholder="/users"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44 text-xs"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={endpoints.length === 0 ? "No endpoints in this module" : "No endpoints match"}
          description={
            endpoints.length === 0
              ? "Move endpoints here from another module."
              : "Change the method or the search text."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <tbody>
              {shown.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-zinc-200 last:border-0 dark:border-zinc-800"
                >
                  <td className="w-20 p-2">
                    <MethodBadge method={e.method} />
                  </td>
                  <td className="p-2 font-mono text-xs">
                    <Link
                      href={`/projects/${projectId}/endpoints/${e.id}`}
                      className="hover:underline"
                    >
                      {e.path}
                    </Link>
                  </td>
                  <td className="p-2 text-xs text-zinc-500">{e.summary}</td>
                  <td className="p-2 text-right text-xs">
                    {e.moved ? <ViaBadge via="manual" className="mr-2" /> : null}
                    {e.isDestructive ? <span className="text-zinc-500">destructive</span> : null}
                  </td>
                  <td className="w-10 p-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${e.method} ${e.path}`}
                      onClick={() => openMove(e)}
                    >
                      <MoveRight className="h-4 w-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby="move-title"
        className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <div>
            <h2 id="move-title" className="text-base font-semibold">
              Move endpoint
            </h2>
            {moving ? (
              <p className="font-mono text-xs text-zinc-500">
                {moving.method} {moving.path}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-target">Module</Label>
            <select
              id="move-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="h-9 rounded-md border border-zinc-300 bg-background px-2 text-sm dark:border-zinc-800"
            >
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value={NEW}>New module…</option>
            </select>
          </div>
          {target === NEW ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-new-name">New module name</Label>
              <Input
                id="move-new-name"
                required
                maxLength={80}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
          ) : null}
          <p className="text-xs text-zinc-500">
            The move is remembered and kept when the spec is re-imported.
          </p>
          {error ? (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
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
              Move
            </Button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
