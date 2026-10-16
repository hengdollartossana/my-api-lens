import { pascal, singular, TypeRegistry } from "./render";
import { type Shape, schemaToShape, valueToShape } from "./shape";
import type { AuthSummary, PackEndpoint, PackModule, PackOptions, PackParameter } from "./types";

export * from "./types";

/** Rough token count (chars / 4), good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const hasBody = (s: unknown) => s !== null && s !== undefined;

/** Resource name from the path: last non-parameter, non-prefix segment, singular + PascalCase. */
function resourceName(path: string): string {
  const seg = path
    .split("/")
    .filter((s) => s && !/^\{.*\}$/.test(s) && !/^(api|v\d+)$/i.test(s))
    .at(-1);
  return seg ? pascal(singular(seg)) : "Response";
}

const VERB: Record<string, string> = { POST: "Create", PUT: "Update", PATCH: "Patch" };
const bodyHint = (e: PackEndpoint, resource: string) =>
  `${VERB[e.method.toUpperCase()] ?? ""}${resource}Body`;

function statusKeys(e: PackEndpoint): string[] {
  return Object.keys(e.responseSchemas).sort();
}

const isSuccess = (s: string) => /^2/.test(s);

/** The shape used for the 2xx response: observed reality (if asked for and present) or the spec. */
function successShape(e: PackEndpoint, opts: PackOptions): { status: string; shape: Shape } | null {
  if (opts.preferObserved && e.observed && e.observed.status < 300 && hasBody(e.observed.body)) {
    return { status: String(e.observed.status), shape: valueToShape(e.observed.body) };
  }
  const status = statusKeys(e).find((s) => isSuccess(s) && hasBody(e.responseSchemas[s]));
  return status ? { status, shape: schemaToShape(e.responseSchemas[status]) } : null;
}

function authLine(opts: PackOptions, modules: PackModule[]): string {
  const a: AuthSummary | undefined = opts.auth ?? inferAuth(opts, modules);
  if (!a || a.type === "none") return "Auth: none";
  switch (a.type) {
    case "static_bearer":
      return `Auth: Bearer token in \`${a.headerName ?? "Authorization"}\` header`;
    case "api_key":
      return `Auth: API key in ${a.in} \`${a.name}\``;
    case "login_flow":
      return `Auth: Bearer token from \`${a.method ?? "POST"} ${a.loginPath}\` (response \`${a.tokenPath}\`), sent in \`${a.headerName ?? "Authorization"}\` header`;
  }
}

function inferAuth(opts: PackOptions, modules: PackModule[]): AuthSummary | undefined {
  const schemes = Object.values(opts.securitySchemes ?? {});
  if (schemes.length === 0) return modules.length ? undefined : { type: "none" };
  const s = schemes[0] as Record<string, unknown>;
  if (s.type === "http" && String(s.scheme).toLowerCase() === "bearer")
    return { type: "static_bearer" };
  if (s.type === "apiKey")
    return { type: "api_key", in: s.in === "query" ? "query" : "header", name: String(s.name) };
  return undefined;
}

function paramList(params: PackParameter[], reg: TypeRegistry): string {
  const groups: Record<string, string[]> = {};
  for (const p of params) {
    const type = reg.render(schemaToShape(p.schema), p.name);
    (groups[p.in] ??= []).push(
      `${p.name}${p.required && p.in !== "path" ? "" : p.in === "path" ? "" : "?"}: ${type}`,
    );
  }
  return Object.entries(groups)
    .map(([where, items]) => `${where}: ${items.join(", ")}`)
    .join("; ");
}

function signature(e: PackEndpoint, reg: TypeRegistry, opts: PackOptions): string {
  const resource = resourceName(e.path);
  const parts: string[] = [];
  const params = paramList(e.parameters, reg);
  if (params) parts.push(params);
  if (hasBody(e.requestBodySchema)) {
    parts.push(
      `body: ${reg.render(schemaToShape(e.requestBodySchema), bodyHint(e, resource), true)}`,
    );
  }

  const success = successShape(e, opts);
  const responses: string[] = [];
  for (const status of statusKeys(e)) {
    if (success && status === success.status) {
      responses.push(`${status} ${reg.render(success.shape, resource, true)}`);
    } else {
      responses.push(status);
    }
  }
  if (
    success &&
    !responses.some((r) => r.startsWith(`${success.status} `)) &&
    !statusKeys(e).includes(success.status)
  ) {
    responses.unshift(`${success.status} ${reg.render(success.shape, resource, true)}`);
  }

  const summary = e.summary ? ` — ${e.summary.trim().replace(/\.$/, "")}` : "";
  const args = parts.length ? ` (${parts.join("; ")})` : "";
  const out = responses.length ? ` → ${responses.join(" | ")}` : "";
  return `- \`${e.method.toUpperCase()} ${e.path}\`${summary}${args}${out}`;
}

/**
 * Build a compact Markdown context pack for the given modules: base URL placeholder, auth summary,
 * deduplicated TypeScript interfaces, one-line endpoint signatures and known diff notes.
 */
export function buildContextPack(modules: PackModule[], options: PackOptions = {}): string {
  const reg = new TypeRegistry();

  // Pass 1: count object shapes across everything so repeated ones are hoisted and well named.
  for (const m of modules) {
    for (const e of m.endpoints) {
      const resource = resourceName(e.path);
      if (hasBody(e.requestBodySchema))
        reg.count(schemaToShape(e.requestBodySchema), bodyHint(e, resource));
      for (const p of e.parameters) reg.count(schemaToShape(p.schema), p.name);
      const s = successShape(e, options);
      if (s) reg.count(s.shape, resource);
    }
  }

  // Pass 2: render signatures (this registers the interfaces they need).
  const sections = modules.map((m) => {
    const lines = m.endpoints.map((e) => signature(e, reg, options));
    return `## ${m.name}\n${lines.join("\n")}`;
  });

  const notes = modules.flatMap((m) =>
    m.endpoints.flatMap((e) =>
      (e.diffNotes ?? []).map(
        (n) => `- \`${e.method.toUpperCase()} ${e.path}\` ${n.path}: ${n.message}`,
      ),
    ),
  );

  const interfaces = reg.interfaces();
  const out = [
    `# ${options.title ?? "API context"}`,
    `Base URL: \`${options.baseUrlPlaceholder ?? "{{BASE_URL}}"}\``,
    authLine(options, modules),
  ];
  if (interfaces.length) out.push(`## Types\n\`\`\`ts\n${interfaces.join("\n\n")}\n\`\`\``);
  out.push(...sections);
  if (notes.length) out.push(`## Known diffs\n${notes.join("\n")}`);
  return `${out.join("\n\n")}\n`;
}
