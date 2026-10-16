import { createHash } from "node:crypto";
import { canonicalJson } from "@/core/parser/canonical";
import type { ComparableEndpoint } from "@/core/parser/compare";

/**
 * Fingerprint of a module's contract: its live endpoints (by stable key) and the contract slice of
 * each. Summary/tag edits and endpoint order do not change it; any contract change or membership
 * change does.
 */
export function moduleContractHash(endpoints: ComparableEndpoint[]): string {
  const sorted = [...endpoints].sort((a, b) => a.stableKey.localeCompare(b.stableKey));
  const body = canonicalJson(
    sorted.map((e) => [
      e.stableKey,
      e.parameters ?? null,
      e.requestBodySchema ?? null,
      e.responseSchemas ?? null,
      e.security ?? null,
      e.isDestructive,
    ]),
  );
  return createHash("sha256").update(body).digest("hex");
}

export interface ApprovalCheck {
  /** Approval allowed without an override. */
  allowed: boolean;
  errorCount: number;
}

/** A module can be approved cleanly only when no endpoint's latest diff has `error` severity. */
export function checkApproval(diffs: { severity: string }[]): ApprovalCheck {
  const errorCount = diffs.filter((d) => d.severity === "error").length;
  return { allowed: errorCount === 0, errorCount };
}
