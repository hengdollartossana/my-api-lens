"use client";

import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MethodBadge } from "@/components/badges";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import type { GroupingProposalResult, GroupingSuggestion } from "@/db/ai-grouping";
import { apiJson, messageOf } from "@/lib/api-client";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/**
 * Suggest modules for the endpoints in `Ungrouped`. The AI only proposes: nothing changes until the
 * user ticks proposals and presses Apply.
 */
export function AiGroupingPanel({
  projectId,
  aiEnabled,
}: {
  projectId: string;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GroupingProposalResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiJson<GroupingProposalResult>(
        `/api/projects/${projectId}/ai/grouping`,
        { method: "POST" },
        "Could not get suggestions",
      );
      setResult(r);
      setPicked(new Set(r.suggestions.map((s) => s.stableKey)));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      const assignments = result.suggestions
        .filter((s) => picked.has(s.stableKey))
        .map((s) => ({ stableKey: s.stableKey, module: s.module }));
      const data = await apiJson<{ applied: number }>(
        `/api/projects/${projectId}/ai/grouping/apply`,
        { method: "POST", json: { assignments } },
        "Could not apply",
      );
      toast.success(`Moved ${data.applied} endpoint${data.applied === 1 ? "" : "s"}`);
      setResult(null);
      router.refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (s: GroupingSuggestion) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(s.stableKey)) next.delete(s.stableKey);
      else next.add(s.stableKey);
      return next;
    });

  return (
    <section className="mb-6 flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Group with AI</h2>
          <p className="text-xs text-zinc-500">
            Sends only each endpoint's method, path and summary. You approve every move.
          </p>
        </div>
        <Button size="sm" onClick={suggest} disabled={!aiEnabled || busy}>
          {busy && !result ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          Suggest groups
        </Button>
      </div>

      {!aiEnabled ? (
        <p className="text-xs text-zinc-500">
          AI is off. Add a key in{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Settings
          </Link>{" "}
          to use this.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs tabular-nums text-zinc-500" aria-live="polite">
            {result.model} · {result.usage?.inputTokens ?? 0} in / {result.usage?.outputTokens ?? 0}{" "}
            out tokens · {usd(result.costUsd)}
            {result.remaining ? ` · ${result.remaining} more endpoints for a later round` : ""}
          </p>
          {result.suggestions.length === 0 ? (
            <p className="text-sm text-zinc-500">The AI had no confident suggestions.</p>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-zinc-200 text-xs dark:divide-zinc-800">
                {result.suggestions.map((s) => (
                  <li key={s.stableKey}>
                    <label className="flex cursor-pointer items-center gap-3 py-2">
                      <input
                        type="checkbox"
                        checked={picked.has(s.stableKey)}
                        onChange={() => toggle(s)}
                      />
                      <MethodBadge method={s.method} />
                      <code className="flex-1 truncate font-mono">{s.path}</code>
                      <span className="font-medium">
                        → {s.module}
                        {s.isNew ? <span className="ml-1 text-zinc-500">(new)</span> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Button size="sm" onClick={apply} disabled={busy || picked.size === 0}>
                  Apply {picked.size} selected
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setResult(null)} disabled={busy}>
                  Discard
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
