import { NextResponse } from "next/server";
import { z } from "zod";
import { buildDiffReport } from "@/core/report";
import { listLatestDiffs } from "@/db/diffs";
import { getProject } from "@/db/projects";

type Ctx = { params: Promise<{ projectId: string }> };

const query = z.object({
  format: z.enum(["md", "html"]).default("md"),
  environmentId: z.uuid().optional(),
});

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "project";

/** Download the diff report as Markdown (`format=md`) or a self-contained HTML page (`format=html`). */
export async function GET(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  const parsed = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!z.uuid().safeParse(projectId).success || !parsed.success) {
    return NextResponse.json(
      { error: { code: "BAD_REQUEST", message: "Invalid request" } },
      { status: 400 },
    );
  }
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Project not found" } },
      { status: 404 },
    );
  }

  const rows = await listLatestDiffs(projectId, { environmentId: parsed.data.environmentId });
  const report = buildDiffReport({
    project: project.name,
    generatedAt: new Date().toISOString(),
    endpoints: rows.map((r) => ({
      module: r.moduleName,
      method: r.method,
      path: r.path,
      environment: r.environmentName,
      isProd: r.isProd,
      ranAt: r.ranAt,
      statusCode: r.statusCode,
      items: r.items,
    })),
  });

  const html = parsed.data.format === "html";
  return new Response(html ? report.html : report.markdown, {
    headers: {
      "content-type": html ? "text/html; charset=utf-8" : "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="api-diff-${slug(project.name)}.${html ? "html" : "md"}"`,
      "cache-control": "no-store",
    },
  });
}
