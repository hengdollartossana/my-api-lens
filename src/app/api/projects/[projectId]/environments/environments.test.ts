import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const OPENAPI = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Env test", version: "1" },
  servers: [
    { url: "https://api.example.test/v1/" },
    { url: "/relative" },
    { url: "https://{tenant}.example.test" },
  ],
  paths: { "/a": { get: { responses: { "200": { description: "ok" } } } } },
});

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("environments API", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let list: typeof import("./route");
  let one: typeof import("./[envId]/route");
  let projectId = "";
  let otherProjectId = "";

  const ctx = (envId = "") => ({ params: Promise.resolve({ projectId, envId }) });
  const json = (method: string, body?: unknown) =>
    new Request("http://app.test", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    list = await import("./route");
    one = await import("./[envId]/route");
    const { importProject } = await import("@/db/projects");
    projectId = (
      await importProject({
        name: `env-${Date.now()}`,
        source: { text: OPENAPI, filename: "e.json" },
      })
    ).id;
    otherProjectId = (
      await importProject({
        name: `env-other-${Date.now()}`,
        source: { text: OPENAPI, filename: "e.json" },
      })
    ).id;
  });

  afterAll(async () => {
    for (const id of [projectId, otherProjectId])
      await dbc.db.delete(schema.projects).where(eq(schema.projects.id, id));
    await dbc.pool.end();
  });

  it("suggests absolute server URLs from the spec", async () => {
    const res = await list.GET(json("GET"), ctx());
    const body = await res.json();
    expect(body.environments).toEqual([]);
    expect(body.serverSuggestions).toEqual(["https://api.example.test/v1"]);
  });

  it("creates, lists, updates and deletes an environment", async () => {
    const created = await list.POST(
      json("POST", {
        name: "staging",
        baseUrl: "https://stg.example.test/",
        defaultHeaders: { "X-Tenant": "acme" },
      }),
      ctx(),
    );
    expect(created.status).toBe(201);
    const { environment } = await created.json();
    expect(environment).toMatchObject({
      name: "staging",
      baseUrl: "https://stg.example.test",
      isProd: false,
      defaultHeaders: { "X-Tenant": "acme" },
    });

    const prod = await list.POST(
      json("POST", { name: "prod", baseUrl: "https://api.example.test", isProd: true }),
      ctx(),
    );
    expect((await prod.json()).environment.isProd).toBe(true);

    const { environments } = await (await list.GET(json("GET"), ctx())).json();
    expect(environments.map((e: { name: string }) => e.name)).toEqual(["staging", "prod"]); // non-prod first

    const patched = await one.PATCH(
      json("PATCH", { isProd: true, name: "stage" }),
      ctx(environment.id),
    );
    expect(patched.status).toBe(200);
    expect((await patched.json()).environment).toMatchObject({ name: "stage", isProd: true });

    expect((await one.DELETE(json("DELETE"), ctx(environment.id))).status).toBe(204);
    expect((await one.DELETE(json("DELETE"), ctx(environment.id))).status).toBe(404);
  });

  it("rejects an invalid URL with a field error", async () => {
    for (const baseUrl of ["not a url", "ftp://x.test", "", "https://u:p@x.test"]) {
      const res = await list.POST(json("POST", { name: `bad-${baseUrl.length}`, baseUrl }), ctx());
      expect(res.status, baseUrl).toBe(400);
      const { error } = await res.json();
      expect(error.code).toBe("INVALID_ENVIRONMENT");
      expect(error.fields.baseUrl).toBeTruthy();
    }
    const bad = await one.PATCH(
      json("PATCH", { baseUrl: "nope" }),
      ctx("00000000-0000-4000-8000-000000000000"),
    );
    expect(bad.status).toBe(400);
  });

  it("rejects bad headers, empty names and duplicate names", async () => {
    const badHeader = await list.POST(
      json("POST", { name: "h", baseUrl: "http://x.test", defaultHeaders: { "bad name": "v" } }),
      ctx(),
    );
    expect(badHeader.status).toBe(400);
    expect(
      (await list.POST(json("POST", { name: " ", baseUrl: "http://x.test" }), ctx())).status,
    ).toBe(400);

    expect(
      (await list.POST(json("POST", { name: "dup", baseUrl: "http://x.test" }), ctx())).status,
    ).toBe(201);
    const dup = await list.POST(json("POST", { name: "dup", baseUrl: "http://y.test" }), ctx());
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.fields.name).toBeTruthy();
    // the same name is fine in another project
    const other = await list.POST(json("POST", { name: "dup", baseUrl: "http://x.test" }), {
      params: Promise.resolve({ projectId: otherProjectId, envId: "" }),
    });
    expect(other.status).toBe(201);
  });

  it("is scoped to the project and validates ids", async () => {
    const created = await list.POST(
      json("POST", { name: "scoped", baseUrl: "http://x.test" }),
      ctx(),
    );
    const { environment } = await created.json();
    const wrong = await one.PATCH(json("PATCH", { name: "x" }), {
      params: Promise.resolve({ projectId: otherProjectId, envId: environment.id }),
    });
    expect(wrong.status).toBe(404);
    expect(
      (
        await one.DELETE(json("DELETE"), {
          params: Promise.resolve({ projectId: otherProjectId, envId: environment.id }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await list.GET(json("GET"), { params: Promise.resolve({ projectId: "nope", envId: "" }) }))
        .status,
    ).toBe(400);
    const unknown = await list.POST(json("POST", { name: "u", baseUrl: "http://x.test" }), {
      params: Promise.resolve({ projectId: "00000000-0000-4000-8000-000000000000", envId: "" }),
    });
    expect(unknown.status).toBe(404);
  });
});
