import { eq } from "drizzle-orm";
import { type AuthContext, TokenCache } from "@/core/executor";
import { loadAuthContext } from "@/db/auth-recipes";
import { db } from "@/db/client";
import { environments } from "@/db/schema";
import { assertAllowedTarget } from "./ssrf";

/** One token cache per server process; survives Next dev hot reloads. */
const g = globalThis as unknown as { __apilensTokenCache?: TokenCache };
export const tokenCache = (g.__apilensTokenCache ??= new TokenCache());

export class EnvironmentNotFoundError extends Error {}

/** SERVER ONLY: auth context (with decrypted secret) for a project + environment. */
export async function buildAuthContext(
  projectId: string,
  environmentId: string,
  recipeId?: string,
): Promise<AuthContext> {
  const [env] = await db.select().from(environments).where(eq(environments.id, environmentId));
  if (!env || env.projectId !== projectId) throw new EnvironmentNotFoundError(environmentId);
  const { recipe, secret } = await loadAuthContext(projectId, environmentId, recipeId);
  return {
    recipe,
    secret,
    cacheKey: `${projectId}:${environmentId}`,
    env: { baseUrl: env.baseUrl, defaultHeaders: env.defaultHeaders },
  };
}

/** SSRF guard for calls made on behalf of an environment. */
export const guardFor = (baseUrl: string) => async (url: string) => {
  await assertAllowedTarget(url, baseUrl);
};
