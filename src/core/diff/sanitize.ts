/**
 * Copy of a schema that Ajv can compile on its own: unresolved `$ref`s (left behind for circular
 * schemas) become "anything", and OpenAPI-only noise is dropped.
 */
export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== "object") return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj.$ref === "string") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "example" || k === "examples" || k === "xml" || k === "externalDocs") continue;
    // keep user-defined property names intact: only recurse, never filter, inside `properties`
    out[k] =
      k === "properties" && v && typeof v === "object"
        ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, sanitizeSchema(pv)]))
        : sanitizeSchema(v);
  }
  return out;
}
