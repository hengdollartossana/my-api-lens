import type { Shape } from "./shape";

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (s: Shape) => JSON.stringify(s);

export function pascal(input: string): string {
  const words = input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const out = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return /^[A-Za-z]/.test(out) ? out : `T${out}`;
}

export function singular(word: string): string {
  if (/ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|us|is)$/i.test(word)) return word;
  if (/(ses|xes|zes|ches|shes)$/i.test(word)) return word.slice(0, -2);
  return word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word;
}

/**
 * Collects object shapes, names them, and renders TypeScript. Identical shapes share one
 * interface; nested objects become their own interface only when they appear more than once.
 */
export class TypeRegistry {
  private counts = new Map<string, number>();
  private hints = new Map<string, Map<string, number>>();
  private names = new Map<string, string>();
  private taken = new Set<string>();
  private decls: { name: string; shape: Extract<Shape, { k: "obj" }> }[] = [];

  /** First pass: count every object shape (and the names it is reached by) so shared ones are hoisted. */
  count(shape: Shape, hint: string): void {
    switch (shape.k) {
      case "obj": {
        const k = key(shape);
        this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
        const h = this.hints.get(k) ?? new Map<string, number>();
        h.set(hint, (h.get(hint) ?? 0) + 1);
        this.hints.set(k, h);
        for (const p of shape.props) this.count(p.type, singular(pascal(p.name)) || hint);
        break;
      }
      case "arr":
        this.count(shape.item, hint);
        break;
      case "rec":
        this.count(shape.value, hint);
        break;
      case "union":
        for (const t of shape.types) this.count(t, hint);
        break;
    }
  }

  /** Most frequent name this shape was reached by (first one wins ties). */
  private bestHint(shape: Extract<Shape, { k: "obj" }>, fallback: string): string {
    const h = this.hints.get(key(shape));
    if (!h) return fallback;
    let best = fallback;
    let bestN = 0;
    for (const [name, n] of h) {
      if (n > bestN) {
        best = name;
        bestN = n;
      }
    }
    return best;
  }

  private nameFor(shape: Extract<Shape, { k: "obj" }>, hint: string): string {
    const k = key(shape);
    const existing = this.names.get(k);
    if (existing) return existing;
    const base = pascal(shape.title ?? this.bestHint(shape, hint)) || "Item";
    let name = base;
    for (let i = 2; this.taken.has(name); i++) name = `${base}${i}`;
    this.taken.add(name);
    this.names.set(k, name);
    // Reserve the slot first so recursive/nested names stay stable, then fill in order.
    const slot = { name, shape };
    this.decls.push(slot);
    return name;
  }

  /** Render a shape; `top` forces a named interface for objects (response and body roots). */
  render(shape: Shape, hint: string, top = false): string {
    switch (shape.k) {
      case "prim":
        return shape.t;
      case "lit":
        return shape.values.map((v) => JSON.stringify(v)).join(" | ") || "never";
      case "arr": {
        const inner = this.render(shape.item, hint, top);
        return /[|&]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
      }
      case "rec":
        return `Record<string, ${this.render(shape.value, hint)}>`;
      case "union":
        return shape.types.map((t) => this.render(t, hint, top)).join(" | ");
      case "obj": {
        const hoist = top || (this.counts.get(key(shape)) ?? 0) > 1 || shape.title !== undefined;
        if (hoist) return this.nameFor(shape, hint);
        return `{ ${this.fields(shape, hint).join("; ")} }`;
      }
    }
  }

  private fields(shape: Extract<Shape, { k: "obj" }>, hint: string): string[] {
    return shape.props.map((p) => {
      const name = IDENT.test(p.name) ? p.name : JSON.stringify(p.name);
      return `${name}${p.optional ? "?" : ""}: ${this.render(p.type, singular(pascal(p.name)) || hint)}`;
    });
  }

  /** All hoisted interfaces, rendered. Rendering a body can register more, so loop until stable. */
  interfaces(): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.decls.length; i++) {
      const d = this.decls[i] as (typeof this.decls)[number];
      const body = this.fields(d.shape, d.name).map((f) => `  ${f};`);
      out.push(`interface ${d.name} {\n${body.join("\n")}\n}`);
    }
    return out;
  }
}
