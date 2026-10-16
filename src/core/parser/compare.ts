import { canonicalJson } from "./canonical";

/** The contract-relevant slice of an endpoint (what a client would depend on). */
export interface ComparableEndpoint {
  stableKey: string;
  parameters: unknown;
  requestBodySchema: unknown;
  responseSchemas: unknown;
  security: unknown;
  isDestructive: boolean;
}

export type ContractPart = "parameters" | "requestBody" | "responses" | "security" | "destructive";

const norm = (v: unknown) => canonicalJson(v ?? null);

function parts(e: ComparableEndpoint): Record<ContractPart, string> {
  return {
    parameters: norm(e.parameters),
    requestBody: norm(e.requestBodySchema),
    responses: norm(e.responseSchemas),
    security: norm(e.security),
    destructive: String(e.isDestructive),
  };
}

/** Which parts of the contract differ between two versions of the same endpoint. */
export function changedParts(a: ComparableEndpoint, b: ComparableEndpoint): ContractPart[] {
  const pa = parts(a);
  const pb = parts(b);
  return (Object.keys(pa) as ContractPart[]).filter((k) => pa[k] !== pb[k]);
}

export interface ChangedEndpoint {
  stableKey: string;
  parts: ContractPart[];
}

/** Compare two endpoint lists by stable key. Summary and tag edits are not contract changes. */
export function compareEndpoints(current: ComparableEndpoint[], next: ComparableEndpoint[]) {
  const before = new Map(current.map((e) => [e.stableKey, e]));
  const after = new Map(next.map((e) => [e.stableKey, e]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ChangedEndpoint[] = [];
  const unchanged: string[] = [];

  for (const [key, n] of after) {
    const c = before.get(key);
    if (!c) added.push(key);
    else {
      const diff = changedParts(c, n);
      if (diff.length) changed.push({ stableKey: key, parts: diff });
      else unchanged.push(key);
    }
  }
  for (const key of before.keys()) if (!after.has(key)) removed.push(key);
  return { added, removed, changed, unchanged };
}
