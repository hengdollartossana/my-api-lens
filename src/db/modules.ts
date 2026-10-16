import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { endpoints, moduleOverrides, modules } from "./schema";

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
  /** True when the endpoint sits here because someone moved it (a module override exists). */
  moved: boolean;
}

export async function getModule(projectId: string, moduleId: string) {
  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
  if (!mod) return null;
  const rows = await db
    .select({
      id: endpoints.id,
      method: endpoints.method,
      path: endpoints.path,
      summary: endpoints.summary,
      isDestructive: endpoints.isDestructive,
      stableKey: endpoints.stableKey,
    })
    .from(endpoints)
    .where(and(eq(endpoints.moduleId, moduleId), isNull(endpoints.removedAt)))
    .orderBy(asc(endpoints.path), asc(endpoints.method));
  const overridden = rows.length
    ? new Set(
        (
          await db
            .select({ key: moduleOverrides.stableKey })
            .from(moduleOverrides)
            .where(
              and(
                eq(moduleOverrides.projectId, projectId),
                inArray(
                  moduleOverrides.stableKey,
                  rows.map((r) => r.stableKey),
                ),
              ),
            )
        ).map((o) => o.key),
      )
    : new Set<string>();
  const list: ModuleEndpoint[] = rows.map(({ stableKey, ...e }) => ({
    ...e,
    moved: overridden.has(stableKey),
  }));
  return { module: mod, endpoints: list };
}

/** stable_key -> module name for every manual override of a project (what the grouper takes as `overrides`). */
export async function loadOverrides(projectId: string): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(moduleOverrides)
    .where(eq(moduleOverrides.projectId, projectId));
  return Object.fromEntries(rows.map((r) => [r.stableKey, r.moduleName]));
}

export class RegroupError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RegroupError";
  }
}

export type MoveTarget = { moduleId: string } | { newModuleName: string };

const isUnique = (e: unknown) =>
  (e as { code?: string })?.code === "23505" ||
  (e as { cause?: { code?: string } })?.cause?.code === "23505";

/**
 * Move one endpoint to another (or a new) module. The move is stored as a module override so it
 * survives re-import. An approved module that gains or loses an endpoint goes back to needs_review.
 */
export async function moveEndpoint(projectId: string, endpointId: string, target: MoveTarget) {
  return db.transaction(async (tx) => {
    const [ep] = await tx
      .select({ id: endpoints.id, stableKey: endpoints.stableKey, moduleId: endpoints.moduleId })
      .from(endpoints)
      .where(and(eq(endpoints.id, endpointId), eq(endpoints.projectId, projectId)));
    if (!ep) throw new RegroupError(404, "NOT_FOUND", "Endpoint not found");

    let dest: { id: string; name: string } | undefined;
    if ("moduleId" in target) {
      [dest] = await tx
        .select({ id: modules.id, name: modules.name })
        .from(modules)
        .where(and(eq(modules.id, target.moduleId), eq(modules.projectId, projectId)));
      if (!dest) throw new RegroupError(404, "NOT_FOUND", "Target module not found");
    } else {
      const name = target.newModuleName.trim();
      if (!name) throw new RegroupError(400, "BAD_REQUEST", "Module name is required");
      [dest] = await tx
        .select({ id: modules.id, name: modules.name })
        .from(modules)
        .where(and(eq(modules.projectId, projectId), eq(modules.name, name)));
      if (!dest) {
        [dest] = await tx
          .insert(modules)
          .values({ projectId, name, via: "manual", status: "draft" })
          .returning({ id: modules.id, name: modules.name });
      }
    }
    const to = dest as { id: string; name: string };
    if (to.id === ep.moduleId) return { moduleId: to.id, changed: false };

    await tx
      .insert(moduleOverrides)
      .values({ projectId, stableKey: ep.stableKey, moduleName: to.name })
      .onConflictDoUpdate({
        target: [moduleOverrides.projectId, moduleOverrides.stableKey],
        set: { moduleName: to.name },
      });
    await tx.update(endpoints).set({ moduleId: to.id }).where(eq(endpoints.id, ep.id));

    const touched = [to.id, ...(ep.moduleId ? [ep.moduleId] : [])];
    await tx
      .update(modules)
      .set({ status: "needs_review" })
      .where(and(inArray(modules.id, touched), eq(modules.status, "approved")));
    return { moduleId: to.id, changed: true };
  });
}

/**
 * Rename a module. Its endpoints are pinned to the new name with overrides, so a re-import does not
 * bring the old auto-generated name back.
 */
export async function renameModule(projectId: string, moduleId: string, rawName: string) {
  const name = rawName.trim();
  if (!name) throw new RegroupError(400, "BAD_REQUEST", "Module name is required");
  try {
    return await db.transaction(async (tx) => {
      const [mod] = await tx
        .select()
        .from(modules)
        .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
      if (!mod) throw new RegroupError(404, "NOT_FOUND", "Module not found");
      if (mod.name === name) return mod;

      const [updated] = await tx
        .update(modules)
        .set({ name, via: "manual" })
        .where(eq(modules.id, moduleId))
        .returning();
      await tx
        .update(moduleOverrides)
        .set({ moduleName: name })
        .where(
          and(eq(moduleOverrides.projectId, projectId), eq(moduleOverrides.moduleName, mod.name)),
        );
      const members = await tx
        .select({ stableKey: endpoints.stableKey })
        .from(endpoints)
        .where(and(eq(endpoints.moduleId, moduleId), isNull(endpoints.removedAt)));
      for (const m of members) {
        await tx
          .insert(moduleOverrides)
          .values({ projectId, stableKey: m.stableKey, moduleName: name })
          .onConflictDoUpdate({
            target: [moduleOverrides.projectId, moduleOverrides.stableKey],
            set: { moduleName: name },
          });
      }
      return updated as typeof mod;
    });
  } catch (e) {
    if (isUnique(e))
      throw new RegroupError(409, "NAME_TAKEN", "A module with this name already exists");
    throw e;
  }
}

/** Delete a module only when it has no endpoints. */
export async function deleteEmptyModule(projectId: string, moduleId: string): Promise<void> {
  const [mod] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
  if (!mod) throw new RegroupError(404, "NOT_FOUND", "Module not found");
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(endpoints)
    .where(and(eq(endpoints.moduleId, moduleId), isNull(endpoints.removedAt)));
  if (n > 0) throw new RegroupError(409, "NOT_EMPTY", "Move or remove its endpoints first");
  await db.delete(modules).where(eq(modules.id, moduleId));
}
