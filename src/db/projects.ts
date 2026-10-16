import { desc, eq, sql } from "drizzle-orm";
import { groupEndpoints } from "@/core/grouper";
import { type ParseInput, parseSpec } from "@/core/parser";
import { db } from "./client";
import { endpoints, modules, projects } from "./schema";

/** SERVER ONLY: project import and listing. */

export interface ProjectSummary {
  id: string;
  name: string;
  specSource: "url" | "file";
  specUrl: string | null;
  lastImportedAt: Date | null;
  createdAt: Date;
  endpointCount: number;
  moduleCount: number;
}

export interface ImportInput {
  /** Defaults to the spec title. */
  name?: string;
  source: ParseInput;
}

const INSERT_CHUNK = 500;

/**
 * Parse a spec, group its endpoints into modules and persist everything in ONE transaction.
 * Throws (ParseSpecError for bad specs) before anything is written, so a broken spec creates nothing.
 */
export async function importProject(input: ImportInput): Promise<ProjectSummary> {
  const spec = await parseSpec(input.source);
  const grouping = groupEndpoints(spec.endpoints);
  const name = input.name?.trim() || spec.title.trim() || "Untitled API";
  const now = new Date();

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({
        name,
        specSource: "url" in input.source ? "url" : "file",
        specUrl: "url" in input.source ? input.source.url : null,
        specRaw: spec.raw,
        specHash: spec.specHash,
        lastImportedAt: now,
      })
      .returning();
    if (!project) throw new Error("Project insert returned no row");

    const moduleRows = await tx
      .insert(modules)
      .values(
        grouping.modules.map((m) => ({
          projectId: project.id,
          name: m.name,
          via: m.via,
          status: "draft" as const,
        })),
      )
      .returning({ id: modules.id, name: modules.name });
    const moduleId = new Map(moduleRows.map((m) => [m.name, m.id]));
    const moduleOf = new Map(grouping.assignments.map((a) => [a.stableKey, a.moduleName]));

    const rows = spec.endpoints.map((e) => ({
      projectId: project.id,
      moduleId: moduleId.get(moduleOf.get(e.stableKey) ?? "") ?? null,
      stableKey: e.stableKey,
      method: e.method,
      path: e.path,
      operationId: e.operationId,
      summary: e.summary,
      tags: e.tags,
      parameters: e.parameters,
      requestBodySchema: e.requestBodySchema,
      responseSchemas: e.responseSchemas,
      security: e.security,
      isDestructive: e.isDestructive,
    }));
    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await tx.insert(endpoints).values(rows.slice(i, i + INSERT_CHUNK));
    }

    return {
      id: project.id,
      name: project.name,
      specSource: project.specSource,
      specUrl: project.specUrl,
      lastImportedAt: project.lastImportedAt,
      createdAt: project.createdAt,
      endpointCount: rows.length,
      moduleCount: grouping.modules.length,
    };
  });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      specSource: projects.specSource,
      specUrl: projects.specUrl,
      lastImportedAt: projects.lastImportedAt,
      createdAt: projects.createdAt,
      endpointCount: sql<number>`(select count(*)::int from ${endpoints} where ${endpoints.projectId} = ${sql.raw('"projects"."id"')} and ${endpoints.removedAt} is null)`,
      moduleCount: sql<number>`(select count(*)::int from ${modules} where ${modules.projectId} = ${sql.raw('"projects"."id"')})`,
    })
    .from(projects)
    .orderBy(desc(projects.createdAt));
}

export async function getProject(id: string): Promise<ProjectSummary | null> {
  const rows = (await listProjects()).filter((p) => p.id === id);
  return rows[0] ?? null;
}

export async function deleteProject(id: string): Promise<boolean> {
  const rows = await db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
  return rows.length > 0;
}
