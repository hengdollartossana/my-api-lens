import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  type AuthSummary,
  buildContextPack,
  estimateTokens,
  type PackEndpoint,
  type PackModule,
} from "@/core/pack";
import { listAuthRecipes } from "./auth-recipes";
import { db } from "./client";
import { listLatestDiffs } from "./diffs";
import { endpoints, modules, projects, runResults, runs } from "./schema";

/** SERVER ONLY: assemble the context pack of a project from stored endpoints, diffs and runs. */

export class PackError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = "PackError";
  }
}

export interface PackResult {
  markdown: string;
  tokens: number;
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

function authSummary(
  recipe: Awaited<ReturnType<typeof listAuthRecipes>>[number]["recipe"],
): AuthSummary {
  switch (recipe.type) {
    case "static_bearer":
      return { type: "static_bearer", headerName: recipe.headerName };
    case "api_key":
      return { type: "api_key", in: recipe.in, name: recipe.name };
    case "login_flow":
      return {
        type: "login_flow",
        loginPath: recipe.loginPath,
        method: recipe.method,
        tokenPath: recipe.tokenPath,
        headerName: recipe.headerName,
      };
    default:
      return { type: "none" };
  }
}

export async function buildProjectPack(
  projectId: string,
  moduleIds: string[],
  opts: { preferObserved?: boolean } = {},
): Promise<PackResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new PackError(404, "Project not found");
  const mods = moduleIds.length
    ? await db
        .select()
        .from(modules)
        .where(and(eq(modules.projectId, projectId), inArray(modules.id, moduleIds)))
    : [];
  if (mods.length !== new Set(moduleIds).size) throw new PackError(404, "Module not found");

  const eps = mods.length
    ? await db
        .select()
        .from(endpoints)
        .where(
          and(
            eq(endpoints.projectId, projectId),
            inArray(endpoints.moduleId, moduleIds),
            isNull(endpoints.removedAt),
          ),
        )
    : [];

  const notes = new Map<string, PackEndpoint["diffNotes"]>();
  for (const d of await listLatestDiffs(projectId)) {
    const items = d.items.filter((i) => i.severity !== "info");
    if (items.length)
      notes.set(
        d.endpointId,
        items.map(({ kind, path, message }) => ({ kind, path, message })),
      );
  }

  const observed = new Map<string, { status: number; body: unknown }>();
  if (opts.preferObserved && eps.length) {
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

  const packModules: PackModule[] = [...mods]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((m) => ({
      name: m.name,
      endpoints: eps
        .filter((e) => e.moduleId === m.id)
        .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
        .map((e) => ({
          method: e.method,
          path: e.path,
          summary: e.summary,
          operationId: e.operationId,
          parameters: (e.parameters as PackEndpoint["parameters"] | null) ?? [],
          requestBodySchema: e.requestBodySchema ?? null,
          responseSchemas: (e.responseSchemas as PackEndpoint["responseSchemas"] | null) ?? {},
          diffNotes: notes.get(e.id),
          observed: observed.get(e.id),
        })),
    }));

  const recipes = await listAuthRecipes(projectId);
  const recipe = recipes.find((r) => r.environmentId === null) ?? recipes[0];
  const raw = (project.specRaw ?? {}) as Record<string, unknown>;
  const schemes = ((raw.components as Record<string, unknown> | undefined)?.securitySchemes ??
    raw.securityDefinitions) as Record<string, Record<string, unknown>> | undefined;

  const markdown = buildContextPack(packModules, {
    title: `${project.name} API context`,
    auth: recipe ? authSummary(recipe.recipe) : undefined,
    securitySchemes: schemes,
    preferObserved: opts.preferObserved,
  });
  return {
    markdown,
    tokens: estimateTokens(markdown),
    unapproved: mods
      .filter((m) => m.status !== "approved")
      .map((m) => m.name)
      .sort(),
  };
}
