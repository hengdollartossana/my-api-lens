import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { DiffItemJson } from "@/lib/run-types";
import { db } from "./client";
import { endpoints, environments, modules, runResults, runs } from "./schema";

/** SERVER ONLY: the latest spec-vs-reality comparison of every endpoint that has been run. */

export interface DiffRow {
  moduleId: string | null;
  moduleName: string;
  endpointId: string;
  method: string;
  path: string;
  runId: string;
  environmentId: string;
  environmentName: string;
  isProd: boolean;
  ranAt: string;
  statusCode: number | null;
  items: DiffItemJson[];
}

/**
 * For each endpoint of the project, the diff stored by its most recent run that could be compared
 * (optionally limited to one environment). Endpoints that matched the spec have no items.
 */
export async function listLatestDiffs(
  projectId: string,
  opts: { environmentId?: string } = {},
): Promise<DiffRow[]> {
  const where = and(
    eq(runs.projectId, projectId),
    isNotNull(runResults.diff),
    isNull(endpoints.removedAt),
    opts.environmentId ? eq(runs.environmentId, opts.environmentId) : undefined,
  );
  const latest = await db
    .selectDistinctOn([runResults.endpointId], {
      moduleId: endpoints.moduleId,
      moduleName: modules.name,
      endpointId: endpoints.id,
      method: endpoints.method,
      path: endpoints.path,
      runId: runs.id,
      environmentId: environments.id,
      environmentName: environments.name,
      isProd: environments.isProd,
      ranAt: runResults.createdAt,
      statusCode: runResults.statusCode,
      diff: runResults.diff,
    })
    .from(runResults)
    .innerJoin(runs, eq(runs.id, runResults.runId))
    .innerJoin(endpoints, eq(endpoints.id, runResults.endpointId))
    .innerJoin(environments, eq(environments.id, runs.environmentId))
    .leftJoin(modules, eq(modules.id, endpoints.moduleId))
    .where(where)
    .orderBy(asc(runResults.endpointId), desc(runResults.createdAt));

  return latest
    .map(({ diff, ranAt, moduleName, ...rest }) => ({
      ...rest,
      moduleName: moduleName ?? "Ungrouped",
      ranAt: ranAt.toISOString(),
      items: (Array.isArray(diff) ? diff : []) as DiffItemJson[],
    }))
    .sort(
      (a, b) =>
        a.moduleName.localeCompare(b.moduleName) ||
        a.path.localeCompare(b.path) ||
        a.method.localeCompare(b.method),
    );
}
