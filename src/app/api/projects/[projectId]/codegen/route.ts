import { NextResponse } from "next/server";
import { z } from "zod";
import { CodegenError, generateProjectFlutter } from "@/db/codegen";

type Ctx = { params: Promise<{ projectId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const bodySchema = z.object({
  target: z.literal("flutter"),
  moduleIds: z.array(z.uuid()).max(200),
  preferObserved: z.boolean().optional(),
  contractTests: z.boolean().optional(),
  packageName: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, "Package name must be lowercase letters, digits and underscores")
    .max(64)
    .optional(),
});

/** Generate Flutter code for the chosen modules: `{ files: [{ path, content }], unapproved }`. */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid id");
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return err(400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
  try {
    return NextResponse.json(await generateProjectFlutter(projectId, body.data));
  } catch (e) {
    if (e instanceof CodegenError) return err(e.status, "NOT_FOUND", e.message);
    throw e;
  }
}
