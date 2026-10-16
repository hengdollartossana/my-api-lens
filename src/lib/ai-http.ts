import { NextResponse } from "next/server";
import { AiError } from "@/core/ai";
import { AiDisabledError } from "@/db/ai";

const STATUS: Record<AiError["code"], number> = {
  AUTH: 401,
  RATE_LIMIT: 429,
  BAD_REQUEST: 400,
  REFUSED: 502,
  UNAVAILABLE: 502,
};

/** Route-handler response for an AI failure, or null when `e` is something else. */
export function aiErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof AiDisabledError)
    return NextResponse.json(
      { error: { code: "AI_DISABLED", message: e.message } },
      { status: 409 },
    );
  if (e instanceof AiError)
    return NextResponse.json(
      { error: { code: e.code, message: e.message } },
      { status: STATUS[e.code] },
    );
  return null;
}
