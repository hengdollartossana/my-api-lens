import { z } from "zod";
import { execute } from "./execute";
import { buildRequest } from "./request";
import type { BuiltRequest, ExecAuth, ExecEnv, ExecResult, ExecuteOptions } from "./types";

/**
 * Auth recipes: turn a stored recipe + secret into request credentials.
 * Pure TS; the caller supplies the decrypted secret and (optionally) an SSRF guard.
 */

const refreshSchema = z.object({
  path: z.string().min(1),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  /** Body template; {{refreshToken}} is replaced. */
  bodyTemplate: z.string().default('{"refreshToken":"{{refreshToken}}"}'),
  /** JSON path of the new access token in the response. */
  tokenPath: z.string().min(1),
  /** JSON path of a rotated refresh token, if the API issues one. */
  refreshTokenPath: z.string().optional(),
});

export const authRecipeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("static_bearer"),
    headerName: z.string().default("Authorization"),
  }),
  z.object({
    type: z.literal("api_key"),
    in: z.enum(["header", "query"]).default("header"),
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal("login_flow"),
    loginPath: z.string().min(1),
    method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
    /** Body template; {{username}} and {{password}} are replaced (JSON-escaped). */
    bodyTemplate: z.string().default('{"username":"{{username}}","password":"{{password}}"}'),
    /** JSON path of the access token in the login response, e.g. "data.token". */
    tokenPath: z.string().min(1),
    headerName: z.string().default("Authorization"),
    /** Header value; {{token}} is replaced. */
    headerTemplate: z.string().default("Bearer {{token}}"),
    refresh: refreshSchema.optional(),
  }),
]);

export type AuthRecipe = z.infer<typeof authRecipeSchema>;
export type LoginFlowRecipe = Extract<AuthRecipe, { type: "login_flow" }>;

export class AuthError extends Error {
  constructor(
    readonly code: "MISSING_SECRET" | "BAD_SECRET" | "LOGIN_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

interface CachedToken {
  token: string;
  refreshToken?: string;
}

/** In-memory token cache, keyed by project + environment. */
export class TokenCache {
  private readonly entries = new Map<string, CachedToken>();
  get(key: string) {
    return this.entries.get(key);
  }
  set(key: string, value: CachedToken) {
    this.entries.set(key, value);
  }
  delete(key: string) {
    this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
  }
}

export interface AuthContext {
  recipe: AuthRecipe;
  env: ExecEnv;
  /** Decrypted secret: the token / API key, or `{"username","password"}` JSON for login_flow. */
  secret: string | null;
  /** e.g. `${projectId}:${environmentId}` */
  cacheKey: string;
}

/** Read a value from parsed JSON by a path like "data.token" or "items[0].id". */
export function readJsonPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const part of path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const jsonEscape = (v: string) => JSON.stringify(v).slice(1, -1);

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) =>
    k in values ? jsonEscape(values[k] as string) : m,
  );
}

function loginHeaders(recipe: LoginFlowRecipe, token: string): Record<string, string> {
  // The header value is not JSON, so substitute the raw token.
  return { [recipe.headerName]: recipe.headerTemplate.replace(/\{\{token\}\}/g, token) };
}

function credentials(secret: string | null): { username: string; password: string } {
  if (!secret) throw new AuthError("MISSING_SECRET", "No credentials are stored for this recipe");
  try {
    const parsed = z
      .object({ username: z.string(), password: z.string() })
      .parse(JSON.parse(secret));
    return parsed;
  } catch {
    throw new AuthError(
      "BAD_SECRET",
      'Credentials must be JSON: {"username": "...", "password": "..."}',
    );
  }
}

async function callJson(
  env: ExecEnv,
  path: string,
  method: string,
  body: string,
  opts: ExecuteOptions,
): Promise<ExecResult> {
  const req: BuiltRequest = buildRequest(
    { method, path, parameters: [], requestBodySchema: null },
    env,
    { body },
  );
  return execute(req, opts);
}

