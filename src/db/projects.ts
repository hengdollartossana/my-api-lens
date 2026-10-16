import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { groupEndpoints } from "@/core/grouper";
import { type ContractPart, changedParts, type ParseInput, parseSpec } from "@/core/parser";
import { db } from "./client";
import { endpoints, moduleOverrides, modules, projects } from "./schema";

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

export class ReimportError extends Error {
  constructor(
    readonly status: 404,
    message: string,
  ) {
    super(message);
    this.name = "ReimportError";
  }
}

export interface ChangeSummary {
  /** True when the spec is byte-for-byte equivalent to the stored one: nothing was touched. */
  identical: boolean;
  added: { stableKey: string; module: string }[];
  removed: { stableKey: string; module: string | null }[];
  changed: { stableKey: string; module: string | null; parts: ContractPart[] }[];
  moved: { stableKey: string; from: string | null; to: string }[];
  unchangedCount: number;
  /** Approved modules that went back to needs_review because of these changes. */
  needsReview: string[];
}

/**
 * Re-import a spec into an existing project and report what changed, comparing by stable key:
 * new endpoints, removed ones (kept with `removed_at`, so run history survives), changed contracts,
 * and endpoints that moved module. Manual regrouping (module overrides) is applied first, so it
 * survives. An approved module touched by any change goes back to needs_review. All-or-nothing.
 */
export async function reimportProject(
  projectId: string,
  source: ParseInput,
): Promise<{ project: ProjectSummary; changes: ChangeSummary }> {
  const spec = await parseSpec(source);

  const changes = await db.transaction(async (tx): Promise<ChangeSummary> => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId));
    if (!project) throw new ReimportError(404, "Project not found");

    const now = new Date();
    const empty: ChangeSummary = {
      identical: false,
      added: [],
      removed: [],
      changed: [],
      moved: [],
      unchangedCount: 0,
      needsReview: [],
    };
    if (project.specHash === spec.specHash) {
      await tx.update(projects).set({ lastImportedAt: now }).where(eq(projects.id, projectId));
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(endpoints)
        .where(and(eq(endpoints.projectId, projectId), isNull(endpoints.removedAt)));
      return { ...empty, identical: true, unchangedCount: n };
    }

    const overrides = Object.fromEntries(
      (await tx.select().from(moduleOverrides).where(eq(moduleOverrides.projectId, projectId))).map(
        (o) => [o.stableKey, o.moduleName],
      ),
    );
    const grouping = groupEndpoints(spec.endpoints, { overrides });
    const assigned = new Map(grouping.assignments.map((a) => [a.stableKey, a]));

    const moduleRows = await tx.select().from(modules).where(eq(modules.projectId, projectId));
    const moduleId = new Map(moduleRows.map((m) => [m.name, m.id]));
    const moduleName = new Map(moduleRows.map((m) => [m.id, m.name]));
    for (const g of grouping.modules) {
      if (moduleId.has(g.name)) continue;
      const [created] = await tx
        .insert(modules)
        .values({ projectId, name: g.name, via: g.via, status: "draft" })
        .returning();
      moduleId.set(g.name, (created as { id: string }).id);
      moduleName.set((created as { id: string }).id, g.name);
    }

    const existing = await tx.select().from(endpoints).where(eq(endpoints.projectId, projectId));
    const byKey = new Map(existing.map((e) => [e.stableKey, e]));
    const result: ChangeSummary = { ...empty };
    const touched = new Set<string>();
    const nextKeys = new Set(spec.endpoints.map((e) => e.stableKey));

    for (const e of spec.endpoints) {
      const target = assigned.get(e.stableKey)?.moduleName ?? "";
      const targetId = moduleId.get(target) as string;
      const values = {
        moduleId: targetId,
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
        removedAt: null,
      };
      const current = byKey.get(e.stableKey);
      if (!current) {
        await tx.insert(endpoints).values({ projectId, stableKey: e.stableKey, ...values });
        result.added.push({ stableKey: e.stableKey, module: target });
        touched.add(targetId);
        continue;
      }
      await tx.update(endpoints).set(values).where(eq(endpoints.id, current.id));
      if (current.removedAt) {
        result.added.push({ stableKey: e.stableKey, module: target }); // came back
        touched.add(targetId);
        continue;
      }
      const parts = changedParts(current, e);
      if (parts.length) {
        result.changed.push({ stableKey: e.stableKey, module: target, parts });
        touched.add(targetId);
      }
      if (current.moduleId !== targetId) {
        result.moved.push({
          stableKey: e.stableKey,
          from: current.moduleId ? (moduleName.get(current.moduleId) ?? null) : null,
          to: target,
        });
        touched.add(targetId);
        if (current.moduleId) touched.add(current.moduleId);
      }
      if (!parts.length && current.moduleId === targetId) result.unchangedCount++;
    }

    const gone = existing.filter((e) => !e.removedAt && !nextKeys.has(e.stableKey));
    if (gone.length) {
      await tx
        .update(endpoints)
        .set({ removedAt: now })
        .where(
          inArray(
            endpoints.id,
            gone.map((g) => g.id),
          ),
        );
      for (const g of gone) {
        result.removed.push({
          stableKey: g.stableKey,
          module: g.moduleId ? (moduleName.get(g.moduleId) ?? null) : null,
        });
        if (g.moduleId) touched.add(g.moduleId);
      }
    }

    if (touched.size) {
      const flipped = await tx
        .update(modules)
        .set({ status: "needs_review" })
        .where(and(inArray(modules.id, [...touched]), eq(modules.status, "approved")))
        .returning({ name: modules.name });
      result.needsReview = flipped.map((m) => m.name).sort();
    }

    await tx
      .update(projects)
      .set({ specRaw: spec.raw, specHash: spec.specHash, lastImportedAt: now })
      .where(eq(projects.id, projectId));
    return result;
  });

  const summary = await getProject(projectId);
  return { project: summary as ProjectSummary, changes };
}
