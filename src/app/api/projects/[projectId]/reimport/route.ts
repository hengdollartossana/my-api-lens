import { NextResponse } from "next/server";
import { z } from "zod";
import { type ParseErrorCode, ParseSpecError } from "@/core/parser";
import { getProject, ReimportError, reimportProject } from "@/db/projects";
import { assertAllowedTarget, SsrfError } from "@/lib/ssrf";

type Ctx = { params: Promise<{ projectId: string }> };

const MAX_SPEC_BYTES = 10 * 1024 * 1024;

const err = (status: number, code: string, message: string) =>
  NextResponse.json({ error: { code, message } }, { status });

const PARSE_STATUS: Record<ParseErrorCode, number> = {
  INVALID_SPEC: 400,
  UNSUPPORTED_VERSION: 400,
  TOO_LARGE: 413,
  FETCH_TIMEOUT: 504,
  FETCH_FAILED: 502,
};

/**
 * Re-import a project's spec and return a change summary. Send a multipart `file`, JSON `{ url }`,
 * or an empty JSON body to fetch the project's stored spec URL again.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { projectId } = await params;
  if (!z.uuid().safeParse(projectId).success) return err(400, "BAD_REQUEST", "Invalid project id");
  const project = await getProject(projectId);
  if (!project) return err(404, "NOT_FOUND", "Project not found");

  let source: { url: string } | { text: string; filename?: string };
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const file = (await req.formData().catch(() => null))?.get("file");
    if (!(file instanceof File)) return err(400, "BAD_REQUEST", "Attach a spec file as `file`");
    if (file.size > MAX_SPEC_BYTES) return err(413, "TOO_LARGE", "Spec files can be at most 10 MB");
    source = { text: await file.text(), filename: file.name };
  } else {
    const body = z
      .object({ url: z.url({ protocol: /^https?$/ }).optional() })
      .safeParse(await req.json().catch(() => ({})));
    if (!body.success) return err(400, "BAD_REQUEST", "Invalid body");
    const url = body.data.url ?? project.specUrl;
    if (!url)
      return err(400, "BAD_REQUEST", "This project was imported from a file: upload the new spec");
    try {
      await assertAllowedTarget(url, url);
    } catch (e) {
      if (e instanceof SsrfError) return err(400, e.code, e.message);
      throw e;
    }
    source = { url };
  }

  try {
    return NextResponse.json(await reimportProject(projectId, source));
  } catch (e) {
    if (e instanceof ParseSpecError) return err(PARSE_STATUS[e.code], e.code, e.message);
    if (e instanceof ReimportError) return err(e.status, "NOT_FOUND", e.message);
    throw e;
  }
}
