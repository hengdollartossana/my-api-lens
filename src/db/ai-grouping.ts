import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  type AiUsage,
  buildGroupingRequest,
  type GroupingProposal,
  MAX_GROUPING_ENDPOINTS,
  type MessagesClient,
  parseGroupingResponse,
} from "@/core/ai";
import { normalizeModuleName, UNGROUPED } from "@/core/grouper";
import { runAi } from "./ai";
import { db } from "./client";
import { moveEndpoint, RegroupError } from "./modules";
import { endpoints, modules } from "./schema";

/**
 * SERVER ONLY: AI suggestions for endpoints left in `Ungrouped`. Only one-liners (method, path,
 * summary) are sent. Proposals are returned for the user to approve; nothing is written until
 * `applyGrouping` is called with the approved subset.
 */

export interface GroupingSuggestion {
  stableKey: string;
  endpointId: string;
  method: string;
  path: string;
  module: string;
  /** True when no module of that name exists yet (applying creates it). */
  isNew: boolean;
}

export interface GroupingProposalResult {
  suggestions: GroupingSuggestion[];
  /** Endpoints sent to the model. */
  sent: number;
  /** Ungrouped endpoints beyond the per-call limit, left for a later round. */
  remaining: number;
  model: string | null;
  usage: AiUsage | null;
  costUsd: number;
}

export async function proposeGrouping(
  projectId: string,
  client?: MessagesClient,
): Promise<GroupingProposalResult> {
  const [ungrouped] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.projectId, projectId), eq(modules.name, UNGROUPED)));
  const empty: GroupingProposalResult = {
    suggestions: [],
    sent: 0,
    remaining: 0,
    model: null,
    usage: null,
    costUsd: 0,
  };
  if (!ungrouped) return empty;

  const all = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.moduleId, ungrouped.id), isNull(endpoints.removedAt)))
    .orderBy(asc(endpoints.path), asc(endpoints.method));
  if (all.length === 0) return empty;
  const batch = all.slice(0, MAX_GROUPING_ENDPOINTS);

  const existing = await db
    .select({ name: modules.name })
    .from(modules)
    .where(and(eq(modules.projectId, projectId), ne(modules.id, ungrouped.id)));
  const names = new Set(existing.map((m) => m.name));

  const result = await runAi(
    "grouping",
    buildGroupingRequest(
      batch.map((e) => ({
        stableKey: e.stableKey,
        method: e.method,
        path: e.path,
        summary: e.summary,
      })),
      [...names].sort(),
    ),
    client,
  );
  const byKey = new Map(batch.map((e) => [e.stableKey, e]));
  const proposals = parseGroupingResponse(
    result.text,
    batch.map((e) => ({
      stableKey: e.stableKey,
      method: e.method,
      path: e.path,
      summary: e.summary,
    })),
  );
  return {
    suggestions: proposals.map((p) => {
      const e = byKey.get(p.stableKey) as (typeof batch)[number];
      return {
        stableKey: p.stableKey,
        endpointId: e.id,
        method: e.method,
        path: e.path,
        module: p.module,
        isNew: !names.has(p.module),
      };
    }),
    sent: batch.length,
    remaining: all.length - batch.length,
    model: result.model,
    usage: result.usage,
    costUsd: result.costUsd,
  };
}

/**
 * Apply the proposals the user approved. Each move is stored as a module override (so it survives
 * re-import); new modules are created with `via = ai`.
 */
export async function applyGrouping(
  projectId: string,
  assignments: GroupingProposal[],
): Promise<{ applied: number; createdModules: string[] }> {
  const clean = new Map<string, string>();
  for (const a of assignments) {
    const name = normalizeModuleName(a.module.trim());
    if (!name || name === UNGROUPED || name.length > 80)
      throw new RegroupError(400, "BAD_REQUEST", `Invalid module name: ${a.module}`);
    clean.set(a.stableKey, name);
  }
  if (clean.size === 0) return { applied: 0, createdModules: [] };

  const eps = await db
    .select({ id: endpoints.id, stableKey: endpoints.stableKey })
    .from(endpoints)
    .where(
      and(
        eq(endpoints.projectId, projectId),
        isNull(endpoints.removedAt),
        inArray(endpoints.stableKey, [...clean.keys()]),
      ),
    );
  if (eps.length !== clean.size) throw new RegroupError(404, "NOT_FOUND", "Endpoint not found");

  const have = new Map(
    (await db.select().from(modules).where(eq(modules.projectId, projectId))).map((m) => [
      m.name,
      m.id,
    ]),
  );
  const createdModules: string[] = [];
  for (const name of new Set(clean.values())) {
    if (have.has(name)) continue;
    const [m] = await db
      .insert(modules)
      .values({ projectId, name, via: "ai", status: "draft" })
      .returning({ id: modules.id });
    have.set(name, (m as { id: string }).id);
    createdModules.push(name);
  }

  let applied = 0;
  for (const e of eps) {
    const dest = have.get(clean.get(e.stableKey) as string) as string;
    const r = await moveEndpoint(projectId, e.id, { moduleId: dest });
    if (r.changed) applied++;
  }
  return { applied, createdModules: createdModules.sort() };
}
