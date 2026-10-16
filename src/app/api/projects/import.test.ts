import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const spec = (name: string) => readFileSync(`fixtures/specs/${name}`, "utf8");

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("project import API", () => {
  let POST: typeof import("./import/route").POST;
  let LIST: typeof import("./route").GET;
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let server: Server;
  let base = "";
  const created: string[] = [];

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    ({ POST } = await import("./import/route"));
    ({ GET: LIST } = await import("./route"));

    server = createServer((req, res) => {
      if (req.url === "/messy.json") return void res.end(spec("messy-v3.json"));
      if (req.url === "/broken.json") return void res.end("{ not json");
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const id of created)
      await dbc.db.delete(schema.projects).where(eq(schema.projects.id, id));
    server.closeAllConnections();
    server.close();
    await dbc.pool.end();
  });

  const upload = (text: string, filename: string, name?: string) => {
    const form = new FormData();
    form.set("file", new File([text], filename));
    if (name) form.set("name", name);
    return POST(new Request("http://app.test/api/projects/import", { method: "POST", body: form }));
  };
  const fromUrl = (u: string, name?: string) =>
    POST(
      new Request("http://app.test/api/projects/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: u, name }),
      }),
    );
  // Other test files share the database, so check by a unique name instead of counting all rows.
  const marker = `rejected-${Date.now()}`;
  const withMarker = async () =>
    (await dbc.db.select().from(schema.projects).where(eq(schema.projects.name, marker))).length;
  const moduleNames = async (projectId: string) =>
    (await dbc.db.select().from(schema.modules).where(eq(schema.modules.projectId, projectId)))
      .map((m) => m.name)
      .sort();

  it.each([
    ["petstore-v2.json", 4, ["Pet", "Store"]],
    ["petstore-v3.yaml", 4, ["Pet", "Store"]],
    ["messy-v3.json", 9, ["Auth", "Order", "User"]],
  ])("imports %s with the expected modules", async (file, endpointCount, modules) => {
    const res = await upload(spec(file), file);
    expect(res.status).toBe(201);
    const { project } = await res.json();
    created.push(project.id);
    expect(project).toMatchObject({
      endpointCount,
      moduleCount: modules.length,
      specSource: "file",
    });
    expect(project.lastImportedAt).not.toBeNull();
    expect(await moduleNames(project.id)).toEqual(modules);

    const eps = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, project.id));
    expect(eps).toHaveLength(endpointCount);
    expect(eps.every((e) => e.moduleId !== null)).toBe(true);
    const [row] = await dbc.db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(row?.specHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.specRaw).toBeTruthy();
  });

  it("uses the given name, else the spec title", async () => {
    const named = await (await upload(spec("petstore-v3.yaml"), "p.yaml", "My Pets")).json();
    const titled = await (await upload(spec("petstore-v3.yaml"), "p.yaml")).json();
    created.push(named.project.id, titled.project.id);
    expect(named.project.name).toBe("My Pets");
    expect(titled.project.name).toBe("Petstore (OpenAPI 3)");
  });

  it("imports from a URL", async () => {
    const res = await fromUrl(`${base}/messy.json`);
    expect(res.status).toBe(201);
    const { project } = await res.json();
    created.push(project.id);
    expect(project).toMatchObject({
      specSource: "url",
      specUrl: `${base}/messy.json`,
      endpointCount: 9,
    });
  });

  it("a broken spec returns an error and creates nothing", async () => {
    const file = await upload("{ not json", "broken.json", marker);
    expect(file.status).toBe(400);
    expect((await file.json()).error.code).toBe("INVALID_SPEC");
    const missingPaths = await upload('{"openapi":"3.0.3"}', "x.json", marker);
    expect(missingPaths.status).toBe(400);
    const remote = await fromUrl(`${base}/broken.json`, marker);
    expect(remote.status).toBe(400);
    const gone = await fromUrl(`${base}/nope.json`, marker);
    expect(gone.status).toBe(502);
    expect(await withMarker()).toBe(0);
  });

  it("rolls back everything if persisting fails part-way", async () => {
    const dup = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "d", version: "1" },
      paths: {
        "/a/{x}": { get: { responses: { "200": { description: "ok" } } } },
        "/a/{y}": { get: { responses: { "200": { description: "ok" } } } },
      },
    });
    expect((await upload(dup, "dup.json", marker)).status).toBe(400);
    expect(await withMarker()).toBe(0);
  });

  it("validates input and enforces the size limit and SSRF guard", async () => {
    expect((await fromUrl("not a url")).status).toBe(400);
    expect((await fromUrl("ftp://example.test/x")).status).toBe(400);
    const metadata = await fromUrl("http://169.254.169.254/latest/meta-data", marker);
    expect(metadata.status).toBe(400);
    expect((await metadata.json()).error.code).toBe("METADATA_BLOCKED");
    const big = await upload("x".repeat(10 * 1024 * 1024 + 1), "big.json", marker);
    expect(big.status).toBe(413);
    const noFile = await POST(
      new Request("http://app.test", { method: "POST", body: new FormData() }),
    );
    expect(noFile.status).toBe(400);
    expect(await withMarker()).toBe(0);
  });

  it("lists projects with counts and last import", async () => {
    const res = await LIST();
    const { projects } = await res.json();
    const messy = projects.find((p: { id: string }) => p.id === created.at(-1));
    expect(messy).toMatchObject({ endpointCount: 9, moduleCount: 3 });
    expect(messy.lastImportedAt).toBeTruthy();
  });
});
