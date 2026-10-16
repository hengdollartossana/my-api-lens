import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  buildRequest,
  clampConcurrency,
  type ExecEndpoint,
  type ExecInput,
  type ExecResult,
  executeWithAuth,
  resolveAuth,
  runPool,
  type Severity,
  severityFor,
  skipReason,
} from "@/core/executor";
import { db } from "@/db/client";
import { endpoints, environments, modules, runResults, runs } from "@/db/schema";
import { buildAuthContext, guardFor, tokenCache } from "./auth-runner";

/**
 * Runs endpoints against an environment, persists results and fans events out to SSE listeners.
 * SERVER ONLY. Runs live in this process; results are in Postgres.
 */

export const STORED_BODY_LIMIT = 256 * 1024;

export type RunEvent =
  | { type: "progress"; data: { completed: number; total: number } }
  | { type: "result"; data: ResultEventData }
  | {
      type: "done";
      data: { status: "done" | "failed" | "cancelled"; completed: number; total: number };
    }
  | { type: "error"; data: { message: string } };

export interface ResultEventData {
  endpointId: string;
  stableKey: string;
  statusCode: number | null;
  durationMs: number | null;
  severity: Severity;
  skipped: boolean;
  skipReason: string | null;
  error: string | null;
}

export class RunInputError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunInputError";
  }
}

export interface StartRunInput {
  projectId: string;
  environmentId: string;
  moduleId?: string;
  endpointIds?: string[];
  confirmDestructive?: boolean;
  confirmEnvName?: string;
  concurrency?: number;
  /** Edited request for a single-endpoint run (path/query params, headers, body). */
  input?: ExecInput;
}

interface LiveRun {
  id: string;
  events: RunEvent[];
  listeners: Set<(e: RunEvent) => void>;
  controller: AbortController;
  finished: boolean;
}

const MAX_LIVE_RUNS = 50;
const g = globalThis as unknown as { __apilensLiveRuns?: Map<string, LiveRun> };
const live = (g.__apilensLiveRuns ??= new Map<string, LiveRun>());

function emit(run: LiveRun, event: RunEvent) {
  run.events.push(event);
  for (const l of run.listeners) l(event);
}

const redactHeaders = (h: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(h).map(([k, v]) => [k, k.toLowerCase() === "set-cookie" ? "[REDACTED]" : v]),
  );

const truncate = (text: string) =>
  text.length > STORED_BODY_LIMIT ? text.slice(0, STORED_BODY_LIMIT) : text;

async function loadEndpoints(input: StartRunInput) {
  const base = and(eq(endpoints.projectId, input.projectId), isNull(endpoints.removedAt));
  if (input.endpointIds?.length) {
    const rows = await db
      .select()
      .from(endpoints)
      .where(and(base, inArray(endpoints.id, input.endpointIds)))
      .orderBy(asc(endpoints.path), asc(endpoints.method));
    if (rows.length !== new Set(input.endpointIds).size) {
      throw new RunInputError(
        400,
        "UNKNOWN_ENDPOINT",
        "Some endpoints do not belong to this project",
      );
    }
    return rows;
  }
  const where = input.moduleId ? and(base, eq(endpoints.moduleId, input.moduleId)) : base;
  return db
    .select()
    .from(endpoints)
    .where(where)
    .orderBy(asc(endpoints.path), asc(endpoints.method));
}

/** Validates the request, creates the run row and starts executing in the background. */
export async function startRun(input: StartRunInput) {
  const [env] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId));
  if (!env || env.projectId !== input.projectId) {
    throw new RunInputError(404, "NOT_FOUND", "Environment not found in this project");
  }
  if (input.moduleId) {
    const [mod] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.id, input.moduleId), eq(modules.projectId, input.projectId)));
    if (!mod) throw new RunInputError(404, "NOT_FOUND", "Module not found in this project");
  }
  if (env.isProd && input.confirmDestructive && input.confirmEnvName !== env.name) {
    throw new RunInputError(
      400,
      "ENV_CONFIRMATION_REQUIRED",
      `Production environment: type the environment name "${env.name}" to run destructive endpoints`,
    );
  }

  const rows = await loadEndpoints(input);
  if (rows.length === 0) throw new RunInputError(400, "NO_ENDPOINTS", "Nothing to run");
  if (input.input && rows.length !== 1) {
    throw new RunInputError(
      400,
      "BAD_REQUEST",
      "A custom request can only be sent for a single endpoint",
    );
  }

  const [run] = await db
    .insert(runs)
    .values({
      projectId: input.projectId,
      environmentId: input.environmentId,
      moduleId: input.moduleId ?? null,
      status: "running",
    })
    .returning();
  const runId = (run as { id: string }).id;
  const skipped = rows.filter((e) => skipReason(e, input)).length;

  const liveRun: LiveRun = {
    id: runId,
    events: [],
    listeners: new Set(),
    controller: new AbortController(),
    finished: false,
  };
  live.set(runId, liveRun);
  for (const [id, r] of live) {
    if (live.size <= MAX_LIVE_RUNS) break;
    if (r.finished) live.delete(id);
  }

  void execute(liveRun, rows, input, clampConcurrency(input.concurrency));
  return { runId, total: rows.length, skipped };
}

