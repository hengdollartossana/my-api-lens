import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockServer } from "../../../../../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("diff in runs", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let projectId = "";
  let envId = "";
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let RUNS: typeof import("../../../runs/route").POST;
  let RUN_DETAIL: typeof import("../../../runs/[id]/route").GET;
  let DIFF: typeof import("./route").GET;
  const ids = new Map<string, string>();

  async function run(body: Record<string, unknown>) {
    const res = await RUNS(
      new Request("http://app.test/api/runs", {
        method: "POST",
        body: JSON.stringify({ projectId, environmentId: envId, ...body }),
      }),
    );
    expect(res.status).toBe(202);
    const { runId } = await res.json();
    for (let i = 0; i < 200; i++) {
      const detail = await (
        await RUN_DETAIL(new Request("http://app.test"), { params: Promise.resolve({ id: runId }) })
      ).json();
      if (detail.run.status !== "running") return detail;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("run did not finish");
  }
  const diffRows = async (query = "") =>
    (
      await (
        await DIFF(new Request(`http://app.test/api/projects/${projectId}/diff${query}`), {
          params: Promise.resolve({ projectId }),
        })
      ).json()
    ).rows;
  const summarize = (
    rows: { method: string; path: string; items: { kind: string; path: string }[] }[],
  ) => rows.flatMap((r) => r.items.map((i) => `${r.method} ${r.path} ${i.kind} ${i.path}`)).sort();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST: RUNS } = await import("../../../runs/route"));
    ({ GET: RUN_DETAIL } = await import("../../../runs/[id]/route"));
    ({ GET: DIFF } = await import("./route"));
    const { importProject } = await import("@/db/projects");
    const { saveAuthRecipe } = await import("@/db/auth-recipes");

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    const base = `http://localhost:${(mock.address() as AddressInfo).port}`;
    projectId = (
      await importProject({
        name: `diff-${Date.now()}`,
        source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
      })
    ).id;
    const [env] = await dbc.db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    envId = (env as { id: string }).id;
    for (const e of await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId))) {
      ids.set(e.stableKey, e.id);
    }
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

  it("is empty before anything has run", async () => {
    expect(await diffRows()).toEqual([]);
  });

  it("stores a diff per result and raises severity from it", async () => {
    const detail = await run({ confirmDestructive: true });
    const byKey = new Map(detail.results.map((r: { stableKey: string }) => [r.stableKey, r]));
    const users = byKey.get("GET /api/v1/{}/users") as {
      severity: string;
      diff: { kind: string }[];
    };
    expect(users.severity).toBe("error");
    expect(users.diff.map((d) => d.kind)).toEqual(["missing_required"]);
    expect((byKey.get("GET /api/v1/{}/users/{}") as { severity: string }).severity).toBe("info"); // extra field only
    expect((byKey.get("GET /api/v1/{}/orders/{}") as { severity: string }).severity).toBe("warn"); // unexpected null
    const me = byKey.get("GET /api/v1/auth/me") as { severity: string; diff: unknown[] };
    expect(me.severity).toBe("ok");
    expect(me.diff).toEqual([]);
  });

  it("lists every deliberate mismatch after running the messy module and sending the 409", async () => {
    await run({
      endpointIds: [ids.get("POST /api/v1/{}/users")],
      confirmDestructive: true,
      input: { pathParams: { tenant: "t" }, body: { email: "taken@example.com", name: "x" } },
    });
    const rows = await diffRows();
    expect(summarize(rows)).toEqual(
      [
        "GET /api/v1/{tenant}/orders type_mismatch $[0].total.amount",
        "GET /api/v1/{tenant}/orders/{orderId} unexpected_null $.shippingAddress",
        "GET /api/v1/{tenant}/users missing_required $[1].email",
        "GET /api/v1/{tenant}/users/{userId} extra_field $.internalNote",
        "POST /api/v1/{tenant}/users undocumented_status $status",
      ].sort(),
    );
    // matching endpoints are present with no items, and rows carry module, environment and run
    const clean = rows.filter((r: { items: unknown[] }) => r.items.length === 0);
    expect(clean.length).toBe(4);
    const orders = rows.find(
      (r: { path: string; method: string }) =>
        r.method === "GET" && r.path === "/api/v1/{tenant}/orders",
    );
    expect(orders).toMatchObject({ moduleName: "Order", environmentName: "mock", isProd: false });
    expect(orders.runId).toBeTruthy();
    expect(orders.items[0]).toMatchObject({
      severity: "error",
      expected: "number",
      actual: "42.50",
    });
  });

  it("uses each endpoint's latest comparison", async () => {
    // POST /users ran cleanly in the first run (201) and with the 409 afterwards: the 409 wins.
    const rows = await diffRows();
    const post = rows.find(
      (r: { method: string; path: string }) =>
        r.method === "POST" && r.path === "/api/v1/{tenant}/users",
    );
    expect(post.items.map((i: { kind: string }) => i.kind)).toEqual(["undocumented_status"]);
    expect(post.statusCode).toBe(409);
  });

  it("filters by environment and validates ids", async () => {
    expect(await diffRows(`?environmentId=00000000-0000-4000-8000-000000000000`)).toEqual([]);
    expect((await diffRows(`?environmentId=${envId}`)).length).toBeGreaterThan(0);
    const bad = await DIFF(new Request("http://app.test?environmentId=nope"), {
      params: Promise.resolve({ projectId }),
    });
    expect(bad.status).toBe(400);
    const badProject = await DIFF(new Request("http://app.test"), {
      params: Promise.resolve({ projectId: "nope" }),
    });
    expect(badProject.status).toBe(400);
  });
});
