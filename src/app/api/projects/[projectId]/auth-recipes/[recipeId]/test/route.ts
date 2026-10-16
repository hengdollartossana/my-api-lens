import { NextResponse } from "next/server";
import { z } from "zod";
import { testAuth } from "@/core/executor";
import {
  buildAuthContext,
  EnvironmentNotFoundError,
  guardFor,
  tokenCache,
} from "@/lib/auth-runner";

type Ctx = { params: Promise<{ projectId: string; recipeId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

/** "Test auth": logs in for real and reports ok/failed. The token is never returned. */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId, recipeId } = await params;
  const parsed = z
    .object({ environmentId: z.uuid() })
    .safeParse(await req.json().catch(() => null));
  if (
    !z.uuid().safeParse(projectId).success ||
    !z.uuid().safeParse(recipeId).success ||
    !parsed.success
  ) {
    return err(400, "BAD_REQUEST", "projectId, recipeId and environmentId must be valid ids");
  }
  try {
    const ctx = await buildAuthContext(projectId, parsed.data.environmentId, recipeId);
    const result = await testAuth(ctx, tokenCache, { guard: guardFor(ctx.env.baseUrl) });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof EnvironmentNotFoundError)
      return err(404, "NOT_FOUND", "Environment not found");
    throw e;
  }
}
