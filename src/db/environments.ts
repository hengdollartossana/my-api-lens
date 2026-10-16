import { and, asc, eq } from "drizzle-orm";
import { serversOf } from "@/core/parser";
import type { EnvironmentInput } from "@/lib/environment-schema";
import { db } from "./client";
import { environments, projects } from "./schema";

/** SERVER ONLY: environment storage. */

export interface EnvironmentOption {
  id: string;
  name: string;
  baseUrl: string;
  isProd: boolean;
}

export interface EnvironmentRecord extends EnvironmentOption {
  projectId: string;
  defaultHeaders: Record<string, string>;
}

export class EnvironmentNameTakenError extends Error {}

const columns = {
  id: environments.id,
  projectId: environments.projectId,
  name: environments.name,
  baseUrl: environments.baseUrl,
  isProd: environments.isProd,
  defaultHeaders: environments.defaultHeaders,
};

/** Environments of a project, non-prod first. */
export async function listEnvironments(projectId: string): Promise<EnvironmentRecord[]> {
  return db
    .select(columns)
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(asc(environments.isProd), asc(environments.name));
}

/** Absolute http(s) server URLs from the imported spec, to prefill the form. */
export async function serverSuggestions(projectId: string): Promise<string[]> {
  const [row] = await db
    .select({ raw: projects.specRaw })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!row?.raw || typeof row.raw !== "object") return [];
  const urls = serversOf(row.raw as Record<string, unknown>).filter((u) =>
    /^https?:\/\/[^/{]+/i.test(u),
  );
  return [...new Set(urls.map((u) => u.replace(/\/+$/, "")))];
}

const isUniqueViolation = (e: unknown) =>
  typeof e === "object" &&
  e !== null &&
  ((e as { code?: string }).code === "23505" ||
    (e as { cause?: { code?: string } }).cause?.code === "23505");

export async function createEnvironment(
  projectId: string,
  input: EnvironmentInput,
): Promise<EnvironmentRecord> {
  try {
    const [row] = await db
      .insert(environments)
      .values({ projectId, ...input })
      .returning(columns);
    return row as EnvironmentRecord;
  } catch (e) {
    if (isUniqueViolation(e)) throw new EnvironmentNameTakenError(input.name);
    throw e;
  }
}

export async function updateEnvironment(
  projectId: string,
  id: string,
  patch: Partial<EnvironmentInput>,
): Promise<EnvironmentRecord | null> {
  if (Object.keys(patch).length === 0) {
    const [row] = await db
      .select(columns)
      .from(environments)
      .where(and(eq(environments.id, id), eq(environments.projectId, projectId)));
    return row ?? null;
  }
  try {
    const [row] = await db
      .update(environments)
      .set(patch)
      .where(and(eq(environments.id, id), eq(environments.projectId, projectId)))
      .returning(columns);
    return row ?? null;
  } catch (e) {
    if (isUniqueViolation(e)) throw new EnvironmentNameTakenError(patch.name ?? "");
    throw e;
  }
}

/** Deleting an environment also deletes the runs made against it (FK cascade). */
export async function deleteEnvironment(projectId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(environments)
    .where(and(eq(environments.id, id), eq(environments.projectId, projectId)))
    .returning({ id: environments.id });
  return rows.length > 0;
}
