import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up) and migrations; skipped when DATABASE_URL is unset.
describe.skipIf(!url)("auth recipes", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let base = "";
  let projectId = "";
  let envId = "";
  let api: typeof import("./auth-recipes");
  let schema: typeof import("./schema");
  let dbc: typeof import("./client");

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("./client");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    api = await import("./auth-recipes");
    schema = await import("./schema");

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    base = `http://localhost:${(mock.address() as AddressInfo).port}`;

    const [p] = await dbc.db
      .insert(schema.projects)
      .values({ name: `auth-${Date.now()}`, specSource: "file" })
      .returning();
    projectId = (p as { id: string }).id;
    const [e] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    envId = (e as { id: string }).id;
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await new Promise<void>((r) => mock.close(() => r()));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  const loginRecipe = { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" };

  it("stores the secret encrypted and returns only its last4", async () => {
    const secret = JSON.stringify({ username: "demo", password: "demo" });
    const meta = await api.saveAuthRecipe({ projectId, recipe: loginRecipe, secret });
    expect(meta.secretLast4).toBe(secret.slice(-4));
    expect(JSON.stringify(meta)).not.toContain('demo"');
    const [row] = await dbc.db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.projectId, projectId));
    expect(row?.ciphertext).not.toContain("demo");
  });

  it("replaces (not duplicates) the recipe for the same scope and drops the old secret", async () => {
    await api.saveAuthRecipe({
      projectId,
      recipe: loginRecipe,
      secret: '{"username":"demo","password":"demo"}',
    });
    expect(await api.listAuthRecipes(projectId)).toHaveLength(1);
    const secretRows = await dbc.db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.projectId, projectId));
    expect(secretRows).toHaveLength(1);
  });

  it("test route logs in for real and never returns the token", async () => {
    const [recipe] = await api.listAuthRecipes(projectId);
    const { POST } = await import(
      "@/app/api/projects/[projectId]/auth-recipes/[recipeId]/test/route"
    );
    const res = await POST(
      new Request("http://app.test", {
        method: "POST",
        body: JSON.stringify({ environmentId: envId }),
      }),
      { params: Promise.resolve({ projectId, recipeId: (recipe as { id: string }).id }) },
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toEqual({ ok: true, message: "Auth works" });
    expect(text).not.toContain("mock-access-token");
  });

  it("PUT route validates the recipe and deleting removes the secret", async () => {
    const { PUT } = await import("@/app/api/projects/[projectId]/auth-recipes/route");
    const ctx = { params: Promise.resolve({ projectId }) };
    const bad = await PUT(
      new Request("http://app.test", {
        method: "PUT",
        body: JSON.stringify({ recipe: { type: "magic" } }),
      }),
      ctx,
    );
    expect(bad.status).toBe(400);
    const [recipe] = await api.listAuthRecipes(projectId);
    expect(await api.deleteAuthRecipe(projectId, (recipe as { id: string }).id)).toBe(true);
    expect(await api.listAuthRecipes(projectId)).toHaveLength(0);
    const left = await dbc.db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.projectId, projectId));
    expect(left).toHaveLength(0);
  });

  it("falls back to none when nothing is configured", async () => {
    expect(await api.loadAuthContext(projectId, envId)).toEqual({
      recipe: { type: "none" },
      secret: null,
    });
  });
});
