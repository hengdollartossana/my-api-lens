import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projects, secrets } from "./schema";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("secrets", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let api: typeof import("./secrets");
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    // A valid test key, independent of whatever .env provides.
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    api = await import("./secrets");
    pool = new Pool({ connectionString: url });
    db = drizzle(pool);
    await migrate(db, { migrationsFolder: "src/db/migrations" });
  });

  afterAll(async () => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    const { pool: clientPool } = await import("./client");
    await clientPool.end();
    await pool.end();
  });

  it("saveSecret stores ciphertext and returns only masked metadata", async () => {
    const [project] = await db
      .insert(projects)
      .values({ name: `secrets-${Date.now()}`, specSource: "url", specUrl: "http://x" })
      .returning();
    try {
      const saved = await api.saveSecret({
        projectId: project.id,
        kind: "api_token",
        value: "tok-abcd1234",
      });
      expect(saved.id).toBeTruthy();
      expect(saved.projectId).toBe(project.id);
      expect(saved.kind).toBe("api_token");
      expect(saved.last4).toBe("1234");
      expect(saved).not.toHaveProperty("ciphertext");
      expect(saved).not.toHaveProperty("value");

      // The row itself does hold the encrypted material.
      const [row] = await db.select().from(secrets).where(eq(secrets.id, saved.id));
      expect(row.ciphertext).toBeTruthy();
      expect(row.ciphertext).not.toContain("tok-abcd1234");
    } finally {
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  });

  it("saveSecret stores a global secret (null project) and rejects invalid input", async () => {
    const global = await api.saveSecret({ kind: "ai_key", value: "sk-ant-test-9876" });
    expect(global.projectId).toBeNull();
    expect(global.last4).toBe("9876");
    await db.delete(secrets).where(eq(secrets.id, global.id));

    await expect(api.saveSecret({ kind: "password", value: "" })).rejects.toThrow();
    await expect(
      api.saveSecret({ projectId: "not-a-uuid", kind: "password", value: "x" }),
    ).rejects.toThrow();
  });

  it("readSecret decrypts a stored secret and returns null for unknown ids", async () => {
    const saved = await api.saveSecret({ kind: "password", value: "hunter2" });
    try {
      expect(await api.readSecret(saved.id)).toBe("hunter2");
      expect(await api.readSecret("00000000-0000-0000-0000-000000000000")).toBeNull();
    } finally {
      await db.delete(secrets).where(eq(secrets.id, saved.id));
    }
  });

  it("listSecretsMasked never returns ciphertext material and filters by project", async () => {
    await db.delete(secrets); // deterministic counts
    const [project] = await db
      .insert(projects)
      .values({ name: `secrets-list-${Date.now()}`, specSource: "file" })
      .returning();
    const global = await api.saveSecret({ kind: "other", value: "glob-9999" });
    const scoped = await api.saveSecret({
      projectId: project.id,
      kind: "api_token",
      value: "tok-7777",
    });
    try {
      const all = await api.listSecretsMasked();
      expect(all).toHaveLength(2);
      for (const row of all) {
        expect(row).not.toHaveProperty("ciphertext");
        expect(row).not.toHaveProperty("iv");
        expect(row).not.toHaveProperty("authTag");
        expect(row).not.toHaveProperty("value");
      }
      const onlyProject = await api.listSecretsMasked(project.id);
      expect(onlyProject.map((row) => row.id)).toEqual([scoped.id]);
      expect(onlyProject[0].last4).toBe("7777");
    } finally {
      await db.delete(secrets).where(eq(secrets.id, global.id));
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  });
});
