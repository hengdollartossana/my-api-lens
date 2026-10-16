import { afterAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/apilens";

describe("db client", () => {
  const load = () => import("./client");

  afterAll(async () => {
    const { pool } = await load();
    await pool.end();
  });

  it("exports a drizzle db", async () => {
    const { db } = await load();
    expect(typeof db.select).toBe("function");
  });

  it("reuses one pool across reloads", async () => {
    const first = (await load()).pool;
    const g = globalThis as unknown as { __apilensPool?: unknown };
    expect(g.__apilensPool).toBe(first);
  });
});
