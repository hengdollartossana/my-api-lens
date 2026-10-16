import { NextResponse } from "next/server";
import { z } from "zod";
import { listRuns } from "@/db/runs";
import { RunInputError, startRun } from "@/lib/run-service";

const body = z.object({
  projectId: z.uuid(),
  environmentId: z.uuid(),
  moduleId: z.uuid().optional(),
  endpointIds: z.array(z.uuid()).min(1).optional(),
  confirmDestructive: z.boolean().optional(),
  confirmEnvName: z.string().optional(),
  concurrency: z.number().int().min(1).max(4).optional(),
});

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** Starts a run in the background. Follow it with GET /api/runs/:id/stream. */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "BAD_REQUEST", "Invalid request body");
  try {
    const started = await startRun(parsed.data);
    return NextResponse.json(started, { status: 202 });
  } catch (e) {
    if (e instanceof RunInputError) return err(e.status, e.code, e.message);
    throw e;
  }
}

/** Recent runs, newest first. Optional `projectId` and `limit` (max 200). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const projectId = params.get("projectId") ?? undefined;
  if (projectId && !z.uuid().safeParse(projectId).success)
    return err(400, "BAD_REQUEST", "Invalid projectId");
  const limit = Number(params.get("limit")) || undefined;
  return NextResponse.json({ runs: await listRuns({ projectId, limit }) });
}
