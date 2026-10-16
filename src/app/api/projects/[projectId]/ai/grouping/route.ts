import { NextResponse } from "next/server";
import { z } from "zod";
import { proposeGrouping } from "@/db/ai-grouping";
import { aiErrorResponse } from "@/lib/ai-http";

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Ask the AI where the `Ungrouped` endpoints belong. Read-only: returns proposals and the call's
 * tokens and cost; nothing is changed until the user approves them (`./apply`).
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid id" } },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await proposeGrouping(projectId));
  } catch (e) {
    const res = aiErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
