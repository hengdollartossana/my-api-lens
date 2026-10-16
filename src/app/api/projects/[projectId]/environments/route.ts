import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createEnvironment,
  EnvironmentNameTakenError,
  listEnvironments,
  serverSuggestions,
} from "@/db/environments";
import { environmentInput, fieldErrors } from "@/lib/environment-schema";

type Ctx = { params: Promise<{ projectId: string }> };

const err = (status: number, code: string, message: string, fields?: Record<string, string>) =>
  NextResponse.json({ error: { code, message, ...(fields ? { fields } : {}) } }, { status });

/** Environments of a project plus `serverSuggestions` taken from the imported spec. */
export async function GET(_req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid project id");
  const [environments, suggestions] = await Promise.all([
    listEnvironments(projectId),
    serverSuggestions(projectId),
  ]);
  return NextResponse.json({ environments, serverSuggestions: suggestions });
}

export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid project id");
  const parsed = environmentInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return err(400, "INVALID_ENVIRONMENT", "Environment is invalid", fieldErrors(parsed.error));
  try {
    return NextResponse.json(
      { environment: await createEnvironment(projectId, parsed.data) },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof EnvironmentNameTakenError) {
      return err(409, "NAME_TAKEN", "An environment with this name already exists", {
        name: "Name already used",
      });
    }
    // An unknown project violates the foreign key.
    if ((e as { cause?: { code?: string } }).cause?.code === "23503")
      return err(404, "NOT_FOUND", "Project not found");
    throw e;
  }
}
