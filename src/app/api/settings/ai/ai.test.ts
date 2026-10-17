import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("AI settings", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let ai: typeof import("@/db/ai");
  let route: typeof import("./route");
  // The suite uses the shared dev database; never touch a key someone really saved.
  let occupied = false;

  const put = (body: unknown) =>
    route.PUT(new Request("http://app.test", { method: "PUT", body: JSON.stringify(body) }));
  const fake = {
    messages: {
      create: async () => ({
        model: "claude-sonnet-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 2000, output_tokens: 1000 },
      }),
    },
  } as never;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ai = await import("@/db/ai");
    route = await import("./route");
    occupied = (await ai.getAiSettings()).hasKey;
  });

  afterAll(async () => {
    if (!occupied) {
      await ai.removeAiKey();
      await dbc.db.delete(schema.settings).where(eq(schema.settings.key, "ai"));
    }
    await dbc.db.delete(schema.aiCalls).where(inArray(schema.aiCalls.purpose, ["t", "test"]));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it("is disabled without a key", async (ctx) => {
    if (occupied) return ctx.skip();
    const s = await (await route.GET()).json();
    expect(s.settings.hasKey).toBe(false);
    expect(await ai.aiEnabled()).toBe(false);
    await expect(ai.runAi("t", { prompt: "x" }, fake)).rejects.toBeInstanceOf(ai.AiDisabledError);
  });

  it("stores the key encrypted and never returns it", async (ctx) => {
    if (occupied) return ctx.skip();
    const res = await put({
      apiKey: "sk-ant-secret-1234",
      model: "claude-sonnet-5-5",
      monthlyBudgetUsd: 0.01,
    });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("sk-ant-secret");
    expect(JSON.parse(text).settings).toMatchObject({ hasKey: true, keyMasked: "••••1234" });
    expect(JSON.stringify(await (await route.GET()).json())).not.toContain("sk-ant-secret");
    const rows = await dbc.db
      .select()
      .from(schema.secrets)
      .where(eq(schema.secrets.kind, "ai_key"));
    expect(rows.some((r) => r.ciphertext.includes("sk-ant"))).toBe(false);
  });

  it("records tokens and cost per call and flags the soft budget", async (ctx) => {
    if (occupied) return ctx.skip();
    const r = await ai.runAi("test", { prompt: "hi" }, fake);
    expect(r.costUsd).toBe(0.014);
    const calls = await dbc.db.select().from(schema.aiCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      purpose: "test",
      inputTokens: 2000,
      outputTokens: 1000,
      costUsd: 0.014,
    });
    const s = await ai.getAiSettings();
    expect(s.monthSpendUsd).toBeGreaterThanOrEqual(0.014);
    expect(s.overBudget).toBe(true);
  });

  it("replaces the key without leaving the old one, and removes it", async (ctx) => {
    if (occupied) return ctx.skip();
    await put({ apiKey: "sk-ant-other-9999" });
    expect(
      await dbc.db.select().from(schema.secrets).where(eq(schema.secrets.kind, "ai_key")),
    ).toHaveLength(1);
    expect((await ai.removeAiKey()).hasKey).toBe(false);
    expect(
      await dbc.db.select().from(schema.secrets).where(eq(schema.secrets.kind, "ai_key")),
    ).toHaveLength(0);
  });

  it("rejects an unknown model", async (ctx) => {
    if (occupied) return ctx.skip();
    expect((await put({ model: "gpt-4" })).status).toBe(400);
    expect((await put({ provider: "google", model: "claude-opus-5-5" })).status).toBe(400);
  });
});
