"use client";

import { useState } from "react";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AI_MODELS } from "@/core/ai/pricing";
import type { AiSettingsView } from "@/db/ai";
import { apiJson, messageOf } from "@/lib/api-client";

type TestState =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; model: string; input: number; output: number; cost: number }
  | { kind: "error"; message: string };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Bring-your-own-key settings. The key is write-only: after saving, only `••••last4` is shown. */
export function AiSettings({ initial }: { initial: AiSettingsView }) {
  const [view, setView] = useState(initial);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial.model);
  const [budget, setBudget] = useState(initial.monthlyBudgetUsd?.toString() ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [test, setTest] = useState<TestState>({ kind: "idle" });

  async function call(method: string, json?: unknown) {
    const data = await apiJson<{ settings: AiSettingsView }>(
      "/api/settings/ai",
      { method, json },
      "Could not update settings",
    );
    setView(data.settings);
  }

  async function save() {
    setBusy(true);
    try {
      const parsed = budget.trim() === "" ? null : Number(budget);
      if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0))
        throw new Error("Budget must be a positive number");
      await call("PUT", { ...(apiKey.trim() ? { apiKey } : {}), model, monthlyBudgetUsd: parsed });
      setApiKey("");
      toast.success("AI settings saved");
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    setTest({ kind: "idle" });
    try {
      await call("DELETE");
      toast.success("API key removed");
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setTest({ kind: "busy" });
    try {
      const data = await apiJson<{
        model: string;
        usage: { inputTokens: number; outputTokens: number };
        costUsd: number;
      }>("/api/settings/ai/test", { method: "POST" }, "Test failed");
      setTest({
        kind: "ok",
        model: data.model,
        input: data.usage.inputTokens,
        output: data.usage.outputTokens,
        cost: data.costUsd,
      });
      toast.success("The key works");
      const refreshed = await apiJson<{ settings: AiSettingsView }>("/api/settings/ai");
      setView(refreshed.settings);
    } catch (e) {
      setTest({ kind: "error", message: messageOf(e) });
    }
  }

  return (
    <section className="flex max-w-xl flex-col gap-5 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h2 className="text-sm font-semibold">AI (optional)</h2>
        <p className="text-xs text-zinc-500">
          Bring your own Anthropic key. Without one, everything else works and AI actions stay
          disabled. The key is stored encrypted and never sent back to the browser.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="ai-key" className="text-xs">
          API key {view.keyMasked ? <span className="font-mono">({view.keyMasked})</span> : null}
        </Label>
        <Input
          id="ai-key"
          type="password"
          autoComplete="off"
          placeholder={view.hasKey ? "Enter a new key to replace it" : "sk-ant-…"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-model" className="text-xs">
            Model
          </Label>
          <select
            id="ai-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 rounded-md border border-zinc-300 bg-background px-2 text-sm dark:border-zinc-800"
          >
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} (${m.inputPerMTok}/${m.outputPerMTok} per M tokens)
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-budget" className="text-xs">
            Soft monthly budget (USD)
          </Label>
          <Input
            id="ai-budget"
            inputMode="decimal"
            placeholder="No limit"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs tabular-nums text-zinc-500">
        This month: {usd(view.monthSpendUsd)}
        {view.monthlyBudgetUsd !== null ? ` of ${usd(view.monthlyBudgetUsd)}` : ""}
      </p>
      {view.overBudget ? (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          Soft budget reached. AI calls still run; raise or clear the budget to silence this.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={runTest}
          disabled={!view.hasKey || test.kind === "busy"}
        >
          {test.kind === "busy" ? "Testing…" : "Test key"}
        </Button>
        {view.hasKey ? (
          <Button size="sm" variant="ghost" onClick={removeKey} disabled={busy}>
            Remove key
          </Button>
        ) : null}
      </div>

      {test.kind === "ok" ? (
        <p className="text-xs text-green-600 dark:text-green-400" aria-live="polite">
          Works: {test.model} · {test.input} in / {test.output} out tokens · {usd(test.cost)}
        </p>
      ) : null}
      {test.kind === "error" ? (
        <p role="alert" className="text-xs text-red-500">
          {test.message}
        </p>
      ) : null}
    </section>
  );
}
