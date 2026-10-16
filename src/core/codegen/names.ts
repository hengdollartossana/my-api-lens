const DART_RESERVED = new Set([
  "abstract",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "covariant",
  "default",
  "deferred",
  "do",
  "dynamic",
  "else",
  "enum",
  "export",
  "extends",
  "extension",
  "external",
  "factory",
  "false",
  "final",
  "finally",
  "for",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "interface",
  "is",
  "late",
  "library",
  "mixin",
  "new",
  "null",
  "on",
  "operator",
  "part",
  "required",
  "rethrow",
  "return",
  "set",
  "show",
  "static",
  "super",
  "switch",
  "sync",
  "this",
  "throw",
  "true",
  "try",
  "typedef",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

export function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

export function pascalCase(input: string): string {
  const out = words(input).map(cap).join("");
  return /^[A-Za-z]/.test(out) ? out : `N${out}`;
}

export function camelCase(input: string): string {
  const [first = "", ...rest] = words(input);
  const out = first + rest.map(cap).join("");
  return /^[a-z]/.test(out) ? out : `n${out}`;
}

export function snakeCase(input: string): string {
  const out = words(input).join("_");
  return /^[a-z]/.test(out) ? out : `n_${out}`;
}

/** A valid Dart identifier for a field or parameter. */
export function safeIdent(name: string): string {
  return DART_RESERVED.has(name) ? `${name}Value` : name;
}

export function singular(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
}

/** Resource name from the path: last non-parameter, non-prefix segment, singular + PascalCase. */
export function resourceName(path: string): string {
  const seg = path
    .split("/")
    .filter((s) => s && !/^\{.*\}$/.test(s) && !/^(api|v\d+)$/i.test(s))
    .at(-1);
  return seg ? pascalCase(singular(seg)) : "Response";
}

/** Method name: the operationId after `Controller_`, else METHOD + path words. */
export function operationName(e: {
  method: string;
  path: string;
  operationId?: string | null;
}): string {
  if (e.operationId) {
    const tail = e.operationId.split(/[_.:]/).filter(Boolean).at(-1) ?? e.operationId;
    return safeIdent(camelCase(tail));
  }
  const segs = e.path
    .split("/")
    .filter((s) => s && !/^(api|v\d+)$/i.test(s))
    .map((s) => (/^\{.*\}$/.test(s) ? `by ${s.slice(1, -1)}` : s));
  return safeIdent(camelCase([e.method.toLowerCase(), ...segs].join(" ")));
}
