import { NextResponse } from "next/server";
import { AiError } from "@/core/ai";
import { AiDisabledError, runAi } from "@/db/ai";

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** Make one tiny call with the stored key and report tokens and cost. */
export async function POST() {
  try {
    const r = await runAi("settings-test", {
      prompt: "Reply with the single word: ok",
      maxTokens: 1024,
    });
    return NextResponse.json({ ok: true, model: r.model, usage: r.usage, costUsd: r.costUsd });
  } catch (e) {
    if (e instanceof AiDisabledError) return err(409, "AI_DISABLED", e.message);
    if (e instanceof AiError) {
      const status =
        e.code === "AUTH"
          ? 401
          : e.code === "RATE_LIMIT"
            ? 429
            : e.code === "BAD_REQUEST"
              ? 400
              : 502;
      return err(status, e.code, e.message);
    }
    throw e;
  }
}
