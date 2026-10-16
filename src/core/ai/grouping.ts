import { z } from "zod";
import { normalizeModuleName, UNGROUPED } from "@/core/grouper";
import type { AiRequest } from "./types";

/** One endpoint as the model sees it: a one-liner, never schemas or example data. */
export interface GroupingEndpoint {
  stableKey: string;
  method: string;
  path: string;
  summary?: string | null;
}

export interface GroupingProposal {
  stableKey: string;
  module: string;
}

/** Most endpoints sent in one call; the rest stay ungrouped until the next round. */
export const MAX_GROUPING_ENDPOINTS = 150;
const MAX_MODULE_NAME = 80;

const oneLine = (e: GroupingEndpoint) => {
  const summary = e.summary?.replace(/\s+/g, " ").trim().slice(0, 100);
  return `${e.method.toUpperCase()} ${e.path}${summary ? ` - ${summary}` : ""}`;
};

/** Ask for a module per endpoint, referring to endpoints by short ids to keep the call cheap. */
export function buildGroupingRequest(
  endpoints: GroupingEndpoint[],
  existingModules: string[],
): AiRequest {
  const list = endpoints.map((e, i) => `${i + 1}. ${oneLine(e)}`).join("\n");
  return {
    system:
      "You group REST API endpoints into modules, one module per resource or feature area. " +
      "Prefer an existing module when it fits; otherwise invent a short singular name such as " +
      '"Invoice" or "Notification". Answer with JSON only.',
    prompt:
      `Existing modules: ${existingModules.length ? existingModules.join(", ") : "(none)"}\n\n` +
      `Endpoints:\n${list}\n\n` +
      'Reply with {"assignments":[{"id":1,"module":"Name"}]} covering the endpoints you are ' +
      "confident about. Skip any you cannot place.",
    maxTokens: 8000,
  };
}

const responseSchema = z.object({
  assignments: z.array(z.object({ id: z.number().int(), module: z.string() })),
});

/**
 * Turn the model's reply into proposals. Tolerates prose or code fences around the JSON, drops
 * unknown ids and unusable names, and keeps the first answer per endpoint.
 */
export function parseGroupingResponse(
  text: string,
  endpoints: GroupingEndpoint[],
): GroupingProposal[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let json: unknown;
  try {
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return [];

  const seen = new Set<string>();
  const out: GroupingProposal[] = [];
  for (const a of parsed.data.assignments) {
    const endpoint = endpoints[a.id - 1];
    const name = normalizeModuleName(a.module.trim().slice(0, MAX_MODULE_NAME));
    if (!endpoint || !name || name === UNGROUPED || seen.has(endpoint.stableKey)) continue;
    seen.add(endpoint.stableKey);
    out.push({ stableKey: endpoint.stableKey, module: name });
  }
  return out;
}
