import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("running with AI-filled request data", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let projectId = "";
  let envId = "";
  let postUserId = "";
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let ai: typeof import("@/db/ai");
  let svc: typeof import("@/lib/run-service");
  let POST: typeof import("./route").POST;
  let DETAIL: typeof import("./[id]/route").GET;
  let occupied = false;
  let reply = "";

  const fake = {
    messages: {
      create: async () => {
        if (reply === "THROW") throw new Error("boom");
        return {
          model: "claude-sonnet-5-5",
          stop_reason: "end_turn",
          content: [{ type: "text", text: reply }],
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  } as never;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ai = await import("@/db/ai");
    svc = await import("@/lib/run-service");
    ({ POST } = await import("./route"));
    ({ GET: DETAIL } = await import("./[id]/route"));
    const { importProject } = await import("@/db/projects");
    const { saveAuthRecipe } = await import("@/db/auth-recipes");
    occupied = (await ai.getAiSettings()).hasKey;

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    const base = `http://localhost:${(mock.address() as AddressInfo).port}`;
    const project = await importProject({
      name: `ai-fill-${Date.now()}`,
      source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
    });
    projectId = project.id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    envId = (env as { id: string }).id;
    const [ep] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId))
      .then((rows) => rows.filter((r) => r.stableKey === "POST /api/v1/{}/users"));
    postUserId = (ep as { id: string }).id;
    await saveAuthRecipe({
      projectId,
      recipe: { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" },
      secret: JSON.stringify({ username: "demo", password: "demo" }),
    });
  });

  afterAll(async () => {
    if (!occupied) {
      await ai.removeAiKey();
      await dbc.db.delete(schema.settings).where(eq(schema.settings.key, "ai"));
    }
    await dbc.db.delete(schema.aiCalls).where(inArray(schema.aiCalls.purpose, ["test-data"]));
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await new Promise<void>((r) => mock.close(() => r()));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  async function finished(runId: string) {
    for (let i = 0; i < 100; i++) {
      const res = await DETAIL(new Request("http://app.test"), {
        params: Promise.resolve({ id: runId }),
      });
      const detail = await res.json();
      if (detail.run.status !== "running") return detail;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("run did not finish");
  }

  const start = (deps?: { anthropicClient: never }) =>
    svc.startRun(
      {
        projectId,
        environmentId: envId,
        endpointIds: [postUserId],
        confirmDestructive: true,
        aiFill: true,
      },
      deps,
    );

  it("is rejected with AI_DISABLED when no key is configured", async () => {
    if (occupied) return;
    const res = await POST(
      new Request("http://app.test/api/runs", {
        method: "POST",
        body: JSON.stringify({ projectId, environmentId: envId, aiFill: true }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("AI_DISABLED");
  });

  it("sends the AI's values in the request", async () => {
    if (occupied) return;
    await ai.saveAiSettings({ provider: "anthropic", apiKey: "sk-ant-test-1234" });
    reply = JSON.stringify({
      endpoints: [
        {
          id: 1,
          pathParams: { tenant: "acme" },
          body: { email: "ana.lopez@acme.io", name: "Ana Lopez" },
        },
      ],
    });
    const started = await start({ anthropicClient: fake });
    expect(started.aiFill).toMatchObject({ used: true, filled: 1 });
    const [result] = (await finished(started.runId)).results;
    expect(result.request.url).toContain("/api/v1/acme/users");
    expect(JSON.parse(result.request.body)).toEqual({
      email: "ana.lopez@acme.io",
      name: "Ana Lopez",
    });
  });

  it("falls back to sampled values when the AI call fails", async () => {
    if (occupied) return;
    reply = "THROW";
    const started = await start({ anthropicClient: fake });
    expect(started.aiFill).toMatchObject({ used: false, filled: 0 });
    const [result] = (await finished(started.runId)).results;
    expect(result.request.url).toContain("/api/v1/");
    expect(result.statusCode).not.toBeNull();
  });
});
