import { NextResponse } from "next/server";
import { z } from "zod";
import { type ParseErrorCode, ParseSpecError } from "@/core/parser";
import { importProject } from "@/db/projects";
import { assertAllowedTarget, SsrfError } from "@/lib/ssrf";

const MAX_SPEC_BYTES = 10 * 1024 * 1024;

const jsonBody = z.object({
  url: z.url({ protocol: /^https?$/ }),
  name: z.string().trim().max(120).optional(),
});

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
 * Import a spec from a URL (JSON body `{ url, name? }`) or an uploaded file (multipart `file`, `name?`),
 * then parse, group and persist it in one transaction. A broken spec creates nothing.
 */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  let name: string | undefined;
  let source: { url: string } | { text: string; filename?: string };

  if (type.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File))
      return err(400, "BAD_REQUEST", "Attach a spec file as `file`");
    if (file.size > MAX_SPEC_BYTES) return err(413, "TOO_LARGE", "Spec files can be at most 10 MB");
    name = typeof form.get("name") === "string" ? (form.get("name") as string) : undefined;
    source = { text: await file.text(), filename: file.name };
  } else {
    const parsed = jsonBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err(400, "BAD_REQUEST", "Send { url } or a multipart `file`");
    name = parsed.data.name;
    source = { url: parsed.data.url };
    try {
      await assertAllowedTarget(parsed.data.url, parsed.data.url);
    } catch (e) {
      if (e instanceof SsrfError) return err(400, e.code, e.message);
      throw e;
    }
  }

  try {
    const project = await importProject({ name, source });
    return NextResponse.json({ project }, { status: 201 });
  } catch (e) {
    if (e instanceof ParseSpecError) return err(PARSE_STATUS[e.code], e.code, e.message);
    throw e;
  }
}
