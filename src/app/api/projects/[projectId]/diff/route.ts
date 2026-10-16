import { NextResponse } from "next/server";
import { z } from "zod";
import { listLatestDiffs } from "@/db/diffs";

type Ctx = { params: Promise<{ projectId: string }> };

/** Latest diff per endpoint. Optional `environmentId` limits it to one environment. */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  const environmentId = new URL(req.url).searchParams.get("environmentId") ?? undefined;
  if (
    !z.uuid().safeParse(projectId).success ||
    (environmentId && !z.uuid().safeParse(environmentId).success)
  ) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid id" } },
      { status: 400 },
    );
  }
  return NextResponse.json({ rows: await listLatestDiffs(projectId, { environmentId }) });
}
