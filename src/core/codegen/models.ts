import { type Shape, schemaToShape, valueToShape } from "../pack/shape";
import { camelCase, pascalCase, safeIdent, singular, snakeCase } from "./names";

export interface DartField {
  /** Dart identifier (camelCase). */
  name: string;
  /** Key in the JSON payload. */
  jsonName: string;
  /** Dart type including a trailing `?` when nullable. */
  type: string;
  required: boolean;
}

export interface DartModel {
  name: string;
  /** snake_case file name without extension, e.g. `user`. */
  file: string;
  fields: DartField[];
  /** Other model classes this one references. */
  refs: string[];
}

export interface ResolvedType {
  /** Dart type without `?`. */
  type: string;
  nullable: boolean;
  refs: string[];
}

type Obj = Extract<Shape, { k: "obj" }>;
const key = (s: Shape) => JSON.stringify(s);
const nullShape: Shape = { k: "prim", t: "null" };

export const specShape = (schema: unknown) => schemaToShape(schema, 0, { precise: true });
export const observedShape = (value: unknown) => valueToShape(value, 0, { precise: true });

const plainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function matches(shape: Shape, value: unknown): boolean {
  switch (shape.k) {
    case "obj":
      return plainObject(value);
    case "arr":
      return Array.isArray(value);
    case "prim":
      return (
        (shape.t === "string" && typeof value === "string") ||
        (shape.t === "number" && typeof value === "number") ||
        (shape.t === "boolean" && typeof value === "boolean")
      );
    default:
      return true;
  }
}

/**
 * Adjust a spec shape to what an API really returned: null values make a field nullable, fields
 * missing from the response become optional, extra fields are added (optional), and a value of a
 * different type replaces the documented one.
 */
export function reconcile(spec: Shape, value: unknown): Shape {
  if (value === null) {
    const hasNull =
      spec.k === "prim"
        ? spec.t === "null"
        : spec.k === "union" && spec.types.some((t) => t.k === "prim" && t.t === "null");
    return hasNull ? spec : { k: "union", types: [spec, nullShape] };
  }
  if (spec.k === "union") return spec; // ambiguous: keep the documented union
  if (!matches(spec, value)) return observedShape(value);

  if (spec.k === "obj" && plainObject(value)) {
    const props = spec.props.map((p) =>
      p.name in value ? { ...p, type: reconcile(p.type, value[p.name]) } : { ...p, optional: true },
    );
    const known = new Set(spec.props.map((p) => p.name));
    for (const [name, v] of Object.entries(value)) {
      if (!known.has(name)) props.push({ name, optional: true, type: observedShape(v) });
    }
    return { ...spec, props };
  }
  if (spec.k === "arr" && Array.isArray(value)) {
    return { ...spec, item: value.reduce<Shape>((item, el) => reconcile(item, el), spec.item) };
  }
  return spec;
}

/**
 * Turns shapes into Dart types and collects the model classes they need.
 * Identical object shapes share one class; names come from `title` or the most common name the
 * shape is reached by (resource from the path, field name).
 */
export class ModelRegistry {
  private counts = new Map<string, number>();
  private hints = new Map<string, Map<string, number>>();
  private names = new Map<string, string>();
  private taken = new Set<string>();
  private pending: { name: string; shape: Obj }[] = [];
  private done = new Map<string, DartModel>();

