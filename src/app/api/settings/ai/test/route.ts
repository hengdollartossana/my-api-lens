import { NextResponse } from "next/server";
import { runAi } from "@/db/ai";
import { aiErrorResponse } from "@/lib/ai-http";

/** Make one tiny call with the stored key and report tokens and cost. */
export async function POST() {
  try {
    const r = await runAi("settings-test", {
      prompt: "Reply with the single word: ok",
      maxTokens: 1024,
    });
    return NextResponse.json({ ok: true, model: r.model, usage: r.usage, costUsd: r.costUsd });
  } catch (e) {
    const res = aiErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
