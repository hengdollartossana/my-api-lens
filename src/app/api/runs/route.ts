import { NextResponse } from "next/server";
import { z } from "zod";
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
