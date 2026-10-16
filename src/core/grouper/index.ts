import { normalizeModuleName, splitWords } from "./names";

export { normalizeModuleName, singularize, splitWords } from "./names";

export type ModuleVia = "tag" | "path" | "operation_id" | "auth" | "ai" | "manual" | "ungrouped";

/** The slice of a parsed endpoint the grouper needs. */
export interface GroupableEndpoint {
  stableKey: string;
  path: string;
  operationId: string | null;
  tags: string[];
  security: unknown[];
}

export interface GroupOptions {
  /** stableKey -> module name chosen by the user; survives re-import. */
  overrides?: Record<string, string>;
}

export interface Assignment {
  stableKey: string;
  moduleName: string;
  via: ModuleVia;
}

export interface GroupedModule {
  name: string;
  via: ModuleVia;
  stableKeys: string[];
}

export interface GroupResult {
  assignments: Assignment[];
  modules: GroupedModule[];
}

export const UNGROUPED = "Ungrouped";
export const AUTH_MODULE = "Auth";

const IGNORED_TAGS = new Set(["default", "api"]);
const AUTH_WORDS = new Set(["login", "register", "token", "refresh", "otp", "password", "me"]);
/** Lower index = higher priority. */
const VIA_PRIORITY: ModuleVia[] = [
  "manual",
  "tag",
  "path",
  "operation_id",
  "auth",
  "ai",
  "ungrouped",
];

const isPathNoise = (seg: string) =>
  /^api$/i.test(seg) || /^v\d+$/i.test(seg) || /^\{.*\}$/.test(seg);

/** Path segments left after stripping leading /api, /v1 and {param} segments. */
function meaningfulSegments(path: string): string[] {
  const segs = path.split("/").filter(Boolean);
  let i = 0;
  while (i < segs.length && isPathNoise(segs[i] as string)) i++;
  return segs.slice(i);
}

function fromTag(e: GroupableEndpoint): string | null {
  for (const tag of e.tags) {
    if (IGNORED_TAGS.has(tag.trim().toLowerCase())) continue;
    const name = normalizeModuleName(tag);
    if (name) return name;
  }
  return null;
}

function fromPath(e: GroupableEndpoint): string | null {
  // Nested resources stay with their parent: only the first segment counts.
  const first = meaningfulSegments(e.path)[0];
  if (!first || AUTH_WORDS.has(first.toLowerCase())) return null;
  return normalizeModuleName(first) || null;
}

function fromOperationId(e: GroupableEndpoint): string | null {
  if (!e.operationId) return null;
  const parts = e.operationId.split(/[_.:]/).filter(Boolean);
  if (parts.length < 2) return null; // "getUserById" has no resource prefix
  return normalizeModuleName(parts[0] as string) || null;
}

function isAuthLike(e: GroupableEndpoint): boolean {
  const last = meaningfulSegments(e.path).at(-1) ?? "";
  const words = [...splitWords(last), ...splitWords(e.operationId ?? "")];
  return words.some((w) => AUTH_WORDS.has(w)) || e.security.length === 0;
}

function assign(e: GroupableEndpoint, overrides: Record<string, string>): Assignment {
  const manual = overrides[e.stableKey]?.trim();
  if (manual) return { stableKey: e.stableKey, moduleName: manual, via: "manual" };

  const tag = fromTag(e);
  if (tag) return { stableKey: e.stableKey, moduleName: tag, via: "tag" };

  const path = fromPath(e);
  if (path) return { stableKey: e.stableKey, moduleName: path, via: "path" };

  const opId = fromOperationId(e);
  if (opId) return { stableKey: e.stableKey, moduleName: opId, via: "operation_id" };

  if (isAuthLike(e)) return { stableKey: e.stableKey, moduleName: AUTH_MODULE, via: "auth" };

  return { stableKey: e.stableKey, moduleName: UNGROUPED, via: "ungrouped" };
}

/** Assigns every endpoint to exactly one module. */
export function groupEndpoints(
  endpoints: GroupableEndpoint[],
  options: GroupOptions = {},
): GroupResult {
  const overrides = options.overrides ?? {};
  const assignments = endpoints.map((e) => assign(e, overrides));

  const byName = new Map<string, GroupedModule>();
  for (const a of assignments) {
    const m = byName.get(a.moduleName);
    if (!m) {
      byName.set(a.moduleName, { name: a.moduleName, via: a.via, stableKeys: [a.stableKey] });
      continue;
    }
    m.stableKeys.push(a.stableKey);
    if (VIA_PRIORITY.indexOf(a.via) < VIA_PRIORITY.indexOf(m.via)) m.via = a.via;
  }
  return { assignments, modules: [...byName.values()] };
}
