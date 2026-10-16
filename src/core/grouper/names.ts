const STRIP_WORDS = new Set(["controller", "api", "service"]);
const SINGULAR_EXCEPTIONS = new Set(["news", "series", "species", "data", "metadata"]);

/** Split camelCase, PascalCase, snake_case and kebab-case into lowercase words. */
export function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

export function singularize(word: string): string {
  const w = word.toLowerCase();
  if (SINGULAR_EXCEPTIONS.has(w) || w.length < 4) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** "UsersController" -> "User", "order-items" -> "Order Item". Returns "" if nothing is left. */
export function normalizeModuleName(raw: string): string {
  const words = splitWords(raw);
  while (words.length > 1 && STRIP_WORDS.has(words[words.length - 1] as string)) words.pop();
  if (words.length === 1 && STRIP_WORDS.has(words[0] as string)) return "";
  if (words.length === 0) return "";
  words[words.length - 1] = singularize(words[words.length - 1] as string);
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
