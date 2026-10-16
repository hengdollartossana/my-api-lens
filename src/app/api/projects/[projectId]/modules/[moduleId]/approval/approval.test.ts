import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("module approval", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let projects: typeof import("@/db/projects");
  let route: typeof import("./route");
  let projectId = "";
  let moduleId = "";
  let endpointId = "";
  let environmentId = "";
  const spec = JSON.parse(readFileSync("fixtures/specs/messy-v3.json", "utf8"));

  const ctx = () => ({ params: Promise.resolve({ projectId, moduleId }) });
  const approve = (body?: unknown) =>
    route.POST(
      new Request("http://app.test", { method: "POST", body: JSON.stringify(body ?? {}) }),
      ctx(),
    );
  const state = async () => {
    const [m] = await dbc.db.select().from(schema.modules).where(eq(schema.modules.id, moduleId));
    return m as typeof schema.modules.$inferSelect;
  };

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    projects = await import("@/db/projects");
    route = await import("./route");
    projectId = (
      await projects.importProject({
        name: `approval-${Date.now()}`,
        source: { text: JSON.stringify(spec), filename: "s.json" },
      })
    ).id;
    const [mod] = await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.projectId, projectId));
    moduleId = (mod as { id: string }).id;
    const [ep] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.moduleId, moduleId));
    endpointId = (ep as { id: string }).id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "dev", baseUrl: "http://localhost:1" })
      .returning();
    environmentId = (env as { id: string }).id;
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
  });

  it("is blocked by an error diff unless approved with known issues", async () => {
    const [run] = await dbc.db
      .insert(schema.runs)
      .values({ projectId, environmentId, moduleId, status: "done" })
      .returning();
    await dbc.db.insert(schema.runResults).values({
      runId: (run as { id: string }).id,
      endpointId,
      severity: "error",
      diff: [{ kind: "status", severity: "error", path: "status", message: "boom" }],
    });

    const blocked = await approve();
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("HAS_ERRORS");
    expect((await state()).status).not.toBe("approved");

    const res = await approve({ knownIssues: true });
    expect(res.status).toBe(200);
    const m = await state();
    expect(m.status).toBe("approved");
    expect(m.approvedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(m.approvedAt).not.toBeNull();
  });

  it("flips to needs_review when a re-import changes the module", async () => {
    const [mod] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.id, endpointId));
    const changed = structuredClone(spec);
    const [path, method] =
      [...Object.entries(spec.paths as Record<string, Record<string, unknown>>)]
        .flatMap(([p, ops]) => Object.keys(ops).map((m) => [p, m] as const))
        .find(
          ([p, m]) =>
            (mod as { path: string; method: string }).path.replace(/\{[^}]*\}/g, "{}") ===
              p.replace(/\{[^}]*\}/g, "{}") &&
            m.toUpperCase() === (mod as { method: string }).method,
        ) ?? [];
    expect(path).toBeDefined();
    changed.paths[path as string][method as string].responses["299"] = { description: "new" };

    const { changes } = await projects.reimportProject(projectId, {
      text: JSON.stringify(changed),
      filename: "s.json",
    });
    expect(changes.needsReview.length).toBeGreaterThan(0);
    expect((await state()).status).toBe("needs_review");
  });

  it("revokes back to draft and clears the hash", async () => {
    const res = await route.DELETE(new Request("http://app.test", { method: "DELETE" }), ctx());
    expect(res.status).toBe(200);
    const m = await state();
    expect(m.status).toBe("draft");
    expect(m.approvedHash).toBeNull();
  });

  it("approves cleanly once there are no errors", async () => {
    await dbc.db.delete(schema.runs).where(eq(schema.runs.projectId, projectId));
    expect((await approve()).status).toBe(200);
    expect((await state()).status).toBe("approved");
  });
});
