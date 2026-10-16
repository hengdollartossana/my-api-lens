import { NextResponse } from "next/server";
import { z } from "zod";
import { listModules } from "@/db/modules";

type Ctx = { params: Promise<{ projectId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid project id" } },
      { status: 400 },
    );
  }
  return NextResponse.json({ modules: await listModules(projectId) });
}
