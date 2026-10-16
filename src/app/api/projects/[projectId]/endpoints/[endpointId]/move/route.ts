import { NextResponse } from "next/server";
import { z } from "zod";
import { moveEndpoint, RegroupError } from "@/db/modules";

type Ctx = { params: Promise<{ projectId: string; endpointId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const body = z.union([
  z.object({ moduleId: z.uuid() }),
  z.object({ newModuleName: z.string().trim().min(1, "Name is required").max(80) }),
]);

/** Move an endpoint to an existing module (`{ moduleId }`) or a new one (`{ newModuleName }`). */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId, endpointId } = await params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(endpointId).success) {
    return err(400, "BAD_REQUEST", "Invalid id");
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "BAD_REQUEST", "Send { moduleId } or { newModuleName }");
  try {
    return NextResponse.json(await moveEndpoint(projectId, endpointId, parsed.data));
  } catch (e) {
    if (e instanceof RegroupError) return err(e.status, e.code, e.message);
    throw e;
  }
}