async function login(ctx: AuthContext, recipe: LoginFlowRecipe, opts: ExecuteOptions) {
  const { username, password } = credentials(ctx.secret);
  const res = await callJson(
    ctx.env,
    recipe.loginPath,
    recipe.method,
    fill(recipe.bodyTemplate, { username, password }),
    opts,
  );
  // Messages below never include the response body or token.
  if (res.error) throw new AuthError("LOGIN_FAILED", `Login request failed: ${res.error.message}`);
  if (!res.status || res.status >= 400) {
    throw new AuthError("LOGIN_FAILED", `Login returned HTTP ${res.status}`);
  }
  const token = readJsonPath(res.body, recipe.tokenPath);
  if (typeof token !== "string" || !token) {
    throw new AuthError(
      "LOGIN_FAILED",
      `No token found at "${recipe.tokenPath}" in the login response`,
    );
  }
  const entry: CachedToken = { token };
  const rt = recipe.refresh?.refreshTokenPath
    ? readJsonPath(res.body, recipe.refresh.refreshTokenPath)
    : undefined;
  if (typeof rt === "string" && rt) entry.refreshToken = rt;
  return entry;
}

async function refresh(
  ctx: AuthContext,
  recipe: LoginFlowRecipe,
  previous: CachedToken,
  opts: ExecuteOptions,
): Promise<CachedToken | null> {
  const r = recipe.refresh;
  if (!r || !previous.refreshToken) return null;
  const res = await callJson(
    ctx.env,
    r.path,
    r.method,
    fill(r.bodyTemplate, { refreshToken: previous.refreshToken }),
    opts,
  );
  if (res.error || !res.status || res.status >= 400) return null;
  const token = readJsonPath(res.body, r.tokenPath);
  if (typeof token !== "string" || !token) return null;
  const rotated = r.refreshTokenPath ? readJsonPath(res.body, r.refreshTokenPath) : undefined;
  return {
    token,
    refreshToken: typeof rotated === "string" && rotated ? rotated : previous.refreshToken,
  };
}

/** Credentials for the next request. login_flow logs in once and caches the token. */
export async function resolveAuth(
  ctx: AuthContext,
  cache: TokenCache,
  opts: ExecuteOptions = {},
): Promise<ExecAuth> {
  const { recipe } = ctx;
  switch (recipe.type) {
    case "none":
      return {};
    case "static_bearer":
      if (!ctx.secret) throw new AuthError("MISSING_SECRET", "No token is stored for this recipe");
      return { headers: { [recipe.headerName]: `Bearer ${ctx.secret}` } };
    case "api_key":
      if (!ctx.secret)
        throw new AuthError("MISSING_SECRET", "No API key is stored for this recipe");
      return recipe.in === "query"
        ? { query: { [recipe.name]: ctx.secret } }
        : { headers: { [recipe.name]: ctx.secret } };
    case "login_flow": {
      let entry = cache.get(ctx.cacheKey);
      if (!entry) {
        entry = await login(ctx, recipe, opts);
        cache.set(ctx.cacheKey, entry);
      }
      return { headers: loginHeaders(recipe, entry.token) };
    }
  }
}

/**
 * Build and send a request with auth applied. For login_flow, a 401 drops the cached token,
 * gets a fresh one (refresh if configured, else login) and retries exactly once.
 */
export async function executeWithAuth(
  build: (auth: ExecAuth) => BuiltRequest,
  ctx: AuthContext,
  cache: TokenCache,
  opts: ExecuteOptions = {},
): Promise<ExecResult> {
  const first = await execute(build(await resolveAuth(ctx, cache, opts)), opts);
  if (first.status !== 401 || ctx.recipe.type !== "login_flow") return first;

  const recipe = ctx.recipe;
  const previous = cache.get(ctx.cacheKey);
  cache.delete(ctx.cacheKey);
  const renewed =
    (previous && (await refresh(ctx, recipe, previous, opts))) || (await login(ctx, recipe, opts));
  cache.set(ctx.cacheKey, renewed);
  return execute(build({ headers: loginHeaders(recipe, renewed.token) }), opts);
}

export interface AuthTestResult {
  ok: boolean;
  message: string;
}

/** "Test auth": resolves credentials and reports success. Never returns the token. */
export async function testAuth(
  ctx: AuthContext,
  cache: TokenCache,
  opts: ExecuteOptions = {},
): Promise<AuthTestResult> {
  try {
    if (ctx.recipe.type === "login_flow") cache.delete(ctx.cacheKey); // force a real login
    await resolveAuth(ctx, cache, opts);
    return { ok: true, message: ctx.recipe.type === "none" ? "No auth configured" : "Auth works" };
  } catch (err) {
    return { ok: false, message: err instanceof AuthError ? err.message : "Auth test failed" };
  }
}
