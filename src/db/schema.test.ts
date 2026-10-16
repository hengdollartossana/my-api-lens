import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endpoints, modules, projects } from "./schema";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("schema", () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("inserts and reads a project", async () => {
    const [p] = await db
      .insert(projects)
      .values({ name: `smoke-${Date.now()}`, specSource: "url", specUrl: "http://x" })
      .returning();
    const [read] = await db.select().from(projects).where(eq(projects.id, p.id));
    expect(read.name).toBe(p.name);
    expect(read.createdAt).toBeInstanceOf(Date);
    await db.delete(projects).where(eq(projects.id, p.id));
  });

  it("enforces unique (project, stable_key) and (project, module name)", async () => {
    const [p] = await db
      .insert(projects)
      .values({ name: `uq-${Date.now()}`, specSource: "file" })
      .returning();
    try {
      const ep = { projectId: p.id, stableKey: "GET /a/{}", method: "GET", path: "/a/{id}" };
      await db.insert(endpoints).values(ep);
      await expect(db.insert(endpoints).values(ep)).rejects.toThrow();
      await db.insert(modules).values({ projectId: p.id, name: "m", via: "tag" });
      await expect(
        db.insert(modules).values({ projectId: p.id, name: "m", via: "path" }),
      ).rejects.toThrow();
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
