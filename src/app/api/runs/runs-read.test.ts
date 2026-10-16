import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("runs read API", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let projectId = "";
  let envId = "";
  let moduleId = "";
  let runId = "";
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let LIST: typeof import("./route").GET;
  let DETAIL: typeof import("./[id]/route").GET;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    const { POST, GET } = await import("./route");
    LIST = GET;
    ({ GET: DETAIL } = await import("./[id]/route"));
    const { importProject } = await import("@/db/projects");
    const { saveAuthRecipe } = await import("@/db/auth-recipes");

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    const base = `http://localhost:${(mock.address() as AddressInfo).port}`;

    const project = await importProject({
      name: `runs-read-${Date.now()}`,
      source: {
        text: readFileSync("fixtures/specs/messy-v3.json", "utf8"),
        filename: "messy.json",
      },
    });
    projectId = project.id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    envId = (env as { id: string }).id;
    const mods = await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.projectId, projectId));
    moduleId = (mods.find((m) => m.name === "Auth") as { id: string }).id;
    await saveAuthRecipe({
      projectId,
      recipe: { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" },
      secret: JSON.stringify({ username: "demo", password: "demo" }),
    });

    const res = await POST(
      new Request("http://app.test/api/runs", {
        method: "POST",
        body: JSON.stringify({ projectId, environmentId: envId, moduleId }),
      }),
    );
    runId = (await res.json()).runId;
    // Wait for the run to finish.
    for (let i = 0; i < 100; i++) {
      const [r] = await dbc.db.select().from(schema.runs).where(eq(schema.runs.id, runId));
      if (r?.status !== "running") break;
      await new Promise((r) => setTimeout(r, 50));
    }
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await new Promise<void>((r) => mock.close(() => r()));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it("lists runs with names and counts, filtered by project", async () => {
    const res = await LIST(new Request(`http://app.test/api/runs?projectId=${projectId}`));
    const { runs } = await res.json();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: runId,
      moduleName: "Auth",
      environmentName: "mock",
      isProd: false,
      status: "done",
      resultCount: 3,
      skippedCount: 2, // login + refresh are POSTs
      errorCount: 0,
    });
    expect(runs[0].finishedAt).toBeTruthy();
  });

  it("returns run detail with stored results", async () => {
    const res = await DETAIL(new Request("http://app.test"), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.status).toBe(200);
    const { run, results } = await res.json();
    expect(run.projectName).toContain("runs-read");
    expect(results).toHaveLength(3);
    const me = results.find((r: { stableKey: string }) => r.stableKey === "GET /api/v1/auth/me");
    expect(me).toMatchObject({ method: "GET", statusCode: 200, severity: "ok", skipReason: null });
    expect(JSON.parse(me.responseBody)).toMatchObject({ id: "u1" });
    expect(JSON.stringify(me.request)).not.toContain("mock-access-token");
    const skipped = results.filter((r: { skipReason: string | null }) => r.skipReason);
    expect(skipped).toHaveLength(2);
  });

  it("validates ids and reports unknown runs", async () => {
    expect((await LIST(new Request("http://app.test/api/runs?projectId=nope"))).status).toBe(400);
    expect(
      (await DETAIL(new Request("http://app.test"), { params: Promise.resolve({ id: "nope" }) }))
        .status,
    ).toBe(400);
    const missing = await DETAIL(new Request("http://app.test"), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(missing.status).toBe(404);
  });
});
