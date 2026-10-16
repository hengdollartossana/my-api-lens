import { sampleFromSchema } from "@/core/executor";

export interface ParamDoc {
  name: string;
  in: string;
  required: boolean;
  schema?: unknown;
}

export interface InitialInput {
  pathParams: Record<string, string>;
  /** Every documented query parameter; required ones are prefilled with a sample. */
  query: { name: string; value: string; required: boolean }[];
  /** Pretty JSON sample of the request body, or "" when the endpoint takes none. */
  body: string;
  hasBody: boolean;
}

const asText = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Prefill for the Request tab: sample path/query values and a sample JSON body. */
export function initialInput(
  parameters: ParamDoc[] | null,
  requestBodySchema: unknown | null,
): InitialInput {
  const params = parameters ?? [];
  const hasBody = requestBodySchema !== null && requestBodySchema !== undefined;
  return {
    pathParams: Object.fromEntries(
      params
        .filter((p) => p.in === "path")
        .map((p) => [p.name, asText(sampleFromSchema(p.schema)) || "1"]),
    ),
    query: params
      .filter((p) => p.in === "query")
      .map((p) => ({
        name: p.name,
        required: p.required,
        value: p.required ? asText(sampleFromSchema(p.schema)) : "",
      })),
    body: hasBody ? JSON.stringify(sampleFromSchema(requestBodySchema), null, 2) : "",
    hasBody,
  };
}

/** Schema documented for a status: exact, then `2XX`, then `default`; null when undocumented. */
export function documentedSchema(
  responseSchemas: Record<string, unknown> | null,
  status: number | null,
): { found: boolean; schema: unknown } {
  if (status === null || !responseSchemas) return { found: false, schema: null };
  const s = String(status);
  for (const key of [s, `${s[0]}XX`, `${s[0]}xx`, "default"]) {
    if (key in responseSchemas) return { found: true, schema: responseSchemas[key] };
  }
  return { found: false, schema: null };
}