async function execute(
  run: LiveRun,
  rows: (typeof endpoints.$inferSelect)[],
  input: StartRunInput,
  concurrency: number,
) {
  const total = rows.length;
  let completed = 0;
  let failed = false;
  try {
    const ctx = await buildAuthContext(input.projectId, input.environmentId);
    const opts = { guard: guardFor(ctx.env.baseUrl) };
    // Log in once up front so parallel calls do not each trigger a login.
    if (ctx.recipe.type === "login_flow") await resolveAuth(ctx, tokenCache, opts).catch(() => {});

    await runPool(rows, concurrency, run.controller.signal, async (row) => {
      const reason = skipReason(row, input);
      let result: ExecResult | null = null;
      let errorText: string | null = null;
      let request: unknown = null;

      if (!reason) {
        try {
          const endpoint: ExecEndpoint = {
            method: row.method,
            path: row.path,
            parameters: (row.parameters as ExecEndpoint["parameters"]) ?? [],
            requestBodySchema: row.requestBodySchema ?? null,
          };
          result = await executeWithAuth(
            (auth) => buildRequest(endpoint, ctx.env, input.input ?? {}, auth),
            ctx,
            tokenCache,
            opts,
          );
          request = result.request;
          errorText = result.error ? `${result.error.code}: ${result.error.message}` : null;
        } catch (e) {
          errorText = (e as Error).message;
        }
      }

      const severity: Severity = reason ? "info" : result ? severityFor(result) : "error";
      await db.insert(runResults).values({
        runId: run.id,
        endpointId: row.id,
        request,
        statusCode: result?.status ?? null,
        durationMs: result?.durationMs ?? null,
        responseHeaders: result ? redactHeaders(result.headers) : null,
        responseBody: result ? truncate(result.bodyText) : null,
        severity,
        skipReason: reason,
        error: errorText,
      });
      completed++;
      emit(run, {
        type: "result",
        data: {
          endpointId: row.id,
          stableKey: row.stableKey,
          statusCode: result?.status ?? null,
          durationMs: result?.durationMs ?? null,
          severity,
          skipped: reason !== null,
          skipReason: reason,
          error: errorText,
        },
      });
      emit(run, { type: "progress", data: { completed, total } });
    });
  } catch (e) {
    failed = true;
    emit(run, { type: "error", data: { message: (e as Error).message } });
  }

  const status = failed ? "failed" : run.controller.signal.aborted ? "cancelled" : "done";
  await db.update(runs).set({ status, finishedAt: new Date() }).where(eq(runs.id, run.id));
  run.finished = true;
  emit(run, { type: "done", data: { status, completed, total } });
}

export const isLive = (runId: string) => live.has(runId);

/** Replays buffered events, then streams new ones. Returns an unsubscribe function, or null if not live. */
export function subscribe(runId: string, onEvent: (e: RunEvent) => void): (() => void) | null {
  const run = live.get(runId);
  if (!run) return null;
  for (const e of run.events) onEvent(e);
  if (run.finished) return () => {};
  run.listeners.add(onEvent);
  return () => run.listeners.delete(onEvent);
}

/** Rebuilds the event sequence for a run that is no longer in memory (e.g. after a restart). */
export async function replayFromDb(runId: string): Promise<RunEvent[] | null> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run) return null;
  const rows = await db
    .select({ r: runResults, stableKey: endpoints.stableKey })
    .from(runResults)
    .innerJoin(endpoints, eq(endpoints.id, runResults.endpointId))
    .where(eq(runResults.runId, runId))
    .orderBy(asc(runResults.createdAt));
  const events: RunEvent[] = [];
  rows.forEach(({ r, stableKey }, i) => {
    events.push({
      type: "result",
      data: {
        endpointId: r.endpointId,
        stableKey,
        statusCode: r.statusCode,
        durationMs: r.durationMs,
        severity: r.severity,
        skipped: r.skipReason !== null,
        skipReason: r.skipReason,
        error: r.error,
      },
    });
    events.push({ type: "progress", data: { completed: i + 1, total: rows.length } });
  });
  // A "running" row with no live worker was orphaned by a restart.
  const status = run.status === "running" ? "failed" : run.status;
  events.push({ type: "done", data: { status, completed: rows.length, total: rows.length } });
  return events;
}

export type CancelOutcome = "cancelled" | "not_running" | "not_found";

export async function cancelRun(runId: string): Promise<CancelOutcome> {
  const liveRun = live.get(runId);
  if (liveRun && !liveRun.finished) {
    liveRun.controller.abort();
    return "cancelled";
  }
  const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (!run) return "not_found";
  if (run.status === "running") {
    // Orphaned by a restart: nothing is executing, so close it out.
    await db
      .update(runs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(runs.id, runId));
    return "cancelled";
  }
  return "not_running";
}
