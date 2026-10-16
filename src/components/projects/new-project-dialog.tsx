"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Source = "url" | "file";

/** "New project": import a spec from a URL or a file; parse errors show inline and nothing is created. */
export function NewProjectDialog() {
  const router = useRouter();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [source, setSource] = useState<Source>("url");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = () => {
    setError(null);
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let res: Response;
      if (source === "url") {
        res = await fetch("/api/projects/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, ...(name.trim() ? { name } : {}) }),
        });
      } else {
        if (!file) {
          setError("Choose a spec file first.");
          return;
        }
        const form = new FormData();
        form.set("file", file);
        if (name.trim()) form.set("name", name);
        res = await fetch("/api/projects/import", { method: "POST", body: form });
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      close();
      toast.success(`Imported ${data?.project?.name ?? "project"}`);
      setName("");
      setUrl("");
      setFile(null);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" onClick={open}>
        <Plus className="h-4 w-4" aria-hidden />
        New project
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="new-project-title"
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <h2 id="new-project-title" className="text-base font-semibold">
            New project
          </h2>

          <div className="flex gap-1 rounded-md bg-zinc-100 p-1 dark:bg-zinc-900" role="tablist">
            {(["url", "file"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={source === s}
                onClick={() => setSource(s)}
                className={cn(
                  "flex-1 rounded px-3 py-1 text-sm",
                  source === s ? "bg-background font-medium shadow-sm" : "text-zinc-500",
                )}
              >
                {s === "url" ? "From URL" : "Upload file"}
              </button>
            ))}
          </div>

          {source === "url" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="spec-url">Spec URL</Label>
              <Input
                id="spec-url"
                type="url"
                required
                placeholder="https://api.example.com/openapi.json"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="spec-file">Spec file (JSON or YAML, up to 10 MB)</Label>
              <Input
                id="spec-file"
                type="file"
                accept=".json,.yaml,.yml,application/json"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="project-name">Name (optional)</Label>
            <Input
              id="project-name"
              placeholder="Defaults to the spec title"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {error ? (
            <p
              role="alert"
              className="whitespace-pre-wrap break-words rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Import
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
