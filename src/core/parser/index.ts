import { createHash } from "node:crypto";
import SwaggerParser from "@apidevtools/swagger-parser";
import { canonicalJson } from "./canonical";
import { ParseSpecError } from "./errors";
import { fetchSpecText } from "./fetch";
import { normalizeEndpoints, normalizeSecuritySchemes, normalizeServers } from "./normalize";
import type { JsonObject, ParsedSpec, ParseInput } from "./types";

export { canonicalJson } from "./canonical";
export {
  type ChangedEndpoint,
  type ComparableEndpoint,
  type ContractPart,
  changedParts,
  compareEndpoints,
} from "./compare";
export { type ParseErrorCode, ParseSpecError } from "./errors";
export { FETCH_TIMEOUT_MS, fetchSpecText, MAX_SPEC_BYTES } from "./fetch";
export { isDestructive, stableKey } from "./normalize";

/** Server base URLs declared by a stored spec (OpenAPI 3 `servers`, Swagger 2 `host`+`basePath`). */
export function serversOf(raw: Record<string, unknown>): string[] {
  return normalizeServers(raw, raw.swagger === "2.0");
}
export type { NormalizedEndpoint, NormalizedParameter, ParsedSpec, ParseInput } from "./types";

function extensionFor(text: string, filename?: string): string {
  const ext = filename?.match(/\.(json|ya?ml)$/i)?.[1]?.toLowerCase();
  if (ext) return ext === "json" ? "json" : "yaml";
  return text.trimStart().startsWith("{") ? "json" : "yaml";
}

export async function parseSpec(input: ParseInput): Promise<ParsedSpec> {
  const text = "url" in input ? await fetchSpecText(input.url) : input.text;
  const filename = "url" in input ? undefined : input.filename;
  const virtual = `spec:///spec.${extensionFor(text, filename)}`;

  let raw: JsonObject;
  let api: JsonObject;
  try {
    // Parse from memory (YAML or JSON); no filesystem or network access for the spec itself.
    const resolve = {
      external: false,
      spec: { order: 1, canRead: /^spec:/, read: () => text },
    };
    raw = (await SwaggerParser.parse(virtual, { resolve } as never)) as unknown as JsonObject;
    api = (await SwaggerParser.validate(
      structuredClone(raw) as never,
      {
        dereference: { circular: "ignore" },
      } as never,
    )) as unknown as JsonObject;
  } catch (err) {
    throw new ParseSpecError("INVALID_SPEC", (err as Error).message);
  }

  const v2 = api.swagger === "2.0";
  const openapi = v2 ? "2.0" : String(api.openapi ?? "");
  if (!v2 && !openapi.startsWith("3.")) {
    throw new ParseSpecError(
      "UNSUPPORTED_VERSION",
      `Unsupported spec version: ${openapi || "unknown"}`,
    );
  }

  const info = (api.info ?? {}) as JsonObject;
  return {
    title: String(info.title ?? ""),
    version: String(info.version ?? ""),
    openapi,
    servers: normalizeServers(api, v2),
    securitySchemes: normalizeSecuritySchemes(api, v2),
    endpoints: normalizeEndpoints(api, v2),
    specHash: createHash("sha256").update(canonicalJson(raw)).digest("hex"),
    raw,
  };
}
