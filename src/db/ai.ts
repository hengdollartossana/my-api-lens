import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AiError,
  type AiProvider,
  type AiRequest,
  type AiResult,
  createAnthropicProvider,
  DEFAULT_AI_MODEL,
  isKnownModel,
  type MessagesClient,
} from "@/core/ai";
import { db } from "./client";
import { aiCalls, secrets, settings } from "./schema";
import { readSecret, saveSecret } from "./secrets";

/**
 * SERVER ONLY: AI provider settings and usage.
 *
 * The API key is stored encrypted as an `ai_key` secret. The UI only ever sees `AiSettingsView`
 * (masked last4), never the key itself.
 */

const KEY = "ai";

const stored = z.object({
  keySecretId: z.string().nullable().default(null),
  model: z.string().default(DEFAULT_AI_MODEL),
  monthlyBudgetUsd: z.number().nonnegative().nullable().default(null),
});
type Stored = z.infer<typeof stored>;

export interface AiSettingsView {
  hasKey: boolean;
  /** `••••abcd`, or null without a key. */
  keyMasked: string | null;
  model: string;
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
  return stored.parse(row?.value ?? {});
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

export async function getAiSettings(): Promise<AiSettingsView> {
  const s = await load();
  let keyMasked: string | null = null;
  if (s.keySecretId) {
    const [secret] = await db
      .select({ last4: secrets.last4 })
      .from(secrets)
      .where(eq(secrets.id, s.keySecretId));
    keyMasked = secret ? `••••${secret.last4}` : null;
  }
  const spend = await monthSpendUsd();
  return {
    hasKey: keyMasked !== null,
    keyMasked,
    model: s.model,
    monthlyBudgetUsd: s.monthlyBudgetUsd,
    monthSpendUsd: spend,
    overBudget: s.monthlyBudgetUsd !== null && spend >= s.monthlyBudgetUsd,
  };
}

export interface SaveAiSettingsInput {
  /** Omit to keep the stored key. */
  apiKey?: string;
  model?: string;
  /** null clears the budget. */
  monthlyBudgetUsd?: number | null;
}

export async function saveAiSettings(input: SaveAiSettingsInput): Promise<AiSettingsView> {
  const current = await load();
  const next: Stored = { ...current };
  if (input.model !== undefined) {
    if (!isKnownModel(input.model)) throw new AiError("BAD_REQUEST", "Unknown model");
    next.model = input.model;
  }
  if (input.monthlyBudgetUsd !== undefined) next.monthlyBudgetUsd = input.monthlyBudgetUsd;
  if (input.apiKey?.trim()) {
    const meta = await saveSecret({ kind: "ai_key", value: input.apiKey.trim() });
    if (current.keySecretId) await db.delete(secrets).where(eq(secrets.id, current.keySecretId));
    next.keySecretId = meta.id;
  }
  await store(next);
  return getAiSettings();
}

export async function removeAiKey(): Promise<AiSettingsView> {
  const current = await load();
  if (current.keySecretId) await db.delete(secrets).where(eq(secrets.id, current.keySecretId));
  await store({ ...current, keySecretId: null });
  return getAiSettings();
}

/** True when an AI key is stored. AI actions in the UI are disabled without it. */
export async function aiEnabled(): Promise<boolean> {
  return (await load()).keySecretId !== null && (await getAiSettings()).hasKey;
}

/**
 * Run one AI call with the stored key and record its tokens and cost. Throws `AiDisabledError`
 * without a key. `client` is for tests.
 */
export async function runAi(
  purpose: string,
  req: AiRequest,
  client?: MessagesClient,
): Promise<AiResult> {
  const s = await load();
  const key = s.keySecretId ? await readSecret(s.keySecretId) : null;
  if (!key) throw new AiDisabledError();
  const provider: AiProvider = createAnthropicProvider({ apiKey: key, model: s.model, client });
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
