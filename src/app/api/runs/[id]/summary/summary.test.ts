import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("AI run summary", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let ai: typeof import("@/db/ai");
  let sum: typeof import("@/db/ai-summary");
  let route: typeof import("./route");
  let projectId = "";
  let envId = "";
  let runWithDiffs = "";
  let cleanRun = "";
  // The suite shares the dev database; never touch a key someone really saved.
  let occupied = false;
  const prompts: string[] = [];

  const fake = {
    messages: {
      create: async (p: { messages: { content: string }[] }) => {
        prompts.push(p.messages[0]?.content ?? "");
        return {
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Users returns an extra field; fix the client first." }],
          usage: { input_tokens: 400, output_tokens: 80 },
        };
      },
    },
  } as never;

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (id: string, body: unknown = {}) =>
    route.POST(
      new Request("http://app.test", { method: "POST", body: JSON.stringify(body) }),
      ctx(id),
    );

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ai = await import("@/db/ai");
    sum = await import("@/db/ai-summary");
    route = await import("./route");
    occupied = (await ai.getAiSettings()).hasKey;

    const [p] = await dbc.db
      .insert(schema.projects)
      .values({ name: `summary-${Date.now()}`, specSource: "file" })
      .returning();
    projectId = (p as { id: string }).id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "dev", baseUrl: "http://localhost:1" })
      .returning();
    envId = (env as { id: string }).id;
    const [ep] = await dbc.db
      .insert(schema.endpoints)
      .values({ projectId, stableKey: "GET /users", method: "GET", path: "/users" })
      .returning();
    const mkRun = async (status: "done" | "running", diff: unknown) => {
      const [r] = await dbc.db
        .insert(schema.runs)
        .values({ projectId, environmentId: envId, status })
        .returning();
      const id = (r as { id: string }).id;
      await dbc.db.insert(schema.runResults).values({
        runId: id,
        endpointId: (ep as { id: string }).id,
        statusCode: 200,
        diff: diff as never,
      });
      return id;
    };
    runWithDiffs = await mkRun("done", [
      {
        kind: "extra_field",
        severity: "warn",
        path: "$[0].internalNote",
        message: "Field not in spec",
        expected: "undefined",
        actual: "PLANTED-SECRET-VALUE",
      },
    ]);
    cleanRun = await mkRun("done", []);
  });

  afterAll(async () => {
    if (!occupied) {
      await ai.removeAiKey();
      await dbc.db.delete(schema.settings).where(eq(schema.settings.key, "ai"));
    }
    await dbc.db.delete(schema.aiCalls).where(inArray(schema.aiCalls.purpose, ["diff-summary"]));
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it("is disabled without a key", async (t) => {
    if (occupied) return t.skip();
    const res = await post(runWithDiffs);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("AI_DISABLED");
    expect(
      (await (await route.GET(new Request("http://app.test"), ctx(runWithDiffs))).json()).aiEnabled,
    ).toBe(false);
  });

  it("summarises findings only, then re-shows the stored summary without another call", async (t) => {
    if (occupied) return t.skip();
    await ai.saveAiSettings({ apiKey: "sk-ant-test-1111", model: "claude-sonnet-5-5" });

    const first = await sum.summarizeRun(runWithDiffs, {}, fake);
    expect(first.cached).toBe(false);
    expect(first.summary?.text).toContain("extra field");
    expect(first.summary?.costUsd).toBeGreaterThan(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("GET /users $[0].internalNote");
    expect(prompts[0]).not.toContain("PLANTED-SECRET-VALUE");

    const again = await sum.summarizeRun(runWithDiffs, {}, fake);
    expect(again.cached).toBe(true);
    expect(again.summary).toEqual(first.summary);
    const viaRoute = await (await post(runWithDiffs)).json();
    expect(viaRoute.cached).toBe(true);
    expect(prompts).toHaveLength(1); // no further AI calls
    expect((await sum.getRunSummary(runWithDiffs))?.text).toBe(first.summary?.text);

    await sum.summarizeRun(runWithDiffs, { refresh: true }, fake);
    expect(prompts).toHaveLength(2);
  });

  it("makes no call when there is nothing to summarise or the run is still going", async (t) => {
    if (occupied) return t.skip();
    const before = prompts.length;
    expect(await sum.summarizeRun(cleanRun, {}, fake)).toEqual({
      summary: null,
      cached: false,
      noFindings: true,
    });
    const [running] = await dbc.db
      .insert(schema.runs)
      .values({ projectId, environmentId: envId, status: "running" })
      .returning();
    const res = await post((running as { id: string }).id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("RUN_ACTIVE");
    expect(prompts).toHaveLength(before);
  });

  it("rejects bad or unknown run ids", async () => {
    expect((await post("nope")).status).toBe(400);
    expect((await post("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
