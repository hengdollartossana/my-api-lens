import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("sending one endpoint with an edited request", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let projectId = "";
  let envId = "";
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let POST: typeof import("./route").POST;
  let DETAIL: typeof import("./[id]/route").GET;
  const ids = new Map<string, string>();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST } = await import("./route"));
    ({ GET: DETAIL } = await import("./[id]/route"));
    const { importProject } = await import("@/db/projects");
    const { saveAuthRecipe } = await import("@/db/auth-recipes");

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    const base = `http://localhost:${(mock.address() as AddressInfo).port}`;
    const project = await importProject({
      name: `runs-input-${Date.now()}`,
      source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
    });
    projectId = project.id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    envId = (env as { id: string }).id;
    const eps = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId));
    for (const e of eps) ids.set(e.stableKey, e.id);
    await saveAuthRecipe({
      projectId,
      recipe: { type: "login_flow", loginPath: "/api/v1/auth/login", tokenPath: "token" },
      secret: JSON.stringify({ username: "demo", password: "demo" }),
    });
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await new Promise<void>((r) => mock.close(() => r()));
    await dbc.pool.end();
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  const send = (endpoint: string, extra: Record<string, unknown> = {}) =>
    POST(
      new Request("http://app.test/api/runs", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          environmentId: envId,
          endpointIds: [ids.get(endpoint)],
          ...extra,
        }),
      }),
    );

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

  it("uses the edited path params, query and body", async () => {
    const get = await send("GET /api/v1/{}/users/{}", {
      input: { pathParams: { tenant: "acme", userId: "u42" }, query: { expand: "x" } },
    });
    const run = await finished((await get.json()).runId);
    const [result] = run.results;
    expect(JSON.parse(result.responseBody)).toMatchObject({ id: "u42" });
    expect(result.request.url).toContain("/api/v1/acme/users/u42");
    expect(result.request.url).toContain("expand=x");

    const post = await send("POST /api/v1/{}/users", {
      confirmDestructive: true,
      input: { pathParams: { tenant: "acme" }, body: { email: "me@example.test", name: "Me" } },
    });
    const posted = (await finished((await post.json()).runId)).results[0];
    expect(posted.statusCode).toBe(201);
    expect(JSON.parse(posted.responseBody)).toMatchObject({ email: "me@example.test", name: "Me" });
  });

  it("adds custom headers and still redacts auth ones", async () => {
    const res = await send("GET /api/v1/auth/me", {
      input: { headers: { "X-Trace": "t-1", Cookie: "s=1" } },
    });
    const [result] = (await finished((await res.json()).runId)).results;
    expect(result.request.headers["x-trace"]).toBe("t-1");
    expect(result.request.headers.cookie).toBe("[REDACTED]");
    expect(result.request.headers.authorization).toBe("[REDACTED]");
  });

  it("rejects an edited request for more than one endpoint", async () => {
    const res = await POST(
      new Request("http://app.test/api/runs", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          environmentId: envId,
          endpointIds: [ids.get("GET /api/v1/auth/me"), ids.get("GET /api/v1/{}/orders")],
          input: { headers: { a: "b" } },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("BAD_REQUEST");
  });

  it("every mock endpoint can be sent and gets a response", async () => {
    for (const [key] of ids) {
      const res = await send(key, { confirmDestructive: true });
      expect(res.status, key).toBe(202);
      const { results } = await finished((await res.json()).runId);
      expect(results[0].skipReason, key).toBeNull();
      expect(results[0].statusCode, key).not.toBeNull();
      expect(results[0].error, key).toBeNull();
    }
  });

  it("skips a destructive endpoint without confirmation", async () => {
    const res = await send("DELETE /api/v1/{}/orders/{}");
    const [result] = (await finished((await res.json()).runId)).results;
    expect(result.skipReason).toBe("destructive_unconfirmed");
  });
});
