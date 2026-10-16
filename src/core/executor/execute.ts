import { request } from "undici";
import { redactRequest } from "./request";
import type { BuiltRequest, ExecErrorCode, ExecResult, ExecuteOptions } from "./types";

export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function failure(
  req: BuiltRequest,
  started: number,
  code: ExecErrorCode,
  message: string,
): ExecResult {
  return {
    status: null,
    headers: {},
    durationMs: Date.now() - started,
    body: null,
    bodyText: "",
    truncated: false,
    error: { code, message },
    request: redactRequest(req),
  };
}

function parseBody(text: string, contentType: string, truncated: boolean): unknown | null {
  if (!text) return null;
  const jsonish = /json/i.test(contentType);
  if (!truncated && (jsonish || /^\s*[{[]/.test(text))) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to plain text
    }
  }
  return text;
}

/** Send a built request. Never throws: timeouts, network errors and guard blocks come back in `error`. */
export async function execute(req: BuiltRequest, opts: ExecuteOptions = {}): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const started = Date.now();

  try {
    await opts.guard?.(req.url);
  } catch (err) {
    return failure(req, started, "BLOCKED", (err as Error).message);
  }

  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await request(req.url, {
      method: req.method as "GET",
      headers: req.headers,
      body: req.body,
      signal,
    });

    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    for await (const chunk of res.body) {
      const buf = chunk as Buffer;
      if (size + buf.length > maxBytes) {
        chunks.push(buf.subarray(0, maxBytes - size));
        size = maxBytes;
        truncated = true;
        res.body.on("error", () => {});
        res.body.destroy();
        break;
      }
      chunks.push(buf);
      size += buf.length;
    }

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) {
      if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(", ") : String(v);
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");
    return {
      status: res.statusCode,
      headers,
      durationMs: Date.now() - started,
      body: parseBody(bodyText, headers["content-type"] ?? "", truncated),
      bodyText,
      truncated,
      request: redactRequest(req),
    };
  } catch (err) {
    if (signal.aborted) {
      return failure(req, started, "TIMEOUT", `Request timed out after ${timeoutMs} ms`);
    }
    return failure(req, started, "NETWORK", (err as Error).message);
  }
}
