/** Layout helpers that mimic `dart format` (tall style, 80 columns) so generated code is already formatted. */

export const WIDTH = 80;

export const indent = (n: number) => "  ".repeat(n);

export type CallItem = string | { single: string; multi: string };

/**
 * `head(item, item)tail` on one line when it fits, else one item per line with trailing commas:
 *   head(
 *     item,
 *     item,
 *   )tail
 * An item may offer a `multi` form that is used when its `single` form would overflow its line.
 */
export function call(head: string, items: CallItem[], tail: string, level: number): string {
  if (items.length === 0) return `${indent(level)}${head}()${tail}`;
  const text = (i: CallItem, form: "single" | "multi") => (typeof i === "string" ? i : i[form]);
  const single = `${indent(level)}${head}(${items.map((i) => text(i, "single")).join(", ")})${tail}`;
  if (single.length <= WIDTH) return single;
  const lines = items.map((i) => {
    const one = `${indent(level + 1)}${text(i, "single")},`;
    const chosen = one.length <= WIDTH ? text(i, "single") : text(i, "multi");
    return `${chosen
      .split("\n")
      .map((l) => `${indent(level + 1)}${l}`)
      .join("\n")},`;
  });
  return `${indent(level)}${head}(\n${lines.join("\n")}\n${indent(level)})${tail}`;
}

/** A parameter list with named parameters: `({required String a, int? b})` or split one per line. */
export function namedParams(head: string, params: string[], tail: string, level: number): string {
  if (params.length === 0) return `${indent(level)}${head}()${tail}`;
  const single = `${indent(level)}${head}({${params.join(", ")}})${tail}`;
  if (single.length <= WIDTH) return single;
  const lines = params.map((p) => `${indent(level + 1)}${p},`).join("\n");
  return `${indent(level)}${head}({\n${lines}\n${indent(level)}})${tail}`;
}

/** Escape text for a single-quoted Dart string. */
export function dartString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`;
}
