import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { findExtraFields } from "./extra";
import { sanitizeSchema } from "./sanitize";
import {
  type ActualResponse,
  type DiffItem,
  type DiffKind,
  type ResponseSchemas,
  SEVERITY_BY_KIND,
} from "./types";

export * from "./types";

const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);
// OpenAPI number formats Ajv does not know.
for (const f of ["int32", "int64", "float", "double", "byte", "binary", "password"])
  ajv.addFormat(f, true);

type Validate = ReturnType<typeof ajv.compile>;
const compiled = new WeakMap<object, Validate | null>();

function validatorFor(schema: object): Validate | null {
  if (compiled.has(schema)) return compiled.get(schema) ?? null;
  let v: Validate | null = null;
  try {
    v = ajv.compile(sanitizeSchema(schema) as object);
  } catch {
    v = null; // a schema Ajv cannot compile is skipped rather than failing the run
  }
  compiled.set(schema, v);
  return v;
}

/** "/0/email" -> "$[0].email" */
export function toJsonPath(pointer: string): string {
  return pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((acc, seg) => (/^\d+$/.test(seg) ? `${acc}[${seg}]` : `${acc}.${seg}`), "$");
}

const MAX_SAMPLE = 120;
/** Keeps values in the report small; never echo large bodies. */
export function sample(v: unknown): unknown {
  if (typeof v === "string") return v.length > MAX_SAMPLE ? `${v.slice(0, MAX_SAMPLE)}…` : v;
  if (v && typeof v === "object") {
    const s = JSON.stringify(v);
    return s.length > MAX_SAMPLE ? `${s.slice(0, MAX_SAMPLE)}…` : v;
  }
  return v;
}

const make = (
  kind: DiffKind,
  path: string,
  message: string,
  expected?: unknown,
  actual?: unknown,
): DiffItem => ({
  kind,
  severity: SEVERITY_BY_KIND[kind],
  path,
  message,
  ...(expected !== undefined ? { expected } : {}),
  ...(actual !== undefined ? { actual: sample(actual) } : {}),
});

const CONSTRAINTS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

function pickSchema(schemas: ResponseSchemas, status: number): { found: boolean; schema: unknown } {
  const s = String(status);
  for (const key of [s, `${s[0]}XX`, `${s[0]}xx`, "default"]) {
    if (key in schemas) return { found: true, schema: schemas[key] };
  }
  return { found: false, schema: null };
}

function fromAjvError(e: ErrorObject): DiffItem | null {
  const path = toJsonPath(e.instancePath);
  const schema = e.parentSchema as { type?: unknown } | undefined;
  switch (e.keyword) {
    case "required": {
      const prop = (e.params as { missingProperty: string }).missingProperty;
      return make(
        "missing_required",
        `${path}.${prop}`,
        `Required field "${prop}" is missing`,
        "present",
        undefined,
      );
    }
    case "type":
      return e.data === null
        ? make(
            "unexpected_null",
            path,
            "Value is null but the spec does not allow null",
            schema?.type,
            null,
          )
        : make(
            "type_mismatch",
            path,
            `Expected ${[schema?.type].flat().join(" | ")}, got ${typeName(e.data)}`,
            schema?.type,
            e.data,
          );
    case "enum":
    case "const":
      return make(
        "enum_violation",
        path,
        "Value is not one of the allowed values",
        (e.params as { allowedValues?: unknown }).allowedValues,
        e.data,
      );
    case "format":
      return make(
        "format_violation",
        path,
        `Value does not match format "${(e.params as { format: string }).format}"`,
        (e.params as { format: string }).format,
        e.data,
      );
    case "additionalProperties":
      return null; // handled by the extra-field walk
    case "anyOf":
    case "oneOf":
      return make(
        "type_mismatch",
        path,
        "Value does not match any allowed schema",
        undefined,
        e.data,
      );
    default:
      return CONSTRAINTS.has(e.keyword)
        ? make(
            "format_violation",
            path,
            `Value violates "${e.keyword}" (${e.message ?? "constraint"})`,
            e.schema,
            e.data,
          )
        : null;
  }
}

const typeName = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/**
 * Compare an actual response with the documented response schemas.
 * Errors: missing_required, type_mismatch, undocumented_status. Warnings: unexpected_null,
 * enum_violation, format_violation. Info: extra_field. A matching response yields no items.
 */
export function diffResponse(responseSchemas: ResponseSchemas, actual: ActualResponse): DiffItem[] {
  const { found, schema } = pickSchema(responseSchemas, actual.status);
  if (!found) {
    return [
      make(
        "undocumented_status",
        "$status",
        `Status ${actual.status} is not documented`,
        Object.keys(responseSchemas),
        actual.status,
      ),
    ];
  }
  if (schema === null || schema === undefined || typeof schema !== "object") return [];

  const items: DiffItem[] = [];
  const validate = validatorFor(schema);
  if (validate && !validate(actual.body)) {
    // Inside anyOf/oneOf branches, errors describe the losing branches; keep only the branch summary.
    const errors = (validate.errors ?? []).filter(
      (e) => !/\/(anyOf|oneOf)\/\d+\//.test(e.schemaPath),
    );
    for (const e of errors) {
      const item = fromAjvError(e);
      if (item) items.push(item);
    }
  }
  for (const extra of findExtraFields(schema, actual.body)) {
    items.push(
      make(
        "extra_field",
        extra.path,
        `Field "${extra.key}" is not in the spec`,
        undefined,
        extra.value,
      ),
    );
  }

  // De-duplicate and order: errors first, then by path.
  const seen = new Set<string>();
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return items
    .filter((i) => {
      const k = `${i.kind}|${i.path}`;
      return seen.has(k) ? false : (seen.add(k), true);
    })
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.path.localeCompare(b.path));
}

/** Worst severity across items, as a run-result severity ("ok" when there are none). */
export function worstSeverity(
  items: Pick<DiffItem, "severity">[],
): "ok" | "info" | "warn" | "error" {
  if (items.some((i) => i.severity === "error")) return "error";
  if (items.some((i) => i.severity === "warn")) return "warn";
  return items.length ? "info" : "ok";
}
