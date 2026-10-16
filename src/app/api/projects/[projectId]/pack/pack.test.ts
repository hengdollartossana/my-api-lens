import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("context pack route", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let POST: typeof import("./route").POST;
  let projectId = "";
  let moduleIds: string[] = [];

  const pack = (body: unknown) =>
    POST(new Request("http://app.test", { method: "POST", body: JSON.stringify(body) }), {
      params: Promise.resolve({ projectId }),
    });

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST } = await import("./route"));
    const { importProject } = await import("@/db/projects");
    projectId = (
      await importProject({
        name: `pack-${Date.now()}`,
        source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
      })
    ).id;
    moduleIds = (
      await dbc.db.select().from(schema.modules).where(eq(schema.modules.projectId, projectId))
    ).map((m) => m.id);
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
  });

  it("builds a pack with a token estimate and lists unapproved modules", async () => {
    const res = await pack({ moduleIds });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.markdown).toContain("Base URL: `{{BASE_URL}}`");
    expect(body.markdown).toContain("`GET /api/v1/{tenant}/users`");
    expect(body.tokens).toBe(Math.ceil(body.markdown.length / 4));
    expect(body.unapproved).toHaveLength(moduleIds.length);
  });

  it("stops listing a module once it is approved", async () => {
    await dbc.db
      .update(schema.modules)
      .set({ status: "approved" })
      .where(eq(schema.modules.id, moduleIds[0] as string));
    const body = await (await pack({ moduleIds })).json();
    expect(body.unapproved).toHaveLength(moduleIds.length - 1);
  });

  it("rejects bad input and unknown modules", async () => {
    expect((await pack({ moduleIds: ["nope"] })).status).toBe(400);
    expect((await pack({ moduleIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(404);
  });
});
