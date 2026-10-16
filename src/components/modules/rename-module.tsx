"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RenameModule({
  projectId,
  moduleId,
  name,
}: {
  projectId: string;
  moduleId: string;
  name: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? `Could not rename (HTTP ${res.status})`);
        return;
      }
      dialog.current?.close();
      toast.success("Module renamed");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setValue(name);
          setError(null);
          dialog.current?.showModal();
        }}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden /> Rename
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="rename-title"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <h2 id="rename-title" className="text-base font-semibold">
            Rename module
          </h2>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              required
              maxLength={80}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
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
              Save
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
