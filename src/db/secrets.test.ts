import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Load this checkout's .env so the test hits its own database (each Orca
// worktree uses a different apilens_<workspace> DB). dotenv never overrides
// variables that are already set.
config();

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/apilens";
// The .env placeholder is not a usable key; tests always use a real one.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

/** True when the database is reachable and the migrations are applied. */
async function databaseReady(): Promise<boolean> {
  try {
    const { pool } = await import("./client");
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("connection timeout")), 2000),
      ),
    ]);
    try {
      await client.query("select 1 from secrets limit 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

const dbReady = await databaseReady();

if (!dbReady) {
  console.warn("secrets.test.ts: database not reachable — skipping integration tests");
}

describe.skipIf(!dbReady)("secrets storage", () => {
  let projectId: string;
  let secretId: string;

  const load = () => import("./secrets");

  beforeAll(async () => {
    const { db } = await import("./client");
    const { projects } = await import("./schema");
    const [project] = await db
      .insert(projects)
      .values({ name: `t04-secrets-test-${randomUUID()}`, specSource: "file" })
      .returning({ id: projects.id });
    projectId = project.id;
  });

  afterAll(async () => {
    const { db, pool } = await import("./client");
    const { projects } = await import("./schema");
    if (projectId) await db.delete(projects).where(eq(projects.id, projectId));
    await pool.end().catch(() => {});
  });

  it("saves a secret and returns only masked metadata", async () => {
    const { saveSecret } = await load();
    const meta = await saveSecret({
      projectId,
      kind: "api_token",
      value: "sk_live_abcd1234efgh5678",
    });
    secretId = meta.id;

    expect(meta.projectId).toBe(projectId);
    expect(meta.kind).toBe("api_token");
    expect(meta.last4).toBe("5678");
    // never the value, ciphertext, iv or auth tag
    expect(JSON.stringify(meta)).not.toContain("sk_live");
    expect(JSON.stringify(meta)).not.toContain("ciphertext");
  });

  it("reads the secret back decrypted (server-side)", async () => {
    const { readSecret } = await load();
    await expect(readSecret(secretId)).resolves.toBe("sk_live_abcd1234efgh5678");
  });

  it("returns null for an unknown id", async () => {
    const { readSecret } = await load();
    await expect(readSecret(randomUUID())).resolves.toBeNull();
  });

  it("lists masked secrets for a project only", async () => {
    const { listSecretsMasked, saveSecret } = await load();
    const other = await saveSecret({ kind: "password", value: "hunter2hunter2" }); // no project
    try {
      const rows = await listSecretsMasked(projectId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: secretId, last4: "5678", kind: "api_token" });
      // masked rows never carry ciphertext material
      expect(JSON.stringify(rows)).not.toContain("ciphertext");
      expect(JSON.stringify(rows)).not.toContain("sk_live");
    } finally {
      const { db } = await import("./client");
      const { secrets } = await import("./schema");
      await db.delete(secrets).where(eq(secrets.id, other.id));
    }
  });
});
