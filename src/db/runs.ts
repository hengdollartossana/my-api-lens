import { asc, desc, eq, sql } from "drizzle-orm";
import type { RunDetail, RunListItem, RunResultItem } from "@/lib/run-types";
import { db } from "./client";
import { endpoints, environments, modules, projects, runResults, runs } from "./schema";

/** SERVER ONLY: read side of runs (writes live in lib/run-service). */

const runId = sql.raw('"runs"."id"');
const count = (extra = sql``) =>
  sql<number>`(select count(*)::int from ${runResults} where ${runResults.runId} = ${runId} ${extra})`;

const runColumns = {
  id: runs.id,
  projectId: runs.projectId,
  projectName: projects.name,
  moduleId: runs.moduleId,
  moduleName: modules.name,
  environmentId: runs.environmentId,
  environmentName: environments.name,
  isProd: environments.isProd,
  status: runs.status,
  startedAt: runs.startedAt,
  finishedAt: runs.finishedAt,
  resultCount: count(),
  errorCount: count(sql`and ${runResults.severity} = 'error'`),
  warnCount: count(sql`and ${runResults.severity} = 'warn'`),
  skippedCount: count(sql`and ${runResults.skipReason} is not null`),
};

type RunRow = Omit<RunListItem, "startedAt" | "finishedAt"> & {
  startedAt: Date;
  finishedAt: Date | null;
};

const toItem = (r: RunRow): RunListItem => ({
  ...r,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

function baseQuery() {
  return db
    .select(runColumns)
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .innerJoin(environments, eq(environments.id, runs.environmentId))
    .leftJoin(modules, eq(modules.id, runs.moduleId));
}

export async function listRuns(
  opts: { projectId?: string; limit?: number } = {},
): Promise<RunListItem[]> {
  const q = baseQuery();
  const rows = await (opts.projectId ? q.where(eq(runs.projectId, opts.projectId)) : q)
    .orderBy(desc(runs.startedAt))
    .limit(Math.min(opts.limit ?? 50, 200));
  return rows.map((r) => toItem(r as RunRow));
}

export async function getRunDetail(id: string): Promise<RunDetail | null> {
  const [row] = await baseQuery().where(eq(runs.id, id));
  if (!row) return null;
  const results = await db
    .select({
      id: runResults.id,
      endpointId: runResults.endpointId,
      stableKey: endpoints.stableKey,
      method: endpoints.method,
      path: endpoints.path,
      statusCode: runResults.statusCode,
      durationMs: runResults.durationMs,
      severity: runResults.severity,
      skipReason: runResults.skipReason,
      error: runResults.error,
      request: runResults.request,
      responseHeaders: runResults.responseHeaders,
      responseBody: runResults.responseBody,
    })
    .from(runResults)
    .innerJoin(endpoints, eq(endpoints.id, runResults.endpointId))
    .where(eq(runResults.runId, id))
    .orderBy(asc(runResults.createdAt));
  return { run: toItem(row as RunRow), results: results as RunResultItem[] };
}
