import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

const spec = {
  openapi: "3.0.3",
  info: { title: "Leftovers", version: "1" },
  // Without security the grouper would file these under Auth instead of leaving them ungrouped.
  security: [{ key: [] }],
  components: { securitySchemes: { key: { type: "apiKey", in: "header", name: "x-key" } } },
  paths: {
    "/{a}/{b}": { get: { responses: { "200": { description: "ok" } } } },
    "/{a}/{b}/{c}": {
      get: { summary: "Fetch the thing", responses: { "200": { description: "ok" } } },
      delete: { responses: { "204": { description: "gone" } } },
    },
  },
};

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("AI grouping of Ungrouped endpoints", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let ai: typeof import("@/db/ai");
  let grouping: typeof import("@/db/ai-grouping");
  let PROPOSE: typeof import("./route").POST;
  let APPLY: typeof import("./apply/route").POST;
  let projectId = "";
  // The suite shares the dev database; never touch a key someone really saved.
  let occupied = false;
  const sent: string[] = [];

  const fake = (reply: (prompt: string) => unknown) =>
    ({
      messages: {
        create: async (p: { messages: { content: string }[] }) => {
          const prompt = p.messages[0]?.content ?? "";
          sent.push(prompt);
          return {
            model: "claude-sonnet-5-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify(reply(prompt)) }],
            usage: { input_tokens: 500, output_tokens: 200 },
          };
        },
      },
    }) as never;

  const moduleOf = async (stableKey: string) => {
    const [row] = await dbc.db
      .select({ name: schema.modules.name, via: schema.modules.via })
      .from(schema.endpoints)
      .leftJoin(schema.modules, eq(schema.modules.id, schema.endpoints.moduleId))
      .where(
        and(eq(schema.endpoints.projectId, projectId), eq(schema.endpoints.stableKey, stableKey)),
      );
    return row;
  };

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ai = await import("@/db/ai");
    grouping = await import("@/db/ai-grouping");
    ({ POST: PROPOSE } = await import("./route"));
    ({ POST: APPLY } = await import("./apply/route"));
    occupied = (await ai.getAiSettings()).hasKey;
    const { importProject } = await import("@/db/projects");
    projectId = (
      await importProject({
        name: `ai-grouping-${Date.now()}`,
        source: { text: JSON.stringify(spec), filename: "s.json" },
      })
    ).id;
  });

  afterAll(async () => {
    if (!occupied) {
      await ai.removeAiKey();
      await dbc.db.delete(schema.settings).where(eq(schema.settings.key, "ai"));
    }
    await dbc.db.delete(schema.aiCalls).where(inArray(schema.aiCalls.purpose, ["grouping"]));
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  const post = (body?: unknown) =>
    APPLY(new Request("http://app.test", { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ projectId }),
    });

  it("starts with the endpoints in Ungrouped and is disabled without a key", async (ctx) => {
    if (occupied) return ctx.skip();
    expect((await moduleOf("GET /{}/{}"))?.name).toBe("Ungrouped");
    const res = await PROPOSE(new Request("http://app.test", { method: "POST" }), {
      params: Promise.resolve({ projectId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("AI_DISABLED");
  });

  it("proposes without changing anything, sending one-liners only", async (ctx) => {
    if (occupied) return ctx.skip();
    await ai.saveAiSettings({ apiKey: "sk-ant-test-0000", model: "claude-sonnet-5-5" });
    const r = await grouping.proposeGrouping(
      projectId,
      fake(() => ({
        assignments: [
          { id: 1, module: "Things" },
          { id: 2, module: "Things" },
        ],
      })),
    );
    expect(r.suggestions.map((s) => s.module)).toEqual(["Thing", "Thing"]);
    expect(r.suggestions.every((s) => s.isNew)).toBe(true);
    expect(r.costUsd).toBeGreaterThan(0);
    expect(sent.at(-1)).toContain("Fetch the thing");
    expect(sent.at(-1)).not.toMatch(/responses|schema|200/);
    // never auto-applied
    expect((await moduleOf("GET /{}/{}/{}"))?.name).toBe("Ungrouped");
    const calls = await dbc.db
      .select()
      .from(schema.aiCalls)
      .where(eq(schema.aiCalls.purpose, "grouping"));
    expect(calls).toHaveLength(1);
  });

  it("applies only the approved proposals, as AI-created modules", async (ctx) => {
    if (occupied) return ctx.skip();
    const res = await post({ assignments: [{ stableKey: "GET /{}/{}/{}", module: "Things" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: 1, createdModules: ["Thing"] });
    expect(await moduleOf("GET /{}/{}/{}")).toEqual({ name: "Thing", via: "ai" });
    expect((await moduleOf("DELETE /{}/{}/{}"))?.name).toBe("Ungrouped");
  });

  it("rejects bad assignments", async () => {
    expect((await post({ assignments: [{ stableKey: "GET /nope", module: "X" }] })).status).toBe(
      404,
    );
    expect(
      (await post({ assignments: [{ stableKey: "GET /{}/{}", module: "Ungrouped" }] })).status,
    ).toBe(400);
    expect((await post({ nope: true })).status).toBe(400);
  });
});