  /** Pass 1: record how often each object shape occurs and under which names. */
  count(shape: Shape, hint: string): void {
    switch (shape.k) {
      case "obj": {
        const k = key(shape);
        this.counts.set(k, (this.counts.get(k) ?? 0) + 1);
        const h = this.hints.get(k) ?? new Map<string, number>();
        h.set(hint, (h.get(hint) ?? 0) + 1);
        this.hints.set(k, h);
        for (const p of shape.props) this.count(p.type, pascalCase(singular(p.name)) || hint);
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

  private nameFor(shape: Obj, hint: string): string {
    const k = key(shape);
    const existing = this.names.get(k);
    if (existing) return existing;
    let best = hint;
    let bestN = 0;
    for (const [name, n] of this.hints.get(k) ?? []) {
      if (n > bestN) {
        best = name;
        bestN = n;
      }
    }
    const base = pascalCase(shape.title ?? best) || "Item";
    let name = base;
    for (let i = 2; this.taken.has(name); i++) name = `${base}${i}`;
    this.taken.add(name);
    this.names.set(k, name);
    this.pending.push({ name, shape });
    return name;
  }

  /** Resolve a shape to a Dart type, registering any model classes it needs. */
  resolve(shape: Shape, hint: string): ResolvedType {
    switch (shape.k) {
      case "prim":
        return this.prim(shape);
      case "lit": {
        const vals = shape.values.filter((v) => v !== null);
        const nullable = vals.length !== shape.values.length;
        const kinds = new Set(vals.map((v) => typeof v));
        const type =
          kinds.size !== 1
            ? "dynamic"
            : kinds.has("string")
              ? "String"
              : kinds.has("boolean")
                ? "bool"
                : vals.every((v) => Number.isInteger(v))
                  ? "int"
                  : "double";
        return { type, nullable, refs: [] };
      }
      case "arr": {
        const inner = this.resolve(shape.item, hint);
        return { type: `List<${this.withNull(inner)}>`, nullable: false, refs: inner.refs };
      }
      case "rec": {
        const inner = this.resolve(shape.value, hint);
        return { type: `Map<String, ${this.withNull(inner)}>`, nullable: false, refs: inner.refs };
      }
      case "obj": {
        const name = this.nameFor(shape, hint);
        return { type: name, nullable: false, refs: [name] };
      }
      case "union": {
        const rest = shape.types.filter((t) => !(t.k === "prim" && t.t === "null"));
        const nullable = rest.length !== shape.types.length;
        if (rest.length === 1) return { ...this.resolve(rest[0] as Shape, hint), nullable };
        const numeric = rest.every((t) => t.k === "prim" && t.t === "number");
        return { type: numeric && rest.length ? "double" : "dynamic", nullable, refs: [] };
      }
    }
  }

  private prim(shape: Extract<Shape, { k: "prim" }>): ResolvedType {
    switch (shape.t) {
      case "string":
        return {
          type: shape.format === "date-time" || shape.format === "date" ? "DateTime" : "String",
          nullable: false,
          refs: [],
        };
      case "number":
        return { type: shape.int ? "int" : "double", nullable: false, refs: [] };
      case "boolean":
        return { type: "bool", nullable: false, refs: [] };
      case "null":
        return { type: "Object", nullable: true, refs: [] };
      default:
        return { type: "dynamic", nullable: false, refs: [] };
    }
  }

  /** `T?` for nullable types (never for dynamic). */
  withNull(t: ResolvedType): string {
    return t.nullable && t.type !== "dynamic" ? `${t.type}?` : t.type;
  }

  /** All registered model classes, sorted by name. Building one can register more; loops until stable. */
  models(): DartModel[] {
    while (this.pending.length) {
      const { name, shape } = this.pending.shift() as { name: string; shape: Obj };
      const refs = new Set<string>();
      const used = new Set<string>();
      const fields: DartField[] = shape.props.map((p) => {
        const t = this.resolve(p.type, pascalCase(singular(p.name)) || name);
        for (const r of t.refs) refs.add(r);
        let dart = safeIdent(camelCase(p.name));
        while (used.has(dart)) dart = `${dart}_`;
        used.add(dart);
        const nullable = p.optional || t.nullable;
        return {
          name: dart,
          jsonName: p.name,
          type: nullable && t.type !== "dynamic" ? `${t.type}?` : t.type,
          required: !nullable && t.type !== "dynamic",
        };
      });
      refs.delete(name);
      this.done.set(name, { name, file: snakeCase(name), fields, refs: [...refs].sort() });
    }
    return [...this.done.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
