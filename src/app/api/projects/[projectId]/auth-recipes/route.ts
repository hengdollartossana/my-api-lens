import { NextResponse } from "next/server";
import { z } from "zod";
import { listAuthRecipes, saveAuthRecipe } from "@/db/auth-recipes";

type Ctx = { params: Promise<{ projectId: string }> };

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const body = z.object({
  environmentId: z.uuid().nullable().optional(),
  recipe: z.unknown(),
  secret: z.string().min(1).optional(),
});

export async function GET(_req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid project id");
  return NextResponse.json({ recipes: await listAuthRecipes(projectId) });
}

/** Create or replace the recipe for a project (or one environment). The secret is never echoed back. */
export async function PUT(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid project id");
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err(400, "BAD_REQUEST", "Invalid request body");
  try {
    const saved = await saveAuthRecipe({ projectId, ...parsed.data });
    return NextResponse.json({ recipe: saved });
  } catch (e) {
    if (e instanceof z.ZodError) return err(400, "INVALID_RECIPE", "Recipe config is invalid");
    throw e;
  }
}
