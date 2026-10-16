"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Confirmation before calling POST/PUT/PATCH/DELETE endpoints. On a production environment the
 * environment name must be typed exactly.
 */
export function ConfirmDestructiveDialog({
  open,
  env,
  count,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  env: { name: string; isProd: boolean } | undefined;
  count: number;
  busy: boolean;
  error: string | null;
  onConfirm: (typedName: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTyped("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const needsName = !!env?.isProd;
  const ok = !needsName || typed === env?.name;

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      aria-labelledby="confirm-destructive-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onConfirm(typed);
        }}
        className="flex flex-col gap-3 p-4"
      >
        <h2 id="confirm-destructive-title" className="text-base font-semibold">
          Send a destructive request?
        </h2>
        <p className="text-sm">
          This will call {count} POST/PUT/PATCH/DELETE endpoint{count === 1 ? "" : "s"} on{" "}
          <strong>{env?.name}</strong>. {count === 1 ? "It" : "They"} can create, change or delete
          data.
        </p>
        {needsName ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-env-name">
              Type <code className="font-mono">{env?.name}</code> to confirm
            </Label>
            <Input
              id="confirm-env-name"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" size="sm" disabled={busy || !ok}>
            Send anyway
          </Button>
        </div>
      </form>
    </dialog>
  );
}
