import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { endpoints, modules } from "./schema";

/** SERVER ONLY: one endpoint with the details the detail screen needs. */
export async function getEndpointDetail(projectId: string, endpointId: string) {
  const [row] = await db
    .select({
      id: endpoints.id,
      projectId: endpoints.projectId,
      moduleId: endpoints.moduleId,
      moduleName: modules.name,
      stableKey: endpoints.stableKey,
      method: endpoints.method,
      path: endpoints.path,
      operationId: endpoints.operationId,
      summary: endpoints.summary,
      tags: endpoints.tags,
      parameters: endpoints.parameters,
      requestBodySchema: endpoints.requestBodySchema,
      responseSchemas: endpoints.responseSchemas,
      security: endpoints.security,
      isDestructive: endpoints.isDestructive,
    })
    .from(endpoints)
    .leftJoin(modules, eq(modules.id, endpoints.moduleId))
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.projectId, projectId)));
  return row ?? null;
}
