import { NextResponse } from "next/server";
import { z } from "zod";
import { applyGrouping } from "@/db/ai-grouping";
import { RegroupError } from "@/db/modules";

type Ctx = { params: Promise<{ projectId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const bodySchema = z.object({
  assignments: z
    .array(z.object({ stableKey: z.string().min(1), module: z.string().min(1).max(80) }))
    .max(500),
});

/** Apply the proposals the user approved: `{ assignments: [{ stableKey, module }] }`. */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid id");
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return err(400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
  try {
    return NextResponse.json(await applyGrouping(projectId, body.data.assignments));
  } catch (e) {
    if (e instanceof RegroupError) return err(e.status, e.code, e.message);
    throw e;
  }
}
