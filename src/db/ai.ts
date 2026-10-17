import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AI_PROVIDERS,
  AiError,
  type AiProvider,
  type AiProviderId,
  type AiRequest,
  type AiResult,
  createAnthropicProvider,
  createGoogleProvider,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER,
  isKnownModel,
  type MessagesClient,
  providerOfModel,
} from "@/core/ai";
import { db } from "./client";
import { aiCalls, secrets, settings } from "./schema";
import { readSecret, saveSecret } from "./secrets";

/**
 * SERVER ONLY: AI provider settings and usage.
 *
 * One provider is active at a time (Google AI Studio or Anthropic), each with its own encrypted
 * `ai_key` secret and model. The UI only ever sees `AiSettingsView` (masked last4), never a key.
 */

const KEY = "ai";
const PROVIDER_IDS = AI_PROVIDERS.map((p) => p.id) as AiProviderId[];

const perProvider = <T extends z.ZodType>(schema: T) =>
  z.object({ anthropic: schema, google: schema });

const stored = z.object({
  provider: z.enum(["anthropic", "google"]).optional(),
  keys: perProvider(z.string().nullable().default(null)).default({
    anthropic: null,
    google: null,
  }),
  models: perProvider(z.string().optional()).default({}),
  monthlyBudgetUsd: z.number().nonnegative().nullable().default(null),
  // Shape written before multiple providers existed (Anthropic only).
  keySecretId: z.string().nullable().optional(),
  model: z.string().optional(),
});

interface Stored {
  provider: AiProviderId;
  keys: Record<AiProviderId, string | null>;
  models: Record<AiProviderId, string>;
  monthlyBudgetUsd: number | null;
}

function normalize(raw: z.infer<typeof stored>): Stored {
  const keys = { ...raw.keys };
  const models = {
    anthropic: raw.models.anthropic ?? DEFAULT_MODEL_BY_PROVIDER.anthropic,
    google: raw.models.google ?? DEFAULT_MODEL_BY_PROVIDER.google,
  };
  if (raw.keySecretId && !keys.anthropic) {
    keys.anthropic = raw.keySecretId;
    if (raw.model && isKnownModel(raw.model, "anthropic")) models.anthropic = raw.model;
  }
  const provider =
    raw.provider ?? (keys.anthropic && !keys.google ? "anthropic" : DEFAULT_PROVIDER);
  return { provider, keys, models, monthlyBudgetUsd: raw.monthlyBudgetUsd };
}

export interface AiProviderView {
  /** `••••abcd`, or null without a key for this provider. */
  keyMasked: string | null;
  model: string;
}

export interface AiSettingsView {
  /** The provider AI actions use. */
  provider: AiProviderId;
  /** The active provider has a key. */
  hasKey: boolean;
  keyMasked: string | null;
  model: string;
  /** Key and model of every provider, so the form can switch without losing them. */
  providers: Record<AiProviderId, AiProviderView>;
  monthlyBudgetUsd: number | null;
  monthSpendUsd: number;
  /** Soft limit: calls still run, the UI warns. */
  overBudget: boolean;
}

export class AiDisabledError extends Error {
  constructor() {
    super("AI is not configured: add an API key in Settings");
    this.name = "AiDisabledError";
  }
}

async function load(): Promise<Stored> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return normalize(stored.parse(row?.value ?? {}));
}

async function store(next: Stored) {
  await db
    .insert(settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

export async function monthSpendUsd(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)::float8` })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, monthStart()));
  return row?.total ?? 0;
}

async function maskedKey(secretId: string | null): Promise<string | null> {
  if (!secretId) return null;
  const [secret] = await db
    .select({ last4: secrets.last4 })
    .from(secrets)
    .where(eq(secrets.id, secretId));
  return secret ? `••••${secret.last4}` : null;
}

export async function getAiSettings(): Promise<AiSettingsView> {
  const s = await load();
  const providers = {} as Record<AiProviderId, AiProviderView>;
  for (const id of PROVIDER_IDS) {
    providers[id] = { keyMasked: await maskedKey(s.keys[id]), model: s.models[id] };
  }
  const active = providers[s.provider];
  const spend = await monthSpendUsd();
  return {
    provider: s.provider,
    hasKey: active.keyMasked !== null,
    keyMasked: active.keyMasked,
    model: active.model,
    providers,
    monthlyBudgetUsd: s.monthlyBudgetUsd,
    monthSpendUsd: spend,
    overBudget: s.monthlyBudgetUsd !== null && spend >= s.monthlyBudgetUsd,
  };
}

export interface SaveAiSettingsInput {
  /** Switch the active provider. Defaults to the current one. */
  provider?: AiProviderId;
  /** Omit to keep the stored key of that provider. */
  apiKey?: string;
  /** Must belong to the provider being saved. */
  model?: string;
  /** null clears the budget. */
  monthlyBudgetUsd?: number | null;
}

export async function saveAiSettings(input: SaveAiSettingsInput): Promise<AiSettingsView> {
  const current = await load();
  // A model implies its provider when none is named.
  const target =
    input.provider ?? (input.model ? providerOfModel(input.model) : null) ?? current.provider;
  const next: Stored = { ...current, keys: { ...current.keys }, models: { ...current.models } };
  next.provider = target;
  if (input.model !== undefined) {
    if (!isKnownModel(input.model, target)) throw new AiError("BAD_REQUEST", "Unknown model");
    next.models[target] = input.model;
  }
  if (input.monthlyBudgetUsd !== undefined) next.monthlyBudgetUsd = input.monthlyBudgetUsd;
  if (input.apiKey?.trim()) {
    const meta = await saveSecret({ kind: "ai_key", value: input.apiKey.trim() });
    const old = current.keys[target];
    if (old) await db.delete(secrets).where(eq(secrets.id, old));
    next.keys[target] = meta.id;
  }
  await store(next);
  return getAiSettings();
}

/** Remove the stored key of a provider (the active one by default). */
export async function removeAiKey(provider?: AiProviderId): Promise<AiSettingsView> {
  const current = await load();
  const target = provider ?? current.provider;
  const old = current.keys[target];
  if (old) await db.delete(secrets).where(eq(secrets.id, old));
  await store({ ...current, keys: { ...current.keys, [target]: null } });
  return getAiSettings();
}

/** True when the active provider has a key. AI actions in the UI are disabled without it. */
export async function aiEnabled(): Promise<boolean> {
  return (await getAiSettings()).hasKey;
}

/** Test doubles for the network: the Anthropic SDK client and/or `fetch` (Google). */
export interface AiTestDeps {
  anthropicClient?: MessagesClient;
  fetch?: typeof fetch;
}

/**
 * Run one AI call with the active provider's stored key and record its tokens and cost. Throws
 * `AiDisabledError` without a key. A bare `MessagesClient` as third argument still works (tests).
 */
export async function runAi(
  purpose: string,
  req: AiRequest,
  deps?: AiTestDeps | MessagesClient,
): Promise<AiResult> {
  const test: AiTestDeps = deps && "messages" in deps ? { anthropicClient: deps } : (deps ?? {});
  const s = await load();
  const secretId = s.keys[s.provider];
  const key = secretId ? await readSecret(secretId) : null;
  if (!key) throw new AiDisabledError();
  const model = s.models[s.provider];
  const provider: AiProvider =
    s.provider === "google"
      ? createGoogleProvider({ apiKey: key, model, fetch: test.fetch })
      : createAnthropicProvider({ apiKey: key, model, client: test.anthropicClient });
  const result = await provider.complete(req);
  await db.insert(aiCalls).values({
    purpose,
    model: result.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    costUsd: result.costUsd,
  });
  return result;
}
