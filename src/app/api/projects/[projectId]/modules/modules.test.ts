import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupEndpoints } from "@/core/grouper";
import { parseSpec } from "@/core/parser";

const url = process.env.DATABASE_URL;

// Needs a running Postgres (pnpm db:up); skipped when DATABASE_URL is unset.
describe.skipIf(!url)("manual regroup", () => {
  let dbc: typeof import("@/db/client");
  let schema: typeof import("@/db/schema");
  let mods: typeof import("@/db/modules");
  let MOVE: typeof import("../endpoints/[endpointId]/move/route").POST;
  let RENAME: typeof import("./[moduleId]/route").PATCH;
  let REMOVE: typeof import("./[moduleId]/route").DELETE;
  let projectId = "";
  const byKey = new Map<string, string>();
  const modId = new Map<string, string>();

  const call = (body: unknown, method = "POST") =>
    new Request("http://app.test", {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const move = (key: string, body: unknown) =>
    MOVE(call(body), {
      params: Promise.resolve({ projectId, endpointId: byKey.get(key) as string }),
    });
  const rename = (name: string, id: string) =>
    RENAME(call({ name }, "PATCH"), { params: Promise.resolve({ projectId, moduleId: id }) });

  async function reload() {
    const eps = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.projectId, projectId));
    for (const e of eps) byKey.set(e.stableKey, e.id);
    const ms = await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.projectId, projectId));
    modId.clear();
    for (const m of ms) modId.set(m.name, m.id);
  }
  const moduleOf = async (key: string) => {
    const [e] = await dbc.db
      .select()
      .from(schema.endpoints)
      .where(eq(schema.endpoints.id, byKey.get(key) as string));
    return [...modId.entries()].find(([, id]) => id === e?.moduleId)?.[0];
  };

  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    dbc = await import("@/db/client");
    schema = await import("@/db/schema");
    await migrate(dbc.db, { migrationsFolder: "src/db/migrations" });
    mods = await import("@/db/modules");
    ({ POST: MOVE } = await import("../endpoints/[endpointId]/move/route"));
    ({ PATCH: RENAME, DELETE: REMOVE } = await import("./[moduleId]/route"));
    const { importProject } = await import("@/db/projects");
    projectId = (
      await importProject({
        name: `regroup-${Date.now()}`,
        source: { text: readFileSync("fixtures/specs/messy-v3.json", "utf8"), filename: "m.json" },
      })
    ).id;
    await reload();
  });

  afterAll(async () => {
    await dbc.db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await dbc.pool.end();
  });

  it("moves an endpoint to another module and remembers it as an override", async () => {
    const key = "GET /api/v1/{}/orders";
    expect(await moduleOf(key)).toBe("Order");
    const res = await move(key, { moduleId: modId.get("User") });
    expect(res.status).toBe(200);
    expect(await moduleOf(key)).toBe("User");
    const [override] = await dbc.db
      .select()
      .from(schema.moduleOverrides)
      .where(
        and(
          eq(schema.moduleOverrides.projectId, projectId),
          eq(schema.moduleOverrides.stableKey, key),
        ),
      );
    expect(override?.moduleName).toBe("User");
    expect(await mods.loadOverrides(projectId)).toEqual({ [key]: "User" });

    const detail = await mods.getModule(projectId, modId.get("User") as string);
    const moved = detail?.endpoints.find((e) => e.path === "/api/v1/{tenant}/orders");
    expect(moved?.moved).toBe(true);
    expect(detail?.endpoints.filter((e) => e.moved)).toHaveLength(1);
  });

  it("moving again updates the override instead of adding another", async () => {
    const key = "GET /api/v1/{}/orders";
    await move(key, { moduleId: modId.get("Auth") });
    const rows = await dbc.db
      .select()
      .from(schema.moduleOverrides)
      .where(eq(schema.moduleOverrides.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.moduleName).toBe("Auth");
    expect((await move(key, { moduleId: modId.get("Auth") })).status).toBe(200); // no-op move
  });

  it("creates a new manual module on demand and reuses it by name", async () => {
    const a = await move("GET /api/v1/auth/me", { newModuleName: "  Profile  " });
    expect(a.status).toBe(200);
    await reload();
    const [profile] = await dbc.db
      .select()
      .from(schema.modules)
      .where(eq(schema.modules.id, modId.get("Profile") as string));
    expect(profile).toMatchObject({ name: "Profile", via: "manual", status: "draft" });
    await move("GET /api/v1/{}/users", { newModuleName: "Profile" });
    await reload();
    expect([...modId.keys()].filter((n) => n === "Profile")).toHaveLength(1);
    expect(await moduleOf("GET /api/v1/{}/users")).toBe("Profile");
  });

  it("flips an approved module back to needs_review when its endpoints change", async () => {
    await dbc.db
      .update(schema.modules)
      .set({ status: "approved" })
      .where(eq(schema.modules.id, modId.get("Order") as string));
    await dbc.db
      .update(schema.modules)
      .set({ status: "approved" })
      .where(eq(schema.modules.id, modId.get("User") as string));
    await move("DELETE /api/v1/{}/orders/{}", { moduleId: modId.get("User") });
    const status = async (name: string) =>
      (
        await dbc.db
          .select()
          .from(schema.modules)
          .where(eq(schema.modules.id, modId.get(name) as string))
      )[0]?.status;
    expect(await status("Order")).toBe("needs_review"); // lost an endpoint
    expect(await status("User")).toBe("needs_review"); // gained one
  });

  it("applies overrides when the project is grouped again (re-import)", async () => {
    const spec = await parseSpec({ text: readFileSync("fixtures/specs/messy-v3.json", "utf8") });
    const overrides = await mods.loadOverrides(projectId);
    const plain = groupEndpoints(spec.endpoints);
    const withOverrides = groupEndpoints(spec.endpoints, { overrides });
    const plainName = (key: string) =>
      plain.assignments.find((a) => a.stableKey === key)?.moduleName;
    const name = (key: string) => withOverrides.assignments.find((a) => a.stableKey === key);
    expect(plainName("GET /api/v1/{}/orders")).toBe("Order");
    expect(name("GET /api/v1/{}/orders")).toMatchObject({ moduleName: "Auth", via: "manual" });
    expect(name("GET /api/v1/auth/me")).toMatchObject({ moduleName: "Profile", via: "manual" });
  });

  it("renames a module, pins its endpoints to the new name and rejects duplicates", async () => {
    const id = modId.get("Profile") as string;
    const res = await rename("Account", id);
    expect(res.status).toBe(200);
    expect((await res.json()).module).toMatchObject({ name: "Account", via: "manual" });
    const overrides = await mods.loadOverrides(projectId);
    expect(overrides["GET /api/v1/auth/me"]).toBe("Account");
    expect(overrides["GET /api/v1/{}/users"]).toBe("Account");

    const dup = await rename("Auth", id);
    expect(dup.status).toBe(409);
    expect((await rename("   ", id)).status).toBe(400);
    expect((await rename("x", "00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("deletes only empty modules", async () => {
    await reload();
    const ctx = (id: string) => ({ params: Promise.resolve({ projectId, moduleId: id }) });
    const full = await REMOVE(call(undefined, "DELETE"), ctx(modId.get("Account") as string));
    expect(full.status).toBe(409);
    for (const key of ["GET /api/v1/auth/me", "GET /api/v1/{}/users"]) {
      await move(key, { moduleId: modId.get("Auth") });
    }
    expect(
      (await REMOVE(call(undefined, "DELETE"), ctx(modId.get("Account") as string))).status,
    ).toBe(204);
  });

  it("validates input and project scoping", async () => {
    expect((await move("GET /api/v1/auth/me", {})).status).toBe(400);
    expect(
      (await move("GET /api/v1/auth/me", { moduleId: "00000000-0000-4000-8000-000000000000" }))
        .status,
    ).toBe(404);
    expect((await move("GET /api/v1/auth/me", { newModuleName: "   " })).status).toBe(400);
    const wrongProject = await MOVE(call({ newModuleName: "X" }), {
      params: Promise.resolve({
        projectId: "00000000-0000-4000-8000-000000000000",
        endpointId: byKey.get("GET /api/v1/auth/me") as string,
      }),
    });
    expect(wrongProject.status).toBe(404);
  });
});
