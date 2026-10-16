import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSpec } from "@/core/parser";
import { createMockServer } from "../../../../fixtures/mock-api/app";

const url = process.env.DATABASE_URL;
// Needs a running Postgres (pnpm db:up) and migrations; skipped when DATABASE_URL is unset.
describe.skipIf(!url)("runs API", () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  let mock: Server;
  let base = "";
  let projectId = "";
  let envId = "";
  let prodEnvId = "";
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let POST: typeof import("./route").POST;
  let STREAM: typeof import("./[id]/stream/route").GET;
  let CANCEL: typeof import("./[id]/cancel/route").POST;
  let moduleId = "";
  const keyToId = new Map<string, string>();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST } = await import("./route"));
    ({ GET: STREAM } = await import("./[id]/stream/route"));
    ({ POST: CANCEL } = await import("./[id]/cancel/route"));
    const { saveAuthRecipe } = await import("@/db/auth-recipes");

    mock = createMockServer();
    await new Promise<void>((r) => mock.listen(0, r));
    base = `http://localhost:${(mock.address() as AddressInfo).port}`;

    const { db } = dbc;
    const [p] = await db
      .insert(schema.projects)
      .values({ name: `runs-${Date.now()}`, specSource: "file" })
      .returning();
    projectId = (p as { id: string }).id;
    const [e1] = await db
      .insert(schema.environments)
      .values({ projectId, name: "mock", baseUrl: base })
      .returning();
    const [e2] = await db
      .insert(schema.environments)
      .values({ projectId, name: "prod", baseUrl: base, isProd: true })
      .returning();
    envId = (e1 as { id: string }).id;
    prodEnvId = (e2 as { id: string }).id;
    const [m] = await db
      .insert(schema.modules)
      .values({ projectId, name: "All", via: "manual" })
      .returning();
    moduleId = (m as { id: string }).id;

    const parsed = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
    const rows = await db
      .insert(schema.endpoints)
      .values(
        parsed.endpoints.map((e) => ({
          projectId,
          moduleId,
          stableKey: e.stableKey,
          method: e.method,
          path: e.path,
          operationId: e.operationId,
          summary: e.summary,
          tags: e.tags,
          parameters: e.parameters,
          requestBodySchema: e.requestBodySchema,
          responseSchemas: e.responseSchemas,
          security: e.security,
          isDestructive: e.isDestructive,
        })),
      )
      .returning();
    for (const r of rows) keyToId.set(r.stableKey, r.id);

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

  const post = (body: unknown) =>
    POST(new Request("http://app.test/api/runs", { method: "POST", body: JSON.stringify(body) }));

  type Ev = { event: string; data: Record<string, unknown> };
  async function readStream(runId: string): Promise<Ev[]> {
    const res = await STREAM(new Request(`http://app.test/api/runs/${runId}/stream`), {
      params: Promise.resolve({ id: runId }),
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    return text
      .split("\n\n")
      .filter((f) => f.startsWith("event:"))
      .map((f) => {
        const [ev, data] = f.split("\n");
        return { event: (ev as string).slice(7), data: JSON.parse((data as string).slice(6)) };
      });
  }

  it("streams one result per endpoint and skips unconfirmed destructive ones", async () => {
    const res = await post({ projectId, environmentId: envId, moduleId });
    expect(res.status).toBe(202);
    const { runId, total, skipped } = await res.json();
    expect(total).toBe(9);
    expect(skipped).toBe(4); // login, refresh, POST users, DELETE order

    const events = await readStream(runId);
    const results = events.filter((e) => e.event === "result");
    expect(results).toHaveLength(9);
    expect(events.at(-1)).toMatchObject({
      event: "done",
      data: { status: "done", completed: 9, total: 9 },
    });
    expect(events.filter((e) => e.event === "progress")).toHaveLength(9);

    const skippedKeys = results.filter((e) => e.data.skipped).map((e) => e.data.stableKey);
    expect(skippedKeys.sort()).toEqual([
      "DELETE /api/v1/{}/orders/{}",
      "POST /api/v1/auth/login",
      "POST /api/v1/auth/refresh",
      "POST /api/v1/{}/users",
    ]);
    const me = results.find((e) => e.data.stableKey === "GET /api/v1/auth/me");
    expect(me?.data).toMatchObject({ statusCode: 200, severity: "ok", skipped: false });

    const stored = await dbc.db
      .select()
      .from(schema.runResults)
      .where(eq(schema.runResults.runId, runId));
    expect(stored).toHaveLength(9);
    expect(stored.filter((r) => r.skipReason === "destructive_unconfirmed")).toHaveLength(4);
    const [run] = await dbc.db.select().from(schema.runs).where(eq(schema.runs.id, runId));
    expect(run?.status).toBe("done");
    expect(run?.finishedAt).not.toBeNull();
    // stored request is redacted
    expect(JSON.stringify(stored.map((r) => r.request))).not.toContain("mock-access-token");
  });

  it("replays a finished run from the database when it is no longer in memory", async () => {
    const { runId } = await (await post({ projectId, environmentId: envId, moduleId })).json();
    await readStream(runId);
    (
      globalThis as unknown as { __apilensLiveRuns: Map<string, unknown> }
    ).__apilensLiveRuns.clear();
    const events = await readStream(runId);
    expect(events.filter((e) => e.event === "result")).toHaveLength(9);
    expect(events.at(-1)?.event).toBe("done");
  });

  it("runs destructive endpoints when confirmed", async () => {
    const del = keyToId.get("DELETE /api/v1/{}/orders/{}") as string;
    const res = await post({
      projectId,
      environmentId: envId,
      endpointIds: [del],
      confirmDestructive: true,
    });
    const { runId, skipped } = await res.json();
    expect(skipped).toBe(0);
    const [result] = (await readStream(runId)).filter((e) => e.event === "result");
    expect(result?.data).toMatchObject({ skipped: false, statusCode: 204 });
  });

  it("requires the typed env name for destructive runs on prod", async () => {
    const del = keyToId.get("DELETE /api/v1/{}/orders/{}") as string;
    const base = {
      projectId,
      environmentId: prodEnvId,
      endpointIds: [del],
      confirmDestructive: true,
    };
    const denied = await post(base);
    expect(denied.status).toBe(400);
    expect((await denied.json()).error.code).toBe("ENV_CONFIRMATION_REQUIRED");
    expect((await post({ ...base, confirmEnvName: "wrong" })).status).toBe(400);
    expect((await post({ ...base, confirmEnvName: "prod" })).status).toBe(202);
    // read-only runs on prod need no confirmation
    const get = keyToId.get("GET /api/v1/auth/me") as string;
    expect((await post({ projectId, environmentId: prodEnvId, endpointIds: [get] })).status).toBe(
      202,
    );
  });

  it("validates input", async () => {
    expect((await post({ projectId: "nope" })).status).toBe(400);
    const other = "00000000-0000-4000-8000-000000000000";
    expect((await post({ projectId, environmentId: other })).status).toBe(404);
    expect((await post({ projectId, environmentId: envId, endpointIds: [other] })).status).toBe(
      400,
    );
  });

  it("cancels a run and reports a conflict for finished ones", async () => {
    const { runId } = await (
      await post({ projectId, environmentId: envId, moduleId, concurrency: 1 })
    ).json();
    const first = await CANCEL(new Request("http://app.test", { method: "POST" }), {
      params: Promise.resolve({ id: runId }),
    });
    expect([202, 409]).toContain(first.status); // may already be done on a fast machine
    const events = await readStream(runId);
    expect(["done", "cancelled"]).toContain((events.at(-1)?.data as { status: string }).status);
    const again = await CANCEL(new Request("http://app.test", { method: "POST" }), {
      params: Promise.resolve({ id: runId }),
    });
    expect(again.status).toBe(409);
    const missing = await CANCEL(new Request("http://app.test", { method: "POST" }), {
      params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }),
    });
    expect(missing.status).toBe(404);
  });
});
