import { asc, eq } from "drizzle-orm";
import { db } from "./client";
import { environments } from "./schema";

export interface EnvironmentOption {
  id: string;
  name: string;
  baseUrl: string;
  isProd: boolean;
}

/** SERVER ONLY: environments of a project, for pickers. CRUD arrives with T-13. */
export async function listEnvironments(projectId: string): Promise<EnvironmentOption[]> {
  return db
    .select({
      id: environments.id,
      name: environments.name,
      baseUrl: environments.baseUrl,
      isProd: environments.isProd,
    })
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.isProd), asc(environments.name));
}
