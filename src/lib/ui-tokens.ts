/** Class and label maps shared by the badge components (pure, so they can be unit tested). */

const base = "border";

export const METHOD_CLASSES: Record<string, string> = {
  GET: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  POST: "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
  PUT: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  PATCH: "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  DELETE: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
};
const NEUTRAL = "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300";

export function methodClass(method: string): string {
  return `${base} ${METHOD_CLASSES[method.toUpperCase()] ?? NEUTRAL}`;
}

export type StatusKey =
  | "draft"
  | "needs_review"
  | "approved"
  | "ok"
  | "info"
  | "warn"
  | "error"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "skipped";

const GREEN = "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300";
const AMBER = "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
const RED = "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300";
const BLUE = "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";

export const STATUS_STYLES: Record<StatusKey, { label: string; className: string }> = {
  draft: { label: "Draft", className: NEUTRAL },
  needs_review: { label: "Needs review", className: AMBER },
  approved: { label: "Approved", className: GREEN },
  ok: { label: "OK", className: GREEN },
  info: { label: "Info", className: BLUE },
  warn: { label: "Warning", className: AMBER },
  error: { label: "Error", className: RED },
  running: { label: "Running", className: BLUE },
  done: { label: "Done", className: GREEN },
  failed: { label: "Failed", className: RED },
  cancelled: { label: "Cancelled", className: NEUTRAL },
  skipped: { label: "Skipped", className: NEUTRAL },
};

export function statusStyle(status: string): { label: string; className: string } {
  const s = STATUS_STYLES[status as StatusKey] ?? { label: status, className: NEUTRAL };
  return { label: s.label, className: `${base} ${s.className}` };
}

export const VIA_LABELS = {
  tag: "tag",
  path: "path",
  operation_id: "operationId",
  auth: "auth",
  ai: "AI",
  manual: "manual",
  ungrouped: "ungrouped",
} as const;

export type ViaKey = keyof typeof VIA_LABELS;

export function viaLabel(via: string): string {
  return VIA_LABELS[via as ViaKey] ?? via;
}

/** Placeholder switcher data until real projects/environments exist (T-10, T-13). */
export const PLACEHOLDER_PROJECTS = [{ id: "demo", name: "Demo project" }];
export const PLACEHOLDER_ENVIRONMENTS = [
  { name: "local", isProd: false },
  { name: "staging", isProd: false },
  { name: "prod", isProd: true },
];

export const NAV_ITEMS = [
  { href: "/projects", label: "Projects", icon: "folder" },
  { href: "/runs", label: "Runs", icon: "play" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export const PROJECT_TABS = [
  { suffix: "", label: "Modules" },
  { suffix: "/diff", label: "Diff" },
  { suffix: "/pack", label: "Context pack" },
  { suffix: "/codegen", label: "Codegen" },
] as const;

/** Is `href` the current section of `pathname`? "/projects" matches "/projects/demo/diff". */
export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Project id from "/projects/<id>/...", or null. */
export function projectIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
}
