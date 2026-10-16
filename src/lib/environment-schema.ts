import { z } from "zod";

/** Validation shared by the environment API and the form. */

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HAS_CONTROL = /[\u0000-\u001f\u007f]/;

export const baseUrlSchema = z
  .string()
  .trim()
  .min(1, "Base URL is required")
  .superRefine((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Base URL must be a valid http(s) URL, e.g. https://api.example.com",
      });
      return;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
      ctx.addIssue({
        code: "custom",
        message: "Base URL must be a valid http(s) URL, e.g. https://api.example.com",
      });
    } else if (u.username || u.password) {
      ctx.addIssue({
        code: "custom",
        message: "Do not put credentials in the URL; use an auth recipe",
      });
    }
  })
  // No trailing slash, so "/path" joins cleanly.
  .transform((v) => v.replace(/\/+$/, ""));

export const headersSchema = z
  .record(
    z.string().trim().regex(HEADER_NAME, "Invalid header name"),
    z
      .string()
      .refine((v) => !HAS_CONTROL.test(v), "Header values cannot contain control characters"),
  )
  .default({});

export const environmentInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  baseUrl: baseUrlSchema,
  isProd: z.boolean().default(false),
  defaultHeaders: headersSchema,
});

export const environmentPatch = environmentInput.partial();

export type EnvironmentInput = z.infer<typeof environmentInput>;

/** First problem per field, for showing under the inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
