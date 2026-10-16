import { and, eq, isNull } from "drizzle-orm";
import { checkApproval, moduleContractHash } from "@/core/approval";
import { db } from "./client";
import { listLatestDiffs } from "./diffs";
import { endpoints, modules } from "./schema";

/** SERVER ONLY: approve / revoke a module. */

export class ApprovalError extends Error {
  constructor(
    readonly status: 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

async function loadModule(projectId: string, moduleId: string) {
  const [mod] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.projectId, projectId)));
  if (!mod) throw new ApprovalError(404, "NOT_FOUND", "Module not found");
  return mod;
}

/**
 * Approve a module and store the hash of its current contract. Blocked while any of its endpoints
 * has an `error` diff, unless `knownIssues` ("approve with known issues") is set.
 */
export async function approveModule(
  projectId: string,
  moduleId: string,
  opts: { knownIssues?: boolean } = {},
) {
  const mod = await loadModule(projectId, moduleId);
  const eps = await db
    .select()
    .from(endpoints)
    .where(and(eq(endpoints.moduleId, moduleId), isNull(endpoints.removedAt)));
  if (!eps.length)
    throw new ApprovalError(409, "EMPTY_MODULE", "A module with no endpoints cannot be approved");

  const diffs = (await listLatestDiffs(projectId)).filter((d) => d.moduleId === moduleId);
  const check = checkApproval(diffs.flatMap((d) => d.items));
  if (!check.allowed && !opts.knownIssues) {
    throw new ApprovalError(
      409,
      "HAS_ERRORS",
      `${check.errorCount} error${check.errorCount === 1 ? "" : "s"} against the spec; fix them or approve with known issues`,
    );
  }

  const [updated] = await db
    .update(modules)
    .set({ status: "approved", approvedAt: new Date(), approvedHash: moduleContractHash(eps) })
    .where(eq(modules.id, mod.id))
    .returning();
  return { module: updated as typeof mod, errorCount: check.errorCount };
}

/** Revoke an approval: back to draft, hash cleared. */
export async function revokeModule(projectId: string, moduleId: string) {
  const mod = await loadModule(projectId, moduleId);
  const [updated] = await db
    .update(modules)
    .set({ status: "draft", approvedAt: null, approvedHash: null })
    .where(eq(modules.id, mod.id))
    .returning();
  return updated as typeof mod;
}
