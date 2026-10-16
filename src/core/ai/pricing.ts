import type { AiUsage } from "./types";

export interface AiModelInfo {
  id: string;
  label: string;
  /** List price in USD per million tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
}

export const AI_MODELS: AiModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", inputPerMTok: 4, outputPerMTok: 20 },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", inputPerMTok: 2, outputPerMTok: 10 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", inputPerMTok: 1, outputPerMTok: 5 },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", inputPerMTok: 10, outputPerMTok: 50 },
];

export const DEFAULT_AI_MODEL = "claude-opus-5-5";

export const isKnownModel = (id: string) => AI_MODELS.some((m) => m.id === id);

/** Cost of one call in USD (6 decimals). Unknown models cost 0 so a custom id never breaks a call. */
export function estimateCostUsd(model: string, usage: AiUsage): number {
  const m = AI_MODELS.find((x) => x.id === model);
  if (!m) return 0;
  const usd =
    (usage.inputTokens * m.inputPerMTok + usage.outputTokens * m.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
