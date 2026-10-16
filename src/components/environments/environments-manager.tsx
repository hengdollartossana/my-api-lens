"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { EnvBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EnvironmentRecord } from "@/db/environments";

interface FormState {
  id: string | null;
  name: string;
  baseUrl: string;
  isProd: boolean;
  headers: { key: string; value: string }[];
}

const blank = (baseUrl = ""): FormState => ({
  id: null,
  name: "",
  baseUrl,
  isProd: false,
  headers: [],
});

function fromRecord(e: EnvironmentRecord): FormState {
  return {
    id: e.id,
    name: e.name,
    baseUrl: e.baseUrl,
    isProd: e.isProd,
    headers: Object.entries(e.defaultHeaders).map(([key, value]) => ({ key, value })),
  };
}

/** Create, edit and delete a project's environments. New ones are prefilled from the spec's servers. */
export function EnvironmentsManager({
  projectId,
  environments,
  suggestions,
}: {
  projectId: string;
  environments: EnvironmentRecord[];
  suggestions: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<FormState>(blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const openForm = (state: FormState) => {
    setForm(state);
    setErrors({});
    setFormError(null);
    dialog.current?.showModal();
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["environments", projectId] });
    router.refresh();
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const res = await fetch(
        form.id
          ? `/api/projects/${projectId}/environments/${form.id}`
          : `/api/projects/${projectId}/environments`,
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: form.name,
            baseUrl: form.baseUrl,
            isProd: form.isProd,
            defaultHeaders: Object.fromEntries(
              form.headers.filter((h) => h.key.trim()).map((h) => [h.key.trim(), h.value]),
            ),
          }),
        },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErrors(data?.error?.fields ?? {});
        setFormError(data?.error?.message ?? `Could not save (HTTP ${res.status})`);
        return;
      }
      dialog.current?.close();
      toast.success("Environment saved");
      refresh();
    } catch {
      setFormError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(env: EnvironmentRecord) {
    if (!window.confirm(`Delete environment "${env.name}"? Runs made against it are deleted too.`))
      return;
    setListError(null);
    const res = await fetch(`/api/projects/${projectId}/environments/${env.id}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res || !res.ok) {
      setListError("Could not delete the environment.");
      return;
    }
    refresh();
  }

  const setHeader = (i: number, patch: Partial<{ key: string; value: string }>) =>
    setForm({ ...form, headers: form.headers.map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  return (
    <section aria-label="Environments" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">Environments</h2>
          <p className="text-xs text-zinc-500">
            A base URL per stage. Mark production so it is flagged everywhere and destructive calls
            need the typed name.
          </p>
        </div>
        <Button size="sm" onClick={() => openForm(blank(suggestions[0] ?? ""))}>
          <Plus className="h-4 w-4" aria-hidden /> New environment
        </Button>
      </div>
      {listError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {listError}
        </p>
      ) : null}

      {environments.length === 0 ? (
        <EmptyState
          title="No environments yet"
          description={
            suggestions.length
              ? `The spec lists ${suggestions[0]}. Create an environment to run requests.`
              : "Create an environment with the API's base URL to run requests."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="p-2 font-medium">Name</th>
                <th className="p-2 font-medium">Base URL</th>
                <th className="p-2 text-right font-medium">Headers</th>
                <th className="w-24 p-2" />
              </tr>
            </thead>
            <tbody>
              {environments.map((env) => (
                <tr
                  key={env.id}
                  className="border-b border-zinc-200 last:border-0 dark:border-zinc-800"
                >
                  <td className="p-2">
                    <span className="mr-2 font-medium">{env.name}</span>
                    <EnvBadge isProd={env.isProd} />
                  </td>
                  <td className="p-2 font-mono text-xs">{env.baseUrl}</td>
                  <td className="p-2 text-right tabular-nums">
                    {Object.keys(env.defaultHeaders).length}
                  </td>
                  <td className="p-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${env.name}`}
                      onClick={() => openForm(fromRecord(env))}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${env.name}`}
                      onClick={() => void remove(env)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
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
        aria-labelledby="env-form-title"
        className="m-auto w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-zinc-300 bg-background p-0 text-foreground backdrop:bg-black/50 dark:border-zinc-800"
      >
        <form onSubmit={submit} className="flex flex-col gap-4 p-4">
          <h2 id="env-form-title" className="text-base font-semibold">
            {form.id ? "Edit environment" : "New environment"}
          </h2>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-name">Name</Label>
            <Input
              id="env-name"
              required
              maxLength={60}
              placeholder="staging"
              value={form.name}
              aria-invalid={!!errors.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {errors.name ? (
              <p className="text-xs text-red-600 dark:text-red-400">{errors.name}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="env-url">Base URL</Label>
            <Input
              id="env-url"
              required
              inputMode="url"
              list="env-url-suggestions"
              placeholder="https://api.example.com"
              value={form.baseUrl}
              aria-invalid={!!errors.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
            <datalist id="env-url-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {errors.baseUrl ? (
              <p className="text-xs text-red-600 dark:text-red-400">{errors.baseUrl}</p>
            ) : null}
            {suggestions.length ? (
              <p className="text-xs text-zinc-500">From the spec: {suggestions.join(", ")}</p>
            ) : null}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isProd}
              onChange={(e) => setForm({ ...form, isProd: e.target.checked })}
            />
            Production environment <EnvBadge isProd={form.isProd} />
          </label>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium">Default headers</legend>
            <p className="text-xs text-zinc-500">
              Sent with every request. Put credentials in an auth recipe, not here.
            </p>
            {form.headers.map((h, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  aria-label={`Header name ${i + 1}`}
                  placeholder="X-Tenant"
                  value={h.key}
                  onChange={(e) => setHeader(i, { key: e.target.value })}
                />
                <Input
                  aria-label={`Header value ${i + 1}`}
                  placeholder="acme"
                  value={h.value}
                  onChange={(e) => setHeader(i, { value: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove header ${i + 1}`}
                  onClick={() =>
                    setForm({ ...form, headers: form.headers.filter((_, j) => j !== i) })
                  }
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ))}
            {errors.defaultHeaders ? (
              <p className="text-xs text-red-600 dark:text-red-400">{errors.defaultHeaders}</p>
            ) : null}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setForm({ ...form, headers: [...form.headers, { key: "", value: "" }] })
                }
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add header
              </Button>
            </div>
          </fieldset>

          {formError ? (
            <p
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300"
            >
              {formError}
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
    </section>
  );
}
