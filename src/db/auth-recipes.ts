import { and, eq, isNull } from "drizzle-orm";
import { type AuthRecipe, authRecipeSchema } from "@/core/executor";
import { db } from "./client";
import { authRecipes, secrets } from "./schema";
import { readSecret, saveSecret } from "./secrets";

/**
 * Auth recipe storage.
 *
 * SERVER ONLY: `loadAuthContext` returns the decrypted secret. List/save return
 * only `AuthRecipeMeta` (masked last4, never the secret).
 */

export interface AuthRecipeMeta {
  id: string;
  projectId: string;
  /** null = applies to all environments of the project. */
  environmentId: string | null;
  recipe: AuthRecipe;
  secretLast4: string | null;
}

export interface SaveAuthRecipeInput {
  projectId: string;
  environmentId?: string | null;
  recipe: unknown;
  /** Token / API key, or `{"username","password"}` JSON for login_flow. Omit to keep the stored one. */
  secret?: string;
}

const scope = (projectId: string, environmentId: string | null) =>
  and(
    eq(authRecipes.projectId, projectId),
    environmentId === null
      ? isNull(authRecipes.environmentId)
      : eq(authRecipes.environmentId, environmentId),
  );

function toMeta(row: typeof authRecipes.$inferSelect, secretLast4: string | null): AuthRecipeMeta {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    recipe: authRecipeSchema.parse(row.config),
    secretLast4,
  };
}

async function last4Of(secretId: string | null): Promise<string | null> {
  if (!secretId) return null;
  const [s] = await db
    .select({ last4: secrets.last4 })
    .from(secrets)
    .where(eq(secrets.id, secretId));
  return s?.last4 ?? null;
}

/** Creates or replaces the recipe for this project + environment scope. */
export async function saveAuthRecipe(input: SaveAuthRecipeInput): Promise<AuthRecipeMeta> {
  const recipe = authRecipeSchema.parse(input.recipe);
  const environmentId = input.environmentId ?? null;
  const [existing] = await db
    .select()
    .from(authRecipes)
    .where(scope(input.projectId, environmentId));

  let secretId = existing?.secretId ?? null;
  if (recipe.type === "none") {
    input = { ...input, secret: undefined };
    secretId = null;
  } else if (input.secret) {
    const saved = await saveSecret({
      kind: recipe.type === "login_flow" ? "password" : "api_token",
      value: input.secret,
      projectId: input.projectId,
    });
    secretId = saved.id;
  }

  const values = { type: recipe.type, config: recipe, secretId };
  const [row] = existing
    ? await db.update(authRecipes).set(values).where(eq(authRecipes.id, existing.id)).returning()
    : await db
        .insert(authRecipes)
        .values({ projectId: input.projectId, environmentId, ...values })
        .returning();

  // Drop the replaced secret so old credentials do not linger.
  if (existing?.secretId && existing.secretId !== secretId) {
    await db.delete(secrets).where(eq(secrets.id, existing.secretId));
  }
  return toMeta(row as typeof authRecipes.$inferSelect, await last4Of(secretId));
}

export async function listAuthRecipes(projectId: string): Promise<AuthRecipeMeta[]> {
  const rows = await db.select().from(authRecipes).where(eq(authRecipes.projectId, projectId));
  return Promise.all(rows.map(async (r) => toMeta(r, await last4Of(r.secretId))));
}

export async function deleteAuthRecipe(projectId: string, recipeId: string): Promise<boolean> {
  const [row] = await db
    .delete(authRecipes)
    .where(and(eq(authRecipes.id, recipeId), eq(authRecipes.projectId, projectId)))
    .returning();
  if (row?.secretId) await db.delete(secrets).where(eq(secrets.id, row.secretId));
  return !!row;
}

/**
 * SERVER ONLY: the recipe that applies to an environment (its own, else the project-wide one)
 * with its decrypted secret. Returns a `none` recipe when nothing is configured.
 */
export async function loadAuthContext(
  projectId: string,
  environmentId: string,
  recipeId?: string,
): Promise<{ recipe: AuthRecipe; secret: string | null }> {
  const rows = await db.select().from(authRecipes).where(eq(authRecipes.projectId, projectId));
  const row = recipeId
    ? rows.find((r) => r.id === recipeId)
    : (rows.find((r) => r.environmentId === environmentId) ??
      rows.find((r) => r.environmentId === null));
  if (!row) return { recipe: { type: "none" }, secret: null };
  return {
    recipe: authRecipeSchema.parse(row.config),
    secret: row.secretId ? await readSecret(row.secretId) : null,
  };
}
