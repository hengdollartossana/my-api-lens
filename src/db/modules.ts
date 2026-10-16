import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { endpoints, modules } from "./schema";

/** SERVER ONLY: module reads for the project and module screens. */

export interface ModuleSummary {
  id: string;
  name: string;
  via: (typeof modules.$inferSelect)["via"];
  status: (typeof modules.$inferSelect)["status"];
  endpointCount: number;
}

export async function listModules(projectId: string): Promise<ModuleSummary[]> {
  return db
    .select({
      id: modules.id,
      name: modules.name,
      via: modules.via,
      status: modules.status,
      endpointCount: sql<number>`(select count(*)::int from ${endpoints} where ${endpoints.moduleId} = ${sql.raw('"modules"."id"')} and ${endpoints.removedAt} is null)`,
    })
    .from(modules)
    .where(eq(modules.projectId, projectId))
    .orderBy(asc(modules.name));
}

export interface ModuleEndpoint {
  id: string;
  method: string;
  path: string;
  summary: string | null;
  isDestructive: boolean;
}

export async function getModule(projectId: string, moduleId: string) {
  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
  if (!mod) return null;
  const rows: ModuleEndpoint[] = await db
    .select({
      id: endpoints.id,
      method: endpoints.method,
      path: endpoints.path,
      summary: endpoints.summary,
      isDestructive: endpoints.isDestructive,
    })
    .from(endpoints)
    .where(and(eq(endpoints.moduleId, moduleId), isNull(endpoints.removedAt)))
    .orderBy(asc(endpoints.path), asc(endpoints.method));
  return { module: mod, endpoints: rows };
}
