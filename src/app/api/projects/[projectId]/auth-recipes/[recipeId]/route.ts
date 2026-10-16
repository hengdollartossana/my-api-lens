import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAuthRecipe } from "@/db/auth-recipes";

type Ctx = { params: Promise<{ projectId: string; recipeId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { projectId, recipeId } = await params;
  if (!z.uuid().safeParse(projectId).success || !z.uuid().safeParse(recipeId).success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid id" } },
      { status: 400 },
    );
  }
  if (!(await deleteAuthRecipe(projectId, recipeId))) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Recipe not found" } },
      { status: 404 },
    );
  }
  return new NextResponse(null, { status: 204 });
}
