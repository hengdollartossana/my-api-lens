/** A small type tree between JSON Schema and TypeScript, so structurally equal types can be deduplicated. */
export type Shape =
  | {
      k: "prim";
      t: "string" | "number" | "boolean" | "null" | "unknown";
      format?: string;
      int?: boolean;
    }
  | { k: "lit"; values: (string | number | boolean | null)[] }
  | { k: "arr"; item: Shape }
  | { k: "rec"; value: Shape }
  | { k: "obj"; props: { name: string; optional: boolean; type: Shape }[]; title?: string }
  | { k: "union"; types: Shape[] };

type Schema = Record<string, unknown>;

/** `precise` keeps string formats and the integer/number split (used by code generators). */
export interface ShapeOptions {
  precise?: boolean;
}
const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_DEPTH = 8;

const unknownShape: Shape = { k: "prim", t: "unknown" };
const nullShape: Shape = { k: "prim", t: "null" };

function union(types: Shape[]): Shape {
  const flat = types.flatMap((t) => (t.k === "union" ? t.types : [t]));
  const seen = new Set<string>();
  const uniq = flat.filter((t) => {
    const key = JSON.stringify(t);
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return uniq.length === 1 ? (uniq[0] as Shape) : { k: "union", types: uniq };
}

function mergeAllOf(parts: unknown[]): Schema {
  const merged: Schema = { type: "object", properties: {}, required: [] };
  for (const p of parts) {
    if (!isObj(p)) continue;
    const m = Array.isArray(p.allOf) ? mergeAllOf(p.allOf) : p;
    Object.assign(merged.properties as Schema, isObj(m.properties) ? m.properties : {});
    (merged.required as string[]).push(
      ...(Array.isArray(m.required) ? (m.required as string[]) : []),
    );
    if (m.additionalProperties !== undefined) merged.additionalProperties = m.additionalProperties;
    if (typeof m.title === "string") merged.title ??= m.title;
  }
  return merged;
}

/** Convert a (dereferenced) JSON schema to a Shape. */
export function schemaToShape(schema: unknown, depth = 0, opts: ShapeOptions = {}): Shape {
  if (!isObj(schema) || depth > MAX_DEPTH) return unknownShape;
  const nullable = schema.nullable === true;
  const withNull = (s: Shape) => (nullable ? union([s, nullShape]) : s);

  if (Array.isArray(schema.enum)) {
    return withNull({ k: "lit", values: schema.enum as (string | number | boolean | null)[] });
  }
  if (schema.const !== undefined) return withNull({ k: "lit", values: [schema.const as string] });
  if (Array.isArray(schema.allOf))
    return withNull(schemaToShape(mergeAllOf(schema.allOf), depth + 1, opts));
  for (const key of ["oneOf", "anyOf"] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length) {
      return withNull(union(options.map((o) => schemaToShape(o, depth + 1, opts))));
    }
  }

  const rawType = Array.isArray(schema.type)
    ? schema.type
    : [schema.type ?? (isObj(schema.properties) ? "object" : undefined)];
  const types = (rawType as unknown[]).map((t) => objectOrScalar(schema, t, depth, opts));
  return withNull(union(types));
}

function objectOrScalar(schema: Schema, type: unknown, depth: number, opts: ShapeOptions): Shape {
  switch (type) {
    case "string":
      return opts.precise && typeof schema.format === "string"
        ? { k: "prim", t: "string", format: schema.format }
        : { k: "prim", t: "string" };
    case "integer":
      return opts.precise ? { k: "prim", t: "number", int: true } : { k: "prim", t: "number" };
    case "number":
      return { k: "prim", t: "number" };
    case "boolean":
      return { k: "prim", t: "boolean" };
    case "null":
      return nullShape;
    case "array":
      return { k: "arr", item: schemaToShape(schema.items, depth + 1, opts) };
    case "object": {
      const props = isObj(schema.properties) ? schema.properties : {};
      const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
      if (Object.keys(props).length === 0) {
        return isObj(schema.additionalProperties)
          ? { k: "rec", value: schemaToShape(schema.additionalProperties, depth + 1, opts) }
          : { k: "rec", value: unknownShape };
      }
      return {
        k: "obj",
        title: typeof schema.title === "string" ? schema.title : undefined,
        props: Object.entries(props).map(([name, s]) => ({
          name,
          optional: !required.has(name),
          type: schemaToShape(s, depth + 1, opts),
        })),
      };
    }
    default:
      return unknownShape;
  }
}

/** Infer a Shape from an observed JSON value. */
export function valueToShape(value: unknown, depth = 0, opts: ShapeOptions = {}): Shape {
  if (value === null) return nullShape;
  if (depth > MAX_DEPTH) return unknownShape;
  if (Array.isArray(value)) {
    return {
      k: "arr",
      item: value.length
        ? mergeShapes(value.map((v) => valueToShape(v, depth + 1, opts)))
        : unknownShape,
    };
  }
  switch (typeof value) {
    case "string":
      return { k: "prim", t: "string" };
    case "number":
      return opts.precise && Number.isInteger(value)
        ? { k: "prim", t: "number", int: true }
        : { k: "prim", t: "number" };
    case "boolean":
      return { k: "prim", t: "boolean" };
    case "object":
      return {
        k: "obj",
        props: Object.entries(value as Schema).map(([name, v]) => ({
          name,
          optional: false,
          type: valueToShape(v, depth + 1, opts),
        })),
      };
    default:
      return unknownShape;
  }
}

/** Merge array element shapes: objects combine (fields missing somewhere become optional). */
function mergeShapes(shapes: Shape[]): Shape {
  const objs = shapes.filter((s): s is Extract<Shape, { k: "obj" }> => s.k === "obj");
  const others = shapes.filter((s) => s.k !== "obj");
  const parts: Shape[] = [...others];
  if (objs.length) {
    const names = [...new Set(objs.flatMap((o) => o.props.map((p) => p.name)))];
    parts.push({
      k: "obj",
      props: names.map((name) => {
        const found = objs.map((o) => o.props.find((p) => p.name === name));
        return {
          name,
          optional: found.some((f) => !f || f.optional),
          type: union(found.filter((f): f is NonNullable<typeof f> => !!f).map((f) => f.type)),
        };
      }),
    });
  }
  return union(parts);
}
