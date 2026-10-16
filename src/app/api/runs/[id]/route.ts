import { NextResponse } from "next/server";
import { z } from "zod";
import { getRunDetail } from "@/db/runs";

type Ctx = { params: Promise<{ id: string }> };

/** One run with every stored result (redacted request, response headers and body). */
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid run id" } },
      { status: 400 },
    );
  }
  const detail = await getRunDetail(id);
  if (!detail) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Run not found" } },
      { status: 404 },
    );
  }
  return NextResponse.json(detail);
}
