"use client";

import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RunSummary } from "@/db/ai-summary";
import { apiJson, messageOf } from "@/lib/api-client";

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** A plain-English summary of the run's differences. Stored per run: reopening costs nothing. */
export function RunAiSummary({ runId, finished }: { runId: string; finished: boolean }) {
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noFindings, setNoFindings] = useState(false);

  useEffect(() => {
    fetch(`/api/runs/${runId}/summary`)
      .then((r) => r.json())
      .then((d) => {
        setSummary(d.summary ?? null);
        setEnabled(Boolean(d.aiEnabled));
      })
      .finally(() => setLoaded(true));
  }, [runId]);

  async function generate(refresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson<{ summary: RunSummary | null; noFindings: boolean }>(
        `/api/runs/${runId}/summary`,
        { method: "POST", json: { refresh } },
        "Could not summarise",
      );
      setSummary(data.summary);
      setNoFindings(Boolean(data.noFindings));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || !finished) return null;

  return (
    <section className="mb-4 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Summary</h2>
        {summary ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => generate(true)}
            disabled={busy || !enabled}
          >
            Regenerate
          </Button>
        ) : (
          <Button size="sm" onClick={() => generate(false)} disabled={busy || !enabled}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Summarize with AI
          </Button>
        )}
      </div>
      {!enabled && !summary ? (
        <p className="text-xs text-zinc-500">
          AI is off. Add a key in{" "}
          <Link href="/settings" className="text-primary hover:underline">
            Settings
          </Link>{" "}
          to summarise differences. Only the findings are sent, never response data.
        </p>
      ) : null}
      {noFindings && !summary ? (
        <p className="text-sm text-zinc-500">No differences from the spec, nothing to summarise.</p>
      ) : null}
      {summary ? (
        <>
          <p className="whitespace-pre-wrap text-sm">{summary.text}</p>
          <p className="text-xs tabular-nums text-zinc-500">
            {summary.model} · {summary.findingCount} findings · {summary.inputTokens} in /{" "}
            {summary.outputTokens} out tokens · {usd(summary.costUsd)} · saved with this run
          </p>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : null}
    </section>
  );
}
