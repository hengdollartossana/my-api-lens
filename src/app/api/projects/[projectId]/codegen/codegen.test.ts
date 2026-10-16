import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("codegen route", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let POST: typeof import("./route").POST;
  let projectId = "";
  let moduleIds: string[] = [];
  let userModuleId = "";

  const gen = (body: Record<string, unknown>) =>
    POST(
      new Request("http://app.test", {
        method: "POST",
        body: JSON.stringify({ target: "flutter", ...body }),
      }),
      { params: Promise.resolve({ projectId }) },
    );

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST } = await import("./route"));
    const { importProject } = await import("@/db/projects");
    projectId = (
      await importProject({
        name: `codegen-${Date.now()}`,
        source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
      })
    ).id;
    const mods = await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.projectId, projectId));
    moduleIds = mods.map((m) => m.id);
    userModuleId = (mods.find((m) => m.name === "User") as { id: string }).id;
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
  });

  it("generates the Flutter layout for the selected modules only", async () => {
    const res = await gen({ moduleIds: [userModuleId] });
    expect(res.status).toBe(200);
    const { files, unapproved } = await res.json();
    const paths = files.map((f: { path: string }) => f.path);
    expect(paths).toContain("lib/api/user/user_client.dart");
    expect(paths).toContain("lib/api/models/user.dart");
    expect(paths.some((p: string) => p.startsWith("lib/api/order/"))).toBe(false);
    expect(paths.some((p: string) => p.startsWith("test/"))).toBe(false);
    expect(unapproved).toEqual(["User"]);
    expect(await (await gen({ moduleIds: [userModuleId] })).json()).toEqual({ files, unapproved });
  });

  it("adds contract tests from recorded 2xx responses only", async () => {
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "dev", baseUrl: "http://localhost:1" })
      .returning();
    const [run] = await dbc.db
      .insert(schema.runs)
      .values({ projectId, environmentId: (env as { id: string }).id, status: "done" })
      .returning();
    const [ep] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(
        and(
          eq(schema.endpoints.projectId, projectId),
          eq(schema.endpoints.stableKey, "GET /api/v1/{}/users"),
        ),
      );
    await dbc.db.insert(schema.runResults).values({
      runId: (run as { id: string }).id,
      endpointId: (ep as { id: string }).id,
      statusCode: 200,
      responseBody: JSON.stringify([
        { id: "u1", name: "A", email: "a@b.c", token: "secret-value" },
      ]),
    });
    const { files } = await (
      await gen({ moduleIds, contractTests: true, packageName: "my_app" })
    ).json();
    const test = files.find((f: { path: string }) => f.path === "test/api/user_contract_test.dart");
    expect(test.content).toContain("package:my_app/api/api.dart");
    const all = files.map((f: { content: string }) => f.content).join("\n");
    expect(all).not.toContain("secret-value");
  });

  it("rejects bad input and unknown modules", async () => {
    expect((await gen({ moduleIds: ["nope"] })).status).toBe(400);
    expect((await gen({ moduleIds: [], target: "swift" })).status).toBe(400);
    expect((await gen({ moduleIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
    expect((await gen({ moduleIds, packageName: "Bad-Name" })).status).toBe(400);
  });
});
