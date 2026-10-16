import { and, eq, isNotNull } from "drizzle-orm";
import { buildSummaryRequest, type MessagesClient, type SummaryDiffItem } from "@/core/ai";
import { safeText } from "@/core/report/redact";
import type { DiffItemJson } from "@/lib/run-types";
import { runAi } from "./ai";
import { db } from "./client";
import { endpoints, environments, modules, runResults, runs } from "./schema";

/**
 * SERVER ONLY: plain-English summary of a run's spec-vs-reality differences. Sends the findings
 * only (never bodies or values) and stores the answer on the run, so showing it again costs no call.
 */

export type RunSummary = NonNullable<(typeof runs.$inferSelect)["aiSummary"]>;

export class SummaryError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SummaryError";
  }
}

export interface RunSummaryResult {
  summary: RunSummary | null;
  /** True when the stored summary was returned and no AI call was made. */
  cached: boolean;
  /** The run has no differences, so there is nothing to summarise. */
  noFindings: boolean;
}

export async function getRunSummary(runId: string): Promise<RunSummary | null> {
  const [row] = await db.select({ s: runs.aiSummary }).from(runs).where(eq(runs.id, runId));
  return row?.s ?? null;
}

export async function summarizeRun(
  runId: string,
  opts: { refresh?: boolean } = {},
  client?: MessagesClient,
): Promise<RunSummaryResult> {
  const [run] = await db
    .select({
      status: runs.status,
      summary: runs.aiSummary,
      moduleName: modules.name,
      environmentName: environments.name,
    })
    .from(runs)
    .innerJoin(environments, eq(environments.id, runs.environmentId))
    .leftJoin(modules, eq(modules.id, runs.moduleId))
    .where(eq(runs.id, runId));
  if (!run) throw new SummaryError(404, "NOT_FOUND", "Run not found");
  if (run.status === "running")
    throw new SummaryError(409, "RUN_ACTIVE", "Wait for the run to finish");
  if (run.summary && !opts.refresh)
    return { summary: run.summary, cached: true, noFindings: false };

  const rows = await db
    .select({ method: endpoints.method, path: endpoints.path, diff: runResults.diff })
    .from(runResults)
    .innerJoin(endpoints, eq(endpoints.id, runResults.endpointId))
    .where(and(eq(runResults.runId, runId), isNotNull(runResults.diff)));
  const items: SummaryDiffItem[] = rows.flatMap((r) =>
    ((Array.isArray(r.diff) ? r.diff : []) as DiffItemJson[]).map((d) => ({
      endpoint: `${r.method.toUpperCase()} ${r.path}`,
      kind: d.kind,
      severity: d.severity,
      path: d.path,
      message: safeText(d.message),
    })),
  );
  if (items.length === 0) return { summary: null, cached: false, noFindings: true };

  const result = await runAi(
    "diff-summary",
    buildSummaryRequest(
      {
        moduleName: run.moduleName,
        environmentName: run.environmentName,
        comparedCount: rows.length,
      },
      items,
    ),
    client,
  );
  const summary: RunSummary = {
    text: result.text.trim(),
    model: result.model,
    costUsd: result.costUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    findingCount: items.length,
    createdAt: new Date().toISOString(),
  };
  await db.update(runs).set({ aiSummary: summary }).where(eq(runs.id, runId));
  return { summary, cached: false, noFindings: false };
}
