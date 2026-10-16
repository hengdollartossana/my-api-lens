import { NextResponse } from "next/server";
import { z } from "zod";
import { aiEnabled } from "@/db/ai";
import { getRunSummary, SummaryError, summarizeRun } from "@/db/ai-summary";
import { aiErrorResponse } from "@/lib/ai-http";

type Ctx = { params: Promise<{ id: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** The stored summary of a run, if any (no AI call), and whether AI is configured. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return err(400, "BAD_REQUEST", "Invalid run id");
  return NextResponse.json({ summary: await getRunSummary(id), aiEnabled: await aiEnabled() });
}

/**
 * Summarise the run's differences in plain English. Returns the stored summary without calling the
 * AI again; `{ refresh: true }` forces a new one.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return err(400, "BAD_REQUEST", "Invalid run id");
  const body = z
    .object({ refresh: z.boolean().optional() })
    .safeParse(await req.json().catch(() => ({})));
  if (!body.success) return err(400, "BAD_REQUEST", "Invalid body");
  try {
    return NextResponse.json(await summarizeRun(id, body.data));
  } catch (e) {
    if (e instanceof SummaryError) return err(e.status, e.code, e.message);
    const res = aiErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
