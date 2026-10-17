import type { AiUsage } from "./types";

export type AiProviderId = "anthropic" | "google";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Shape of a key, shown as the input placeholder. */
  keyHint: string;
  /** Where the user creates a key. */
  keyUrl: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: "google",
    label: "Google AI Studio (Gemini)",
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    keyHint: "sk-ant-…",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
];

export interface AiModelInfo {
  id: string;
  provider: AiProviderId;
  label: string;
  /** Estimated list price in USD per million tokens (standard tier). Budgets use it, billing may differ. */
  inputPerMTok: number;
  outputPerMTok: number;
}

export const AI_MODELS: AiModelInfo[] = [
  {
    id: "gemini-3.8-flash",
    provider: "google",
    label: "Gemini 3.8 Flash",
    inputPerMTok: 1.5,
    outputPerMTok: 7.5,
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "google",
    label: "Gemini 3.5 Flash-Lite",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
  },
  {
    id: "gemini-2.5-flash",
    provider: "google",
    label: "Gemini 2.5 Flash",
    inputPerMTok: 0.3,
    outputPerMTok: 2.5,
  },
  {
    id: "gemini-4-argon",
    provider: "google",
    label: "Gemini 4 Argon",
    inputPerMTok: 4,
    outputPerMTok: 20,
  },
  {
    id: "claude-opus-5-5",
    provider: "anthropic",
    label: "Claude Opus 5.5",
    inputPerMTok: 4,
    outputPerMTok: 20,
  },
  {
    id: "claude-sonnet-5-5",
    provider: "anthropic",
    label: "Claude Sonnet 5.5",
    inputPerMTok: 2,
    outputPerMTok: 10,
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    inputPerMTok: 1,
    outputPerMTok: 5,
  },
  {
    id: "claude-fable-5-1",
    provider: "anthropic",
    label: "Claude Fable 5.1",
    inputPerMTok: 10,
    outputPerMTok: 50,
  },
];

export const DEFAULT_PROVIDER: AiProviderId = "google";

export const DEFAULT_MODEL_BY_PROVIDER: Record<AiProviderId, string> = {
  google: "gemini-3.8-flash",
  anthropic: "claude-opus-5-5",
};

/** Kept for callers that predate multiple providers. */
export const DEFAULT_AI_MODEL = DEFAULT_MODEL_BY_PROVIDER.anthropic;

export const modelsFor = (provider: AiProviderId) =>
  AI_MODELS.filter((m) => m.provider === provider);

export const providerOfModel = (id: string): AiProviderId | null =>
  AI_MODELS.find((m) => m.id === id)?.provider ?? null;

export const isKnownModel = (id: string, provider?: AiProviderId) =>
  AI_MODELS.some((m) => m.id === id && (!provider || m.provider === provider));

/** Cost of one call in USD (6 decimals). Unknown models cost 0 so a custom id never breaks a call. */
export function estimateCostUsd(model: string, usage: AiUsage): number {
  const m = AI_MODELS.find((x) => x.id === model);
  if (!m) return 0;
  const usd =
    (usage.inputTokens * m.inputPerMTok + usage.outputTokens * m.outputPerMTok) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}
