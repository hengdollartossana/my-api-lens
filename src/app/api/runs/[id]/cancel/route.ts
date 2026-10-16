import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelRun } from "@/lib/run-service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid run id" } },
      { status: 400 },
    );
  }
  const outcome = await cancelRun(id);
  if (outcome === "not_found") {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Run not found" } },
      { status: 404 },
    );
  }
  if (outcome === "not_running") {
    return NextResponse.json(
      { error: { code: "CONFLICT", message: "Run is not running" } },
      { status: 409 },
    );
  }
  return NextResponse.json({ status: "cancelling" }, { status: 202 });
}
