import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;
const original = JSON.parse(readFileSync("fixtures/specs/messy-v3.json", "utf8"));

/** A modified copy: one endpoint removed, one added, one contract changed, one regrouped by tag. */
function modified() {
  const spec = structuredClone(original);
  delete spec.paths["/api/v1/{tenant}/orders/{orderId}"].delete; // removed
  spec.paths["/api/v1/{tenant}/orders/{orderId}/refund"] = {
    // added
    parameters: spec.paths["/api/v1/{tenant}/orders/{orderId}"].parameters,
    post: {
      operationId: "OrdersController_refund",
      responses: { "202": { description: "accepted" } },
    },
  };
  const users =
    spec.paths["/api/v1/{tenant}/users"].get.responses["200"].content["application/json"].schema;
  users.items = {
    allOf: [
      { $ref: "#/components/schemas/UserDto" },
      { type: "object", properties: { phone: { type: "string" } }, required: ["phone"] },
    ],
  }; // changed
  spec.paths["/api/v1/{tenant}/orders"].get.tags = ["Billing"]; // moved Order -> Billing
  return spec;
}

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("re-import with change detection", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let mods: typeof import("@/db/modules");
  let projects: typeof import("@/db/projects");
  let REIMPORT: typeof import("./route").POST;
  let server: Server;
  let base = "";
  let projectId = "";
  let current: unknown = original;
  const modId = new Map<string, string>();

  const post = (
    body?: BodyInit,
    headers: Record<string, string> = { "content-type": "application/json" },
  ) =>
    REIMPORT(new Request("http://app.test", { method: "POST", body, headers }), {
      params: Promise.resolve({ projectId }),
    });
  const upload = (spec: unknown) => {
    const form = new FormData();
    form.set("file", new File([JSON.stringify(spec)], "spec.json"));
    return REIMPORT(new Request("http://app.test", { method: "POST", body: form }), {
      params: Promise.resolve({ projectId }),
    });
  };
  const status = async (name: string) =>
    (
      await dbc.db
        .select()
        .from(schema.modules)
        .where(eq(schema.modules.id, modId.get(name) as string))
    )[0]?.status;
  async function loadModules() {
    for (const m of await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.projectId, projectId))) {
      modId.set(m.name, m.id);
    }
  }

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    mods = await import("@/db/modules");
    projects = await import("@/db/projects");
    ({ POST: REIMPORT } = await import("./route"));

    server = createServer((req, res) => {
      if (req.url === "/spec.json") return void res.end(JSON.stringify(current));
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, r));
    base = `http://localhost:${(server.address() as AddressInfo).port}`;

    projectId = (
      await projects.importProject({
        name: `reimport-${Date.now()}`,
        source: { url: `${base}/spec.json` },
      })
    ).id;
    await loadModules();
    // a manual regroup that must survive, then approve everything
    const me = (
      await dbc.db
        .select()
        .from(schema.endpoints)
        .where(eq(schema.endpoints.stableKey, "GET /api/v1/auth/me"))
    ).find((e) => e.projectId === projectId);
    await mods.moveEndpoint(projectId, me?.id as string, { newModuleName: "Profile" });
    await loadModules();
    await dbc.db
      .update(schema.modules)
      .set({ status: "approved" })
      .where(eq(schema.modules.projectId, projectId));
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    server.closeAllConnections();
    server.close();
    await dbc.pool.end();
  });

  it("an identical spec changes nothing, even when reformatted", async () => {
    const res = await upload(JSON.parse(JSON.stringify(original)));
    expect(res.status).toBe(200);
    const { changes } = await res.json();
    expect(changes).toMatchObject({
      identical: true,
      added: [],
      removed: [],
      changed: [],
      moved: [],
      needsReview: [],
    });
    expect(changes.unchangedCount).toBe(9);
    expect(await status("Order")).toBe("approved");
  });

  it("reports new / removed / changed / moved and flips approved modules to needs_review", async () => {
    const res = await upload(modified());
    expect(res.status).toBe(200);
    const { changes, project } = await res.json();
    expect(changes.identical).toBe(false);
    expect(changes.added).toEqual([
      { stableKey: "POST /api/v1/{}/orders/{}/refund", module: "Order" },
    ]);
    expect(changes.removed).toEqual([
      { stableKey: "DELETE /api/v1/{}/orders/{}", module: "Order" },
    ]);
    expect(changes.changed).toEqual([
      { stableKey: "GET /api/v1/{}/users", module: "User", parts: ["responses"] },
    ]);
    expect(changes.moved).toEqual([
      { stableKey: "GET /api/v1/{}/orders", from: "Order", to: "Billing" },
    ]);
    expect(changes.unchangedCount).toBe(6);
    expect(changes.needsReview).toEqual(["Order", "User"]);
    expect(project).toMatchObject({ endpointCount: 9 });

    await loadModules();
    expect(await status("Order")).toBe("needs_review");
    expect(await status("User")).toBe("needs_review");
    expect(await status("Auth")).toBe("approved"); // untouched
    expect(await status("Profile")).toBe("approved");
    expect(await status("Billing")).toBe("draft"); // new module
  });

  it("keeps manual regrouping and removed endpoints", async () => {
    const eps = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId));
    const me = eps.find((e) => e.stableKey === "GET /api/v1/auth/me");
    expect(me?.moduleId).toBe(modId.get("Profile")); // override preserved
    expect(await mods.loadOverrides(projectId)).toMatchObject({ "GET /api/v1/auth/me": "Profile" });

    const removed = eps.find((e) => e.stableKey === "DELETE /api/v1/{}/orders/{}");
    expect(removed?.removedAt).not.toBeNull(); // kept for history, not deleted
    const detail = await mods.getModule(projectId, modId.get("Order") as string);
    expect(detail?.endpoints.some((e) => e.method === "DELETE")).toBe(false);
    const summary = (await projects.listProjects()).find((p) => p.id === projectId);
    expect(summary).toMatchObject({ endpointCount: 9 });
  });

  it("updates the stored spec so the same file is now identical", async () => {
    const { changes } = await (await upload(modified())).json();
    expect(changes.identical).toBe(true);
  });

  it("brings a removed endpoint back as added and clears removed_at", async () => {
    const { changes } = await (await upload(original)).json();
    expect(changes.added.map((a: { stableKey: string }) => a.stableKey)).toContain(
      "DELETE /api/v1/{}/orders/{}",
    );
    const [row] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(
        and(
          eq(schema.endpoints.projectId, projectId),
          eq(schema.endpoints.stableKey, "DELETE /api/v1/{}/orders/{}"),
        ),
      );
    expect(row?.removedAt).toBeNull();
    // the endpoint added by the modified copy is gone again
    const gone = changes.removed.map((r: { stableKey: string }) => r.stableKey);
    expect(gone).toContain("POST /api/v1/{}/orders/{}/refund");
  });

  it("re-fetches the stored URL when no body is given", async () => {
    current = modified();
    const res = await post(JSON.stringify({}));
    expect(res.status).toBe(200);
    expect((await res.json()).changes.identical).toBe(false);
    const again = await post(JSON.stringify({}));
    expect((await again.json()).changes.identical).toBe(true);
  });

  it("a broken spec changes nothing", async () => {
    const before = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId));
    const form = new FormData();
    form.set("file", new File(["{ nope"], "bad.json"));
    const res = await REIMPORT(new Request("http://app.test", { method: "POST", body: form }), {
      params: Promise.resolve({ projectId }),
    });
    expect(res.status).toBe(400);
    const after = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId));
    expect(after.map((e) => [e.id, e.removedAt, e.moduleId])).toEqual(
      before.map((e) => [e.id, e.removedAt, e.moduleId]),
    );
  });

  it("validates the project and the source", async () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ projectId: id }) });
    expect(
      (await REIMPORT(new Request("http://app.test", { method: "POST", body: "{}" }), ctx("nope")))
        .status,
    ).toBe(400);
    expect(
      (
        await REIMPORT(
          new Request("http://app.test", { method: "POST", body: "{}" }),
          ctx("00000000-0000-4000-8000-000000000000"),
        )
      ).status,
    ).toBe(404);
    const metadata = await post(JSON.stringify({ url: "http://169.254.169.254/x" }));
    expect(metadata.status).toBe(400);
    const fileProject = await projects.importProject({
      name: `reimport-file-${Date.now()}`,
      source: { text: JSON.stringify(original), filename: "m.json" },
    });
    const noUrl = await REIMPORT(
      new Request("http://app.test", { method: "POST", body: "{}" }),
      ctx(fileProject.id),
    );
    expect(noUrl.status).toBe(400);
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, fileProject.id));
  });
});
