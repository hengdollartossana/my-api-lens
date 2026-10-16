import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { type CodegenEndpoint, type CodegenModule, generateFlutter } from "@/core/codegen";
import { db } from "./client";
import { endpoints, modules, projects, runResults, runs } from "./schema";

/** SERVER ONLY: generate client code for a project's modules. */

export class CodegenError extends Error {
  constructor(
    readonly status: 404,
    message: string,
  ) {
    super(message);
    this.name = "CodegenError";
  }
}

export interface CodegenInput {
  moduleIds: string[];
  /** Use real responses (nullability, extra fields) over the spec. */
  preferObserved?: boolean;
  contractTests?: boolean;
  packageName?: string;
}

export interface CodegenResult {
  files: { path: string; content: string }[];
  /** Selected modules that are not approved (the UI warns about these). */
  unapproved: string[];
}

function parseJson(text: string | null): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function generateProjectFlutter(
  projectId: string,
  input: CodegenInput,
): Promise<CodegenResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new CodegenError(404, "Project not found");
  const mods = input.moduleIds.length
    ? await db
        .select()
        .from(modules)
        .where(and(eq(modules.projectId, projectId), inArray(modules.id, input.moduleIds)))
    : [];
  if (mods.length !== new Set(input.moduleIds).size)
    throw new CodegenError(404, "Module not found");

  const eps = mods.length
    ? await db
        .select()
        .from(endpoints)
        .where(
          and(
            eq(endpoints.projectId, projectId),
            inArray(endpoints.moduleId, input.moduleIds),
            isNull(endpoints.removedAt),
          ),
        )
    : [];

  const observed = new Map<string, { status: number; body: unknown }>();
  if ((input.preferObserved || input.contractTests) && eps.length) {
    const latest = await db
      .selectDistinctOn([runResults.endpointId], {
        endpointId: runResults.endpointId,
        status: runResults.statusCode,
        body: runResults.responseBody,
      })
      .from(runResults)
      .innerJoin(runs, eq(runs.id, runResults.runId))
      .where(
        and(
          eq(runs.projectId, projectId),
          inArray(
            runResults.endpointId,
            eps.map((e) => e.id),
          ),
          isNotNull(runResults.statusCode),
          isNotNull(runResults.responseBody),
        ),
      )
      .orderBy(runResults.endpointId, desc(runResults.createdAt));
    for (const r of latest) {
      const body = parseJson(r.body);
      if (r.status !== null && body !== undefined)
        observed.set(r.endpointId, { status: r.status, body });
    }
  }

  const codegenModules: CodegenModule[] = [...mods]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      name: m.name,
      endpoints: eps
        .filter((e) => e.moduleId === m.id)
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
        .map(
          (e): CodegenEndpoint => ({
            method: e.method,
            path: e.path,
            summary: e.summary,
            operationId: e.operationId,
            parameters: (e.parameters as CodegenEndpoint["parameters"] | null) ?? [],
            requestBodySchema: e.requestBodySchema ?? null,
            responseSchemas: (e.responseSchemas as CodegenEndpoint["responseSchemas"] | null) ?? {},
            observed: observed.get(e.id),
          }),
        ),
    }));

  return {
    files: generateFlutter(codegenModules, {
      preferObserved: input.preferObserved,
      contractTests: input.contractTests,
      packageName: input.packageName,
    }),
    unapproved: mods
      .filter((m) => m.status !== "approved")
      .map((m) => m.name)
      .sort(),
  };
}
