import { NextResponse } from "next/server";
import { z } from "zod";
import { buildProjectPack, PackError } from "@/db/pack";

type Ctx = { params: Promise<{ projectId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const bodySchema = z.object({
  moduleIds: z.array(z.uuid()).max(200),
  preferObserved: z.boolean().optional(),
});

/** Build the context pack Markdown for the chosen modules: `{ markdown, tokens, unapproved }`. */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid id");
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return err(400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
  try {
    return NextResponse.json(
      await buildProjectPack(projectId, body.data.moduleIds, {
        preferObserved: body.data.preferObserved,
      }),
    );
  } catch (e) {
    if (e instanceof PackError)
      return err(e.status, e.status === 404 ? "NOT_FOUND" : "BAD_REQUEST", e.message);
    throw e;
  }
}
