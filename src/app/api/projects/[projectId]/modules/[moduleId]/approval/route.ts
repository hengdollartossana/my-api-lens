import { NextResponse } from "next/server";
import { z } from "zod";
import { ApprovalError, approveModule, revokeModule } from "@/db/approval";

type Ctx = { params: Promise<{ projectId: string; moduleId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

async function ids(params: Ctx["params"]) {
  const { projectId, moduleId } = await params;
  const ok = z.uuid().safeParse(projectId).success && z.uuid().safeParse(moduleId).success;
  return ok ? { projectId, moduleId } : null;
}

/** Approve a module. `{ knownIssues: true }` overrides the block on `error` diffs. */
export async function POST(req: Request, { params }: Ctx) {
  const p = await ids(params);
  if (!p) return err(400, "BAD_REQUEST", "Invalid id");
  const body = z
    .object({ knownIssues: z.boolean().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(400, "BAD_REQUEST", "Invalid body");
  try {
    return NextResponse.json(await approveModule(p.projectId, p.moduleId, body.data));
  } catch (e) {
    if (e instanceof ApprovalError) return err(e.status, e.code, e.message);
    throw e;
  }
}

/** Revoke approval. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const p = await ids(params);
  if (!p) return err(400, "BAD_REQUEST", "Invalid id");
  try {
    return NextResponse.json({ module: await revokeModule(p.projectId, p.moduleId) });
  } catch (e) {
    if (e instanceof ApprovalError) return err(e.status, e.code, e.message);
    throw e;
  }
}
