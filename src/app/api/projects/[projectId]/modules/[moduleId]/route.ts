import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteEmptyModule, RegroupError, renameModule } from "@/db/modules";

type Ctx = { params: Promise<{ projectId: string; moduleId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const ids = (a: string, b: string) =>
  z.uuid().safeParse(a).success && z.uuid().safeParse(b).success;

/** Rename a module (`{ name }`). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { projectId, moduleId } = await params;
  if (!ids(projectId, moduleId)) return err(400, "BAD_REQUEST", "Invalid id");
  const body = z
    .object({ name: z.string().trim().min(1, "Name is required").max(80) })
    .safeParse(await req.json().catch(() => null));
  if (!body.success)
    return err(400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
  try {
    return NextResponse.json({ module: await renameModule(projectId, moduleId, body.data.name) });
  } catch (e) {
    if (e instanceof RegroupError) return err(e.status, e.code, e.message);
    throw e;
  }
}

/** Only an empty module can be deleted. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { projectId, moduleId } = await params;
  if (!ids(projectId, moduleId)) return err(400, "BAD_REQUEST", "Invalid id");
  try {
    await deleteEmptyModule(projectId, moduleId);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof RegroupError) return err(e.status, e.code, e.message);
    throw e;
  }
}
