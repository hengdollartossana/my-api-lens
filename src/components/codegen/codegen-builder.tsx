"use client";

import JSZip from "jszip";
import { Download, FileCode, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ModuleSummary } from "@/db/modules";
import { cn } from "@/lib/utils";

interface GeneratedFile {
  path: string;
  content: string;
}
interface CodegenResponse {
  files: GeneratedFile[];
  unapproved: string[];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "api";

/** Pick a target and modules, preview the generated file tree, then download it as a zip. */
export function CodegenBuilder({
  projectId,
  projectName,
  modules,
}: {
  projectId: string;
  projectName: string;
  modules: ModuleSummary[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(modules.map((m) => m.id)));
  const [preferObserved, setPreferObserved] = useState(false);
  const [contractTests, setContractTests] = useState(false);
  const [packageName, setPackageName] = useState("app");
  const [result, setResult] = useState<CodegenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const ids = useMemo(() => [...selected].sort(), [selected]);
  const packageValid = /^[a-z][a-z0-9_]*$/.test(packageName);

  useEffect(() => {
    if (ids.length === 0 || !packageValid) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/projects/${projectId}/codegen`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target: "flutter",
        moduleIds: ids,
        preferObserved,
        contractTests,
        packageName,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Could not generate code");
        setResult(data as CodegenResponse);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setError((e as Error).message);
      });
    return () => ctrl.abort();
  }, [projectId, ids, preferObserved, contractTests, packageName, packageValid]);

  const files = result?.files ?? [];
  const current = files.find((f) => f.path === active) ?? files[0];

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async () => {
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.content);
    const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug(projectName)}-flutter.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (modules.length === 0) {
    return (
      <EmptyState title="No modules" description="Import a spec first; its modules appear here." />
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="codegen-target" className="text-xs">
            Target
          </Label>
          <select
            id="codegen-target"
            defaultValue="flutter"
            className="h-9 rounded-md border border-zinc-300 bg-background px-2 text-sm dark:border-zinc-800"
          >
            <option value="flutter">Flutter (Dio + freezed)</option>
            <option value="swift" disabled>
              SwiftUI (coming soon)
            </option>
          </select>
        </div>

        <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {modules.map((m) => (
            <li key={m.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                <span className="flex-1 truncate">{m.name}</span>
                <span className="text-xs tabular-nums text-zinc-500">{m.endpointCount}</span>
                <StatusBadge status={m.status} />
              </label>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2 text-xs text-zinc-500">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={preferObserved}
              onChange={(e) => setPreferObserved(e.target.checked)}
            />
            Prefer observed responses (nullability and extra fields) over the spec
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={contractTests}
              onChange={(e) => setContractTests(e.target.checked)}
            />
            Contract tests from recorded responses (needs runs)
          </label>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="codegen-package" className="text-xs">
            Dart package name
          </Label>
          <Input
            id="codegen-package"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            aria-invalid={!packageValid}
          />
          {!packageValid ? (
            <p className="text-xs text-red-500">Lowercase letters, digits and underscores.</p>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {result?.unapproved.length ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Not approved: {result.unapproved.join(", ")}. Review them before relying on this code.
            </span>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={download} disabled={files.length === 0}>
            <Download className="size-4" />
            Download zip
          </Button>
          <p className="ml-auto text-xs tabular-nums text-zinc-500" aria-live="polite">
            {files.length ? `${files.length} files` : "Select modules"}
          </p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        {files.length === 0 ? (
          <EmptyState
            icon={FileCode}
            title="No files yet"
            description="Pick at least one module to preview the generated code."
          />
        ) : (
          <div className="grid min-h-0 gap-3 md:grid-cols-[260px_1fr]">
            <ul className="max-h-[70vh] overflow-auto rounded-md border border-zinc-200 py-1 font-mono text-xs dark:border-zinc-800">
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    onClick={() => setActive(f.path)}
                    className={cn(
                      "w-full truncate px-3 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900",
                      current?.path === f.path && "bg-zinc-100 font-medium dark:bg-zinc-900",
                    )}
                    title={f.path}
                  >
                    {f.path}
                  </button>
                </li>
              ))}
            </ul>
            <pre className="max-h-[70vh] overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-950">
              {current?.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
