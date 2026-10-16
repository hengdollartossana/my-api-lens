import { NextResponse } from "next/server";
import { z } from "zod";
import { AiError } from "@/core/ai";
import { getAiSettings, removeAiKey, saveAiSettings } from "@/db/ai";

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** Masked AI settings: never the key itself. */
export async function GET() {
  return NextResponse.json({ settings: await getAiSettings() });
}

const bodySchema = z.object({
  apiKey: z.string().max(500).optional(),
  model: z.string().optional(),
  monthlyBudgetUsd: z.number().nonnegative().max(100000).nullable().optional(),
});

export async function PUT(req: Request) {
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return err(400, "BAD_REQUEST", body.error.issues[0]?.message ?? "Invalid body");
  try {
    return NextResponse.json({ settings: await saveAiSettings(body.data) });
  } catch (e) {
    if (e instanceof AiError) return err(400, e.code, e.message);
    throw e;
  }
}

/** Remove the stored key (AI actions turn off). */
export async function DELETE() {
  return NextResponse.json({ settings: await removeAiKey() });
}
