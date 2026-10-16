type Schema = Record<string, unknown>;

export interface ExtraField {
  path: string;
  key: string;
  value: unknown;
}

const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);

/** Properties declared by a schema, including those merged from allOf parts. */
function declaredProperties(schema: Schema): Schema {
  const props: Schema = isObj(schema.properties) ? { ...schema.properties } : {};
  if (Array.isArray(schema.allOf)) {
    for (const part of schema.allOf)
      if (isObj(part)) Object.assign(props, declaredProperties(part));
  }
  return props;
}

const allowsAdditional = (schema: Schema): boolean => {
  if (schema.additionalProperties === true || isObj(schema.additionalProperties)) return true;
  return Array.isArray(schema.allOf) && schema.allOf.some((p) => isObj(p) && allowsAdditional(p));
};

/**
 * Fields present in `data` but not declared by `schema`, unless the schema sets
 * `additionalProperties: true` (or a schema for extra values). Schemas with no declared
 * properties are free-form and never flagged. oneOf/anyOf are not walked (ambiguous).
 */
export function findExtraFields(schema: unknown, data: unknown, path = "$"): ExtraField[] {
  if (!isObj(schema)) return [];
  const out: ExtraField[] = [];

  if (Array.isArray(data)) {
    if (isObj(schema.items)) {
      data.forEach((item, i) => out.push(...findExtraFields(schema.items, item, `${path}[${i}]`)));
    }
    return out;
  }
  if (!isObj(data)) return out;

  const props = declaredProperties(schema);
  const patterns = isObj(schema.patternProperties) ? Object.keys(schema.patternProperties) : [];
  const declared = Object.keys(props).length > 0;
  const extraSchema = isObj(schema.additionalProperties) ? schema.additionalProperties : null;

  for (const [key, value] of Object.entries(data)) {
    const keyPath = `${path}.${key}`;
    if (key in props) {
      out.push(...findExtraFields(props[key], value, keyPath));
    } else if (
      declared &&
      !allowsAdditional(schema) &&
      !patterns.some((p) => new RegExp(p).test(key))
    ) {
      out.push({ path: keyPath, key, value });
    } else if (extraSchema) {
      out.push(...findExtraFields(extraSchema, value, keyPath));
    }
  }
  return out;
}
