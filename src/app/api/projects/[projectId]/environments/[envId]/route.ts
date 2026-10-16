import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteEnvironment, EnvironmentNameTakenError, updateEnvironment } from "@/db/environments";
import { environmentPatch, fieldErrors } from "@/lib/environment-schema";

type Ctx = { params: Promise<{ projectId: string; envId: string }> };

const err = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });

const validIds = (a: string, b: string) =>
  z.uuid().safeParse(a).success && z.uuid().safeParse(b).success;

export async function PATCH(req: Request, { params }: Ctx) {
  const { projectId, envId } = await params;
  if (!validIds(projectId, envId)) return err(400, "BAD_REQUEST", "Invalid id");
  const parsed = environmentPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return err(400, "INVALID_ENVIRONMENT", "Environment is invalid", fieldErrors(parsed.error));
  try {
    const updated = await updateEnvironment(projectId, envId, parsed.data);
    return updated
      ? NextResponse.json({ environment: updated })
      : err(404, "NOT_FOUND", "Environment not found");
  } catch (e) {
    if (e instanceof EnvironmentNameTakenError) {
      return err(409, "NAME_TAKEN", "An environment with this name already exists", {
        name: "Name already used",
      });
    }
    throw e;
  }
}

/** Also removes the runs made against this environment. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { projectId, envId } = await params;
  if (!validIds(projectId, envId)) return err(400, "BAD_REQUEST", "Invalid id");
  return (await deleteEnvironment(projectId, envId))
    ? new NextResponse(null, { status: 204 })
    : err(404, "NOT_FOUND", "Environment not found");
}
