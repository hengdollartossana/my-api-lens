type Schema = Record<string, unknown>;

const MAX_DEPTH = 5;

const STRING_FORMATS: Record<string, string> = {
  email: "user@example.com",
  "date-time": "2024-01-01T00:00:00Z",
  date: "2024-01-01",
  uuid: "00000000-0000-4000-8000-000000000000",
  uri: "https://example.com",
  url: "https://example.com",
  hostname: "example.com",
  ipv4: "127.0.0.1",
};

const isObj = (v: unknown): v is Schema => !!v && typeof v === "object" && !Array.isArray(v);

/** Build a plausible sample value from a (dereferenced) JSON schema. */
export function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (!isObj(schema) || depth > MAX_DEPTH) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;

  if (Array.isArray(schema.allOf)) {
    const merged: Schema = {};
    for (const part of schema.allOf) {
      if (!isObj(part)) continue;
      const props = isObj(part.properties) ? part.properties : {};
      merged.properties = { ...(merged.properties as Schema | undefined), ...props };
      merged.required = [
        ...((merged.required as string[] | undefined) ?? []),
        ...(Array.isArray(part.required) ? (part.required as string[]) : []),
      ];
      merged.type ??= part.type;
    }
    return sampleFromSchema({ type: "object", ...merged }, depth + 1);
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const options = schema[key];
    if (Array.isArray(options) && options.length) return sampleFromSchema(options[0], depth + 1);
  }

  const type = Array.isArray(schema.type)
    ? (schema.type.find((t) => t !== "null") ?? "null")
    : (schema.type ?? (isObj(schema.properties) ? "object" : undefined));

  switch (type) {
    case "object": {
      const props = isObj(schema.properties) ? schema.properties : {};
      const out: Schema = {};
      for (const [k, v] of Object.entries(props)) out[k] = sampleFromSchema(v, depth + 1);
      return out;
    }
    case "array":
      return [sampleFromSchema(schema.items, depth + 1)];
    case "string":
      return typeof schema.format === "string"
        ? (STRING_FORMATS[schema.format] ?? "string")
        : "string";
    case "integer":
      return typeof schema.minimum === "number" ? Math.ceil(schema.minimum) : 1;
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 1.5;
    case "boolean":
      return true;
    default:
      return null;
  }
}
